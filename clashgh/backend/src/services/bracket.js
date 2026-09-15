import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { computeSplit } from '../utils/prize.js';

/**
 * Single-elimination bracket engine (Module 1D).
 *
 * Follows agent.md §9 exactly:
 *   1. Shuffle paid players (crypto Fisher-Yates — never Math.random)
 *   2. Assign seeds 1..N
 *   3. Round 1 pairs seeds (1v2), (3v4), (5v6), ... — player1 = lower seed
 *   4. Pre-create placeholder matches (NULL players) for rounds 2..log2(N)
 *   5. Prize pool + platform fee fixed in integer pesewa at generation
 *
 * No byes (the lobby must fill to exactly the player cap), no schema links
 * needed for advancement: the winner of round R match M feeds round R+1
 * match ceil(M/2) — Module 1F uses that wiring to slot winners.
 *
 * Idempotent: a tournament that already has matches is left untouched.
 * Triggered synchronously by the settling payment (the moment the lobby
 * fills) AND by the 60s safety sweep (crash between settle and generate).
 */

export async function generateBracket(tournamentId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same per-tournament lock joins/cancel use — full serialization.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament:${tournamentId}`]);

    const { rows: [t] } = await client.query(
      'SELECT * FROM public.tournaments WHERE id = $1 FOR UPDATE',
      [tournamentId],
    );
    if (!t) {
      await client.query('COMMIT');
      return { generated: false, reason: 'tournament not found' };
    }
    if (!['full', 'in_progress', 'completed'].includes(t.status)) {
      await client.query('COMMIT');
      return { generated: false, reason: `status '${t.status}' — bracket only generates for a filled lobby` };
    }

    const { rows: [existing] } = await client.query(
      'SELECT count(*)::int AS n FROM public.matches WHERE tournament_id = $1',
      [tournamentId],
    );
    if (existing.n > 0) {
      await client.query('COMMIT');
      return { generated: false, reason: 'bracket already exists' };
    }

    const { rows: paid } = await client.query(
      `SELECT user_id FROM public.registrations
       WHERE tournament_id = $1 AND payment_status = 'paid'
       ORDER BY created_at ASC`,
      [tournamentId],
    );
    if (paid.length !== t.max_players) {
      await client.query('COMMIT');
      return { generated: false, reason: `lobby not full (${paid.length}/${t.max_players} paid)` };
    }

    // 1-2: shuffle + seeds
    const order = paid.map((r) => r.user_id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < order.length; i++) {
      await client.query(
        `UPDATE public.registrations SET seed = $3 WHERE tournament_id = $1 AND user_id = $2`,
        [tournamentId, order[i], i + 1],
      );
    }

    // 3-4: round 1 with players, later rounds as placeholders
    const totalRounds = Math.round(Math.log2(t.max_players));
    for (let round = 1; round <= totalRounds; round++) {
      const matchesInRound = t.max_players / 2 ** round;
      for (let m = 1; m <= matchesInRound; m++) {
        const p1 = round === 1 ? order[(m - 1) * 2] : null;
        const p2 = round === 1 ? order[(m - 1) * 2 + 1] : null;
        await client.query(
          `INSERT INTO public.matches (tournament_id, match_round, match_number, player1_id, player2_id, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [tournamentId, round, m, p1, p2],
        );
      }
    }

    // 5: fix the money at bracket generation (integer pesewa math)
    const total = t.entry_fee_pesewas * t.max_players;
    const split = computeSplit(total, t.first_place_percent, t.runnerup_percent);
    await client.query(
      `UPDATE public.tournaments SET prize_pool_pesewas = $2, platform_fee_pesewas = $3 WHERE id = $1`,
      [tournamentId, split.prize_pool, split.platform],
    );

    await client.query('COMMIT');
    return {
      generated: true,
      players: t.max_players,
      rounds: totalRounds,
      matches: t.max_players - 1,
      prize_pool_pesewas: split.prize_pool,
      platform_fee_pesewas: split.platform,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Safety net: generate brackets for 'full' tournaments that have none
 * (e.g. a crash between settlement and generation). Idempotent by design.
 */
export async function generateMissingBrackets() {
  const { rows } = await pool.query(
    `SELECT t.id FROM public.tournaments t
     WHERE t.status = 'full'
       AND NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.tournament_id = t.id)`,
  );
  const results = [];
  for (const row of rows) {
    try {
      results.push({ tournament_id: row.id, ...(await generateBracket(row.id)) });
    } catch (err) {
      results.push({ tournament_id: row.id, generated: false, reason: err.message });
    }
  }
  return results;
}
