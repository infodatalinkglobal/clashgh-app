import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Config } from '../config';
import { api, ApiError, endpoints, type Profile } from './api';

/**
 * Authentication (Module 2A).
 *
 * Two modes, selected by EXPO_PUBLIC_AUTH_MODE:
 *
 *  - 'stub' (dev): tokens come from the backend's /api/dev/auth/signin —
 *    the same JWT-stub format the 1B auth middleware verifies. The
 *    "Google" button presents an identity picker so the flow is fully
 *    testable with no Google credentials.
 *
 *  - 'supabase' (production): Google OAuth + email magic links through
 *    Supabase Auth; the issued JWT is what the backend verifies (1B was
 *    built so this swap needs zero backend route changes).
 *
 * After either path, the app owns: token storage, profile bootstrap,
 * one-time onboarding (username + MoMo phone + OTP) and sign-out.
 */

const TOKEN_KEY = 'clashgh.auth.token';

export interface AuthState {
  token: string | null;
  profile: Profile | null;
  /** true while the stored token is being validated at launch */
  initializing: boolean;
  busy: boolean;
  error: string | null;
}

let supabaseClient: SupabaseClient | null = null;

async function getSupabase(): Promise<SupabaseClient> {
  if (!supabaseClient) {
    // Lazy dynamic import keeps the stub build lean.
    const { createClient } = await import('@supabase/supabase-js');
    supabaseClient = createClient(Config.supabaseUrl, Config.supabaseAnonKey);
  }
  return supabaseClient;
}

class AuthService {
  // -- token storage -------------------------------------------------------

  async loadToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private async saveToken(token: string) {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(TOKEN_KEY, token);
      return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }

  private async clearToken() {
    try {
      if (Platform.OS === 'web') {
        globalThis.localStorage?.removeItem(TOKEN_KEY);
        return;
      }
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // already gone
    }
  }

  // -- bootstrap -----------------------------------------------------------

  /** Validate the stored token (if any) and return the live profile. */
  async bootstrap(): Promise<Profile | null> {
    const token = await this.loadToken();
    if (!token) return null;
    api.setTokenProvider(async () => {
      if (Config.authMode === 'supabase') {
        const sb = await getSupabase();
        const { data } = await sb.auth.getSession();
        return data.session?.access_token ?? null;
      }
      return this.loadToken();
    });
    api.setOnUnauthorized(async () => {
      await this.clearToken();
      onUnauthorized?.();
    });

    try {
      const { profile } = await endpoints.me();
      return profile;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await this.clearToken();
        return null;
      }
      // network / 5xx: keep the token, the caller can retry later
      throw err;
    }
  }

  // -- sign-in -------------------------------------------------------------

  /**
   * Dev/stub: "Google sign-in" simulated with a chosen identity.
   * The backend bootstraps the profile row (mimics the Supabase trigger)
   * and issues a token in the same format production tokens have.
   */
  async signInWithDevIdentity(email: string): Promise<Profile> {
    const data = await api.request<{ token: string; user: { id: string; email: string; role: string } }>(
      '/dev/auth/signin',
      { method: 'POST', body: { email } },
    );
    await this.saveToken(data.token);
    await this.bootstrap();
    const { profile } = await endpoints.me();
    return profile;
  }

  /** Production: Google OAuth via Supabase (opens the external browser). */
  async signInWithGoogle(): Promise<Profile> {
    if (Config.authMode !== 'supabase') {
      throw new ApiError(0, 'Google sign-in is available when the app is configured for Supabase Auth');
    }
    const sb = await getSupabase();
    const redirectTo = `${Config.deeplinkScheme}://auth/callback`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw new ApiError(0, String(error));
    // The app returns here via the deep link → handleAuthUrl(url)
    throw new AuthPendingRedirect();
  }

  /** Production: email magic link (fallback for no-GMS / Google outages). */
  async signInWithEmail(email: string): Promise<void> {
    if (Config.authMode !== 'supabase') {
      throw new ApiError(0, 'Magic links are available when the app is configured for Supabase Auth');
    }
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithOtp({ email });
    if (error) throw new ApiError(0, String(error));
  }

  /**
   * Called when the app is opened from an auth deep link
   * (clashgh://auth/callback?code=…). Exchanges the code for a session.
   */
  async handleAuthUrl(url: string): Promise<Profile> {
    const sb = await getSupabase();
    const urlObj = new URL(url);
    const code =
      urlObj.searchParams.get('code') ??
      urlObj.hash.replace(/^#/, '').split('&').find((p) => p.startsWith('code='))?.slice(5);
    if (!code) throw new ApiError(0, 'The link did not contain a sign-in code');
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (error || !data.session) throw new ApiError(0, 'Could not complete sign-in — try again');
    await this.saveToken(data.session.access_token);
    const p = await this.bootstrap();
    if (!p) throw new ApiError(0, 'Sign-in result was not accepted');
    return p;
  }

  // -- onboarding (one-time: username + MoMo phone + OTP) -------------------

  async setProfileUsername(username: string): Promise<string> {
    const { username: saved } = await endpoints.updateUsername(username);
    return saved;
  }

  async requestPhoneOtp(phoneE164: string): Promise<void> {
    await endpoints.requestOtp(phoneE164);
  }

  async verifyPhoneOtp(phoneE164: string, otp: string): Promise<void> {
    await endpoints.verifyOtp(phoneE164, otp);
  }

  async refreshProfile(): Promise<Profile> {
    const { profile } = await endpoints.me();
    return profile;
  }

  // -- sign-out --------------------------------------------------------------

  async signOut(): Promise<void> {
    await this.clearToken();
    if (Config.authMode === 'supabase') {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(Config.supabaseUrl, Config.supabaseAnonKey);
        await sb.auth.signOut();
      } catch {
        // local session cleared regardless
      }
    }
  }
}

/** Control-flow marker: the OAuth redirect has left the app. */
export class AuthPendingRedirect extends Error {
  constructor() {
    super('redirect-pending');
    this.name = 'AuthPendingRedirect';
  }
}

let onUnauthorized: (() => Promise<void> | void) | null = null;
export function setOnUnauthorized(fn: (() => Promise<void> | void) | null) {
  onUnauthorized = fn;
}

export const authService = new AuthService();
