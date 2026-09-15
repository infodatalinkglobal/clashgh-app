import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { notify, notifyMany } from './notifications.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errorHandler.js';
import { computeSplit } from '../utils/prize.js';
import { generateBracket } from './bracket.js';
import { paystack } from './paystack.js';

/**
 * Money service — entry fees (1C), refunds & payouts via MoMo transfers (1E).
 *
 * Modes:
 *  - PAYSTACK_MODE=stub (dev): charges settle through
 *    /api/dev/paystack/simulate-charge; transfers "complete" immediately.
 *  - PAYSTACK_MODE=live: real Paystack Charge + Transfer APIs; state
 *    changes arrive via the signed webhook (/api/paystack/webhook),
 *    which is the ONLY settlement path.
 *
 * Money invariants:
 *  - one entry_fee transaction per registration (settle is idempotent)
 *  - settlement only for PENDING registrations inside the payment window
 *  - paid_count reaches max_players → tournament 'full' + bracket (1D)
 *  - at most ONE payout per (match, user) — enforced by the partial
 *    unique index (final match legitimately has two payout rows)
 */

// ---------------------------------------------------------------------------
// Entry-fee charges (1C)
// ---------------------------------------------------------------------------

/**
 * Begin an entry-fee charge. Returns { reference, authorization_url, ... }.
 * The reference is stored on the registration; settlement later looks it
 * up by that exact string (webhook in live mode, dev endpoint in stub).
 *
 * IMPORTANT: call this OUTSIDE any DB transaction (it is an HTTP call in
 * live mode); the join flow is structured around that.
 */
export async function initiateEntryFeeCharge({ user, tournament }) {
  if (env.paystackMode === 'live') {
    const reference = `CHRG_${crypto.randomUUID()}`;
    const data = await paystack.initCharge({
      email: user.email,
      amountPesewas: tournament.entry_fee_pesewas,
      reference,
      metadata: { user_id: user.id, tournament_id: tournament.id },
    });
    return {
      reference: data.reference ?? reference,
      channel: 'mobile_money',
      provider: user.momo_provider,
      amount_pesewas: tournament.entry_fee_pesewas,
      authorization_url: data.authorization?.authorization_url ?? null,
      note: 'Approve the charge on your phone to lock your spot',
    };
  }
  return {
    reference: `CHRG_DEV_${crypto.randomUUID()}`,
    channel: 'mobile_money',
    provider: user.momo_provider,
    amount_pesewas: tournament.entry_fee_pesewas,
    authorization_url: null,
    note: 'Dev mode: settle with POST /api/dev/paystack/simulate-charge {reference, success:true}',
  };
}

/**
 * Settle a successful charge. Idempotent: an already-settled or expired
 * reference settles exactly once. (1E: called by the verified
 * charge.success webhook; 1C: by the dev simulate endpoint.)
 */
export async function settleChargeSuccess(reference, chargeData = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE public.registrations r
       SET payment_status = 'paid'
       FROM public.tournaments t
       WHERE r.payment_reference = $1
         AND r.payment_status = 'pending'
         AND r.created_at > now() - make_interval(mins => $2)
         AND t.id = r.tournament_id
       RETURNING r.id, r.tournament_id, r.user_id,
                 t.entry_fee_pesewas AS fee, t.title AS title, t.max_players, t.starts_at`,
      [reference, env.registrationPendingTtlMinutes],
    );

    if (rows.length === 0) {
      await client.query('COMMIT');
      // Money may have moved for a seat we no longer hold (MoMo approval
      // after the 10-min window, reaper already released the slot, or the
      // lobby filled meanwhile). That money must go straight back.
      const late = await refundLateCharge(reference, chargeData);
      return { settled: false, reason: late ? 'payment arrived after the window — refunded' : 'reference unknown or already settled', late_refund: late };
    }

    const reg = rows[0];
    await client.query(
      `INSERT INTO public.transactions
         (user_id, tournament_id, type, amount_pesewas, status, paystack_reference, direction, description)
       VALUES ($1, $2, 'entry_fee', $3, 'success', $4, 'in', $5)`,
      [reg.user_id, reg.tournament_id, reg.fee, reference, `Entry fee — ${reg.title}`],
    );

    const { rows: [fullCheck] } = await client.query(
      `UPDATE public.tournaments t
       SET status = 'full'
       WHERE t.id = $1
         AND t.status = 'open'
         AND (SELECT count(*) FROM public.registrations r
               WHERE r.tournament_id = t.id AND r.payment_status = 'paid') = t.max_players
       RETURNING t.id`,
      [reg.tournament_id],
    );

    // 3E: receipt to the payer; "lobby full" to every paid player.
    const { rows: [payer] } = await client.query('SELECT phone FROM public.users WHERE id = $1', [reg.user_id]);
    await notify(client, {
      userId: reg.user_id,
      template: 'entry_receipt',
      payload: { tournament_title: reg.title, amount_pesewas: reg.fee, phone: payer?.phone, starts_at: reg.starts_at, reference, tournament_id: reg.tournament_id },
    });
    if (fullCheck !== undefined) {
      const { rows: players } = await client.query(
        `SELECT user_id FROM public.registrations WHERE tournament_id = $1 AND payment_status = 'paid'`,
        [reg.tournament_id],
      );
      await notifyMany(client, players.map((p) => p.user_id), {
        template: 'lobby_full',
        payload: { tournament_title: reg.title, starts_at: reg.starts_at, tournament_id: reg.tournament_id },
      });
    }

    await client.query('COMMIT');

    // The lobby just filled — generate the bracket NOW (1D). If this
    // throws, the 60s safety sweep regenerates it; money is already
    // settled, so log and continue.
    let bracket = null;
    if (fullCheck !== undefined) {
      try {
        bracket = await generateBracket(reg.tournament_id);
      } catch (err) {
        console.error('[payment] bracket generation failed (sweep will retry):', err.message);
      }
    }

    return { settled: true, registrationId: reg.id, tournamentFull: fullCheck !== undefined, bracket };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A charge succeeded but there is no pending registration to settle. If
 * this reference was never ledgered as an entry_fee (i.e. not a duplicate
 * webhook), record a refund transaction and send the money back. Idempotent
 * on the reference. Amount/user come from Paystack's event data (our
 * metadata) because the registration row may already be gone.
 */
async function refundLateCharge(reference, chargeData) {
  const userId = chargeData?.metadata?.user_id;
  const tournamentId = chargeData?.metadata?.tournament_id ?? null;
  const amount = Number(chargeData?.amount);
  if (!userId || !Number.isInteger(amount) || amount <= 0) return null;

  const { rows: [tx] } = await pool.query(
    `INSERT INTO public.transactions
       (user_id, tournament_id, type, amount_pesewas, status, paystack_reference, direction, description)
     SELECT $1::uuid, $2::uuid, 'refund', $3::int, $4::public.transaction_status, $5::varchar, 'out',
            'Payment arrived after the registration window — refunded'
     WHERE NOT EXISTS (SELECT 1 FROM public.transactions WHERE paystack_reference = $5::varchar)
     RETURNING id, user_id, amount_pesewas, tournament_id, type, description`,
    [userId, tournamentId, amount, env.paystackMode === 'live' ? 'pending' : 'success', reference],
  );
  if (!tx) return null; // duplicate webhook — already handled
  console.warn(`[payment] late charge ${reference} (${amount}p) for user ${userId} — refunding`);
  if (env.paystackMode === 'live') {
    try {
      await initiateTransferForTx(tx);
    } catch (err) {
      // Stays 'pending' → visible in the admin failed/pending transfers list.
      console.error(`[payment] late-charge refund ${tx.id} failed to initiate:`, err.message);
    }
  } else {
    await notifyMoneySent(pool, tx);
  }
  return { tx: tx.id, amount_pesewas: amount };
}

/**
 * Settle a failed charge: no money moved, nothing to ledger. The
 * registration stays pending; the player may rejoin after the payment
 * window (10 min) expires and releases the slot.
 */
export async function settleChargeFailure(reference) {
  const { rows } = await pool.query(
    `SELECT id FROM public.registrations WHERE payment_reference = $1 AND payment_status = 'pending'`,
    [reference],
  );
  return {
    settled: false,
    reason: rows.length
      ? 'charge failed — registration stays pending until the payment window expires'
      : 'reference unknown',
  };
}

// ---------------------------------------------------------------------------
// MoMo transfers: refunds + payouts (1E)
// ---------------------------------------------------------------------------

/** Payout retry backoff — agent.md §9 step 6: 15min / 1h / 6h, max 3. */
export const RETRY_BACKOFF_MINUTES = [15, 60, 360];
export const MAX_PAYOUT_RETRIES = 3;

function backoffDueDate(attempts) {
  const idx = Math.min(Math.max(attempts, 0), RETRY_BACKOFF_MINUTES.length - 1);
  return new Date(Date.now() + RETRY_BACKOFF_MINUTES[idx] * 60_000);
}

/**
 * Atomically claim a FAILED payout/refund row for re-initiation: flips it
 * to 'pending' and bumps attempts in one statement, so two workers (the
 * 60s sweeper + an admin click, or two API instances) can never both
 * initiate a transfer for the same row. Returns the row or null if someone
 * else got there first.
 */
export async function claimForRetry(txId) {
  const { rows: [row] } = await pool.query(
    `UPDATE public.transactions
     SET status = 'pending', attempts = attempts + 1, next_retry_at = NULL
     WHERE id = $1 AND status = 'failed'
     RETURNING id, user_id, amount_pesewas, attempts, tournament_id, type, description`,
    [txId],
  );
  return row ?? null;
}

/** Undo a claim when initiation itself failed (API down etc.). */
export async function releaseFailedClaim(tx, { final }) {
  await pool.query(
    `UPDATE public.transactions SET status = 'failed', next_retry_at = $2 WHERE id = $1 AND status = 'pending'`,
    [tx.id, final ? null : backoffDueDate(tx.attempts)],
  );
}

/** Create recipient + initiate the transfer for a PENDING tx row. */
export async function initiateTransferForTx(tx) {
  const { rows: [user] } = await pool.query(
    'SELECT username, email, phone, momo_provider FROM public.users WHERE id = $1',
    [tx.user_id],
  );
  if (!user || !user.phone) {
    throw new Error(`Cannot transfer: user ${tx.user_id} has no verified phone`);
  }
  const name = user.username ?? user.email;
  const recipient = await paystack.createTransferRecipient({
    name,
    phone: user.phone,
    provider: user.momo_provider,
  });
  const data = await paystack.initTransfer({
    recipient: recipient.recipient ?? recipient,
    amountPesewas: tx.amount_pesewas,
    reason: tx.type === 'refund' ? 'Entry fee refund' : 'Tournament prize',
    metadata: { clashgh_tx: tx.id, tx_type: tx.type },
  });
  const transferCode = data.transfer_code;
  await pool.query('UPDATE public.transactions SET paystack_transfer_code = $2 WHERE id = $1', [
    tx.id,
    transferCode,
  ]);
  return { tx: tx.id, transfer_code: transferCode };
}

/** Alias for the cancel flow — refund transfers use the same initiation. */
export const initiateRefundTransfer = initiateTransferForTx;

/**
 * Webhook-driven transfer status update.
 * 'success' → done. 'failed' → payout rows schedule a retry (backoff,
 * max 3, then FINAL FAILURE + admin alert); refund rows stay 'failed'
 * for admin action (3C).
 */
export async function updateTransferStatus(transferCode, newStatus) {
  const { rows } = await pool.query(
    `SELECT id, type, attempts, user_id, amount_pesewas, description, tournament_id FROM public.transactions
     WHERE paystack_transfer_code = $1 AND status = 'pending'`,
    [transferCode],
  );
  if (rows.length === 0) {
    return { applied: false, reason: 'no pending transaction for this transfer' };
  }
  const tx = rows[0];

  if (newStatus === 'success') {
    await pool.query('UPDATE public.transactions SET status = $2 WHERE id = $1', [tx.id, 'success']);
    await notifyMoneySent(pool, tx);
    return { applied: true, tx: tx.id };
  }

  // failed
  let finalFailure = false;
  let nextRetryAt = null;
  if (tx.type === 'payout' || tx.type === 'host_share') {
    if (tx.attempts >= MAX_PAYOUT_RETRIES) {
      finalFailure = true;
    } else {
      nextRetryAt = backoffDueDate(tx.attempts);
    }
  }
  await pool.query(
    `UPDATE public.transactions SET status = $2, next_retry_at = $3 WHERE id = $1`,
    [tx.id, 'failed', nextRetryAt],
  );
  if (finalFailure || tx.type === 'refund') {
    // Refunds are never auto-retried (agent.md §9) → every failure needs a human.
    console.error(`[payment] ${tx.type.toUpperCase()} ${tx.id} ${finalFailure ? 'FINAL FAILURE' : 'FAILED'} — admin attention required`);
    await notifyPayoutFailed(pool, tx);
  }
  return { applied: true, tx: tx.id, final_failure: finalFailure, next_retry_at: nextRetryAt };
}

/**
 * Execute a tournament's payouts: champion + runner-up prizes via MoMo
 * transfer, platform fee recorded, tournament → 'completed'.
 *
 * Called by the 1F sweeper when the final match completes, and by the
 * admin endpoint (3C one-click re-payout with force=true, which retries
 * FAILED payout rows). Idempotent: existing payout rows block a second
 * initiation; the partial unique index is the DB-level backstop.
 */
export async function executePayout(tournamentId, { force = false } = {}) {
  const isLive = env.paystackMode === 'live';
  const client = await pool.connect();
  const toTransfer = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${tournamentId}`]);

    const { rows: [t] } = await client.query(
      'SELECT * FROM public.tournaments WHERE id = $1 FOR UPDATE',
      [tournamentId],
    );
    if (!t) {
      await client.query('COMMIT');
      throw new ApiError(404, 'Tournament not found');
    }
    if (!['full', 'in_progress', 'completed'].includes(t.status)) {
      await client.query('COMMIT');
      throw new ApiError(409, `Tournament is '${t.status}' — payouts run on a finished bracket`);
    }

    const totalRounds = Math.round(Math.log2(t.max_players));
    const { rows: [finalMatch] } = await client.query(
      'SELECT * FROM public.matches WHERE tournament_id = $1 AND match_round = $2 AND match_number = 1 FOR UPDATE',
      [tournamentId, totalRounds],
    );
    if (!finalMatch || finalMatch.status !== 'completed' || !finalMatch.winner_id) {
      await client.query('COMMIT');
      throw new ApiError(409, 'The final match is not completed yet — no payouts to run');
    }
    const championId = finalMatch.winner_id;
    const runnerUpId = championId === finalMatch.player1_id ? finalMatch.player2_id : finalMatch.player1_id;
    if (!runnerUpId) {
      await client.query('COMMIT');
      throw new ApiError(409, 'Final match has no second player — nothing to pay');
    }

    const { rows: existing } = await client.query(
      `SELECT id, user_id, amount_pesewas, status, attempts, paystack_transfer_code
       FROM public.transactions WHERE match_id = $1 AND type IN ('payout', 'host_share') ORDER BY id`,
      [finalMatch.id],
    );

    if (existing.length > 0 && !force) {
      await client.query('COMMIT');
      return { payout: 'already_initiated', rows: existing };
    }

    const total = t.entry_fee_pesewas * t.max_players;
    const split = computeSplit(total, t.first_place_percent, t.runnerup_percent, t.host_id ? env.hostCommissionPercent : null);
    let newlyCreated = false;

    if (existing.length === 0) {
      newlyCreated = true;
      // The platform-fee ledger row is booked against a platform account:
      // the creating admin for official cups; for hosted cups (created_by =
      // the host) the oldest admin, so a host's ledger never shows it.
      let platformAccountId = t.created_by;
      if (t.host_id) {
        const { rows: [adm] } = await client.query(`SELECT id FROM public.users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`);
        platformAccountId = adm?.id ?? t.created_by;
      }
      for (const [userId, amount, label] of [
        [championId, split.first, 'Champion prize'],
        [runnerUpId, split.runnerup, 'Runner-up prize'],
      ]) {
        const { rows: [tx] } = await client.query(
          `INSERT INTO public.transactions
             (user_id, tournament_id, match_id, type, amount_pesewas, status, direction, description)
           VALUES ($1, $2, $3, 'payout', $4, $5, 'out', $6)
           RETURNING id, user_id, amount_pesewas`,
          [userId, t.id, finalMatch.id, amount, isLive ? 'pending' : 'success', `${label} — ${t.title}`],
        );
        if (isLive) toTransfer.push({ ...tx, isRetry: false });
        else await notifyMoneySent(client, { ...tx, type: 'payout', tournament_id: t.id, description: label });
      }
      // Hosted tournament: the host's share rides the same transfer pipeline
      // (pending → Paystack transfer → success, with retries). A host whose
      // MoMo number is missing gets a failed row the admin can re-run.
      if (t.host_id && split.host > 0) {
        const { rows: [htx] } = await client.query(
          `INSERT INTO public.transactions
             (user_id, tournament_id, match_id, type, amount_pesewas, status, direction, description)
           VALUES ($1, $2, $3, 'host_share', $4, $5, 'out', $6)
           RETURNING id, user_id, amount_pesewas`,
          [t.host_id, t.id, finalMatch.id, split.host, isLive ? 'pending' : 'success', `Host share — ${t.title}`],
        );
        if (isLive) toTransfer.push({ ...htx, isRetry: false });
        else await notifyMoneySent(client, { ...htx, type: 'host_share', tournament_id: t.id, description: 'Host share' });
      }
      await client.query(
        `INSERT INTO public.transactions
           (user_id, tournament_id, match_id, type, amount_pesewas, status, direction, description)
         VALUES ($1, $2, $3, 'platform_fee', $4, 'success', 'out', $5)`,
        [platformAccountId, t.id, finalMatch.id, split.platform, `Platform fee — ${t.title}`],
      );
      await client.query(`UPDATE public.tournaments SET status = 'completed' WHERE id = $1`, [t.id]);
    } else if (force) {
      // 3C one-click re-payout: retry only the FAILED rows.
      for (const ex of existing) {
        if (ex.status !== 'failed') continue;
        if (isLive) {
          toTransfer.push({ id: ex.id, isRetry: true }); // claimed after COMMIT (see below)
        } else {
          await client.query(
            `UPDATE public.transactions SET status = 'success', attempts = attempts + 1, next_retry_at = NULL WHERE id = $1`,
            [ex.id],
          );
          const { rows: [row] } = await client.query('SELECT * FROM public.transactions WHERE id = $1', [ex.id]);
          await notifyMoneySent(client, row);
        }
      }
    }

    await client.query('COMMIT');

    if (!isLive) {
      return { payout: 'initiated', mode: 'stub', tournament_completed: newlyCreated, rows: existing };
    }

    const transfers = [];
    for (const item of toTransfer) {
      // Retries must be CLAIMED (failed → pending, attempts+1) before the
      // HTTP call so no other worker can initiate the same row.
      const tx = item.isRetry ? await claimForRetry(item.id) : item;
      if (!tx) {
        transfers.push({ tx: item.id, state: 'skipped', reason: 'already being retried elsewhere' });
        continue;
      }
      try {
        const r = await initiateTransferForTx(tx);
        transfers.push({ ...r, state: 'initiated' });
      } catch (err) {
        console.error(`[payment] payout transfer for tx ${tx.id} failed to initiate:`, err.message);
        if (item.isRetry) {
          const final = tx.attempts >= MAX_PAYOUT_RETRIES;
          await releaseFailedClaim(tx, { final });
          if (final) await notifyPayoutFailed(pool, tx);
        }
        transfers.push({ tx: tx.id, state: 'initiation_failed', error: err.message });
      }
    }
    return { payout: 'initiated', mode: 'live', tournament_completed: newlyCreated, transfers };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 3E notification helpers
// ---------------------------------------------------------------------------

/** payout_sent / refund_issued for a SUCCESSFUL transfer row. */
export async function notifyMoneySent(q, tx) {
  const { rows: [ctx] } = await q.query(
    `SELECT u.phone, u.momo_provider, t.title FROM public.users u
     LEFT JOIN public.tournaments t ON t.id = $2 WHERE u.id = $1`,
    [tx.user_id, tx.tournament_id],
  );
  const payload = { tournament_title: ctx?.title ?? '', amount_pesewas: tx.amount_pesewas, phone: ctx?.phone, momo_provider: ctx?.momo_provider, tx_id: tx.id };
  if (tx.type === 'refund') {
    await notify(q, { userId: tx.user_id, template: 'refund_issued', payload });
  } else if (tx.type === 'payout') {
    const label = /runner/i.test(tx.description ?? '') ? 'Runner-up prize' : 'Champion prize';
    await notify(q, { userId: tx.user_id, template: 'payout_sent', payload: { ...payload, label } });
  } else if (tx.type === 'host_share') {
    await notify(q, { userId: tx.user_id, template: 'payout_sent', payload: { ...payload, label: 'Host share' } });
  }
}

export async function notifyPayoutFailed(q, tx) {
  // Used for payouts (after final retry) and refunds (first failure).
  const { rows: [ctx] } = await q.query(
    `SELECT u.username, u.phone, t.title FROM public.users u
     LEFT JOIN public.tournaments t ON t.id = $2 WHERE u.id = $1`,
    [tx.user_id, tx.tournament_id],
  );
  await notify(q, {
    userId: null,
    template: 'admin_payout_failed',
    payload: { tx_id: tx.id, tx_type: tx.type ?? 'payout', amount_pesewas: tx.amount_pesewas, username: ctx?.username, phone: ctx?.phone, tournament_title: ctx?.title, attempts: tx.attempts ?? 0 },
  });
}
