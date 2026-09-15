import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { toE164, detectProvider } from '../utils/phone.js';
import { USERNAME_RE, OTP_RE } from '../utils/validate.js';
import { createOtpChallenge, checkOtpAttempt, completePhoneVerification } from '../services/otp.js';
import { sms } from '../services/sms.js';
import { env } from '../config/env.js';

export const authRouter = Router();

const MIN = 60_000;

function profilePayload(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    phone: user.phone,
    phone_verified: user.phone_verified,
    momo_provider: user.momo_provider,
    role: user.role,
    is_banned: user.is_banned,
    created_at: user.created_at,
  };
}

/** GET /api/me — current user's profile. */
authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { profile: profilePayload(req.user) }, message: 'Profile loaded' });
}));

/** PATCH /api/me — update username (onboarding). */
authRouter.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const { username } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw new ApiError(
      400,
      'Username must be 3-20 characters: lowercase letters, numbers, or underscore',
    );
  }
  const { rows } = await pool.query(
    'UPDATE public.users SET username = $2 WHERE id = $1 RETURNING username',
    [req.user.id, username],
  );
  res.json({ success: true, data: { username: rows[0].username }, message: 'Username updated' });
}));

/**
 * POST /api/me/phone/request-otp — send the one-time verification code.
 * Rate-limited to 3 per 10 minutes per user (keeps SMS cost + abuse down).
 */
authRouter.post(
  '/me/phone/request-otp',
  requireAuth,
  rateLimit({ windowMs: 10 * MIN, max: 3, keyFn: (req) => `otp-req:${req.user.id}` }),
  asyncHandler(async (req, res) => {
    if (req.user.phone_verified) {
      throw new ApiError(409, 'Phone number already verified — no repeated OTPs');
    }
    const phone = toE164(req.body?.phone);
    if (!phone) throw new ApiError(400, 'Enter a valid Ghana number (0XXXXXXXXX or +233XXXXXXXXX)');
    const provider = detectProvider(phone);
    if (!provider) throw new ApiError(400, 'That number is not a supported MoMo number');

    const otp = await createOtpChallenge(phone);
    await sms.send({
      to: phone,
      body: `Your ClashGH verification code is ${otp}. Valid for ${env.otpTtlMinutes} minutes. Do not share it.`,
    });
    res.json({ success: true, data: null, message: 'Verification code sent via SMS' });
  }),
);

const VERIFY_MESSAGES = {
  no_challenge: 'Request a verification code first',
  expired: 'Code expired — request a new one',
  locked: 'Too many wrong attempts — request a new code',
  mismatch: (remaining) => `Wrong code — ${remaining} attempt(s) left`,
};

/**
 * POST /api/me/phone/verify — confirm the one-time code, then the
 * account's phone number is set and locked (phone_verified=true).
 */
authRouter.post(
  '/me/phone/verify',
  requireAuth,
  rateLimit({ windowMs: 10 * MIN, max: 10, keyFn: (req) => `otp-verify:${req.user.id}` }),
  asyncHandler(async (req, res) => {
    if (req.user.phone_verified) {
      throw new ApiError(409, 'Phone number already verified');
    }
    const phone = toE164(req.body?.phone);
    const { otp } = req.body || {};
    if (!phone) throw new ApiError(400, 'Enter your phone number');
    if (typeof otp !== 'string' || !OTP_RE.test(otp)) throw new ApiError(400, 'Code must be 6 digits');
    const provider = detectProvider(phone);
    if (!provider) throw new ApiError(400, 'That number is not a supported MoMo number');

    const result = await checkOtpAttempt(phone, otp);
    if (!result.ok) {
      const message =
        typeof VERIFY_MESSAGES[result.reason] === 'function'
          ? VERIFY_MESSAGES[result.reason](result.remaining)
          : VERIFY_MESSAGES[result.reason];
      throw new ApiError(400, message);
    }

    await completePhoneVerification(req.user.id, phone, provider);
    res.json({
      success: true,
      data: { phone, momo_provider: provider, phone_verified: true },
      message: 'Phone verified — you can now join tournaments',
    });
  }),
);

/**
 * GET /api/me/transactions?limit=&offset=  (Module 2F Wallet)
 *
 * Read-only money history — there is NO wallet balance (agent.md §3: money
 * flows MoMo → Paystack → MoMo; `transactions` is the ledger). Returns the
 * user's rows newest-first plus lifetime totals of successful rows.
 * `platform_fee` rows are admin-side bookkeeping and are excluded.
 */
authRouter.get(
  '/me/transactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows: transactions } = await pool.query(
      `SELECT tx.id, tx.type, tx.amount_pesewas, tx.status, tx.direction, tx.description,
              tx.tournament_id, t.title AS tournament_title, t.game AS tournament_game,
              tx.paystack_reference, tx.attempts, tx.next_retry_at, tx.created_at, tx.updated_at
       FROM public.transactions tx
       LEFT JOIN public.tournaments t ON t.id = tx.tournament_id
       WHERE tx.user_id = $1 AND tx.type <> 'platform_fee'
       ORDER BY tx.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset],
    );

    const { rows: [totals] } = await pool.query(
      `SELECT
         coalesce(sum(amount_pesewas) FILTER (WHERE type = 'entry_fee' AND status = 'success'), 0)::int AS fees_paid_pesewas,
         coalesce(sum(amount_pesewas) FILTER (WHERE type = 'payout'    AND status = 'success'), 0)::int AS winnings_pesewas,
         coalesce(sum(amount_pesewas) FILTER (WHERE type = 'refund'    AND status = 'success'), 0)::int AS refunds_pesewas,
         coalesce(sum(amount_pesewas) FILTER (WHERE type IN ('payout','refund') AND status = 'pending'), 0)::int AS pending_out_pesewas,
         count(*) FILTER (WHERE type = 'payout' AND status = 'success')::int AS payouts_count
       FROM public.transactions
       WHERE user_id = $1`,
      [req.user.id],
    );

    res.json({
      success: true,
      data: { transactions, totals, limit, offset },
      message: 'Transaction history',
    });
  }),
);
