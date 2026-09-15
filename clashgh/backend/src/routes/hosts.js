import { Router } from 'express';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { requireAuth, requireAdmin, requireVerified } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { UUID_RE } from '../utils/validate.js';
import { pesewasToGhsString } from '../utils/prize.js';
import { cancelTournament } from '../services/cancel.js';
import { notify } from '../services/notifications.js';
import { validateTournamentCreate, tournamentPayload } from './tournaments.js';

/**
 * Community hosts (marketplace model).
 *
 * Player side
 *   GET  /api/me/host                   — my host status + limits + earnings
 *   POST /api/me/host/apply {note}      — verified player applies (→ pending)
 *   POST /api/host/tournaments          — approved host creates (host_id = me)
 *   GET  /api/host/tournaments          — my hosted tournaments with money
 *   POST /api/host/tournaments/:id/cancel — cancel my own (not started) → refunds
 *
 * Admin side
 *   GET  /api/admin/hosts?status=       — applications / hosts with stats
 *   POST /api/admin/hosts/:id/approve | /suspend {reason}
 *
 * Money: fees land in the platform Paystack account. At payout the
 * remainder after prizes (host cut ≤ HOST_CUT_MAX_PERCENT) is split
 * HOST_COMMISSION_PERCENT (platform) / rest (host) — see utils/prize.js.
 */
export const hostsRouter = Router();

function hostLimits() {
  return {
    host_cut_max_percent: env.hostCutMaxPercent,
    platform_commission_percent: env.hostCommissionPercent,
    min_entry_fee_pesewas: Math.max(env.hostMinEntryPesewas, env.minEntryFeePesewas),
    min_players: 4,
    max_players: 64,
  };
}

async function hostEarnings(userId) {
  const { rows: [e] } = await pool.query(
    `SELECT
       coalesce(sum(amount_pesewas) FILTER (WHERE type = 'host_share' AND status = 'success'), 0)::int AS earned_pesewas,
       coalesce(sum(amount_pesewas) FILTER (WHERE type = 'host_share' AND status = 'pending'), 0)::int AS pending_pesewas,
       (SELECT count(*) FROM public.tournaments WHERE host_id = $1)::int AS hosted_count,
       (SELECT count(*) FROM public.tournaments WHERE host_id = $1 AND status = 'completed')::int AS completed_count
     FROM public.transactions WHERE user_id = $1`,
    [userId],
  );
  return e;
}

function requireHost(req, _res, next) {
  if (req.user.host_status !== 'approved') {
    return next(new ApiError(403, req.user.host_status === 'suspended'
      ? 'Your host access is suspended — contact support'
      : 'You are not an approved host yet'));
  }
  next();
}

// ---------------------------------------------------------------- player

hostsRouter.get('/me/host', requireAuth, asyncHandler(async (req, res) => {
  const earnings = await hostEarnings(req.user.id);
  res.json({
    success: true,
    data: {
      host_status: req.user.host_status,
      host_note: req.user.host_note ?? null,
      host_applied_at: req.user.host_applied_at ?? null,
      limits: hostLimits(),
      earnings,
    },
    message: 'Host profile loaded',
  });
}));

hostsRouter.post('/me/host/apply', requireAuth, requireVerified, asyncHandler(async (req, res) => {
  if (req.user.host_status === 'approved') throw new ApiError(409, 'You are already a host');
  if (req.user.host_status === 'suspended') throw new ApiError(403, 'Your host access is suspended — contact support');
  if (req.user.host_status === 'pending') throw new ApiError(409, 'Your application is already under review');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
  if (note.length < 10) throw new ApiError(400, 'Tell us a little about the tournaments you want to run (at least 10 characters)');
  await pool.query(
    `UPDATE public.users SET host_status = 'pending', host_applied_at = now(), host_note = $2 WHERE id = $1`,
    [req.user.id, note],
  );
  await notify(pool, { userId: null, template: 'admin_host_application', payload: { username: req.user.username, email: req.user.email, note, user_id: req.user.id } });
  res.status(201).json({ success: true, data: { host_status: 'pending' }, message: 'Application received — we review within 24 hours' });
}));

hostsRouter.post('/host/tournaments', requireAuth, requireVerified, requireHost, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const limits = hostLimits();
  // Host cut is what remains after prizes; cap it so pools stay ≥ 80%.
  const first = Number(body.first_place_percent ?? 70);
  const runnerup = Number(body.runnerup_percent ?? 20);
  const hostCut = 100 - first - runnerup;
  if (!Number.isInteger(hostCut) || hostCut < 0) throw new ApiError(400, 'Prize percentages must not exceed 100');
  if (hostCut > limits.host_cut_max_percent) {
    throw new ApiError(400, `Your cut (${hostCut}%) exceeds the ${limits.host_cut_max_percent}% cap — players must receive at least ${100 - limits.host_cut_max_percent}% back as prizes`);
  }
  if (Number(body.entry_fee_pesewas) < limits.min_entry_fee_pesewas) {
    throw new ApiError(400, `Hosted tournaments need an entry fee of at least ${pesewasToGhsString(limits.min_entry_fee_pesewas)}`);
  }
  const v = validateTournamentCreate({ ...body, first_place_percent: first, runnerup_percent: runnerup });
  const rules = typeof body.rules_text === 'string' ? body.rules_text.trim().slice(0, 600) || null : null;
  const { rows } = await pool.query(
    `INSERT INTO public.tournaments
       (title, game, entry_fee_pesewas, max_players, closes_at, starts_at,
        result_window_minutes, first_place_percent, runnerup_percent, status, created_by, host_id, rules_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $10, $11)
     RETURNING *`,
    [v.title, v.game, v.entryFee, v.maxPlayers, v.closesAt, v.startsAt, v.resultWindow, v.firstPercent, v.runnerupPercent, req.user.id, rules],
  );
  const row = { ...rows[0], host_username: req.user.username, paid_count: 0, pending_count: 0 };
  res.status(201).json({ success: true, data: { tournament: tournamentPayload(row) }, message: 'Tournament published' });
}));

hostsRouter.get('/host/tournaments', requireAuth, requireHost, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, h.username AS host_username,
            (SELECT count(*) FROM public.registrations r WHERE r.tournament_id = t.id AND r.payment_status = 'paid') AS paid_count,
            (SELECT count(*) FROM public.registrations r WHERE r.tournament_id = t.id AND r.payment_status = 'pending'
               AND r.created_at > now() - make_interval(mins => $2)) AS pending_count,
            (SELECT status FROM public.transactions x WHERE x.tournament_id = t.id AND x.type = 'host_share' ORDER BY x.created_at DESC LIMIT 1) AS host_share_status
     FROM public.tournaments t JOIN public.users h ON h.id = t.host_id
     WHERE t.host_id = $1
     ORDER BY t.created_at DESC LIMIT 100`,
    [req.user.id, env.registrationPendingTtlMinutes],
  );
  const earnings = await hostEarnings(req.user.id);
  res.json({
    success: true,
    data: {
      tournaments: rows.map((r) => ({ ...tournamentPayload(r), host_share_status: r.host_share_status ?? null })),
      earnings,
      limits: hostLimits(),
    },
    message: 'Hosted tournaments loaded',
  });
}));

hostsRouter.post('/host/tournaments/:id/cancel', requireAuth, requireHost, asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid tournament id');
  const { rows: [t] } = await pool.query('SELECT host_id FROM public.tournaments WHERE id = $1', [id]);
  if (!t) throw new ApiError(404, 'Tournament not found');
  if (t.host_id !== req.user.id) throw new ApiError(403, 'You can only cancel tournaments you host');
  const result = await cancelTournament(id, req.user.id); // audit row records the host as actor
  res.json({ success: true, data: result, message: `Tournament cancelled — ${result.refunded_count} player(s) refunded` });
}));

// ---------------------------------------------------------------- admin

hostsRouter.get('/admin/hosts', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const status = ['pending', 'approved', 'suspended'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.phone, u.host_status, u.host_note, u.host_applied_at, u.created_at,
            (SELECT count(*) FROM public.tournaments t WHERE t.host_id = u.id)::int AS hosted_count,
            (SELECT count(*) FROM public.tournaments t WHERE t.host_id = u.id AND t.status = 'completed')::int AS completed_count,
            (SELECT count(*) FROM public.tournaments t WHERE t.host_id = u.id AND t.status = 'cancelled')::int AS cancelled_count,
            (SELECT coalesce(sum(amount_pesewas),0) FROM public.transactions x WHERE x.user_id = u.id AND x.type = 'host_share' AND x.status = 'success')::int AS earned_pesewas,
            (SELECT coalesce(sum(x.amount_pesewas),0) FROM public.transactions x JOIN public.tournaments t ON t.id = x.tournament_id
               WHERE t.host_id = u.id AND x.type = 'platform_fee' AND x.status = 'success')::int AS platform_commission_pesewas
     FROM public.users u
     WHERE u.host_status <> 'none' AND ($1::public.host_status IS NULL OR u.host_status = $1)
     ORDER BY (u.host_status = 'pending') DESC, u.host_applied_at DESC NULLS LAST
     LIMIT 200`,
    [status],
  );
  res.json({ success: true, data: { hosts: rows, limits: hostLimits() }, message: 'Hosts loaded' });
}));

for (const action of ['approve', 'suspend']) {
  hostsRouter.post(`/admin/hosts/:id/${action}`, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid user id');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : null;
    const next = action === 'approve' ? 'approved' : 'suspended';
    const { rows: [u] } = await pool.query(
      `UPDATE public.users SET host_status = $2, host_note = coalesce($3, host_note) WHERE id = $1 AND host_status <> 'none'
       RETURNING id, username, host_status`,
      [id, next, action === 'suspend' ? reason : null],
    );
    if (!u) throw new ApiError(404, 'No host application for this user');
    await pool.query(
      `INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', $3, $4)`,
      [req.user.id, `host_${action}`, id, JSON.stringify({ reason })],
    );
    await notify(pool, { userId: id, template: action === 'approve' ? 'host_approved' : 'host_suspended', payload: { username: u.username, reason } });
    res.json({ success: true, data: { host: u }, message: action === 'approve' ? 'Host approved' : 'Host suspended' });
  }));
}
