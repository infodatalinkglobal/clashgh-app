import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { MomoProvider, Profile } from '../services/api';
import { registerForPush, unregisterPush } from '../services/push';
import { authService, setOnUnauthorized } from '../services/auth';

/**
 * Session store — the single source of truth for auth state across the
 * app (agent.md §10: src/store). Kept as a lightweight React context:
 * the session is a small, rarely-changing object, so no state library.
 */
interface AuthContextValue {
  profile: Profile | null;
  initializing: boolean;
  busy: boolean;
  error: string | null;
  /** true once we know the session state (even if signed out) */
  isOnboarding: boolean;
  signInWithDevIdentity: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  handleAuthUrl: (url: string) => Promise<void>;
  setProfileUsername: (username: string) => Promise<void>;
  resolveMomo: (phone: string) => Promise<{ account_name: string | null; momo_provider: MomoProvider }>;
  saveMomo: (phone: string) => Promise<void>;
  signOut: () => Promise<void>;
  dismissError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bootstrap: validate any stored token on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await authService.bootstrap();
        if (!cancelled) setProfile(p);
      } catch {
        // offline at launch — stay signed out of the UI; token persists
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setOnUnauthorized(async () => {
      setProfile(null);
      setError('Your session expired — sign in again');
    });
    return () => setOnUnauthorized(null);
  }, []);

  // 3E: once signed in + onboarded, register this device for push.
  useEffect(() => {
    if (profile?.phone_verified) void registerForPush();
  }, [profile?.id, profile?.phone_verified]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      initializing,
      busy,
      error,
      isOnboarding: profile !== null && !profile.phone_verified,
      signInWithDevIdentity: async (email) => {
        await run(async () => {
          const p = await authService.signInWithDevIdentity(email);
          setProfile(p);
        });
      },
      signInWithGoogle: () => run(async () => {
        await authService.signInWithGoogle();
      }),
      signInWithEmail: (email) => run(async () => {
        await authService.signInWithEmail(email);
        setError(null);
      }),
      handleAuthUrl: (url) =>
        run(async () => {
          const p = await authService.handleAuthUrl(url);
          setProfile(p);
        }),
      setProfileUsername: async (username) => {
        await authService.setProfileUsername(username);
        const p = await authService.refreshProfile();
        setProfile(p);
      },
      resolveMomo: (phone) => run(() => authService.resolveMomo(phone)),
      saveMomo: async (phone) => {
        await run(async () => {
          await authService.saveMomo(phone);
          const p = await authService.refreshProfile();
          setProfile(p);
        });
      },
      signOut: () =>
        run(async () => {
          await unregisterPush();
          await authService.signOut();
          setProfile(null);
        }),
      dismissError: () => setError(null),
    }),
    [profile, initializing, busy, error, run],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
