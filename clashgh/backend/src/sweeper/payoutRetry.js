import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { initiateTransferForTx, claimForRetry, releaseFailedClaim, notifyPayoutFailed, MAX_PAYOUT_RETRIES } from '../services/payment.js';

/**
 * Payout retry sweeper (runs ~every 60s) — agent.md §9 step 6.
 *
 * Failed payout transactions are retried with backoff:
 *   failure 1 → retry in 15min, failure 2 → in 1h, failure 3 → in 6h.
 * After the 3rd retry fails, the row stays 'failed' with no
 * next_retry_at — FINAL FAILURE — and the admin is alerted (3E) with
 * one-click re-payout available (3C → POST /api/admin/tournaments/:id/payout?force=true).
 *
 * Refunds are NOT auto-retried: a failed refund is surfaced to the admin
 * (3C) and handled manually.
 */

let timer = null;
let running = false; // skip a tick if the previous one is still going

export async function runPayoutRetrySweep() {
  const { rows } = await pool.query(
    `SELECT id, user_id, amount_pesewas, attempts, tournament_id
     FROM public.transactions
     WHERE type IN ('payout', 'host_share')
       AND status = 'failed'
       AND attempts < $1
       AND (next_retry_at IS NULL OR next_retry_at <= now())`,
    [MAX_PAYOUT_RETRIES],
  );

  const results = [];
  for (const candidate of rows) {
    if (env.paystackMode === 'stub') {
      // Stub transfers always succeed when retried.
      await pool.query(
        `UPDATE public.transactions SET status = 'success', attempts = attempts + 1, next_retry_at = NULL
         WHERE id = $1 AND status = 'failed'`,
        [candidate.id],
      );
      results.push({ tx: candidate.id, retry: candidate.attempts + 1, state: 'success' });
      continue;
    }
    // Claim (failed → pending, attempts+1) BEFORE the HTTP call so no other
    // worker / admin click can initiate the same transfer concurrently.
    const tx = await claimForRetry(candidate.id);
    if (!tx) continue;
    try {
      await initiateTransferForTx(tx);
      results.push({ tx: tx.id, retry: tx.attempts, state: 'pending' });
      console.log(`[sweeper] payout ${tx.id} retry ${tx.attempts}/${MAX_PAYOUT_RETRIES} initiated`);
    } catch (err) {
      // Initiation itself failed (API down, etc.): back to 'failed' with the
      // next backoff slot, or FINAL FAILURE once attempts are exhausted.
      const final = tx.attempts >= MAX_PAYOUT_RETRIES;
      await releaseFailedClaim(tx, { final });
      if (final) {
        console.error(`[sweeper] payout ${tx.id} FINAL FAILURE after ${tx.attempts} attempts — admin attention required`);
        await notifyPayoutFailed(pool, tx);
      }
      results.push({ tx: tx.id, retry: tx.attempts, state: 'initiation_failed', error: err.message });
    }
  }
  return results;
}

export function startPayoutRetrySweeper() {
  if (timer) return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      try {
        await runPayoutRetrySweep();
      } catch (err) {
        console.error('[sweeper] payout-retry error:', err.message);
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  console.log('[sweeper] payout retry sweep started (60s interval, backoff 15m/1h/6h, max 3)');
}
