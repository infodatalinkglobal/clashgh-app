import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';

/**
 * Module 3E — device push tokens + the player's own notification feed.
 *
 * PUT    /api/me/push-token   { token, platform }  — register/move this device
 * DELETE /api/me/push-token   { token }            — on sign-out
 * GET    /api/me/notifications?limit=              — recent (push channel) as an in-app inbox
 */
export const notificationsRouter = Router();

const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

notificationsRouter.put('/me/push-token', requireAuth, asyncHandler(async (req, res) => {
  const { token, platform = 'android' } = req.body || {};
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new ApiError(400, 'token must be an Expo push token');
  if (!['android', 'ios', 'web'].includes(platform)) throw new ApiError(400, 'platform must be android, ios or web');
  await pool.query(
    `INSERT INTO public.push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform`,
    [token, req.user.id, platform],
  );
  res.json({ success: true, data: { token }, message: 'Push token registered' });
}));

notificationsRouter.delete('/me/push-token', requireAuth, asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== 'string') throw new ApiError(400, 'token is required');
  await pool.query('DELETE FROM public.push_tokens WHERE token = $1 AND user_id = $2', [token, req.user.id]);
  res.json({ success: true, data: null, message: 'Push token removed' });
}));

notificationsRouter.get('/me/notifications', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const { rows } = await pool.query(
    `SELECT id, template, payload, status, created_at
     FROM public.notifications
     WHERE user_id = $1 AND channel = 'push'
     ORDER BY created_at DESC LIMIT $2`,
    [req.user.id, limit],
  );
  res.json({ success: true, data: { notifications: rows }, message: 'Notifications loaded' });
}));
