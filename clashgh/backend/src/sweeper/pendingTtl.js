import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

/**
 * Pending-registration TTL reaper (runs ~every 60s).
 *
 * Unpaid registrations hold their slot for REGISTRATION_PENDING_TTL_MINUTES,
 * then the slot is released. Slot math in the API already treats expired
 * pendings as free (lazy TTL), so this job only physically deletes stale
 * rows — idempotent, and shared by Module 1F's sweeper later.
 */

let timer = null;

export function startPendingTtlSweeper() {
  if (timer) return;
  const run = async () => {
    try {
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
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  console.log(`[sweeper] pending-registration TTL reaper started (${env.registrationPendingTtlMinutes}-min window, 60s interval)`);
}
