import { runNotificationsSweep, enqueueStartReminders } from '../services/notifications.js';

/** Notifications outbox dispatcher (Module 3E) — every 20s. */
let timer = null;
let running = false; // skip a tick if the previous one is still going

export function startNotificationsSweeper() {
  if (timer) return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      try {
        await enqueueStartReminders();
        await runNotificationsSweep();
      } catch (err) {
        console.error('[notify] sweep error:', err.message);
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, 20_000);
  timer.unref();
  setTimeout(run, 2_000).unref();
  console.log('[sweeper] notifications dispatcher started (20s interval, backoff 1m/5m/30m/2h/6h, max 5)');
}
