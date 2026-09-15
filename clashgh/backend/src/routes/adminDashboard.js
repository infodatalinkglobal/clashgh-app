import { Router } from 'express';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { UUID_RE } from '../utils/validate.js';
import { cancelTournament } from '../services/cancel.js';
import { purgeScreenshotsOlderThan } from '../services/screenshots.js';

/**
 * Admin dashboard read models + player moderation (Modules 3B/3C/3F).
 *
 * Everything here is admin-only and read-mostly; the money-moving actions
 * (resolve dispute, payout, cancel) live in admin.js / tournaments.js and
 * are reused as-is. All aggregates are derived from `transactions`,
 * `matches`, `registrations` — no separate analytics table (agent.md §C).
 */
export const adminDashboardRouter = Router();
adminDashboardRouter.use('/admin', requireAuth, requireAdmin);

const HIGH_DISPUTE_RATE = 0.3; // 3B: ≥30% of completed matches disputed (min 3 matches) → flagged
const HIGH_DISPUTE_MIN_MATCHES = 3;

// ---------------------------------------------------------------------------
// GET /admin/overview — the "what needs me right now" screen
// ---------------------------------------------------------------------------
adminDashboardRouter.get('/admin/overview', asyncHandler(async (req, res) => {
  const [
    { rows: [counts] },
    { rows: disputes },
    { rows: lobbies },
    { rows: failedPayouts },
    { rows: [revenue] },
    { rows: alerts },
  ] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*) FROM public.matches WHERE status = 'disputed')::int AS disputed_matches,
        (SELECT count(*) FROM public.tournaments WHERE status = 'open')::int AS open_tournaments,
        (SELECT count(*) FROM public.tournaments WHERE status = 'in_progress')::int AS live_tournaments,
        (SELECT count(*) FROM public.tournaments WHERE status = 'open' AND closes_at < now())::int AS lobbies_past_close,
        (SELECT count(*) FROM public.transactions WHERE type IN ('payout','refund') AND status = 'failed')::int AS failed_transfers,
        (SELECT count(*) FROM public.transactions WHERE type IN ('payout','refund') AND status = 'pending')::int AS pending_transfers,
        (SELECT count(*) FROM public.users WHERE role = 'player')::int AS players,
        (SELECT count(*) FROM public.users WHERE is_banned)::int AS banned_players`),
    pool.query(`
      SELECT m.id, m.tournament_id, t.title, t.game, m.match_round, m.match_number, m.dispute_reason, m.updated_at,
             u1.username AS player1, u2.username AS player2, m.player1_pick, m.player2_pick
      FROM public.matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
      LEFT JOIN public.users u1 ON u1.id = m.player1_id
      LEFT JOIN public.users u2 ON u2.id = m.player2_id
      WHERE m.status = 'disputed'
      ORDER BY m.updated_at ASC
      LIMIT 20`),
    pool.query(`
      SELECT t.id, t.title, t.game, t.status, t.max_players, t.entry_fee_pesewas, t.closes_at, t.starts_at,
             (SELECT count(*) FROM public.registrations r WHERE r.tournament_id = t.id AND r.payment_status = 'paid')::int AS paid_count,
             (SELECT count(*) FROM public.registrations r WHERE r.tournament_id = t.id AND r.payment_status = 'pending'
                AND r.created_at > now() - make_interval(mins => $1))::int AS pending_count
      FROM public.tournaments t
      WHERE t.status = 'open'
      ORDER BY t.closes_at ASC`, [env.registrationPendingTtlMinutes]),
    pool.query(`
      SELECT tx.id, tx.type, tx.amount_pesewas, tx.attempts, tx.next_retry_at, tx.updated_at, tx.description,
             tx.tournament_id, u.username, u.phone
      FROM public.transactions tx JOIN public.users u ON u.id = tx.user_id
      WHERE tx.type IN ('payout','refund') AND tx.status = 'failed'
      ORDER BY tx.updated_at ASC LIMIT 20`),
    pool.query(`
      SELECT
        coalesce(sum(amount_pesewas) FILTER (WHERE type='platform_fee' AND status='success'), 0)::int AS platform_fees_total,
        coalesce(sum(amount_pesewas) FILTER (WHERE type='platform_fee' AND status='success' AND created_at > now() - interval '7 days'), 0)::int AS platform_fees_7d,
        coalesce(sum(amount_pesewas) FILTER (WHERE type='entry_fee' AND status='success'), 0)::int AS collected_total,
        coalesce(sum(amount_pesewas) FILTER (WHERE type='entry_fee' AND status='success' AND created_at > now() - interval '7 days'), 0)::int AS collected_7d,
        coalesce(sum(amount_pesewas) FILTER (WHERE type='payout' AND status='success'), 0)::int AS paid_out_total,
        coalesce(sum(amount_pesewas) FILTER (WHERE type='refund' AND status='success'), 0)::int AS refunded_total,
        coalesce(sum(amount_pesewas) FILTER (WHERE type='entry_fee' AND status='success'), 0)::int
          - coalesce(sum(amount_pesewas) FILTER (WHERE type IN ('payout','refund','platform_fee') AND status='success'), 0)::int AS in_escrow
      FROM public.transactions`),
    pool.query(`
      SELECT id, action, entity_type, entity_id, details, created_at
      FROM public.admin_audit_log ORDER BY created_at DESC LIMIT 10`),
  ]);

  // Lobby health classification (R1): how full vs. how much time is left.
  const now = Date.now();
  const lobbyHealth = lobbies.map((l) => {
    const fill = l.paid_count / l.max_players;
    const hoursLeft = (new Date(l.closes_at).getTime() - now) / 3_600_000;
    let health = 'healthy';
    if (hoursLeft <= 0) health = fill >= 1 ? 'full_awaiting_start' : 'past_close';
    else if (fill >= 1) health = 'full';
    else if (hoursLeft < 6 && fill < 0.5) health = 'at_risk';
    else if (hoursLeft < 12 && fill < 0.75) health = 'watch';
    else if (fill >= 0.75) health = 'near_full';
    return { ...l, fill_percent: Math.round(fill * 100), hours_left: Math.round(hoursLeft * 10) / 10, health };
  });

  res.json({
    success: true,
    data: { counts, disputes, lobby_health: lobbyHealth, failed_transfers: failedPayouts, revenue, recent_actions: alerts },
    message: 'Admin overview',
  });
}));

// ---------------------------------------------------------------------------
// GET /admin/tournaments?status= — full list with fill + money summary
// ---------------------------------------------------------------------------
adminDashboardRouter.get('/admin/tournaments', asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
  const { rows } = await pool.query(`
    SELECT t.*, u.username AS created_by_username,
           (SELECT count(*) FROM public.registrations r WHERE r.tournament_id = t.id AND r.payment_status = 'paid')::int AS paid_count,
           (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.status = 'disputed')::int AS disputed_count,
           (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.status = 'completed')::int AS completed_matches,
           (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id)::int AS total_matches,
           (SELECT coalesce(sum(amount_pesewas),0) FROM public.transactions x WHERE x.tournament_id = t.id AND x.type='entry_fee' AND x.status='success')::int AS collected_pesewas,
           (SELECT coalesce(sum(amount_pesewas),0) FROM public.transactions x WHERE x.tournament_id = t.id AND x.type IN ('payout','refund') AND x.status='success')::int AS paid_out_pesewas,
           (SELECT count(*) FROM public.transactions x WHERE x.tournament_id = t.id AND x.type IN ('payout','refund') AND x.status='failed')::int AS failed_transfers
    FROM public.tournaments t
    LEFT JOIN public.users u ON u.id = t.created_by
    WHERE ($1::text IS NULL OR t.status::text = $1)
    ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 WHEN 'full' THEN 2 ELSE 3 END, t.starts_at DESC
    LIMIT 200`, [status]);
  res.json({ success: true, data: { tournaments: rows }, message: 'Tournaments' });
}));

// GET /admin/tournaments/:id — everything about one cup (registrations, matches, ledger, audit)
adminDashboardRouter.get('/admin/tournaments/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid tournament id');
  const [{ rows: [t] }, { rows: regs }, { rows: matches }, { rows: ledger }, { rows: audit }] = await Promise.all([
    pool.query(`SELECT * FROM public.tournaments WHERE id = $1`, [id]),
    pool.query(`
      SELECT r.*, u.username, u.phone, u.momo_provider, u.is_banned
      FROM public.registrations r JOIN public.users u ON u.id = r.user_id
      WHERE r.tournament_id = $1 ORDER BY r.seed NULLS LAST, r.created_at`, [id]),
    pool.query(`
      SELECT m.*, u1.username AS player1_username, u2.username AS player2_username, w.username AS winner_username
      FROM public.matches m
      LEFT JOIN public.users u1 ON u1.id = m.player1_id
      LEFT JOIN public.users u2 ON u2.id = m.player2_id
      LEFT JOIN public.users w ON w.id = m.winner_id
      WHERE m.tournament_id = $1 ORDER BY m.match_round, m.match_number`, [id]),
    pool.query(`
      SELECT tx.*, u.username FROM public.transactions tx JOIN public.users u ON u.id = tx.user_id
      WHERE tx.tournament_id = $1 ORDER BY tx.created_at DESC`, [id]),
    pool.query(`
      SELECT a.*, u.username AS admin_username FROM public.admin_audit_log a JOIN public.users u ON u.id = a.admin_id
      WHERE a.entity_id = $1 OR a.entity_id IN (SELECT id FROM public.matches WHERE tournament_id = $1)
      ORDER BY a.created_at DESC`, [id]),
  ]);
  if (!t) throw new ApiError(404, 'Tournament not found');
  res.json({ success: true, data: { tournament: t, registrations: regs, matches, ledger, audit }, message: 'Tournament detail' });
}));

// ---------------------------------------------------------------------------
// GET /admin/disputes — queue with both screenshots side by side (3B)
// ---------------------------------------------------------------------------
adminDashboardRouter.get('/admin/disputes', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    WITH rates AS (
      SELECT p.user_id,
             count(*) FILTER (WHERE m.status IN ('completed','disputed'))::int AS played,
             count(*) FILTER (WHERE m.status = 'disputed' OR a.id IS NOT NULL)::int AS disputed
      FROM (SELECT id, player1_id AS user_id, status FROM public.matches
            UNION ALL SELECT id, player2_id, status FROM public.matches) p
      JOIN public.matches m ON m.id = p.id
      LEFT JOIN public.admin_audit_log a ON a.entity_type = 'match' AND a.entity_id = m.id AND a.action = 'resolve_dispute'
      WHERE p.user_id IS NOT NULL
      GROUP BY p.user_id)
    SELECT m.id, m.tournament_id, t.title, t.game, t.entry_fee_pesewas, m.match_round, m.match_number,
           m.dispute_reason, m.room_code, m.started_at, m.deadline_at, m.updated_at,
           jsonb_build_object('id', u1.id, 'username', u1.username, 'pick', m.player1_pick, 'screenshot_url', m.player1_screenshot_url,
                              'game_uid', r1.game_uid, 'is_banned', u1.is_banned,
                              'dispute_rate', CASE WHEN coalesce(x1.played,0) > 0 THEN round(x1.disputed::numeric / x1.played, 2) ELSE 0 END,
                              'matches_played', coalesce(x1.played,0)) AS player1,
           jsonb_build_object('id', u2.id, 'username', u2.username, 'pick', m.player2_pick, 'screenshot_url', m.player2_screenshot_url,
                              'game_uid', r2.game_uid, 'is_banned', u2.is_banned,
                              'dispute_rate', CASE WHEN coalesce(x2.played,0) > 0 THEN round(x2.disputed::numeric / x2.played, 2) ELSE 0 END,
                              'matches_played', coalesce(x2.played,0)) AS player2,
           (m.match_round = (SELECT max(match_round) FROM public.matches WHERE tournament_id = m.tournament_id)) AS is_final
    FROM public.matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
    LEFT JOIN public.users u1 ON u1.id = m.player1_id
    LEFT JOIN public.users u2 ON u2.id = m.player2_id
    LEFT JOIN public.registrations r1 ON r1.tournament_id = m.tournament_id AND r1.user_id = m.player1_id
    LEFT JOIN public.registrations r2 ON r2.tournament_id = m.tournament_id AND r2.user_id = m.player2_id
    LEFT JOIN rates x1 ON x1.user_id = m.player1_id
    LEFT JOIN rates x2 ON x2.user_id = m.player2_id
    WHERE m.status = 'disputed'
    ORDER BY m.updated_at ASC`);

  // 3B priority flag: either player has a high historical dispute rate.
  const flagged = rows.map((d) => {
    const hot = [d.player1, d.player2].some(
      (p) => p && p.matches_played >= HIGH_DISPUTE_MIN_MATCHES && Number(p.dispute_rate) >= HIGH_DISPUTE_RATE,
    );
    return { ...d, priority: hot ? 'high' : 'normal' };
  });
  flagged.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
  res.json({ success: true, data: { disputes: flagged, threshold: { rate: HIGH_DISPUTE_RATE, min_matches: HIGH_DISPUTE_MIN_MATCHES } }, message: 'Dispute queue' });
}));

// ---------------------------------------------------------------------------
// Players: list with dispute stats, ban / unban (R2 trust & fraud)
// ---------------------------------------------------------------------------
adminDashboardRouter.get('/admin/players', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? `%${req.query.q.trim().toLowerCase()}%` : null;
  const { rows } = await pool.query(`
    WITH per_user AS (
      SELECT p.user_id,
             count(*) FILTER (WHERE m.status = 'completed')::int AS completed,
             count(*) FILTER (WHERE m.status = 'disputed')::int AS open_disputes,
             count(*) FILTER (WHERE a.id IS NOT NULL)::int AS resolved_disputes,
             count(*) FILTER (WHERE m.status = 'completed' AND m.winner_id = p.user_id)::int AS wins
      FROM (SELECT id, player1_id AS user_id FROM public.matches UNION ALL SELECT id, player2_id FROM public.matches) p
      JOIN public.matches m ON m.id = p.id
      LEFT JOIN public.admin_audit_log a ON a.entity_type = 'match' AND a.entity_id = m.id AND a.action = 'resolve_dispute'
      WHERE p.user_id IS NOT NULL GROUP BY p.user_id)
    SELECT u.id, u.username, u.email, u.phone, u.momo_provider, u.phone_verified, u.role, u.is_banned, u.created_at,
           coalesce(x.completed,0) AS matches_completed, coalesce(x.wins,0) AS wins,
           coalesce(x.open_disputes,0) AS open_disputes, coalesce(x.resolved_disputes,0) AS resolved_disputes,
           CASE WHEN coalesce(x.completed,0) + coalesce(x.open_disputes,0) > 0
                THEN round((coalesce(x.open_disputes,0) + coalesce(x.resolved_disputes,0))::numeric / (x.completed + x.open_disputes), 2) ELSE 0 END AS dispute_rate,
           (SELECT coalesce(sum(amount_pesewas),0) FROM public.transactions WHERE user_id = u.id AND type='entry_fee' AND status='success')::int AS fees_paid_pesewas,
           (SELECT coalesce(sum(amount_pesewas),0) FROM public.transactions WHERE user_id = u.id AND type='payout' AND status='success')::int AS winnings_pesewas
    FROM public.users u LEFT JOIN per_user x ON x.user_id = u.id
    WHERE ($1::text IS NULL OR lower(u.username) LIKE $1 OR lower(u.email) LIKE $1 OR u.phone LIKE $1)
    ORDER BY u.is_banned DESC, dispute_rate DESC, u.created_at DESC
    LIMIT 200`, [q]);
  const players = rows.map((p) => ({
    ...p,
    flagged: p.matches_completed + p.open_disputes >= HIGH_DISPUTE_MIN_MATCHES && Number(p.dispute_rate) >= HIGH_DISPUTE_RATE,
  }));
  res.json({ success: true, data: { players }, message: 'Players' });
}));

adminDashboardRouter.post('/admin/players/:id/ban', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid user id');
  const banned = req.body?.banned !== false;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
  if (banned && reason.length < 3) throw new ApiError(400, 'A reason is required to ban a player');
  if (id === req.user.id) throw new ApiError(400, 'You cannot ban yourself');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [u] } = await client.query(
      `UPDATE public.users SET is_banned = $2 WHERE id = $1 AND role = 'player' RETURNING id, username, is_banned`, [id, banned]);
    if (!u) { await client.query('ROLLBACK'); throw new ApiError(404, 'Player not found (admins cannot be banned here)'); }
    await client.query(
      `INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', $3, $4)`,
      [req.user.id, banned ? 'player_banned' : 'player_unbanned', id, JSON.stringify({ reason, username: u.username })]);
    await client.query('COMMIT');
    res.json({ success: true, data: u, message: banned ? `${u.username} banned — cannot join tournaments` : `${u.username} unbanned` });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

// ---------------------------------------------------------------------------
// Cancel (reuses the 1E/1F service; before start only unless admin forces
// via the dispute refund path).
// ---------------------------------------------------------------------------
adminDashboardRouter.post('/admin/tournaments/:id/cancel', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid tournament id');
  const result = await cancelTournament(id, req.user.id);
  res.json({ success: true, data: result, message: `Tournament cancelled — ${result.refunded_count} player(s) refunded` });
}));

// ---------------------------------------------------------------------------
// GET /admin/audit — full audit trail
// ---------------------------------------------------------------------------
adminDashboardRouter.get('/admin/audit', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { rows } = await pool.query(`
    SELECT a.*, u.username AS admin_username FROM public.admin_audit_log a
    JOIN public.users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT $1`, [limit]);
  res.json({ success: true, data: { audit: rows }, message: 'Audit log' });
}));

// ---------------------------------------------------------------------------
// GET /admin/analytics — 3F metrics that gate expansion (agent.md §1, §15)
// ---------------------------------------------------------------------------
adminDashboardRouter.get('/admin/analytics', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const [{ rows: [funnel] }, { rows: byGame }, { rows: daily }, { rows: [timing] }] = await Promise.all([
    pool.query(`
      SELECT
        count(*)::int AS created,
        count(*) FILTER (WHERE status IN ('full','in_progress','completed'))::int AS filled,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE status = 'open')::int AS open_now
      FROM public.tournaments WHERE created_at > now() - make_interval(days => $1)`, [days]),
    pool.query(`
      SELECT t.game,
             count(*)::int AS tournaments,
             count(*) FILTER (WHERE t.status IN ('full','in_progress','completed'))::int AS filled,
             (SELECT count(DISTINCT r.user_id) FROM public.registrations r JOIN public.tournaments t2 ON t2.id = r.tournament_id
               WHERE t2.game = t.game AND t2.created_at > now() - make_interval(days => $1) AND r.payment_status IN ('paid','refunded'))::int AS unique_players,
             (SELECT coalesce(sum(x.amount_pesewas),0) FROM public.transactions x JOIN public.tournaments t2 ON t2.id = x.tournament_id
               WHERE t2.game = t.game AND t2.created_at > now() - make_interval(days => $1) AND x.type='entry_fee' AND x.status='success')::int AS collected_pesewas,
             (SELECT coalesce(sum(x.amount_pesewas),0) FROM public.transactions x JOIN public.tournaments t2 ON t2.id = x.tournament_id
               WHERE t2.game = t.game AND t2.created_at > now() - make_interval(days => $1) AND x.type='platform_fee' AND x.status='success')::int AS platform_fee_pesewas
      FROM public.tournaments t
      WHERE t.created_at > now() - make_interval(days => $1)
      GROUP BY t.game ORDER BY collected_pesewas DESC`, [days]),
    pool.query(`
      SELECT d::date AS day,
             coalesce((SELECT sum(amount_pesewas) FROM public.transactions WHERE type='entry_fee' AND status='success' AND created_at::date = d::date),0)::int AS collected,
             coalesce((SELECT sum(amount_pesewas) FROM public.transactions WHERE type='payout' AND status='success' AND created_at::date = d::date),0)::int AS paid_out,
             coalesce((SELECT sum(amount_pesewas) FROM public.transactions WHERE type='platform_fee' AND status='success' AND created_at::date = d::date),0)::int AS platform_fee,
             (SELECT count(DISTINCT user_id) FROM public.transactions WHERE type='entry_fee' AND status='success' AND created_at::date = d::date)::int AS active_players
      FROM generate_series(now()::date - make_interval(days => $1 - 1), now()::date, '1 day') d
      ORDER BY d`, [days]),
    pool.query(`
      WITH fills AS (
        SELECT t.id, t.created_at,
               max(x.created_at) FILTER (WHERE x.type='entry_fee' AND x.status='success') AS filled_at
        FROM public.tournaments t JOIN public.transactions x ON x.tournament_id = t.id
        WHERE t.status IN ('full','in_progress','completed') AND t.created_at > now() - make_interval(days => $1)
        GROUP BY t.id),
      windows AS (
        SELECT m.id, extract(epoch FROM (m.updated_at - m.started_at))/60 AS mins
        FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id
        WHERE m.status = 'completed' AND m.started_at IS NOT NULL AND t.created_at > now() - make_interval(days => $1))
      SELECT
        round(avg(extract(epoch FROM (filled_at - created_at))/3600)::numeric, 1) AS avg_hours_to_fill,
        (SELECT round(avg(mins)::numeric, 1) FROM windows) AS avg_match_minutes,
        (SELECT count(*) FROM public.matches m JOIN public.tournaments t ON t.id=m.tournament_id
          WHERE t.created_at > now() - make_interval(days => $1) AND m.status IN ('completed','disputed'))::int AS matches_played,
        (SELECT count(*) FROM public.matches m JOIN public.tournaments t ON t.id=m.tournament_id
          WHERE t.created_at > now() - make_interval(days => $1) AND (m.status = 'disputed'
             OR EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.entity_type='match' AND a.entity_id=m.id AND a.action = 'resolve_dispute')))::int AS matches_disputed,
        (SELECT count(*) FROM public.matches m JOIN public.tournaments t ON t.id=m.tournament_id
          WHERE t.created_at > now() - make_interval(days => $1) AND m.dispute_reason LIKE 'Deadline passed%')::int AS no_shows
      FROM fills`, [days]),
  ]);

  const fillRate = funnel.created ? Math.round((funnel.filled / funnel.created) * 100) : 0;
  const refundRate = funnel.created ? Math.round((funnel.cancelled / funnel.created) * 100) : 0;
  const disputeRate = timing.matches_played ? Math.round((timing.matches_disputed / timing.matches_played) * 100) : 0;

  res.json({
    success: true,
    data: {
      days,
      funnel: { ...funnel, fill_rate_percent: fillRate, refund_rate_percent: refundRate },
      timing: { ...timing, dispute_rate_percent: disputeRate },
      by_game: byGame,
      daily,
      // Expansion gates (agent.md §1 / §15 R1): green when it is safe to add bracket sizes / games.
      gates: {
        fill_rate: { value: fillRate, target: 70, ok: fillRate >= 70 },
        refund_rate: { value: refundRate, target: 20, ok: refundRate <= 20 },
        dispute_rate: { value: disputeRate, target: 10, ok: disputeRate <= 10 },
      },
    },
    message: 'Analytics',
  });
}));

/**
 * POST /api/admin/screenshots/purge?days=90 — Module 3D retention. Deletes
 * Cloudinary screenshots older than `days` (default SCREENSHOT_RETENTION_DAYS).
 * Only meaningful when SCREENSHOT_STORAGE=cloudinary. Audited.
 */
adminDashboardRouter.post('/admin/screenshots/purge', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (env.screenshotStorage !== 'cloudinary') throw new ApiError(409, 'Screenshot storage is local — nothing to purge');
  const days = Math.max(30, Number(req.query.days) || env.screenshotRetentionDays); // never below 30d (dispute window)
  const deleted = await purgeScreenshotsOlderThan(days);
  await pool.query(
    `INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details) VALUES ($1, 'purge_screenshots', 'system', $2, $3)`,
    [req.user.id, req.user.id, JSON.stringify({ days, deleted })],
  );
  res.json({ success: true, data: { days, deleted }, message: `Deleted ${deleted} screenshot(s) older than ${days} days` });
}));
