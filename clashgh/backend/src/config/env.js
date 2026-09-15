import dotenv from 'dotenv';

dotenv.config();

/**
 * Central env access. Fail fast on missing required vars.
 *
 * AUTH_PROVIDER:
 *   'stub'     — local dev issuer that mimics Supabase Auth's token format
 *                (HS256, aud=authenticated, iss=<base>/auth/v1). Swappable
 *                with real Supabase by setting AUTH_PROVIDER=supabase +
 *                SUPABASE_URL/SUPABASE_JWT_SECRET: zero route changes.
 *   'supabase' — tokens issued by Supabase Auth (Google OAuth / magic link);
 *                the mobile app sends the JWT in the Authorization header.
 */

const required = ['DATABASE_URL', 'PORT'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

const authProvider = process.env.AUTH_PROVIDER || 'stub';
if (authProvider !== 'stub' && authProvider !== 'supabase') {
  throw new Error(`AUTH_PROVIDER must be 'stub' or 'supabase' (got '${authProvider}')`);
}

let jwtSecret;
let jwtIssuer;
if (authProvider === 'supabase') {
  const missingSupabase = ['SUPABASE_URL', 'SUPABASE_JWT_SECRET'].filter((key) => !process.env[key]);
  if (missingSupabase.length > 0) {
    throw new Error(`AUTH_PROVIDER=supabase requires: ${missingSupabase.join(', ')}`);
  }
  jwtSecret = process.env.SUPABASE_JWT_SECRET;
  jwtIssuer = `${process.env.SUPABASE_URL}/auth/v1`;
} else {
  if (!process.env.STUB_JWT_SECRET) {
    throw new Error('AUTH_PROVIDER=stub requires STUB_JWT_SECRET (set it in .env)');
  }
  jwtSecret = process.env.STUB_JWT_SECRET;
  const port = Number(process.env.PORT) || 3000;
  jwtIssuer = `http://localhost:${port}/auth/v1`;
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  authProvider,
  jwtSecret,
  jwtIssuer,
  smsProvider: process.env.SMS_PROVIDER || 'mock',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES) || 10,
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  // Payments (1C stub / 1E live)
  paystackMode: process.env.PAYSTACK_MODE || 'stub',
  paystackApiUrl: process.env.PAYSTACK_API_URL || 'https://api.paystack.co',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || null,
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || null,
  paystackWebhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || null,
  // Business defaults (agent.md §3, §11)
  minEntryFeePesewas: Number(process.env.MIN_ENTRY_FEE_PESOWAS) || 1000,
  minPrizePesewas: Number(process.env.MIN_PRIZE_PESOWAS) || 1000,
  registrationPendingTtlMinutes: Number(process.env.REGISTRATION_PENDING_TTL_MINUTES) || 10,
};

if (!['stub', 'live'].includes(env.paystackMode)) {
  throw new Error(`PAYSTACK_MODE must be 'stub' or 'live' (got '${env.paystackMode}')`);
}
if (env.paystackMode === 'live') {
  const missing = ['PAYSTACK_SECRET_KEY', 'PAYSTACK_WEBHOOK_SECRET'].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`PAYSTACK_MODE=live requires: ${missing.join(', ')}`);
  }
}
