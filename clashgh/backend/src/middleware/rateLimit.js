/**
 * Minimal in-memory fixed-window rate limiter (single instance).
 * Fine for v1 on one Render instance; swap the Map for Postgres or Redis
 * only if the backend scales horizontally.
 *
 * Usage:
 *   rateLimit({ windowMs, max, keyFn })         custom key
 *   perIp({ windowMs, max, name })              keyed by client IP
 *   perUser({ windowMs, max, name })            keyed by req.user.id (falls back to IP)
 *
 * Responses carry Retry-After and the standard RateLimit-* headers so
 * clients can back off. Set RATE_LIMIT_DISABLED=1 to bypass in tests.
 */

const buckets = new Map();
const disabled = process.env.RATE_LIMIT_DISABLED === '1';

export function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    if (disabled) return next();
    const key = keyFn(req);
    if (!key) return next();
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      res.status(429).json({
        success: false,
        data: null,
        message: `Too many requests. Please wait ${resetSeconds > 60 ? Math.ceil(resetSeconds / 60) + ' minutes' : resetSeconds + ' seconds'} and try again.`,
      });
      return;
    }
    next();
  };
}

export function clientIp(req) {
  // trust proxy is set in app.js so req.ip is the real client behind Render.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function perIp({ windowMs, max, name }) {
  return rateLimit({ windowMs, max, keyFn: (req) => `${name}:ip:${clientIp(req)}` });
}

export function perUser({ windowMs, max, name }) {
  return rateLimit({
    windowMs,
    max,
    keyFn: (req) => (req.user?.id ? `${name}:user:${req.user.id}` : `${name}:ip:${clientIp(req)}`),
  });
}

/** Test hook: forget all counters. */
export function resetRateLimits() {
  buckets.clear();
}

// Keep the map bounded: drop expired buckets once a minute.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 60_000).unref();
