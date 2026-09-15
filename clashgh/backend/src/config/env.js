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
  // Notifications (3E): email + Expo push, both 'mock' in dev.
  mailProvider: process.env.MAIL_PROVIDER || 'mock',
  mailFrom: process.env.MAIL_FROM || 'ClashGH <no-reply@clashgh.app>',
  resendApiKey: process.env.RESEND_API_KEY || null,
  pushProvider: process.env.PUSH_PROVIDER || 'mock',
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || null,
  adminAlertEmail: process.env.ADMIN_ALERT_EMAIL || null,
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
  // Screenshot storage: 'local' (dev, backend/uploads-dev) or 'cloudinary' (3D)
  screenshotStorage: process.env.SCREENSHOT_STORAGE || 'local',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || null,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || null,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || null,
  cloudinaryApiUrl: (process.env.CLOUDINARY_API_URL || 'https://api.cloudinary.com').replace(/\/+$/, ''),
  screenshotRetentionDays: Number(process.env.SCREENSHOT_RETENTION_DAYS) || 90,
  // Browser origins allowed in production (comma-separated; admin panel URL).
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

if (env.mailProvider === 'resend' && !env.resendApiKey) {
  throw new Error('MAIL_PROVIDER=resend requires RESEND_API_KEY');
}
if (!['local', 'cloudinary'].includes(env.screenshotStorage)) {
  throw new Error(`SCREENSHOT_STORAGE must be 'local' or 'cloudinary' (got '${env.screenshotStorage}')`);
}
if (env.screenshotStorage === 'cloudinary') {
  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((k) => !process.env[k]);
  if (missing.length > 0) throw new Error(`SCREENSHOT_STORAGE=cloudinary requires: ${missing.join(', ')}`);
}
if (!['stub', 'live'].includes(env.paystackMode)) {
  throw new Error(`PAYSTACK_MODE must be 'stub' or 'live' (got '${env.paystackMode}')`);
}
if (env.paystackMode === 'live') {
  const missing = ['PAYSTACK_SECRET_KEY', 'PAYSTACK_WEBHOOK_SECRET'].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`PAYSTACK_MODE=live requires: ${missing.join(', ')}`);
  }
}
