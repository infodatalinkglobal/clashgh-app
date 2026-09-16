import { Router } from 'express';
import { perUser } from '../middleware/rateLimit.js';
const MIN = 60 * 1000;
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { requireAuth, requireAdmin, requireVerified } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { UUID_RE, GAME_TYPES } from '../utils/validate.js';
import { computeSplit, runnerupPrizeIfFull, pesewasToGhsString } from '../utils/prize.js';
import { initiateEntryFeeCharge } from '../services/payment.js';
import { cancelTournament } from '../services/cancel.js';

export const tournamentRouter = Router();

const HOURS = 3_600_000;
const MAX_PLAYERS_ALLOWED = [4, 8, 16, 32, 64];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIdParam(id, name = 'Tournament') {
  if (!UUID_RE.test(id)) throw new ApiError(400, `Invalid ${name.toLowerCase()} id`);
  return id;
}

function requireNumber(value, name, { integer = true, min = null, max = null } = {}) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if ((integer !== false && !Number.isInteger(n)) || Number.isNaN(n)) {
    throw new ApiError(400, `${name} must be a whole number`);
  }
  if (min !== null && n < min) throw new ApiError(400, `${name} must be at least ${min}`);
  if (max !== null && n > max) throw new ApiError(400, `${name} must be at most ${max}`);
  return n;
}

function requireDate(value, name) {
  const time = Date.parse(value);
  if (typeof value !== 'string' || Number.isNaN(time)) {
    throw new ApiError(400, `${name} must be an ISO timestamp (e.g. 2026-09-16T18:00:00Z)`);
  }
  return new Date(time);
}

export function validateTournamentCreate(body, { minEntryFeePesewas = env.minEntryFeePesewas } = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 3 || title.length > 120) {
    throw new ApiError(400, 'Title must be 3-120 characters');
  }
  const game = body.game;
  if (!GAME_TYPES.includes(game)) {
    throw new ApiError(400, `game must be one of: ${GAME_TYPES.join(', ')}`);
  }

  const entryFee = requireNumber(body.entry_fee_pesewas, 'entry_fee_pesewas', { min: 1 });
  if (entryFee === null) throw new ApiError(400, 'entry_fee_pesewas is required (integer pesewas)');
  if (entryFee < minEntryFeePesewas) {
    throw new ApiError(400, `Entry fee must be at least ${pesewasToGhsString(minEntryFeePesewas)}`);
  }

  const maxPlayers = requireNumber(body.max_players, 'max_players');
  if (!MAX_PLAYERS_ALLOWED.includes(maxPlayers)) {
    throw new ApiError(400, `max_players must be one of: ${MAX_PLAYERS_ALLOWED.join(', ')}`);
  }

  const now = new Date();
  const closesAt = requireDate(body.closes_at, 'closes_at');
  const startsAt = requireDate(body.starts_at, 'starts_at');
  if (closesAt <= new Date(now.getTime() + HOURS)) {
    throw new ApiError(400, 'closes_at must be at least 1 hour in the future');
  }
  if (closesAt > new Date(now.getTime() + 7 * 24 * HOURS)) {
    throw new ApiError(400, 'closes_at must be within 7 days');
  }
  if (startsAt <= new Date(closesAt.getTime() + HOURS)) {
    throw new ApiError(400, 'starts_at must be at least 1 hour after closes_at');
  }

  const resultWindow = requireNumber(body.result_window_minutes, 'result_window_minutes', {
    min: 5,
    max: 240,
  });
  const firstPercent =
    requireNumber(body.first_place_percent, 'first_place_percent', { min: 1, max: 99 }) ?? 70;
  const runnerupPercent =
    requireNumber(body.runnerup_percent, 'runnerup_percent', { min: 1, max: 99 }) ?? 20;
  if (firstPercent + runnerupPercent > 100) {
    throw new ApiError(400, 'first_place_percent + runnerup_percent must be <= 100 (platform takes the rest)');
  }

  // Minimum prize floor (agent.md §3): the runner-up prize at a FULL lobby
  // must clear the platform minimum (default ₵10.00).
  const runnerupPrize = runnerupPrizeIfFull(entryFee, maxPlayers, runnerupPercent);
  if (runnerupPrize < env.minPrizePesewas) {
    throw new ApiError(
      400,
      `Minimum prize floor not met: runner-up would earn ${pesewasToGhsString(runnerupPrize)} ` +
        `(${maxPlayers} x ${pesewasToGhsString(entryFee)} x ${runnerupPercent}%), but the minimum is ` +
        `${pesewasToGhsString(env.minPrizePesewas)}. Raise the entry fee or lobby size, or lower runnerup_percent.`,
    );
  }

  return {
    title,
    game,
    entryFee,
    maxPlayers,
    closesAt,
    startsAt,
    resultWindow: resultWindow ?? 30,
    firstPercent,
    runnerupPercent,
  };
}

const PENDING_TTL_SQL = 'now() - make_interval(mins => $1)';

/** SQL fragment: a registration currently holding a slot (paid, or pending inside the window). */
function holdingSlot(ttlParamIndex) {
  return `(payment_status = 'paid' OR (payment_status = 'pending' AND created_at > ${PENDING_TTL_SQL.replace('$1', `$${ttlParamIndex}`)}))`;
}

export function tournamentPayload(row, now = new Date()) {
  const paid = Number(row.paid_count);
  const pending = Number(row.pending_count);
  const spotsLeft = row.max_players - paid - pending;
  const totalIfFull = row.entry_fee_pesewas * row.max_players;
  const split = computeSplit(totalIfFull, row.first_place_percent, row.runnerup_percent, row.host_id ? env.hostCommissionPercent : null);
  return {
    id: row.id,
    title: row.title,
    game: row.game,
    entry_fee_pesewas: row.entry_fee_pesewas,
    max_players: row.max_players,
    closes_at: row.closes_at,
    starts_at: row.starts_at,
    result_window_minutes: row.result_window_minutes,
    first_place_percent: row.first_place_percent,
    runnerup_percent: row.runnerup_percent,
    prize_pool_pesewas: row.prize_pool_pesewas,
    platform_fee_pesewas: row.platform_fee_pesewas,
    host_share_pesewas: row.host_share_pesewas ?? null,
    // Community-hosted (marketplace) vs official ClashGH cup.
    host: row.host_id ? { id: row.host_id, username: row.host_username ?? null } : null,
    rules_text: row.rules_text ?? null,
    status: row.status,
    created_at: row.created_at,
    // Lobby state (pending outside the 10-min window no longer holds a slot)
    paid_count: paid,
    pending_count: pending,
    spots_left: spotsLeft,
    registration_closes: now >= row.closes_at,
    can_join: row.status === 'open' && now < row.closes_at && spotsLeft > 0,
    // Projected split if the lobby fills (final numbers are fixed at bracket generation, 1D)
    projection_if_full: {
      total_collected_pesewas: totalIfFull,
      first_prize_pesewas: split.first,
      runnerup_prize_pesewas: split.runnerup,
      platform_fee_pesewas: split.platform,
      host_share_pesewas: split.host,
    },
  };
}

async function fetchTournament(client, id) {
  const { rows } = await client.query(
    `SELECT t.*, h.username AS host_username,
            (SELECT count(*) FROM public.registrations r
              WHERE r.tournament_id = t.id AND r.payment_status = 'paid') AS paid_count,
            (SELECT count(*) FROM public.registrations r
              WHERE r.tournament_id = t.id
                AND r.payment_status = 'pending'
                AND r.created_at > now() - make_interval(mins => $2)) AS pending_count
     FROM public.tournaments t LEFT JOIN public.users h ON h.id = t.host_id
     WHERE t.id = $1`,
    [id, env.registrationPendingTtlMinutes],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** POST /api/tournaments — admin only. Enforces min entry fee + min prize floor. */
tournamentRouter.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const v = validateTournamentCreate(req.body || {});
  const { rows } = await pool.query(
    `INSERT INTO public.tournaments
       (title, game, entry_fee_pesewas, max_players, closes_at, starts_at,
        result_window_minutes, first_place_percent, runnerup_percent, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10)
     RETURNING *`,
    [
      v.title, v.game, v.entryFee, v.maxPlayers, v.closesAt, v.startsAt,
      v.resultWindow, v.firstPercent, v.runnerupPercent, req.user.id,
    ],
  );
  res.status(201).json({
    success: true,
    data: { tournament: tournamentPayload(rows[0]) },
    message: 'Tournament created',
  });
}));

/**
 * GET /api/tournaments — public list.
 * Filters: ?game=&status=  Pagination: ?limit= (max 50) &offset=
 * Sorted by closes_at (urgency first) — the lobby view the app opens on.
 */
tournamentRouter.get('/', asyncHandler(async (req, res) => {
  const game = req.query.game !== undefined ? String(req.query.game) : null;
  if (game !== null && !GAME_TYPES.includes(game)) {
    throw new ApiError(400, `game must be one of: ${GAME_TYPES.join(', ')}`);
  }
  const status = req.query.status !== undefined ? String(req.query.status) : null;
  const STATUSES = ['open', 'full', 'in_progress', 'completed', 'cancelled'];
  if (status !== null && !STATUSES.includes(status)) {
    throw new ApiError(400, `status must be one of: ${STATUSES.join(', ')}`);
  }
  const limit = Math.min(requireNumber(req.query.limit, 'limit', { min: 1 }) ?? 20, 50);
  const offset = requireNumber(req.query.offset, 'offset', { min: 0 }) ?? 0;

  const { rows } = await pool.query(
    `SELECT t.*, h.username AS host_username,
            (SELECT count(*) FROM public.registrations r
              WHERE r.tournament_id = t.id AND r.payment_status = 'paid') AS paid_count,
            (SELECT count(*) FROM public.registrations r
              WHERE r.tournament_id = t.id
                AND r.payment_status = 'pending'
                AND r.created_at > now() - make_interval(mins => $3)) AS pending_count
     FROM public.tournaments t LEFT JOIN public.users h ON h.id = t.host_id
     WHERE ($1::public.game_type IS NULL OR t.game = $1)
       AND ($2::public.tournament_status IS NULL OR t.status = $2)
     ORDER BY t.closes_at ASC, t.created_at ASC
     LIMIT $4 OFFSET $5`,
    [game, status, env.registrationPendingTtlMinutes, limit, offset],
  );

  const now = new Date();
  res.json({
    success: true,
    data: { tournaments: rows.map((row) => tournamentPayload(row, now)), limit, offset },
    message: 'Tournaments loaded',
  });
}));

/** GET /api/tournaments/:id — public detail. */
tournamentRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = parseIdParam(req.params.id);
  const row = await fetchTournament(pool, id);
  if (!row) throw new ApiError(404, 'Tournament not found');
  res.json({ success: true, data: { tournament: tournamentPayload(row) }, message: 'Tournament loaded' });
}));

/**
 * GET /api/tournaments/:id/bracket — public bracket view (Module 2C
 * renders this). `feeds_next` carries the advancement wiring: the winner
 * of round R match M plays in round R+1 match ceil(M/2).
 */
tournamentRouter.get('/:id/bracket', asyncHandler(async (req, res) => {
  const id = parseIdParam(req.params.id);
  const { rows: [t] } = await pool.query('SELECT * FROM public.tournaments WHERE id = $1', [id]);
  if (!t) throw new ApiError(404, 'Tournament not found');

  const { rows } = await pool.query(
    `SELECT m.id, m.match_round, m.match_number, m.status, m.room_code, m.started_at,
            m.deadline_at, m.winner_id, m.player1_id AS p1, m.player2_id AS p2,
            u1.username AS p1_username, u2.username AS p2_username, uw.username AS winner_username,
            r1.seed AS p1_seed, r2.seed AS p2_seed
     FROM public.matches m
     LEFT JOIN public.users u1   ON u1.id = m.player1_id
     LEFT JOIN public.users u2   ON u2.id = m.player2_id
     LEFT JOIN public.users uw   ON uw.id = m.winner_id
     LEFT JOIN public.registrations r1 ON r1.tournament_id = m.tournament_id AND r1.user_id = m.player1_id
     LEFT JOIN public.registrations r2 ON r2.tournament_id = m.tournament_id AND r2.user_id = m.player2_id
     WHERE m.tournament_id = $1
     ORDER BY m.match_round ASC, m.match_number ASC`,
    [id],
  );

  const totalRounds = t.max_players > 0 ? Math.round(Math.log2(t.max_players)) : 0;
  const byRound = new Map();
  for (const m of rows) {
    if (!byRound.has(m.match_round)) byRound.set(m.match_round, []);
    byRound.get(m.match_round).push({
      id: m.id,
      match_number: m.match_number,
      status: m.status,
      player1: m.p1 ? { id: m.p1, username: m.p1_username, seed: m.p1_seed } : null,
      player2: m.p2 ? { id: m.p2, username: m.p2_username, seed: m.p2_seed } : null,
      winner: m.winner_id ? { id: m.winner_id, username: m.winner_username } : null,
      room_code: m.room_code,
      started_at: m.started_at,
      deadline_at: m.deadline_at,
      feeds_next: m.match_round < totalRounds ? { round: m.match_round + 1, match: Math.ceil(m.match_number / 2) } : null,
    });
  }
  const rounds = [];
  for (let r = 1; r <= totalRounds; r++) rounds.push({ round: r, matches: byRound.get(r) ?? [] });

  res.json({
    success: true,
    data: {
      tournament_id: t.id,
      title: t.title,
      status: t.status,
      players: t.max_players,
      prize_pool_pesewas: t.prize_pool_pesewas,
      platform_fee_pesewas: t.platform_fee_pesewas,
      bracket_generated: rows.length > 0,
      rounds,
    },
    message: rows.length > 0 ? 'Bracket loaded' : 'Bracket not generated yet — lobby is not full',
  });
}));

/** GET /api/tournaments/:id/me — the caller's registration (or null). */
tournamentRouter.get('/:id/me', requireAuth, asyncHandler(async (req, res) => {
  const id = parseIdParam(req.params.id);
  const { rows } = await pool.query(
    `SELECT id, tournament_id, user_id, game_uid, payment_status, payment_reference,
            created_at,
            created_at + make_interval(mins => $2) AS payment_deadline
     FROM public.registrations
     WHERE tournament_id = $1 AND user_id = $3`,
    [id, env.registrationPendingTtlMinutes, req.user.id],
  );
  res.json({
    success: true,
    data: { registration: rows[0] ?? null },
    message: rows[0] ? 'Registration loaded' : 'You are not registered for this tournament',
  });
}));

/**
 * POST /api/tournaments/:id/join — verified players only.
 * Creates a pending registration (slot held for the 10-min payment window)
 * and initiates the entry-fee charge. One advisory lock per tournament
 * serializes joins so the lobby can never overfill under concurrency.
 */
tournamentRouter.post('/:id/join', requireAuth, requireVerified, perUser({ windowMs: 10 * MIN, max: 10, name: 'join' }), asyncHandler(async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (req.user.is_banned) throw new ApiError(403, 'Your account is banned — you cannot join tournaments');

  const gameUid = typeof req.body?.game_uid === 'string' ? req.body.game_uid.trim() : '';
  if (gameUid.length < 1 || gameUid.length > 64) {
    throw new ApiError(400, 'game_uid is required (1-64 characters) — your in-game ID');
  }

  const client = await pool.connect();
  try {
    // Phase A — validate under the per-tournament lock (no insert yet:
    // the live charge initiation below is an HTTP call and must happen
    // OUTSIDE a transaction so the advisory lock is not held across it).
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${id}`]);

    const t = await fetchTournament(client, id);
    if (!t) {
      await client.query('COMMIT');
      throw new ApiError(404, 'Tournament not found');
    }
    if (t.status === 'cancelled') {
      await client.query('COMMIT');
      throw new ApiError(409, 'This tournament was cancelled');
    }
    if (t.status !== 'open') {
      await client.query('COMMIT');
      throw new ApiError(409, `This tournament is ${t.status} — joining is closed`);
    }
    if (new Date() >= t.closes_at) {
      await client.query('COMMIT');
      throw new ApiError(400, 'Registration has closed for this tournament');
    }

    const { rows: [dup] } = await client.query(
      `SELECT id, payment_status, created_at FROM public.registrations
       WHERE tournament_id = $1 AND user_id = $2 FOR UPDATE`,
      [id, req.user.id],
    );
    if (dup) {
      const expiredPending = dup.payment_status === 'pending' && new Date(dup.created_at) <= new Date(Date.now() - env.registrationPendingTtlMinutes * 60_000);
      if (!expiredPending) {
        await client.query('COMMIT');
        throw new ApiError(409, dup.payment_status === 'pending' ? 'You already have a pending registration — finish payment first' : 'You are already registered for this tournament');
      }
      // Their previous attempt timed out unpaid: drop it so they can retry.
      // (A late charge for the old reference is refunded by refundLateCharge.)
      await client.query('DELETE FROM public.registrations WHERE id = $1', [dup.id]);
    }

    const { rows: [countRow] } = await client.query(
      `SELECT count(*)::int AS occupied
       FROM public.registrations
       WHERE tournament_id = $1 AND ${holdingSlot(2)}`,
      [id, env.registrationPendingTtlMinutes],
    );
    if (countRow.occupied >= t.max_players) {
      await client.query('COMMIT');
      throw new ApiError(409, 'This tournament is full');
    }
    await client.query('COMMIT');

    // Phase B — payment intent. Live: real Paystack MoMo charge (user
    // approves on their phone via authorization_url). Stub: local
    // reference settled by the dev simulate endpoint.
    let charge;
    try {
      charge = await initiateEntryFeeCharge({ user: req.user, tournament: t });
    } catch (err) {
      console.error('[join] charge initiation failed:', err.message);
      throw new ApiError(502, 'Could not start your payment — please try again');
    }

    // Phase C — re-check capacity (spots may have been taken between
    // phases) and insert under the lock.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${id}`]);

    const { rows: [countRow2] } = await client.query(
      `SELECT count(*)::int AS occupied
       FROM public.registrations
       WHERE tournament_id = $1 AND ${holdingSlot(2)}`,
      [id, env.registrationPendingTtlMinutes],
    );
    if (countRow2.occupied >= t.max_players) {
      await client.query('COMMIT');
      throw new ApiError(409, 'This tournament just filled up — please try another');
    }

    // The charge reference goes into the INSERT itself — a separate
    // pool connection here would miss the uncommitted row.
    const { rows: [reg] } = await client.query(
      `INSERT INTO public.registrations (tournament_id, user_id, game_uid, payment_reference)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tournament_id, user_id, game_uid, payment_status,
                 created_at, created_at + make_interval(mins => $5) AS payment_deadline`,
      [id, req.user.id, gameUid, charge.reference, env.registrationPendingTtlMinutes],
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      data: { registration: reg, charge },
      message: `Pay ${pesewasToGhsString(t.entry_fee_pesewas)} to lock your spot — pending registrations expire after ${env.registrationPendingTtlMinutes} minutes`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

/**
 * POST /api/tournaments/:id/cancel — admin only, BEFORE starts_at.
 * Refunds every paid registration (ledger + status), marks the tournament
 * cancelled, and writes the admin_audit_log entry — one transaction.
 */
tournamentRouter.post('/:id/cancel', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = parseIdParam(req.params.id);
  const result = await cancelTournament(id, req.user.id);
  res.json({
    success: true,
    data: result,
    message: `Tournament cancelled — ${result.refunded_count} player(s) refunded`,
  });
}));
