import { useCallback, useEffect, useState } from 'react';
import { api, setOnUnauthorized, token, type Overview, type Profile } from './lib/api';
import { Login } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { TournamentsPage } from './pages/Tournaments';
import { TournamentPage } from './pages/Tournament';
import { DisputesPage } from './pages/Disputes';
import { SchedulePage } from './pages/Schedule';
import { PlayersPage } from './pages/Players';
import { HostsPage } from './pages/Hosts';
import { AnalyticsPage } from './pages/Analytics';
import { AuditPage } from './pages/Audit';

/**
 * ClashGH admin panel: hash-routed (no router dep), auth-gated on the
 * backend's role check (a player token gets 403 on every /admin route).
 */
export type Route =
  | { page: 'overview' }
  | { page: 'tournaments' }
  | { page: 'tournament'; id: string }
  | { page: 'disputes' }
  | { page: 'schedule' }
  | { page: 'players' }
  | { page: 'hosts' }
  | { page: 'analytics' }
  | { page: 'audit' };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, id] = h.split('/');
  if (page === 'tournaments' && id) return { page: 'tournament', id };
  if (['tournaments', 'disputes', 'schedule', 'players', 'hosts', 'analytics', 'audit'].includes(page)) return { page } as Route;
  return { page: 'overview' };
}

export function go(r: Route) {
  location.hash = r.page === 'tournament' ? `/tournaments/${r.id}` : `/${r.page}`;
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(!!token.get());
  const [route, setRoute] = useState<Route>(parseHash());
  const [counts, setCounts] = useState<Overview['counts'] | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const signOut = useCallback(() => {
    token.clear();
    setProfile(null);
  }, []);
  useEffect(() => setOnUnauthorized(signOut), [signOut]);

  useEffect(() => {
    if (!token.get()) return;
    api
      .me()
      .then(({ profile: p }) => (p.role === 'admin' ? setProfile(p) : signOut()))
      .catch(signOut)
      .finally(() => setChecking(false));
  }, [signOut]);

  // Sidebar badges refresh every 60s.
  useEffect(() => {
    if (!profile) return;
    const tick = () => api.overview().then((o) => setCounts(o.counts)).catch(() => {});
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [profile, route]);

  if (checking) return <div className="center">Loading…</div>;
  if (!profile) return <Login onSignedIn={setProfile} />;

  const nav = (r: Route['page'], label: string, n?: number, tone?: 'gold') => (
    <a className={`nav ${route.page === r || (r === 'tournaments' && route.page === 'tournament') ? 'on' : ''}`} href={`#/${r}`}>
      <span>{label}</span>
      {n ? <span className={`n ${tone ?? ''}`}>{n}</span> : null}
    </a>
  );

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">CLASH<b>GH</b> <span className="faint">admin</span></div>
        {nav('overview', 'Overview', (counts?.disputed_matches ?? 0) + (counts?.failed_transfers ?? 0) + (counts?.lobbies_past_close ?? 0))}
        {nav('tournaments', 'Tournaments', counts?.live_tournaments, 'gold')}
        {nav('disputes', 'Disputes', counts?.disputed_matches)}
        {nav('schedule', 'Schedule')}
        {nav('players', 'Players')}
        {nav('hosts', 'Hosts', counts?.pending_hosts, 'gold')}
        {nav('analytics', 'Analytics')}
        {nav('audit', 'Audit log')}
        <div className="spacer" />
        <div className="who">{profile.username ?? profile.email}</div>
        <button className="btn s" onClick={signOut}>Sign out</button>
      </aside>
      <main>
        {route.page === 'overview' && <OverviewPage />}
        {route.page === 'tournaments' && <TournamentsPage />}
        {route.page === 'tournament' && <TournamentPage id={route.id} />}
        {route.page === 'disputes' && <DisputesPage />}
        {route.page === 'schedule' && <SchedulePage />}
        {route.page === 'players' && <PlayersPage />}
        {route.page === 'hosts' && <HostsPage />}
        {route.page === 'analytics' && <AnalyticsPage />}
        {route.page === 'audit' && <AuditPage />}
      </main>
    </div>
  );
}
