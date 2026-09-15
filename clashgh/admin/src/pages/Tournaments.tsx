import { useState } from 'react';
import { api, GAME, ghs, until, when, type AdminTournament, type Game } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { go } from '../App';

const TABS = ['all', 'open', 'full', 'in_progress', 'completed', 'cancelled'] as const;
const TONE: Record<AdminTournament['status'], string> = { open: 'green', full: 'blue', in_progress: 'gold', completed: '', cancelled: 'red' };

export function TournamentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  const [creating, setCreating] = useState(false);
  const { data, error, reload } = useLoad(() => api.tournaments(tab), [tab], 60_000);
  return (
    <>
      <div className="row"><h1>Tournaments</h1><button className="btn p right" onClick={() => setCreating((v) => !v)}>{creating ? 'Close' : '+ New tournament'}</button></div>
      <div className="sub">v1: platform-hosted only — admins create, players join. Close time 24–48h keeps money from sitting (agent.md §1).</div>
      {creating ? <CreateForm onCreated={() => { setCreating(false); void reload(); }} /> : null}
      <div className="tabs">{TABS.map((t) => <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t.replace('_', ' ')}</button>)}</div>
      {error && !data ? <div className="err">{error}</div> : null}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Tournament</th><th>Status</th><th>Players</th><th>Progress</th><th>Closes / starts</th><th>Money</th><th>Flags</th></tr></thead>
          <tbody>
            {(data?.tournaments ?? []).map((t) => (
              <tr key={t.id} className="click" onClick={() => go({ page: 'tournament', id: t.id })}>
                <td><b>{t.title}</b><br /><span className="faint">{GAME[t.game]} · {ghs(t.entry_fee_pesewas)} × {t.max_players} · {t.first_place_percent}/{t.runnerup_percent}/{100 - t.first_place_percent - t.runnerup_percent}</span></td>
                <td><span className={`badge ${TONE[t.status]}`}>{t.status.replace('_', ' ')}</span></td>
                <td className="mono">{t.paid_count}/{t.max_players}</td>
                <td>{t.total_matches ? <><span className="mono">{t.completed_matches}/{t.total_matches}</span> matches</> : <span className="faint">no bracket</span>}</td>
                <td className="faint">{t.status === 'open' ? `closes ${until(t.closes_at)}` : ''}<br />{when(t.starts_at)}</td>
                <td>in {ghs(t.collected_pesewas)}<br /><span className="faint">out {ghs(t.paid_out_pesewas)}</span></td>
                <td className="pill-list">
                  {t.disputed_count ? <span className="badge red">{t.disputed_count} disputed</span> : null}
                  {t.failed_transfers ? <span className="badge red">{t.failed_transfers} failed transfer</span> : null}
                </td>
              </tr>
            ))}
            {data && data.tournaments.length === 0 ? <tr><td colSpan={7} className="center">Nothing here.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function isoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    title: '', game: 'efootball' as Game, entry_fee: '10', max_players: '4',
    closes_at: isoLocal(new Date(Date.now() + 24 * 3600_000)), starts_at: isoLocal(new Date(Date.now() + 26 * 3600_000)),
    result_window_minutes: '30', first: '70', runnerup: '20',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const fee = Math.round(Number(f.entry_fee) * 100) || 0;
  const total = fee * Number(f.max_players);
  const first = Math.floor((total * Number(f.first)) / 100);
  const ru = Math.floor((total * Number(f.runnerup)) / 100);
  const platform = total - first - ru;
  const floorOk = ru >= 1000;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void act.run('create', () => api.createTournament({
      title: f.title, game: f.game, entry_fee_pesewas: fee, max_players: Number(f.max_players),
      closes_at: new Date(f.closes_at).toISOString(), starts_at: new Date(f.starts_at).toISOString(),
      result_window_minutes: Number(f.result_window_minutes), first_place_percent: Number(f.first), runnerup_percent: Number(f.runnerup),
    }), undefined, 'Tournament created').then((ok) => ok && onCreated());
  };

  return (
    <form className="card gold" onSubmit={submit} style={{ marginBottom: 16 }}>
      <div className="grid g3">
        <div className="f"><label>Title</label><input required minLength={3} maxLength={120} value={f.title} onChange={set('title')} placeholder="eFootball Friday Cup" /></div>
        <div className="f"><label>Game</label><select value={f.game} onChange={set('game')}>{(Object.keys(GAME) as Game[]).map((g) => <option key={g} value={g}>{GAME[g]}</option>)}</select></div>
        <div className="f"><label>Bracket size</label><select value={f.max_players} onChange={set('max_players')}><option>4</option><option>8</option><option value="16">16 (expand only when fill-rate is healthy)</option></select></div>
        <div className="f"><label>Entry fee (₵)</label><input type="number" min={10} step="0.5" value={f.entry_fee} onChange={set('entry_fee')} /></div>
        <div className="f"><label>Registration closes</label><input type="datetime-local" value={f.closes_at} onChange={set('closes_at')} /></div>
        <div className="f"><label>Kick-off (≥1h after close)</label><input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></div>
        <div className="f"><label>Result window (min)</label><input type="number" min={5} max={240} value={f.result_window_minutes} onChange={set('result_window_minutes')} /></div>
        <div className="f"><label>1st place %</label><input type="number" min={1} max={99} value={f.first} onChange={set('first')} /></div>
        <div className="f"><label>Runner-up %</label><input type="number" min={1} max={99} value={f.runnerup} onChange={set('runnerup')} /></div>
      </div>
      <div className="row">
        <span className="muted">If full: <b>{ghs(total)}</b> collected → 🥇 {ghs(first)} · 🥈 {ghs(ru)} · platform {ghs(platform)} ({platform >= 0 ? Math.round((platform / (total || 1)) * 100) : '—'}%)</span>
        {!floorOk ? <span className="badge red">runner-up below ₵10.00 minimum — raise fee or size</span> : null}
        <button className="btn p right" disabled={!!act.busy || !floorOk || platform < 0}>Create</button>
      </div>
      {act.msg ? <div className={act.msg.ok ? 'ok' : 'err'}>{act.msg.text}</div> : null}
    </form>
  );
}
