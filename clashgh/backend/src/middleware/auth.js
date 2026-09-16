import jwt from 'jsonwebtoken';
import { createPublicKey } from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { ApiError } from './errorHandler.js';

/**
 * JWT verification for Supabase-Auth-shaped tokens.
 *
 * Token format (identical for the dev stub and real Supabase):
 *   HS256, aud='authenticated', iss=<base>/auth/v1, sub=<user uuid>,
 *   role='authenticated', email=<email>, exp within 1 hour.
 *
 * SECURITY: the user's ClashGH role (player/admin) is ALWAYS read
 * from public.users, never from a token claim — a forged 'role'
 * claim in a JWT is meaningless here.
 */

// ---------------------------------------------------------------------------
// JWKS (asymmetric Supabase keys). Fetched lazily, cached for an hour, and
// refetched once when a token arrives with an unknown kid (key rotation).
// ---------------------------------------------------------------------------
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { keys: new Map(), fetchedAt: 0 };

async function loadJwks(force = false) {
  if (!force && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS && jwksCache.keys.size > 0) return jwksCache.keys;
  const url = `${env.supabaseUrl}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (!jwk.kid) continue;
    keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
  }
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function publicKeyFor(kid) {
  let keys = await loadJwks();
  if (!keys.has(kid)) keys = await loadJwks(true);
  const key = keys.get(kid);
  if (!key) throw new Error(`Unknown signing key ${kid}`);
  return key;
}

/** Test hook: preload keys so no network is needed. */
export function _setJwksForTests(map) {
  jwksCache = { keys: map, fetchedAt: Date.now() };
}

/**
 * Verify a user token. Dispatches on the header alg:
 *   ES256 / RS256  Supabase asymmetric keys via JWKS (default for new projects)
 *   HS256          shared secret (dev stub, or legacy Supabase projects)
 */
export async function verifyToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header) throw Object.assign(new Error('Malformed token'), { name: 'JsonWebTokenError' });
  const { alg, kid } = decoded.header;
  const opts = { audience: 'authenticated', issuer: env.jwtIssuer };
  if (alg === 'HS256') {
    if (!env.jwtSecret) throw Object.assign(new Error('HS256 token but no shared secret configured'), { name: 'JsonWebTokenError' });
    return jwt.verify(token, env.jwtSecret, { ...opts, algorithms: ['HS256'] });
  }
  if (alg === 'ES256' || alg === 'RS256') {
    if (env.authProvider !== 'supabase') throw Object.assign(new Error('Asymmetric tokens not accepted in stub mode'), { name: 'JsonWebTokenError' });
    const key = await publicKeyFor(kid);
    return jwt.verify(token, key, { ...opts, algorithms: [alg] });
  }
  throw Object.assign(new Error(`Unsupported token alg ${alg}`), { name: 'JsonWebTokenError' });
}

export function issueToken(userId, email) {
  return jwt.sign(
    { aud: 'authenticated', role: 'authenticated', email },
    env.jwtSecret,
    {
      algorithm: 'HS256',
      issuer: env.jwtIssuer,
      subject: userId,
      expiresIn: '1h',
    },
  );
}

const PROFILE_FIELDS =
  'id, email, phone, phone_verified, username, momo_provider, role, is_banned, created_at, host_status, host_note, host_applied_at, contact_phone';

/**
 * requireAuth — verify the Bearer JWT and load the profile row.
 * Attaches req.user. 401 on missing/invalid/expired token or a token
 * whose user has no profile row yet.
 */
export async function requireAuth(req, res, next) {
  try {
    // Standard: Authorization: Bearer <jwt>. Fallback: X-ClashGH-Token
    // <jwt> — some reverse proxies / preview tunnels strip Authorization.
    // Same JWT, same verification; only the transport differs.
    const header = req.headers.authorization || '';
    const [scheme, bearer] = header.split(' ');
    const alt = env.nodeEnv !== 'production' ? req.headers['x-clashgh-token'] : undefined;
    const token = scheme === 'Bearer' && bearer ? bearer : typeof alt === 'string' && alt ? alt : null;
    if (!token) {
      throw new ApiError(401, 'Missing bearer token');
    }

    let payload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      throw new ApiError(401, err.name === 'TokenExpiredError' ? 'Session expired — sign in again' : 'Invalid token');
    }

    const { rows } = await pool.query(
      `SELECT ${PROFILE_FIELDS} FROM public.users WHERE id = $1`,
      [payload.sub],
    );
    if (rows.length === 0) throw new ApiError(401, 'Account not found');

    req.user = rows[0];
    // Banned accounts are read-only: they may load their own profile (so
    // the app can explain) but nothing else — no joins, results, uploads,
    // payouts to a banned number. Admin ban is a single, complete gate.
    if (req.user.is_banned && !(req.method === 'GET' && req.path === '/me')) {
      throw new ApiError(403, 'Your account is banned — contact support');
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * optionalAuth — like requireAuth when a token is present (so the route can
 * tailor the response to the viewer), a no-op anonymous request otherwise.
 * A bad token is ignored, not rejected: the route is public.
 */
export function optionalAuth(req, res, next) {
  const hasToken = (req.headers.authorization || '').startsWith('Bearer ') || (env.nodeEnv !== 'production' && !!req.headers['x-clashgh-token']);
  if (!hasToken) return next();
  requireAuth(req, res, (err) => {
    if (err) req.user = undefined;
    next();
  });
}

/** requireAdmin — after requireAuth; 403 unless role='admin'. */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(new ApiError(403, 'Admin access required'));
  }
  next();
}

/**
 * requireVerified — after requireAuth; 403 unless the one-time
 * phone verification is done. Used by every money-adjacent route
 * (join, pay, submit results...) from 1C onward.
 */
export function requireVerified(req, res, next) {
  if (!req.user || !req.user.phone_verified) {
    return next(new ApiError(403, 'Verify your MoMo number before continuing'));
  }
  next();
}
