import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Screenshot storage — pluggable (agent.md §2: Cloudinary for score
 * screenshots only).
 *
 *   SCREENSHOT_STORAGE=local       dev: write to backend/uploads-dev,
 *                                  served at /uploads-dev/<file>
 *   SCREENSHOT_STORAGE=cloudinary  Module 3D: signed upload to Cloudinary,
 *                                  returns the secure_url
 *
 * Returns a public URL string — the only thing the rest of the system
 * (matches.player*_screenshot_url, admin review) ever stores.
 */
export async function storeScreenshot({ buffer, userId, matchId, publicBase }) {
  const name = `${Date.now()}_${(matchId ?? 'nomatch').slice(0, 8)}_${userId.slice(0, 8)}_${crypto.randomBytes(4).toString('hex')}.jpg`;

  if (env.screenshotStorage === 'cloudinary') {
    return uploadToCloudinary(buffer, name);
  }

  const dir = path.resolve(process.cwd(), 'uploads-dev');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buffer);
  return `${publicBase}/uploads-dev/${name}`;
}

/** Signed Cloudinary upload (no SDK — one HTTPS multipart call). Wired in 3D. */
async function uploadToCloudinary(buffer, name) {
  const { cloudinaryCloudName: cloud, cloudinaryApiKey: key, cloudinaryApiSecret: secret } = env;
  if (!cloud || !key || !secret) throw new Error('Cloudinary credentials missing (CLOUDINARY_*)');
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'clashgh/screenshots';
  const publicId = name.replace(/\.jpg$/, '');
  const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + secret).digest('hex');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'image/jpeg' }), name);
  form.append('api_key', key);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) {
    throw new Error(`Cloudinary upload failed: ${json?.error?.message ?? res.status}`);
  }
  return json.secure_url;
}
