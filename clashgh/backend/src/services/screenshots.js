import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Screenshot storage — pluggable (agent.md §2: Cloudinary for score
 * screenshots only). Module 3D.
 *
 *   SCREENSHOT_STORAGE=local       dev: write to backend/uploads-dev,
 *                                  served at /uploads-dev/<file>
 *   SCREENSHOT_STORAGE=cloudinary  signed server-side upload (the API
 *                                  secret never reaches the app), returns
 *                                  the https secure_url
 *
 * Only the URL is stored (matches.player*_screenshot_url). Cloudinary
 * public_ids are deterministic (`clashgh/screenshots/<match>/<user>_<ts>`)
 * and tagged `clashgh_screenshot` + `match_<id>` so retention cleanup
 * (`purgeScreenshotsOlderThan`) can delete by tag without a DB join.
 *
 * No SDK: Cloudinary's REST API is one multipart POST with a SHA-1
 * signature over the sorted params + api_secret.
 * https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
 */

const FOLDER = 'clashgh/screenshots';
const TAG = 'clashgh_screenshot';

export async function storeScreenshot({ buffer, userId, matchId, publicBase }) {
  const stamp = Date.now();
  const match = (matchId ?? 'nomatch').slice(0, 8);
  const user = userId.slice(0, 8);

  if (env.screenshotStorage === 'cloudinary') {
    const publicId = `${match}/${user}_${stamp}_${crypto.randomBytes(3).toString('hex')}`;
    const r = await cloudinaryUpload(buffer, { publicId, tags: [TAG, `match_${match}`] });
    return r.secure_url;
  }

  const name = `${stamp}_${match}_${user}_${crypto.randomBytes(4).toString('hex')}.jpg`;
  const dir = path.resolve(process.cwd(), 'uploads-dev');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buffer);
  return `${publicBase}/uploads-dev/${name}`;
}

// ---------------------------------------------------------------------------
// Cloudinary REST (no SDK)
// ---------------------------------------------------------------------------

function creds() {
  const { cloudinaryCloudName: cloud, cloudinaryApiKey: key, cloudinaryApiSecret: secret } = env;
  if (!cloud || !key || !secret) throw new Error('Cloudinary credentials missing (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET)');
  return { cloud, key, secret };
}

/** Cloudinary signature: sha1 of "k=v&k=v" over sorted params (excluding file/api_key/resource_type) + secret. */
export function signParams(params, secret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(',') : params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}

async function cloudinaryUpload(buffer, { publicId, tags }) {
  const { cloud, key, secret } = creds();
  const params = {
    timestamp: Math.floor(Date.now() / 1000),
    folder: FOLDER,
    public_id: publicId,
    tags: tags.join(','),
    overwrite: 'false',          // a second upload can never replace evidence
    invalidate: 'false',
    // Hard cap on the server side regardless of what the client sent
    // (app already resizes ≤1280px / ≤500KB): keeps CDN bandwidth low for 3G.
    transformation: 'c_limit,w_1280,h_1280,q_auto:eco',
  };
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'screenshot.jpg');
  form.append('api_key', key);
  form.append('signature', signParams(params, secret));
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));

  const res = await fetch(`${env.cloudinaryApiUrl}/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) {
    throw new Error(`Cloudinary upload failed: ${json?.error?.message ?? `HTTP ${res.status}`}`);
  }
  return { secure_url: json.secure_url, public_id: json.public_id, bytes: json.bytes };
}

/** Admin API ping — used at startup so a bad key fails fast, not at the first upload. */
export async function cloudinaryHealth() {
  const { cloud, key, secret } = creds();
  const res = await fetch(`${env.cloudinaryApiUrl}/v1_1/${cloud}/ping`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`Cloudinary ping failed: HTTP ${res.status} (check CLOUDINARY_* values)`);
  return true;
}

/**
 * Retention: delete screenshots older than `days` (default 90) by tag via
 * the Admin API. Screenshots are dispute evidence; after the tournament is
 * long settled they are just storage cost. Returns count deleted.
 * Cloudinary's delete-by-tag has no date filter, so we list first.
 */
export async function purgeScreenshotsOlderThan(days = env.screenshotRetentionDays) {
  const { cloud, key, secret } = creds();
  const auth = { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` };
  const cutoff = Date.now() - days * 86_400_000;
  let deleted = 0;
  let cursor = null;
  do {
    const qs = new URLSearchParams({ max_results: '500' });
    if (cursor) qs.set('next_cursor', cursor);
    const res = await fetch(`${env.cloudinaryApiUrl}/v1_1/${cloud}/resources/image/tags/${TAG}?${qs}`, { headers: auth });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Cloudinary list failed: ${json?.error?.message ?? res.status}`);
    const old = (json.resources ?? []).filter((r) => new Date(r.created_at).getTime() < cutoff).map((r) => r.public_id);
    for (let i = 0; i < old.length; i += 100) {
      const body = new URLSearchParams();
      for (const id of old.slice(i, i + 100)) body.append('public_ids[]', id);
      const del = await fetch(`${env.cloudinaryApiUrl}/v1_1/${cloud}/resources/image/upload`, { method: 'DELETE', headers: auth, body });
      if (!del.ok) throw new Error(`Cloudinary delete failed: HTTP ${del.status}`);
      deleted += old.slice(i, i + 100).length;
    }
    cursor = json.next_cursor ?? null;
  } while (cursor);
  return deleted;
}
