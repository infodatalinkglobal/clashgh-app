import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { toE164, detectProvider } from '../utils/phone.js';
import { USERNAME_RE } from '../utils/validate.js';
import { paystack } from '../services/paystack.js';
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
 * Onboarding step 2 — the MoMo number (Module 3E, replaces SMS OTP).
 *
 * Decision (2026-09-15): no OTP. The ONE number that pays and receives
 * is entered once, confirmed by the player, and then locked. Proof of
 * ownership is money movement: in live mode Paystack resolves the
 * registered account name so the player sees "MTN · KOFI MENSAH" before
 * confirming, and the first entry-fee charge is approved on that very
 * phone. A wrong number cannot pay, so it cannot play.
 *
 * POST /api/me/momo/resolve  { phone }            → { phone, momo_provider, account_name }
 * PUT  /api/me/momo          { phone }            → locks it (phone_verified=true)
 */
authRouter.post(
  '/me/momo/resolve',
  requireAuth,
  rateLimit({ windowMs: 10 * MIN, max: 10, keyFn: (req) => `momo-resolve:${req.user.id}` }),
  asyncHandler(async (req, res) => {
    const { phone, provider } = parseMomo(req.body?.phone);
    let accountName = null;
    if (env.paystackMode === 'live') {
      try {
        ({ account_name: accountName } = await paystack.resolveMomoAccount({ phone, provider }));
      } catch (err) {
        console.warn('[momo] name resolution unavailable:', err.message);
      }
    }
    res.json({
      success: true,
      data: { phone, momo_provider: provider, account_name: accountName },
      message: accountName ? `Registered to ${accountName}` : 'Number looks valid — confirm it is yours',
    });
  }),
);

authRouter.put('/me/momo', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.phone_verified) {
    throw new ApiError(409, 'Your MoMo number is already set — contact support to change it');
  }
  const { phone, provider } = parseMomo(req.body?.phone);
  const { rows: [taken] } = await pool.query(
    'SELECT 1 FROM public.users WHERE phone = $1 AND id <> $2',
    [phone, req.user.id],
  );
  if (taken) throw new ApiError(409, 'That number is already linked to another ClashGH account');

  await pool.query(
    `UPDATE public.users SET phone = $2, momo_provider = $3, phone_verified = true
     WHERE id = $1 AND phone_verified = false`,
    [req.user.id, phone, provider],
  );
  res.json({
    success: true,
    data: { phone, momo_provider: provider, phone_verified: true },
    message: 'MoMo number saved — you can now join tournaments',
  });
}));

function parseMomo(raw) {
  const phone = toE164(raw);
  if (!phone) throw new ApiError(400, 'Enter a valid Ghana number (0XXXXXXXXX or +233XXXXXXXXX)');
  const provider = detectProvider(phone);
  if (!provider) throw new ApiError(400, 'That number is not a supported MoMo number (MTN, Telecel, AirtelTigo)');
  return { phone, provider };
}

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
