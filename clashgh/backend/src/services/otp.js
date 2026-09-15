import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

/**
 * One-time phone verification (onboarding only).
 *
 * Rules (agent.md §3): one phone per account, verified once, no
 * repeated OTPs. OTPs are 6 digits, valid for env.otpTtlMinutes,
 * max env.otpMaxAttempts wrong tries, stored ONLY as a scrypt hash
 * with a per-row salt — the plaintext OTP never touches the DB.
 */

export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashOtp(otp) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(otp, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function otpMatches(otp, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(otp, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Create (or rotate) the OTP challenge for a phone.
 * Returns the plaintext OTP so the caller can send it via SMS.
 */
export async function createOtpChallenge(phone) {
  const otp = generateOtp();
  await pool.query(
    `INSERT INTO public.phone_verifications (phone, otp_hash, expires_at, attempts)
     VALUES ($1, $2, now() + make_interval(mins => $3), 0)
     ON CONFLICT (phone) DO UPDATE
       SET otp_hash = EXCLUDED.otp_hash,
           expires_at = EXCLUDED.expires_at,
           attempts = 0`,
    [phone, hashOtp(otp), env.otpTtlMinutes],
  );
  return otp;
}

/**
 * Check one verification attempt.
 * Returns { ok: true } or { ok: false, reason, remaining? }
 * with reason in: no_challenge | expired | locked | mismatch.
 */
export async function checkOtpAttempt(phone, otp) {
  const { rows } = await pool.query(
    'SELECT otp_hash, expires_at, attempts FROM public.phone_verifications WHERE phone = $1',
    [phone],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'no_challenge' };
  if (row.attempts >= env.otpMaxAttempts) return { ok: false, reason: 'locked' };
  if (row.expires_at.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  if (!otpMatches(otp, row.otp_hash)) {
    const remaining = env.otpMaxAttempts - row.attempts - 1;
    await pool.query('UPDATE public.phone_verifications SET attempts = attempts + 1 WHERE phone = $1', [phone]);
    return { ok: false, reason: 'mismatch', remaining };
  }
  return { ok: true };
}

/**
 * Mark the user's phone as verified (one-time) and clear the
 * challenge — single transaction.
 */
export async function completePhoneVerification(userId, phone, provider) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE public.users
       SET phone = $2, momo_provider = $3, phone_verified = true
       WHERE id = $1 AND phone_verified = false`,
      [userId, phone, provider],
    );
    if (rowCount !== 1) {
      // Someone verified this account concurrently — treat as already done.
      await client.query('COMMIT');
      return;
    }
    await client.query('DELETE FROM public.phone_verifications WHERE phone = $1', [phone]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
