/**
 * App configuration.
 *
 * EXPO_PUBLIC_* variables are inlined at bundle time: provide them in
 * mobile/.env (see .env.example) or the build environment.
 *
 * The API base URL: on a physical Android device `10.0.2.2` reaches the
 * host machine's localhost (adb reverse alternative). On an emulator the
 * host machine is `10.0.2.2` directly; on LAN, use the host's IP.
 */
export type AuthMode = 'stub' | 'supabase';

export const Config = {
  apiUrl:
    process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/api',

  /**
   * 'stub'  → dev mode: the backend's /api/dev/auth endpoints issue the
   *           token; the Google button simulates sign-in with an identity
   *           picker (no real Google credentials needed).
   * 'supabase' → production path: Google OAuth + magic links via Supabase
   *           Auth; the issued JWT is what the backend verifies.
   */
  authMode: (process.env.EXPO_PUBLIC_AUTH_MODE ?? 'stub') as AuthMode,

  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',

  /** Supabase-hosted Google OAuth client (Web ID): used for the OAuth flow. */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',

  /**
   * 'stub' → the backend runs PAYSTACK_MODE=stub: the Join screen shows a
   *          dev "simulate webhook" panel instead of a MoMo prompt.
   * 'live' → real Paystack MoMo charge (authorization_url + phone prompt).
   */
  paystackMode: (process.env.EXPO_PUBLIC_PAYSTACK_MODE ?? 'stub') as 'stub' | 'live',

  /** Deep link scheme the app registers (matches app.json). */
  deeplinkScheme: 'clashgh',

  /** Polling cadence for match screens (agent.md §14: 30 to 60s, be modest). */
  matchPollMs: 30_000,
};
