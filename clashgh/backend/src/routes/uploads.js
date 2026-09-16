import { Router } from 'express';
import { perUser } from '../middleware/rateLimit.js';
const MIN = 60 * 1000;
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { storeScreenshot } from '../services/screenshots.js';

/**
 * Screenshot upload (used by Module 2E, storage provider = Module 3D).
 *
 * POST /api/uploads/screenshot        (auth)
 *   body: { image_base64: string, match_id?: string }   JPEG, ≤ MAX bytes
 *   → { url, bytes }
 *
 * The client compresses to ≤ 500KB before upload (agent.md §4 low data).
 * The URL returned is what the player then sends to POST /matches/:id/result.
 * Storage is pluggable (services/screenshots.js): `local` in dev writes to
 * backend/uploads-dev and serves it from /uploads-dev; `cloudinary` lands
 * in 3D with zero client change.
 */
export const uploadsRouter = Router();

const MAX_BYTES = 600 * 1024; // client target is 500KB; small headroom

uploadsRouter.post(
  '/uploads/screenshot',
  requireAuth,
  perUser({ windowMs: 10 * MIN, max: 15, name: 'upload' }),
  express.json({ limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const b64 = typeof req.body?.image_base64 === 'string' ? req.body.image_base64 : '';
    if (!b64) throw new ApiError(400, 'image_base64 is required');
    const buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    if (buf.length < 1024) throw new ApiError(400, 'Image is empty or unreadable');
    if (buf.length > MAX_BYTES) {
      throw new ApiError(413, `Screenshot too large (${Math.round(buf.length / 1024)}KB) — max ${MAX_BYTES / 1024}KB`);
    }
    // JPEG magic bytes (FF D8 FF). The app always saves JPEG.
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) {
      throw new ApiError(400, 'Screenshot must be a JPEG image');
    }
    let url;
    try {
      url = await storeScreenshot({
        buffer: buf,
        userId: req.user.id,
        matchId: typeof req.body?.match_id === 'string' ? req.body.match_id : null,
        publicBase: `${req.protocol}://${req.get('host')}`,
      });
    } catch (err) {
      // Storage provider trouble is ours, not the player's: log the real
      // cause, tell them to retry (the pick + screenshot stay on-device).
      console.error('[uploads] storage failed:', err.message);
      throw new ApiError(502, 'Could not store the screenshot right now — please try again in a moment');
    }
    res.status(201).json({ success: true, data: { url, bytes: buf.length }, message: 'Screenshot uploaded' });
  }),
);

/** Dev-only static serving of locally stored screenshots. */
export function mountLocalScreenshotStatic(app) {
  if (env.screenshotStorage !== 'local') return;
  const dir = path.resolve(process.cwd(), 'uploads-dev');
  fs.mkdirSync(dir, { recursive: true });
  app.use('/uploads-dev', express.static(dir, { maxAge: '1d', immutable: true }));
}

