import { pool } from '../db/pool.js';
import { ApiError } from '../middleware/errorHandler.js';
import { UUID_RE } from '../utils/validate.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { executePayout } from './payment.js';
import { cancelTournament } from './cancel.js';

/**
 * Match flow (Module 1F).
 *
 * Lifecycle per match:
 *   pending → active → awaiting_results → completed
 *                └──────────┴───────────────→ disputed (admin: award/replay/refund)
 *
 * - Activation happens at the scheduled time (round 1 at starts_at, round
 *   N+1 when every round N match is completed) and mints the room code,
 *   started_at and deadline_at (= now + tournament.result_window_minutes).
 * - Players submit a pick ('won' | 'lost' | 'draw' | 'dispute') with a
 *   screenshot URL. A pick is FINAL once submitted (v1: no edits — a
 *   mis-click is handled by admin replay). Agreement logic:
 *     p1 'won'  + p2 'lost' → p1 wins
 *     p1 'lost' + p2 'won'  → p2 wins
 *     draw + draw, or anything else → disputed (admin decides)
 *   A 'dispute' pick disputes immediately.
 * - Deadline with exactly one 'won' pick → that player wins; any other
 *   state → disputed (sweeper).
 * - Completion slots the winner into the next round's match
 *   (winner of round R match M → round R+1 match ceil(M/2); odd →
 *   player1, even → player2) in the SAME transaction.
 * - Final match completed → tournament 'completed' + payouts (1E).
 */

const PICKS = ['won', 'lost', 'draw', 'dispute'];
const RESOLUTIONS = ['award', 'replay', 'refund'];

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Mint the room code + timing for a pending match (caller holds the
 * transaction + row lock). Retries on the (astronomically rare) unique
 * collision. Returns the updated match row.
 */
async function activateMatchTx(client, matchId, resultWindowMinutes) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomCode = generateRoomCode();
    try {
      const { rows: [m] } = await client.query(
        `UPDATE public.matches
         SET status = 'active', room_code = $2, started_at = now(),
             deadline_at = now() + make_interval(mins => $3)
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [matchId, roomCode, resultWindowMinutes],
      );
      if (m) return m;
      return null; // someone else activated it first
    } catch (err) {
      if (err.code === '23505' && /room_code/.test(err.message)) continue;
      throw err;
    }
  }
  throw new Error('Room code collision after 5 attempts');
}

/**
 * Sweeper step 1 + 3 (activation & tournament progression):
 *  - 'full' + starts_at passed → 'in_progress', activate round 1
 *  - round N fully completed → activate round N+1 (players are already
 *    slotted by the completion transaction)
 */
export async function activateDueMatches() {
  const { rows: candidates } = await pool.query(
    `SELECT id FROM public.tournaments WHERE status IN ('full', 'in_progress')`,
  );
  const activated = [];

  for (const t of candidates) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // (per-tournament errors are caught below — one broken tournament
      // must not stop activation for the others)
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${t.id}`]);
      const { rows: [cur] } = await client.query(
        'SELECT * FROM public.tournaments WHERE id = $1 FOR UPDATE',
        [t.id],
      );
      if (!cur) {
        await client.query('COMMIT');
        continue;
      }

      // Round 1: the tournament has reached its start time.
      if (cur.status === 'full' && cur.starts_at <= new Date()) {
        const { rows: r1 } = await client.query(
          `SELECT id FROM public.matches
           WHERE tournament_id = $1 AND match_round = 1 AND status = 'pending'
           ORDER BY match_number`,
          [cur.id],
        );
        for (const m of r1) {
          const done = await activateMatchTx(client, m.id, cur.result_window_minutes);
          if (done) activated.push(done.id);
        }
        await client.query(`UPDATE public.tournaments SET status = 'in_progress' WHERE id = $1 AND status = 'full'`, [cur.id]);
        await client.query('COMMIT');
        continue;
      }

      // Later round: the highest fully-completed round below it.
      if (cur.status === 'in_progress') {
        const { rows: [next] } = await client.query(
          `WITH rounds AS (
             SELECT match_round, count(*) AS total,
                    count(*) FILTER (WHERE status = 'completed') AS done
             FROM public.matches WHERE tournament_id = $1
             GROUP BY match_round
           )
           SELECT next_r.match_round
           FROM rounds next_r
           WHERE next_r.match_round > 1
             AND next_r.match_round = (
               SELECT max(prev.match_round) + 1 FROM rounds prev
               WHERE prev.total = prev.done
             )`,
          [cur.id],
        );
        if (next) {
          const { rows: pending } = await client.query(
            `SELECT id FROM public.matches
             WHERE tournament_id = $1 AND match_round = $2 AND status = 'pending'
             ORDER BY match_number`,
            [cur.id, next.match_round],
          );
          for (const m of pending) {
            const done = await activateMatchTx(client, m.id, cur.result_window_minutes);
            if (done) activated.push(done.id);
          }
        }
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[matchflow] activation failed for tournament ${t.id}:`, err.message);
    } finally {
      client.release();
    }
  }
  return activated;
}

// ---------------------------------------------------------------------------
// Completion & advancement
// ---------------------------------------------------------------------------

/**
 * Mark a match completed + slot the winner into the next round (caller
 * holds the transaction + match row lock). No-op advancement for the
 * final match.
 */
async function completeMatchTx(client, match, winnerId) {
  await client.query(
    `UPDATE public.matches SET status = 'completed', winner_id = $2 WHERE id = $1`,
    [match.id, winnerId],
  );
  const nextMatchNumber = Math.ceil(match.match_number / 2);
  const nextCol = match.match_number % 2 === 1 ? 'player1_id' : 'player2_id';
  await client.query(
    `UPDATE public.matches SET ${nextCol} = $3
     WHERE tournament_id = $1 AND match_round = $2 AND match_number = $4`,
    [match.tournament_id, match.match_round + 1, winnerId, nextMatchNumber],
  );
}

// ---------------------------------------------------------------------------
// Player result submission
// ---------------------------------------------------------------------------

/**
 * POST /api/matches/:id/result — the player's pick + screenshot.
 */
export async function submitResult({ matchId, userId, pick, screenshotUrl, reason = null }) {
  if (!UUID_RE.test(matchId)) throw new ApiError(400, 'Invalid match id');
  if (!PICKS.includes(pick)) {
    throw new ApiError(400, "pick must be one of 'won', 'lost', 'draw', 'dispute'");
  }
  if (typeof screenshotUrl !== 'string' || screenshotUrl.trim().length < 1 || screenshotUrl.length > 2048) {
    throw new ApiError(400, 'screenshot_url is required (1-2048 characters) — proof of the result');
  }
  if (reason !== null && (typeof reason !== 'string' || reason.length > 500)) {
    throw new ApiError(400, 'reason must be a string of at most 500 characters');
  }
  screenshotUrl = screenshotUrl.trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [match] } = await client.query(
      `SELECT m.* FROM public.matches m WHERE m.id = $1 FOR UPDATE`,
      [matchId],
    );
    if (!match) {
      await client.query('COMMIT');
      throw new ApiError(404, 'Match not found');
    }
    if (match.player1_id !== userId && match.player2_id !== userId) {
      await client.query('COMMIT');
      throw new ApiError(403, 'Only the two players in this match can submit a result');
    }
    if (match.status === 'pending') {
      await client.query('COMMIT');
      throw new ApiError(409, 'This match has not started yet — wait for the room code');
    }
    if (match.status === 'completed') {
      await client.query('COMMIT');
      throw new ApiError(409, 'This match is already completed');
    }
    if (match.status === 'disputed') {
      await client.query('COMMIT');
      throw new ApiError(409, 'This match is in dispute — an admin will resolve it');
    }
    if (match.deadline_at && match.deadline_at < new Date()) {
      await client.query('COMMIT');
      throw new ApiError(409, 'The result window has closed — this match goes to admin review');
    }

    const isP1 = match.player1_id === userId;
    const pickCol = isP1 ? 'player1_pick' : 'player2_pick';
    const shotCol = isP1 ? 'player1_screenshot_url' : 'player2_screenshot_url';
    if (match[pickCol]) {
      await client.query('COMMIT');
      throw new ApiError(409, 'You have already submitted your result for this match');
    }

    if (pick === 'dispute') {
      await client.query(
        `UPDATE public.matches SET ${pickCol} = $2, ${shotCol} = $3,
            status = 'disputed',
            dispute_reason = COALESCE($4, 'A player reported a dispute')
         WHERE id = $1`,
        [match.id, pick, screenshotUrl, reason],
      );
      await client.query('COMMIT');
      return { status: 'disputed', message: 'Match sent to admin review' };
    }

    await client.query(`UPDATE public.matches SET ${pickCol} = $2, ${shotCol} = $3 WHERE id = $1`, [
      match.id,
      pick,
      screenshotUrl,
    ]);

    const p1 = isP1 ? pick : match.player1_pick;
    const p2 = isP1 ? match.player2_pick : pick;
    let outcome;
    if (!p1 || !p2) {
      // Only one pick in so far — wait for the opponent.
      await client.query(`UPDATE public.matches SET status = 'awaiting_results' WHERE id = $1`, [match.id]);
      outcome = { status: 'awaiting_results' };
    } else if (p1 === 'won' && p2 === 'lost') {
      await completeMatchTx(client, match, match.player1_id);
      outcome = { status: 'completed', winner_id: match.player1_id };
    } else if (p1 === 'lost' && p2 === 'won') {
      await completeMatchTx(client, match, match.player2_id);
      outcome = { status: 'completed', winner_id: match.player2_id };
    } else if (p1 === 'draw' && p2 === 'draw') {
      await client.query(
        `UPDATE public.matches SET status = 'disputed',
            dispute_reason = 'Both players reported a draw — admin to decide (replay or award)'
         WHERE id = $1`,
        [match.id],
      );
      outcome = { status: 'disputed', message: 'Agreed draw — admin will decide (replay or award)' };
    } else {
      await client.query(
        `UPDATE public.matches SET status = 'disputed',
            dispute_reason = 'The two players reported different results — admin to review'
         WHERE id = $1`,
        [match.id],
      );
      outcome = { status: 'disputed', message: 'Results do not agree — admin will review' };
    }

    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Deadline enforcement (sweeper step 2)
// ---------------------------------------------------------------------------

export async function enforceDeadlines() {
  const { rows: expired } = await pool.query(
    `SELECT id FROM public.matches
     WHERE status IN ('active', 'awaiting_results') AND deadline_at IS NOT NULL AND deadline_at < now()`,
  );
  const results = [];
  for (const m of expired) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [match] } = await client.query(
        `SELECT m.* FROM public.matches m WHERE m.id = $1 FOR UPDATE`,
        [m.id],
      );
      if (!match || !['active', 'awaiting_results'].includes(match.status) || match.deadline_at >= new Date()) {
        await client.query('COMMIT');
        continue;
      }
      const picksIn = [match.player1_pick, match.player2_pick].filter(Boolean);
      if (picksIn.length === 1 && picksIn[0] === 'won') {
        const winnerId = match.player1_pick === 'won' ? match.player1_id : match.player2_id;
        await client.query(
          `UPDATE public.matches SET dispute_reason = 'Deadline passed — the single "won" pick is taken as the result' WHERE id = $1`,
          [match.id],
        );
        await completeMatchTx(client, match, winnerId);
        await client.query('COMMIT');
        results.push({ match: match.id, outcome: 'completed', winner_id: winnerId });
      } else {
        const reason = picksIn.length === 0
          ? 'Deadline passed with no results submitted — admin to review'
          : 'Deadline passed without agreement — admin to review';
        await client.query(
          `UPDATE public.matches SET status = 'disputed', dispute_reason = $2 WHERE id = $1`,
          [match.id, reason],
        );
        await client.query('COMMIT');
        results.push({ match: match.id, outcome: 'disputed' });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tournament progression (sweeper step 3)
// ---------------------------------------------------------------------------

export async function progressTournaments() {
  // Safety net for the full → in_progress flip (normally done with round-1
  // activation); then: final match completed → payouts (1E) → 'completed'.
  const { rows: finals } = await pool.query(
    `SELECT m.tournament_id
     FROM public.matches m
     JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE m.match_round = (SELECT max(fm.match_round)
                            FROM public.matches fm
                            WHERE fm.tournament_id = m.tournament_id)
       AND m.match_number = 1
       AND m.status = 'completed'
       AND t.status IN ('in_progress', 'full')`,
  );
  const progressed = [];
  for (const { tournament_id: tid } of finals) {
    try {
      const r = await executePayout(tid);
      progressed.push({ tournament: tid, ...r });
    } catch (err) {
      console.error(`[matchflow] payout for tournament ${tid} failed:`, err.message);
      progressed.push({ tournament: tid, error: err.message });
    }
  }
  return progressed;
}

// ---------------------------------------------------------------------------
// Admin dispute resolution
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/matches/:id/resolve —
 *   award  { winner_id } → that player wins, bracket advances
 *   replay                → same two players, new room code + window,
 *                           picks/screenshots/winner cleared
 *   refund                → the whole tournament is cancelled and every
 *                           paid registration refunded (1C flow)
 */
export async function resolveDispute({ matchId, adminId, resolution, winnerId = null }) {
  if (!UUID_RE.test(matchId)) throw new ApiError(400, 'Invalid match id');
  if (!RESOLUTIONS.includes(resolution)) {
    throw new ApiError(400, "resolution must be one of 'award', 'replay', 'refund'");
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [m] } = await client.query(
      `SELECT m.*, t.result_window_minutes
       FROM public.matches m
       JOIN public.tournaments t ON t.id = m.tournament_id
       WHERE m.id = $1 FOR UPDATE`,
      [matchId],
    );
    if (!m) {
      await client.query('COMMIT');
      throw new ApiError(404, 'Match not found');
    }
    if (m.status !== 'disputed') {
      await client.query('COMMIT');
      throw new ApiError(409, `Match is '${m.status}' — only disputed matches can be resolved`);
    }

    if (resolution === 'refund') {
      // Cancel + refund the whole tournament (its own transaction; commit
      // first so we release the lock).
      await client.query('COMMIT');
      const result = await cancelTournament(m.tournament_id, adminId, { allowInProgress: true });
      await pool.query(
        `INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details)
         VALUES ($1, 'resolve_dispute', 'match', $2, $3)`,
        [adminId, matchId, JSON.stringify({ resolution: 'refund', tournament_cancelled: m.tournament_id })],
      );
      return { resolution: 'refund', tournament: result };
    }

    if (resolution === 'award') {
      if (winnerId !== m.player1_id && winnerId !== m.player2_id) {
        await client.query('COMMIT');
        throw new ApiError(400, 'winner_id must be one of the two players in this match');
      }
      await client.query(`UPDATE public.matches SET dispute_reason = 'Admin awarded the match' WHERE id = $1`, [matchId]);
      await completeMatchTx(client, m, winnerId);
      await client.query(
        `INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details)
         VALUES ($1, 'resolve_dispute', 'match', $2, $3)`,
        [adminId, matchId, JSON.stringify({ resolution: 'award', winner_id: winnerId })],
      );
      await client.query('COMMIT');
      return { resolution: 'award', winner_id: winnerId, match: matchId };
    }

    // replay — same two players, fresh room code + result window
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const roomCode = generateRoomCode();
      try {
        await client.query(
          `UPDATE public.matches
           SET status = 'active', room_code = $2,
               player1_pick = NULL, player2_pick = NULL,
               player1_screenshot_url = NULL, player2_screenshot_url = NULL,
               winner_id = NULL, dispute_reason = 'Admin ordered a replay',
               started_at = now(),
               deadline_at = now() + make_interval(mins => $3)
           WHERE id = $1`,
          [matchId, roomCode, m.result_window_minutes],
        );
        break;
      } catch (err) {
        if (attempt === 4 || !(err.code === '23505' && /room_code/.test(err.message))) throw err;
      }
    }
    await client.query(
      `INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details)
       VALUES ($1, 'resolve_dispute', 'match', $2, $3)`,
      [adminId, matchId, JSON.stringify({ resolution: 'replay' })],
    );
    await client.query('COMMIT');
    return { resolution: 'replay', match: matchId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Money invariants (sweeper step 7 — hourly)
// ---------------------------------------------------------------------------

export async function runMoneyInvariantCheck() {
  const violations = [];

  // 1) Every completed tournament: exactly 2 successful payouts + 1 platform fee.
  // 5-minute grace: a just-completed tournament may still have its payout
  // transaction in flight; the hourly re-check catches anything real.
  const { rows: completed } = await pool.query(
    `SELECT id, title FROM public.tournaments
     WHERE status = 'completed' AND updated_at < now() - interval '5 minutes'`,
  );
  for (const t of completed) {
    const { rows: [c] } = await pool.query(
      `SELECT
         (count(*) FILTER (WHERE type = 'payout' AND status = 'success'))::int AS payouts_ok,
         (count(*) FILTER (WHERE type = 'payout'))::int AS payouts_total,
         (count(*) FILTER (WHERE type = 'platform_fee'))::int AS platform_fees,
         (count(*) FILTER (WHERE type = 'payout' AND status = 'failed'))::int AS payouts_failed
       FROM public.transactions WHERE tournament_id = $1`,
      [t.id],
    );
    if (c.payouts_ok !== 2 || c.platform_fees !== 1) {
      violations.push(
        `completed tournament '${t.title}' (${t.id}): expected 2 successful payouts + 1 platform fee, got payouts ${c.payouts_ok}/${c.payouts_total} (failed: ${c.payouts_failed}), platform fees ${c.platform_fees}`,
      );
    }
  }

  // 2) Every cancelled tournament: a refund row for every refunded registration.
  const { rows: cancelled } = await pool.query(
    `SELECT id, title FROM public.tournaments WHERE status = 'cancelled'`,
  );
  for (const t of cancelled) {
    const { rows: [c] } = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.registrations r
           WHERE r.tournament_id = t.id AND r.payment_status = 'refunded')::int AS refunded_regs,
         (SELECT count(*) FROM public.transactions x
           WHERE x.tournament_id = t.id AND x.type = 'refund')::int AS refund_rows,
         (SELECT count(*) FROM public.transactions x
           WHERE x.tournament_id = t.id AND x.type = 'refund' AND x.status = 'failed')::int AS refunds_failed
       FROM public.tournaments t WHERE t.id = $1`,
      [t.id],
    );
    if (c.refunded_regs !== c.refund_rows) {
      violations.push(
        `cancelled tournament '${t.title}' (${t.id}): ${c.refunded_regs} refunded registrations but ${c.refund_rows} refund transactions`,
      );
    }
    if (c.refunds_failed > 0) {
      violations.push(`cancelled tournament '${t.title}' (${t.id}): ${c.refunds_failed} FAILED refund transfer(s) need admin action`);
    }
  }

  // 3) Every completed final match: payout initiated (a payout row exists).
  const { rows: finals } = await pool.query(
    `SELECT m.id AS match_id, m.tournament_id, t.title
     FROM public.matches m
     JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE m.match_round = (SELECT max(fm.match_round) FROM public.matches fm WHERE fm.tournament_id = m.tournament_id)
       AND m.match_number = 1
       AND m.status = 'completed'
       AND NOT EXISTS (SELECT 1 FROM public.transactions x WHERE x.match_id = m.id AND x.type = 'payout')`,
  );
  for (const f of finals) {
    violations.push(`final match ${f.match_id} of '${f.title}' (${f.tournament_id}) completed without any payout transaction`);
  }

  if (violations.length > 0) {
    for (const v of violations) console.error(`[money-invariant] VIOLATION: ${v} — admin attention required (alert lands in 3E)`);
  } else {
    console.log(`[money-invariant] OK — checked ${completed.length} completed + ${cancelled.length} cancelled tournament(s), no violations`);
  }
  return { violations };
}
