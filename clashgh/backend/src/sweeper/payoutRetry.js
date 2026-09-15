import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { initiateTransferForTx, notifyPayoutFailed, MAX_PAYOUT_RETRIES } from '../services/payment.js';

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

export async function runPayoutRetrySweep() {
  const { rows } = await pool.query(
    `SELECT id, user_id, amount_pesewas, attempts, tournament_id
     FROM public.transactions
     WHERE type = 'payout'
       AND status = 'failed'
       AND attempts < $1
       AND (next_retry_at IS NULL OR next_retry_at <= now())`,
    [MAX_PAYOUT_RETRIES],
  );

  const results = [];
  for (const tx of rows) {
    if (env.paystackMode === 'stub') {
      // Stub transfers always succeed when retried.
      await pool.query(
        `UPDATE public.transactions
         SET status = 'success', attempts = attempts + 1, next_retry_at = NULL
         WHERE id = $1`,
        [tx.id],
      );
      results.push({ tx: tx.id, retry: tx.attempts + 1, state: 'success' });
      continue;
    }
    try {
      await initiateTransferForTx(tx);
      await pool.query(
        `UPDATE public.transactions
         SET status = 'pending', attempts = attempts + 1, next_retry_at = NULL
         WHERE id = $1`,
        [tx.id],
      );
      results.push({ tx: tx.id, retry: tx.attempts + 1, state: 'pending' });
      console.log(`[sweeper] payout ${tx.id} retry ${tx.attempts + 1}/${MAX_PAYOUT_RETRIES} initiated`);
    } catch (err) {
      // Re-initiation itself failed (API down, etc.) — bump attempts so
      // the backoff schedule advances; the webhook would have done the
      // same if the transfer had failed after starting.
      const attempts = tx.attempts + 1;
      if (attempts >= MAX_PAYOUT_RETRIES) {
        await pool.query(
          `UPDATE public.transactions SET status = 'failed', attempts = $2, next_retry_at = NULL WHERE id = $1`,
          [tx.id, attempts],
        );
        console.error(`[sweeper] payout ${tx.id} FINAL FAILURE after ${attempts} retries — admin attention required`);
        await notifyPayoutFailed(pool, { ...tx, attempts });
      } else {
        const due = new Date(Date.now() + [15, 60, 360][Math.min(attempts, 2)] * 60_000);
        await pool.query(
          `UPDATE public.transactions SET attempts = $2, next_retry_at = $3 WHERE id = $1`,
          [tx.id, attempts, due],
        );
      }
      results.push({ tx: tx.id, retry: attempts, state: 'initiation_failed', error: err.message });
    }
  }
  return results;
}

export function startPayoutRetrySweeper() {
  if (timer) return;
  const run = async () => {
    try {
      await runPayoutRetrySweep();
    } catch (err) {
      console.error('[sweeper] payout-retry error:', err.message);
    }
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  console.log('[sweeper] payout retry sweep started (60s interval, backoff 15m/1h/6h, max 3)');
}
