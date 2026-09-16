import { Router } from 'express';
import { perIp } from '../middleware/rateLimit.js';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { issueToken } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { EMAIL_RE } from '../utils/validate.js';
import { env } from '../config/env.js';

/**
 * DEV-ONLY stand-in for Supabase Auth (Google OAuth / magic link).
 *
 * Sign in with an email: if the profile does not exist yet it is
 * created exactly like the Supabase handle_new_user() trigger would
 * (002) — id, email, role='player' — then a Supabase-shaped JWT is
 * issued. The mobile app and API code never see the difference; when
 * the real Supabase project is created, AUTH_PROVIDER switches to
 * 'supabase', the app gets the token from supabase-js, and this
 * router is simply not mounted.
 *
 * Mounted only when AUTH_PROVIDER=stub AND NODE_ENV!=production.
 */
export function devAuthRouter() {
  const router = Router();

  router.post('/dev/auth/signin', perIp({ windowMs: 60 * 1000, max: 30, name: 'dev-signin' }), asyncHandler(async (req, res) => {
    if (env.authProvider !== 'stub' || env.nodeEnv === 'production') {
      throw new ApiError(404, 'Endpoint not found');
    }
    const { email } = req.body || {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      throw new ApiError(400, 'A valid email is required');
    }
    const normalized = email.trim().toLowerCase();

    let { rows } = await pool.query('SELECT id, email, role FROM public.users WHERE lower(email) = $1', [
      normalized,
    ]);
    let created = false;
    if (rows.length === 0) {
      // Mimics the 002 Supabase trigger: profile bootstrap on first sign-in.
      rows = (
        await pool.query(
          `INSERT INTO public.users (id, email, role) VALUES ($1, $2, 'player') RETURNING id, email, role`,
          [randomUUID(), normalized],
        )
      ).rows;
      created = true;
    }

    const token = issueToken(rows[0].id, rows[0].email);
    res.status(created ? 201 : 200).json({
      success: true,
      data: {
        token,
        user: { id: rows[0].id, email: rows[0].email, role: rows[0].role },
      },
      message: created ? 'Account created (dev sign-in)' : 'Signed in (dev sign-in)',
    });
  }));

  return router;
}
