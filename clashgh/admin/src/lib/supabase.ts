/**
 * Minimal Supabase Auth client for the admin panel (no SDK: one redirect and
 * one hash parse). Uses the implicit flow so the access token comes back in
 * the URL fragment, which never reaches the server or logs.
 *
 * Build env: VITE_AUTH_MODE=supabase, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
 * The admin origin must be listed under Supabase Auth > URL Configuration > Redirect URLs.
 */
const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const supabaseConfigured = Boolean(URL_ && ANON);

export function signInWithGoogle() {
  if (!supabaseConfigured) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set in this build');
  const redirectTo = `${location.origin}${location.pathname}`;
  const q = new URLSearchParams({ provider: 'google', redirect_to: redirectTo });
  location.assign(`${URL_}/auth/v1/authorize?${q.toString()}`);
}

/** Consume `#access_token=...` left by the OAuth redirect. Returns the token or null. */
export function takeTokenFromUrl(): string | null {
  const h = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!h.includes('access_token=')) return null;
  const p = new URLSearchParams(h);
  const t = p.get('access_token');
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return t;
}

/** Error left in the URL by a failed OAuth round trip (e.g. user not allowed). */
export function takeErrorFromUrl(): string | null {
  const h = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const q = location.search.startsWith('?') ? location.search.slice(1) : '';
  for (const s of [h, q]) {
    const p = new URLSearchParams(s);
    const d = p.get('error_description') || p.get('error');
    if (d) {
      history.replaceState(null, '', location.pathname);
      return d.replace(/\+/g, ' ');
    }
  }
  return null;
}
