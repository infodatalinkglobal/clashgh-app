import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { executePayout } from '../services/payment.js';
import { resolveDispute } from '../services/matches.js';
import { UUID_RE } from '../utils/validate.js';

/**
 * Admin-guarded endpoints (placeholder for 1C/3C admin routes —
 * proves requireAuth + requireAdmin wiring in 1B).
 */
export const adminRouter = Router();

adminRouter.get('/admin/ping', requireAuth, requireAdmin, (req, res) => {
  res.json({
    success: true,
    data: { message: 'pong', admin: req.user.username ?? req.user.email },
    message: 'Admin endpoint reachable',
  });
});

/**
 * POST /api/admin/tournaments/:id/payout — run (or force-retry) the
 * champion + runner-up payouts for a finished bracket. This is the
 * 3C one-click re-payout: ?force=true retries FAILED payout rows.
 * The 1F sweeper also calls executePayout when the final completes.
 */
/**
 * POST /api/admin/matches/:id/resolve — resolve a disputed match (1F):
 *   body { resolution: 'award', winner_id }  → that player wins
 *         { resolution: 'replay' }           → same players, new room code
 *         { resolution: 'refund' }           → tournament cancelled + all paid refunded
 */
adminRouter.post(
  '/admin/matches/:id/resolve',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid match id');
    const result = await resolveDispute({
      matchId: id,
      adminId: req.user.id,
      resolution: req.body?.resolution,
      winnerId: req.body?.winner_id ?? null,
    });
    res.json({
      success: true,
      data: result,
      message:
        result.resolution === 'award'
          ? 'Match awarded — bracket advances'
          : result.resolution === 'replay'
            ? 'Replay scheduled — new room code issued'
            : 'Tournament cancelled — all paid players refunded',
    });
  }),
);

adminRouter.post(
  '/admin/tournaments/:id/payout',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'Invalid tournament id');
    const result = await executePayout(id, { force: req.query.force === 'true' });
    res.json({
      success: true,
      data: result,
      message:
        result.payout === 'already_initiated'
          ? 'Payouts already initiated for this tournament'
          : 'Payouts initiated via MoMo transfer',
    });
  }),
);
