import { useState } from 'react';
import { api, GAME, ghs } from '../lib/api';
import { useLoad } from '../lib/hooks';

/**
 * Analytics (3F): the numbers that gate expansion (agent.md §1, §15 R1).
 * Everything is derived from transactions / matches / tournaments — no events table.
 */
export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data, error } = useLoad(() => api.analytics(days), [days]);
  if (error && !data) return <div className="err">{error}</div>;
  if (!data) return <div className="center">Loading…</div>;
  const { funnel, timing, by_game, daily, gates } = data;
  const max = Math.max(1, ...daily.map((d) => d.collected));
  const activeMax = Math.max(1, ...daily.map((d) => d.active_players));

  return (
    <>
      <div className="row"><h1>Analytics</h1><div className="tabs right" style={{ margin: 0 }}>{[7, 30, 90].map((d) => <button key={d} className={`tab ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>{d}d</button>)}</div></div>
      <div className="sub">Tournaments created in the last {days} days. Expansion gates (bigger brackets, more games) should all be green first.</div>

      <h2>Expansion gates</h2>
      <div className="grid g3">
        <Gate l="Fill rate" v={`${gates.fill_rate.value}%`} ok={gates.fill_rate.ok} s={`target ≥ ${gates.fill_rate.target}% · ${funnel.filled}/${funnel.created} lobbies filled`} />
        <Gate l="Refund rate" v={`${gates.refund_rate.value}%`} ok={gates.refund_rate.ok} s={`target ≤ ${gates.refund_rate.target}% · ${funnel.cancelled} cancelled`} />
        <Gate l="Dispute rate" v={`${gates.dispute_rate.value}%`} ok={gates.dispute_rate.ok} s={`target ≤ ${gates.dispute_rate.target}% · ${timing.matches_disputed}/${timing.matches_played} matches`} />
      </div>

      <h2>Funnel & timing</h2>
      <div className="grid g4">
        <K l="Created" v={funnel.created} s={`${funnel.open_now} open now`} />
        <K l="Completed" v={funnel.completed} s="paid out" />
        <K l="Avg time to fill" v={timing.avg_hours_to_fill ? `${timing.avg_hours_to_fill}h` : '—'} s="creation → last payment" />
        <K l="Avg match length" v={timing.avg_match_minutes ? `${timing.avg_match_minutes}m` : '—'} s={`${timing.no_shows} no-show/deadline settlements`} />
      </div>

      <h2>Daily — collected (bars) and active paying players</h2>
      <div className="card">
        <div className="spark">{daily.map((d) => <i key={d.day} title={`${d.day}: ${ghs(d.collected)} in, ${ghs(d.paid_out)} out, ${d.active_players} players`} style={{ height: `${(d.collected / max) * 100}%` }} />)}</div>
        <div className="spark" style={{ height: 30, marginTop: 6 }}>{daily.map((d) => <i key={d.day} style={{ height: `${(d.active_players / activeMax) * 100}%`, background: 'var(--blue)' }} />)}</div>
        <div className="row faint" style={{ marginTop: 6 }}><span>{daily[0]?.day}</span><span className="right">{daily[daily.length - 1]?.day}</span></div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">Total in {ghs(daily.reduce((s, d) => s + d.collected, 0))}</span>
          <span className="muted">· paid out {ghs(daily.reduce((s, d) => s + d.paid_out, 0))}</span>
          <span className="muted">· platform {ghs(daily.reduce((s, d) => s + d.platform_fee, 0))}</span>
        </div>
      </div>

      <h2>By game</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Game</th><th>Tournaments</th><th>Filled</th><th>Unique players</th><th>Collected</th><th>Platform fee</th></tr></thead>
          <tbody>
            {by_game.map((g) => (
              <tr key={g.game}><td><b>{GAME[g.game]}</b></td><td>{g.tournaments}</td><td>{g.filled} <span className="faint">({g.tournaments ? Math.round((g.filled / g.tournaments) * 100) : 0}%)</span></td><td>{g.unique_players}</td><td>{ghs(g.collected_pesewas)}</td><td className="mono">{ghs(g.platform_fee_pesewas)}</td></tr>
            ))}
            {by_game.length === 0 ? <tr><td colSpan={6} className="center">No tournaments in this window.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function K({ l, v, s }: { l: string; v: number | string; s?: string }) {
  return <div className="card kpi"><div className="l">{l}</div><div className="v" style={{ fontSize: 22 }}>{v}</div>{s ? <div className="s">{s}</div> : null}</div>;
}
function Gate({ l, v, ok, s }: { l: string; v: string; ok: boolean; s: string }) {
  return <div className={`card kpi ${ok ? '' : 'warn'}`}><div className="l">{l}</div><div className={`v ${ok ? 'green' : 'red'}`}>{v} {ok ? '✓' : '✗'}</div><div className="s">{s}</div></div>;
}
