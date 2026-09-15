import { Router } from 'express';
import { env } from '../config/env.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { settleChargeSuccess, settleChargeFailure } from '../services/payment.js';

/**
 * DEV-ONLY charge simulator (PAYSTACK_MODE=stub, non-production).
 *
 * Plays the role of a verified Paystack charge webhook: settles a charge
 * reference exactly the way Module 1E's verified webhook will (same
 * ledger functions, same idempotency). The real 1E webhook is a separate
 * endpoint with HMAC-SHA-512 signature verification + webhook_events
 * dedupe — this route has NO signature and is never mounted in
 * production or live Paystack mode.
 */
export function devPayRouter() {
  const router = Router();

  router.post('/dev/paystack/simulate-charge', asyncHandler(async (req, res) => {
    if (env.paystackMode !== 'stub' || env.nodeEnv === 'production') {
      throw new ApiError(404, 'Endpoint not found');
    }
    const { reference } = req.body || {};
    const success = req.body?.success !== false;
    if (typeof reference !== 'string' || !/^CHRG_[A-Za-z0-9_-]+$/.test(reference)) {
      throw new ApiError(400, 'reference (CHRG_...) is required');
    }

    const result = success ? await settleChargeSuccess(reference) : await settleChargeFailure(reference);
    if (!result.settled && success) {
      throw new ApiError(404, result.reason);
    }
    res.json({
      success: result.settled,
      data: result,
      message: success
        ? result.settled
          ? 'Charge settled — entry fee recorded in escrow'
          : 'Charge not settled (see data.reason)'
        : 'Charge failure recorded — registration stays pending',
    });
  }));

  return router;
}
