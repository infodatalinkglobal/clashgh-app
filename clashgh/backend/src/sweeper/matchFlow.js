import { activateDueMatches, enforceDeadlines, progressTournaments, runMoneyInvariantCheck } from '../services/matches.js';

/**
 * Match-flow sweeper (Module 1F) — runs ~every 60s:
 *   1. activate matches due (round 1 at starts_at, round N+1 when round N
 *      is fully completed) — mints room codes + deadlines
 *   2. enforce deadlines (single 'won' → win, otherwise disputed)
 *   3. progress tournaments (final completed → payouts → 'completed')
 * Plus the hourly money-invariant check (agent.md §9 step 7).
 */

let timer = null;
let running = false; // skip a tick if the previous one is still going
let sweeps = 0;

export async function runMatchFlowSweep() {
  const results = { activated: [], deadlines: [], progressed: [] };
  try {
    results.activated = await activateDueMatches();
    results.deadlines = await enforceDeadlines();
    results.progressed = await progressTournaments();
  } catch (err) {
    console.error('[sweeper] match-flow error:', err.message);
  }
  sweeps += 1;
  if (sweeps % 60 === 1) {
    // ~hourly (first sweep + every 60th)
    try {
      await runMoneyInvariantCheck();
    } catch (err) {
      console.error('[sweeper] money-invariant check error:', err.message);
    }
  }
  const active = results.activated.length + results.deadlines.length + results.progressed.length;
  if (active > 0) {
    console.log(
      `[sweeper] match-flow: activated=${results.activated.length} deadline=${results.deadlines.length} progressed=${results.progressed.length}`,
    );
  }
  return results;
}

export function startMatchFlowSweeper() {
  if (timer) return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runMatchFlowSweep();
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  // Run once shortly after boot so a restart does not delay starts.
  const boot = setTimeout(run, 5_000);
  boot.unref?.();
  console.log('[sweeper] match-flow sweep started (60s interval, hourly money-invariant check)');
}
