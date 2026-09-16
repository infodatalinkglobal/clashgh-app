import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireVerified, optionalAuth } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { UUID_RE } from '../utils/validate.js';
import { submitResult, scheduleMatch, scheduleView } from '../services/matches.js';

/**
 * Match endpoints (Module 1F).
 *
 * GET  /api/matches/:id          — public: both players (username, seed,
 *                                  game_uid so players can find each other
 *                                  in-game), room code (once active), picks,
 *                                  deadline
 * POST /api/matches/:id/result   — the two participants only: submit a pick
 *                                  ('won'/'lost'/'draw'/'dispute') with the
 *                                  screenshot URL
 */
export const matchRouter = Router();

function parseIdParam(id) {
  if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid match id');
  return id;
}

async function loadMatchView(matchId, { includeScreenshots = false } = {}) {
  const { rows: [m] } = await pool.query(
    `SELECT m.*, t.title AS tournament_title, t.status AS tournament_status,
            t.starts_at AS tournament_starts_at
     FROM public.matches m
     JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE m.id = $1`,
    [matchId],
  );
  if (!m) return null;

  const playerView = (userId, pick, shot) => {
    if (!userId) return null;
    return {
      user_id: userId,
      pick: pick ?? null,
      ...(includeScreenshots ? { screenshot_url: shot ?? null } : {}),
    };
  };

  return {
    id: m.id,
    tournament_id: m.tournament_id,
    tournament_title: m.tournament_title,
    tournament_status: m.tournament_status,
    tournament_starts_at: m.tournament_starts_at,
    match_round: m.match_round,
    match_number: m.match_number,
    status: m.status,
    room_code: m.room_code,
    started_at: m.started_at,
    deadline_at: m.deadline_at,
    player1: playerView(m.player1_id, m.player1_pick, m.player1_screenshot_url),
    player2: playerView(m.player2_id, m.player2_pick, m.player2_screenshot_url),
    winner_id: m.winner_id,
    dispute_reason: m.dispute_reason,
    schedule: scheduleView(m),
  };
}

matchRouter.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const id = parseIdParam(req.params.id);
  const match = await loadMatchView(id);
  if (!match) throw new ApiError(404, 'Match not found');
  const viewerId = req.user?.id ?? null;
  const viewerIsPlayer = !!viewerId && (match.player1?.user_id === viewerId || match.player2?.user_id === viewerId);
  const matchOpen = !['completed'].includes(match.status);

  // Resolve usernames + seeds + in-game UIDs for the two players.
  for (const side of ['player1', 'player2']) {
    const p = match[side];
    if (!p) continue;
    const { rows: [info] } = await pool.query(
      `SELECT u.username, u.email, r.seed, r.game_uid, u.contact_phone
       FROM public.users u
       JOIN public.registrations r ON r.user_id = u.id AND r.tournament_id = $2
       WHERE u.id = $1`,
      [p.user_id, match.tournament_id],
    );
    if (info) {
      p.username = info.username;
      p.seed = info.seed;
      p.game_uid = info.game_uid; // public by design — how players find each other in-game
      // Contact number: only the current opponent sees it, only while the match is open.
      p.contact_phone = viewerIsPlayer && matchOpen && p.user_id !== viewerId ? info.contact_phone ?? null : null;
    }
  }

  res.json({ success: true, data: match, message: 'Match loaded' });
}));

/**
 * POST /api/matches/:id/schedule  { action: 'propose', at } | { action: 'accept' }
 * Players agree on one time; see services/matches.js scheduleMatch.
 */
matchRouter.post('/:id/schedule', requireAuth, requireVerified, asyncHandler(async (req, res) => {
  const id = parseIdParam(req.params.id);
  const result = await scheduleMatch({ matchId: id, userId: req.user.id, action: req.body?.action, at: req.body?.at });
  res.json({
    success: true,
    data: result,
    message: req.body?.action === 'accept' ? 'Match time agreed' : 'Time proposed. Your opponent has been notified.',
  });
}));

matchRouter.post(
  '/:id/result',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req.params.id);
    const result = await submitResult({
      matchId: id,
      userId: req.user.id,
      pick: req.body?.pick,
      screenshotUrl: req.body?.screenshot_url,
      reason: req.body?.reason ?? null,
    });
    res.json({
      success: true,
      data: { match_id: id, ...result },
      message:
        result.status === 'completed'
          ? 'Result confirmed — match completed'
          : result.status === 'disputed'
            ? result.message
            : 'Result recorded — waiting for your opponent',
    });
  }),
);
