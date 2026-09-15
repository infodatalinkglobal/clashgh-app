import { generateMissingBrackets } from '../services/bracket.js';

/**
 * Bracket-generation safety sweep (runs ~every 60s).
 *
 * Normal generation happens synchronously inside the settling payment
 * (the exact moment the lobby fills). This sweep only recovers from a
 * crash between settlement and generation — idempotent, shared with
 * Module 1F's sweeper later.
 */

let timer = null;

export function startBracketGenSweeper() {
  if (timer) return;
  const run = async () => {
    try {
      const results = await generateMissingBrackets();
      for (const r of results) {
        if (r.generated) {
          console.log(`[sweeper] generated missing bracket for ${r.tournament_id} (${r.players} players)`);
        } else if (r.reason) {
          console.log(`[sweeper] bracket sweep: ${r.tournament_id} skipped (${r.reason})`);
        }
      }
    } catch (err) {
      console.error('[sweeper] bracket-gen error:', err.message);
    }
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  console.log('[sweeper] bracket generation safety sweep started (60s interval)');
}
