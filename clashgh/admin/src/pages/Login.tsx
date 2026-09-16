import { useState } from 'react';
import { api, token, type Profile } from '../lib/api';

const MODE = (import.meta.env.VITE_AUTH_MODE as string | undefined) ?? 'stub';

/**
 * Admin sign-in. Same identity system as the app (Supabase Auth in prod;
 * dev-identity stub locally). The role check happens server-side: any
 * non-admin account is rejected here and by every /admin route.
 */
export function Login({ onSignedIn }: { onSignedIn: (p: Profile) => void }) {
  const [email, setEmail] = useState('admin@clashgh.dev');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (MODE !== 'stub') throw new Error('Supabase admin sign-in is configured in production builds (VITE_AUTH_MODE=supabase). Use the Supabase magic-link flow.');
      const r = await api.devSignIn(email.trim());
      const t = r.access_token ?? r.token;
      if (!t) throw new Error('No token returned');
      token.set(t);
      const { profile } = await api.me();
      if (profile.role !== 'admin') {
        token.clear();
        throw new Error(`${profile.email} is not an admin`);
      }
      onSignedIn(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ fontSize: 18 }}>CLASH<b>GH</b> <span className="faint">admin</span></div>
        <p className="muted" style={{ marginTop: 0 }}>Admins only. Every action here is written to the audit log.</p>
        <div className="f">
          <label>{MODE === 'stub' ? 'Dev identity (email)' : 'Email'}</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        {error ? <div className="err">{error}</div> : null}
        <button className="btn p" disabled={busy} style={{ width: '100%' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {MODE === 'stub' ? <p className="faint" style={{ marginBottom: 0 }}>Dev mode: the backend's AUTH_PROVIDER=stub issues the token. Seeded admin: admin@clashgh.dev</p> : null}
      </form>
    </div>
  );
}
