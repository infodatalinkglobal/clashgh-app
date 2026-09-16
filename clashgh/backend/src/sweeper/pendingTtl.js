import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { paystack } from '../services/paystack.js';
import { settleChargeSuccess } from '../services/payment.js';

/**
 * Pending-registration TTL reaper (runs ~every 60s).
 *
 * Unpaid registrations hold their slot for REGISTRATION_PENDING_TTL_MINUTES,
 * then the slot is released. Slot math in the API already treats expired
 * pendings as free (lazy TTL), so this job only physically deletes stale
 * rows — idempotent, and shared by Module 1F's sweeper later.
 */

let timer = null;
let running = false; // skip a tick if the previous one is still going

export function startPendingTtlSweeper() {
  if (timer) return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      try {
        // Live mode safety net: a player may have paid while the
        // charge.success webhook was delayed or lost. Ask Paystack before
        // releasing the slot; settle if it says success.
        if (env.paystackMode === 'live') {
          const { rows: stale } = await pool.query(
            `SELECT payment_reference FROM public.registrations
             WHERE payment_status = 'pending'
               AND created_at <= now() - make_interval(mins => $1)
               AND created_at > now() - interval '24 hours'
             LIMIT 50`,
            [env.registrationPendingTtlMinutes],
          );
          for (const r of stale) {
            try {
              const v = await paystack.verifyCharge(r.payment_reference);
              if (v?.status === 'success') {
                await settleChargeSuccess(r.payment_reference, v);
                console.log(`[sweeper] settled ${r.payment_reference} from Paystack verify (webhook was missed)`);
              }
            } catch (err) {
              console.error(`[sweeper] verify ${r.payment_reference} failed:`, err.message);
            }
          }
        }
        const { rowCount } = await pool.query(
          `DELETE FROM public.registrations
           WHERE payment_status = 'pending'
             AND created_at <= now() - make_interval(mins => $1)`,
          [env.registrationPendingTtlMinutes],
        );
        if (rowCount > 0) {
          console.log(`[sweeper] released ${rowCount} expired pending registration(s)`);
        }
      } catch (err) {
        console.error('[sweeper] pending-ttl error:', err.message);
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  console.log(`[sweeper] pending-registration TTL reaper started (${env.registrationPendingTtlMinutes}-min window, 60s interval)`);
}
