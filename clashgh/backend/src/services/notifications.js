import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { mail } from './mail.js';
import { push } from './push.js';

/**
 * Notifications (Module 3E) — transactional outbox.
 *
 *   notify(q, { userId, template, payload, channels })
 *     writes one `notifications` row per channel using the caller's query
 *     handle `q` (a pool OR a transaction client) — so the row commits and
 *     rolls back WITH the business change that caused it. Nothing is sent
 *     here; a provider outage can never block a money transaction.
 *
 *   runNotificationsSweep()
 *     every 20s: claim due pending rows (SKIP LOCKED — safe with several
 *     API instances), render the template, send via mail/push, mark
 *     sent/failed. Backoff 1m → 5m → 30m, 5 attempts then 'failed'.
 *
 *   Admin alerts: userId = null → email to ADMIN_ALERT_EMAIL (skipped if unset).
 *
 * Channel policy (user decision 2026-09-15: email instead of SMS):
 *   email  — money + outcomes (receipt, payout, refund, dispute resolved,
 *            match ready incl. room code so it survives a dead phone)
 *   push   — everything time-sensitive (match ready, opponent submitted,
 *            result, dispute, lobby full, cancelled)
 */

const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = 5;

export const cedis = (pesewas) => `₵${(Number(pesewas) / 100).toFixed(2)}`;
const when = (iso) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Accra', dateStyle: 'medium', timeStyle: 'short' }) + ' GMT';

/**
 * template → { push: {title, body} | null, email: {subject, text} | null }
 * `u` is the recipient (username, email); `p` is the stored payload.
 */
export const TEMPLATES = {
  match_ready: (u, p) => ({
    push: {
      title: `Your match is live — ${p.tournament_title}`,
      body: `Room code ${p.room_code}. You vs ${p.opponent_username}. Submit your result by ${when(p.deadline_at)}.`,
    },
    email: {
      subject: `Room code ${p.room_code} — your ${p.tournament_title} match is live`,
      text: [
        `Hi ${u.username ?? 'player'},`,
        ``,
        `Your round ${p.round} match in "${p.tournament_title}" has started.`,
        ``,
        `  Opponent:   ${p.opponent_username}`,
        `  Room code:  ${p.room_code}`,
        `  Deadline:   ${when(p.deadline_at)}`,
        ``,
        `Play the match in-game, then open ClashGH and submit your result with a screenshot of the final score before the deadline. If only one of you submits "won" by the deadline, that result stands.`,
        ``,
        `Good luck!`,
        `— ClashGH`,
      ].join('\n'),
    },
  }),

  opponent_submitted: (u, p) => ({
    push: {
      title: `${p.opponent_username} submitted their result`,
      body: `Submit yours for ${p.tournament_title} before ${when(p.deadline_at)} to lock the match.`,
    },
    email: null,
  }),

  match_result: (u, p) => ({
    push: {
      title: p.won ? `You won your match! 🏆` : `Match over — ${p.tournament_title}`,
      body: p.won
        ? p.is_final
          ? `You are the ${p.tournament_title} champion. Prize on its way.`
          : `You advance to round ${p.round + 1} of ${p.tournament_title}.`
        : `${p.winner_username} took this one. ${p.is_final ? 'Runner-up prize on its way.' : 'Better luck next time.'}`,
    },
    email: null,
  }),

  start_reminder: (u, p) => ({
    push: {
      title: `${p.tournament_title} starts in ${p.minutes} min`,
      body: `Be online and ready — your room code arrives at kick-off.`,
    },
    email: null,
  }),

  lobby_full: (u, p) => ({
    push: {
      title: `${p.tournament_title} is full`,
      body: `Bracket is set. Round 1 starts ${when(p.starts_at)} — you'll get your room code then.`,
    },
    email: null,
  }),

  entry_receipt: (u, p) => ({
    push: null,
    email: {
      subject: `Receipt: ${cedis(p.amount_pesewas)} entry — ${p.tournament_title}`,
      text: [
        `Hi ${u.username ?? 'player'},`,
        ``,
        `Your entry fee for "${p.tournament_title}" was received.`,
        ``,
        `  Amount:      ${cedis(p.amount_pesewas)}`,
        `  Paid from:   ${p.phone ?? 'your MoMo number'}`,
        `  Starts:      ${when(p.starts_at)}`,
        `  Reference:   ${p.reference}`,
        ``,
        `Your seat is locked. Prizes are paid to the same MoMo number.`,
        `— ClashGH`,
      ].join('\n'),
    },
  }),

  payout_sent: (u, p) => ({
    push: {
      title: `${cedis(p.amount_pesewas)} sent to your MoMo`,
      body: `${p.label} for ${p.tournament_title}. Check ${p.phone}.`,
    },
    email: {
      subject: `${cedis(p.amount_pesewas)} sent — ${p.label}, ${p.tournament_title}`,
      text: [
        `Congratulations ${u.username ?? 'player'}!`,
        ``,
        `  ${p.label}:  ${cedis(p.amount_pesewas)}`,
        `  Sent to:     ${p.phone} (${p.momo_provider ?? 'MoMo'})`,
        `  Tournament:  ${p.tournament_title}`,
        ``,
        `Mobile Money transfers usually land within minutes. If it hasn't arrived in 24 hours, reply to this email with the tournament name.`,
        `— ClashGH`,
      ].join('\n'),
    },
  }),

  refund_issued: (u, p) => ({
    push: {
      title: `${cedis(p.amount_pesewas)} refunded`,
      body: `${p.tournament_title} was cancelled. Refund sent to ${p.phone}.`,
    },
    email: {
      subject: `Refund of ${cedis(p.amount_pesewas)} — ${p.tournament_title} cancelled`,
      text: [
        `Hi ${u.username ?? 'player'},`,
        ``,
        `"${p.tournament_title}" was cancelled${p.reason ? ` (${p.reason})` : ''}. Your full entry fee is being returned.`,
        ``,
        `  Refund:   ${cedis(p.amount_pesewas)}`,
        `  Sent to:  ${p.phone}`,
        ``,
        `Sorry about that — see you in the next one.`,
        `— ClashGH`,
      ].join('\n'),
    },
  }),

  tournament_cancelled: (u, p) => ({
    push: {
      title: `${p.tournament_title} cancelled`,
      body: `Your ${cedis(p.amount_pesewas)} entry fee is being refunded to your MoMo.`,
    },
    email: null,
  }),

  dispute_opened: (u, p) => ({
    push: {
      title: `Match under review — ${p.tournament_title}`,
      body: p.reason,
    },
    email: null,
  }),

  dispute_resolved: (u, p) => ({
    push: {
      title: `Dispute resolved — ${p.tournament_title}`,
      body: p.outcome,
    },
    email: {
      subject: `Dispute resolved — ${p.tournament_title}`,
      text: [
        `Hi ${u.username ?? 'player'},`,
        ``,
        `An admin reviewed your disputed round ${p.round} match in "${p.tournament_title}".`,
        ``,
        `  Decision:  ${p.outcome}`,
        ``,
        `Decisions are based on the screenshots both players submitted. Repeated disputes are tracked.`,
        `— ClashGH`,
      ].join('\n'),
    },
  }),

  // ---- hosts ----
  host_approved: (u, p) => ({
    push: { title: 'You are now a ClashGH host 🎙️', body: 'Open Host Studio in your account to publish your first tournament.' },
    email: {
      subject: 'Welcome aboard — you can now host tournaments on ClashGH',
      text: `Hi ${u.username},\n\nYour host application is approved. Open Account → Host Studio in the app to publish a tournament.\n\nHow the money works: players pay entry fees into ClashGH escrow. After the final, prizes go to the winners and the remainder (your cut, max ${env.hostCutMaxPercent}%) is split ${100 - env.hostCommissionPercent}% to you / ${env.hostCommissionPercent}% to ClashGH, sent straight to your MoMo.\n\nRun clean, on-time tournaments — disputes and refunds are handled by ClashGH.`,
    },
  }),
  host_suspended: (u, p) => ({
    push: { title: 'Host access suspended', body: p.reason || 'Contact support for details.' },
    email: { subject: 'Your ClashGH host access has been suspended', text: `Hi ${u.username},\n\nYour host access was suspended.${p.reason ? `\nReason: ${p.reason}` : ''}\n\nExisting tournaments continue to be settled by ClashGH. Reply to this email to appeal.` },
  }),

  // ---- admin alerts (user_id NULL → ADMIN_ALERT_EMAIL) ----
  admin_host_application: (u, p) => ({
    push: null,
    email: {
      subject: `[ClashGH] Host application: ${p.username}`,
      text: `${p.username} (${p.email}) wants to host.\n\n"${p.note}"\n\nApprove or decline in the admin panel → Hosts.\nuser_id: ${p.user_id}`,
    },
  }),
  admin_dispute: (u, p) => ({
    push: null,
    email: {
      subject: `[ClashGH] Dispute: ${p.tournament_title} R${p.round}M${p.match_number}`,
      text: `${p.player1_username} vs ${p.player2_username}\nReason: ${p.reason}\n\nResolve in the admin panel → Disputes.\nmatch_id: ${p.match_id}`,
    },
  }),
  admin_money_invariant: (u, p) => ({
    push: null,
    email: {
      subject: `[ClashGH] Money invariant VIOLATION (${p.violations.length})`,
      text: `The hourly ledger check found:\n\n${p.violations.map((v) => `- ${v}`).join('\n')}\n\nReview transactions in the admin panel before the next payout run.`,
    },
  }),
  admin_payout_failed: (u, p) => ({
    push: null,
    email: {
      subject: `[ClashGH] ${(p.tx_type ?? 'payout').toUpperCase()} FAILED — ${cedis(p.amount_pesewas)} to ${p.username}`,
      text: `Transaction ${p.tx_id} (${p.tournament_title}) — ${p.tx_type === 'refund' ? 'refund transfer failed (refunds are not auto-retried)' : `failed after ${p.attempts} attempt(s)`}.\nPhone: ${p.phone}\n\nCheck the Paystack dashboard, then use "Re-run payout" / resolve the refund in the admin panel.`,
    },
  }),
};

/**
 * Enqueue a notification. `q` = pool or transaction client.
 * channels default: every channel the template defines.
 */
export async function notify(q, { userId = null, template, payload = {}, channels = null }) {
  const def = TEMPLATES[template];
  if (!def) throw new Error(`Unknown notification template '${template}'`);
  const probe = def({ username: 'x' }, payload);
  const wanted = (channels ?? ['email', 'push']).filter((c) => probe[c]);
  for (const channel of wanted) {
    if (userId === null && channel !== 'email') continue; // admin alerts are email-only
    await q.query(
      `INSERT INTO public.notifications (user_id, channel, template, payload) VALUES ($1, $2, $3, $4)`,
      [userId, channel, template, JSON.stringify(payload)],
    );
  }
}

/** Convenience: same template to several users. */
export async function notifyMany(q, userIds, spec) {
  for (const userId of userIds.filter(Boolean)) await notify(q, { ...spec, userId });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function deliver(row) {
  const isAdmin = row.user_id === null;
  let user = { username: 'admin', email: env.adminAlertEmail };
  if (!isAdmin) {
    const { rows: [u] } = await pool.query('SELECT username, email FROM public.users WHERE id = $1', [row.user_id]);
    if (!u) return { skipped: 'user deleted' };
    user = u;
  }
  const rendered = TEMPLATES[row.template](user, row.payload)[row.channel];
  if (!rendered) return { skipped: 'template has no content for this channel' };

  if (row.channel === 'email') {
    if (!user.email) return { skipped: isAdmin ? 'ADMIN_ALERT_EMAIL not set' : 'user has no email' };
    await mail.send({ to: user.email, subject: rendered.subject, text: rendered.text });
    return { sent: true };
  }

  // push — fan out to every device; prune dead tokens
  const { rows: tokens } = await pool.query('SELECT token FROM public.push_tokens WHERE user_id = $1', [row.user_id]);
  if (tokens.length === 0) return { skipped: 'no push tokens' };
  const messages = tokens.map(({ token }) => ({
    to: token,
    title: rendered.title,
    body: rendered.body,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: { template: row.template, ...row.payload },
  }));
  const tickets = await push.send(messages);
  const dead = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered').map((t) => t.token);
  if (dead.length) await pool.query('DELETE FROM public.push_tokens WHERE token = ANY($1)', [dead]);
  return { sent: true, devices: tokens.length - dead.length };
}

/** Housekeeping: delivered/skipped rows older than 30 days are just noise. */
export async function purgeOldNotifications() {
  const { rowCount } = await pool.query(
    `DELETE FROM public.notifications WHERE status IN ('sent', 'skipped') AND created_at < now() - interval '30 days'`,
  );
  return rowCount;
}

export async function runNotificationsSweep(limit = 50) {
  const client = await pool.connect();
  let claimed;
  try {
    await client.query('BEGIN');
    ({ rows: claimed } = await client.query(
      `UPDATE public.notifications SET attempts = attempts + 1
       WHERE id IN (SELECT id FROM public.notifications
                    WHERE status = 'pending' AND next_attempt_at <= now()
                    ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [limit],
    ));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const summary = { sent: 0, skipped: 0, retry: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const r = await deliver(row);
      if (r.skipped) {
        summary.skipped += 1;
        await pool.query(`UPDATE public.notifications SET status = 'skipped', last_error = $2 WHERE id = $1`, [row.id, r.skipped]);
      } else {
        summary.sent += 1;
        await pool.query(`UPDATE public.notifications SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1`, [row.id]);
      }
    } catch (err) {
      const final = row.attempts >= MAX_ATTEMPTS;
      summary[final ? 'failed' : 'retry'] += 1;
      const mins = BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)];
      await pool.query(
        `UPDATE public.notifications
         SET status = $2, last_error = $3, next_attempt_at = now() + make_interval(mins => $4)
         WHERE id = $1`,
        [row.id, final ? 'failed' : 'pending', String(err.message).slice(0, 500), mins],
      );
      console.error(`[notify] ${row.template}/${row.channel} → ${row.user_id ?? 'admin'} failed (attempt ${row.attempts}): ${err.message}`);
    }
  }
  if (claimed.length) console.log(`[notify] sent=${summary.sent} skipped=${summary.skipped} retry=${summary.retry} failed=${summary.failed}`);
  return summary;
}

/**
 * Scheduled-start reminders (agent.md §6 3E): 30 and 5 minutes before
 * `starts_at` for every paid player of a full/open tournament. Idempotent
 * via a NOT EXISTS check on (user, template, tournament, minutes) — safe to
 * run every sweep. Push only.
 */
export async function enqueueStartReminders() {
  let queued = 0;
  for (const minutes of [30, 5]) {
    const { rowCount } = await pool.query(
      `INSERT INTO public.notifications (user_id, channel, template, payload)
       SELECT r.user_id, 'push', 'start_reminder',
              jsonb_build_object('tournament_title', t.title, 'tournament_id', t.id, 'minutes', $1::int, 'starts_at', t.starts_at)
       FROM public.tournaments t
       JOIN public.registrations r ON r.tournament_id = t.id AND r.payment_status = 'paid'
       WHERE t.status = 'full'  -- a lobby that never filled has nothing to remind about
         AND t.starts_at BETWEEN now() AND now() + make_interval(mins => $1)
         AND NOT EXISTS (
           SELECT 1 FROM public.notifications n
           WHERE n.user_id = r.user_id AND n.template = 'start_reminder'
             AND n.payload->>'tournament_id' = t.id::text AND (n.payload->>'minutes')::int = $1
         )`,
      [minutes],
    );
    queued += rowCount;
  }
  return queued;
}
