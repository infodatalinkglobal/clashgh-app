/**
 * Minimal in-memory fixed-window rate limiter (single instance).
 * Fine for v1 dev/single-node; replace with a shared store (e.g.
 * Postgres or Redis) only if the backend scales horizontally.
 */

const buckets = new Map();

export function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      res.status(429).json({ success: false, data: null, message: 'Too many requests — please try again later' });
      return;
    }
    next();
  };
}

// Keep the map bounded: drop expired buckets once a minute.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 60_000).unref();
