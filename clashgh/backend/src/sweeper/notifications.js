import { runNotificationsSweep, enqueueStartReminders } from '../services/notifications.js';

/** Notifications outbox dispatcher (Module 3E) — every 20s. */
let timer = null;

export function startNotificationsSweeper() {
  if (timer) return;
  const run = async () => {
    try {
      await enqueueStartReminders();
      await runNotificationsSweep();
    } catch (err) {
      console.error('[notify] sweep error:', err.message);
    }
  };
  timer = setInterval(run, 20_000);
  timer.unref();
  setTimeout(run, 2_000).unref();
  console.log('[sweeper] notifications dispatcher started (20s interval, backoff 1m/5m/30m/2h/6h, max 5)');
}
