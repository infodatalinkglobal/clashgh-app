import { useState } from 'react';
import { api, ghs, when, type Player } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';

/** Players: search, dispute stats, ban / unban (R2 trust & fraud). Banned players cannot join. */
export function PlayersPage() {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const { data, error, reload } = useLoad(() => api.players(q), [q]);
  const act = useAction();

  const toggle = (p: Player) => {
    if (p.is_banned) {
      void act.run(p.id, () => api.ban(p.id, false, 'unban'), `Unban ${p.username}?`, 'Unbanned').then(reload);
    } else {
      const reason = window.prompt(`Ban ${p.username}? Enter the reason (written to the audit log):`);
      if (!reason) return;
      void act.run(p.id, () => api.ban(p.id, true, reason), undefined, 'Banned').then(reload);
    }
  };

  return (
    <>
      <h1>Players</h1>
      <div className="sub">Flagged = ≥30% of matches disputed over ≥3 matches (3B). Banned players are blocked at join; existing registrations are untouched.</div>
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); setQ(typed); }}>
        <input style={{ maxWidth: 360 }} placeholder="Search username, email or +233 phone" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn">Search</button>
        {act.msg ? <span className={act.msg.ok ? 'ok' : 'err'}>{act.msg.text}</span> : null}
      </form>
      {error && !data ? <div className="err">{error}</div> : null}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Player</th><th>MoMo</th><th>Matches</th><th>Disputes</th><th>Money</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            {(data?.players ?? []).map((p) => (
              <tr key={p.id}>
                <td><b>{p.username ?? '(no username)'}</b> {p.role === 'admin' ? <span className="badge gold">admin</span> : null}{p.is_banned ? <span className="badge red">banned</span> : null}{p.flagged && !p.is_banned ? <span className="badge red">flagged</span> : null}<br /><span className="faint">{p.email}</span></td>
                <td className="mono">{p.phone ?? 'n/a'} <span className="faint">{p.momo_provider ?? ''}{!p.phone_verified ? ' · unverified' : ''}</span></td>
                <td>{p.matches_completed} played · {p.wins} won</td>
                <td>{p.open_disputes + p.resolved_disputes} <span className="faint">({Math.round(Number(p.dispute_rate) * 100)}%)</span>{p.open_disputes ? <span className="badge red" style={{ marginLeft: 6 }}>{p.open_disputes} open</span> : null}</td>
                <td>paid {ghs(p.fees_paid_pesewas)}<br /><span className="faint">won {ghs(p.winnings_pesewas)}</span></td>
                <td className="faint">{when(p.created_at)}</td>
                <td>{p.role === 'player' ? <button className={`btn s ${p.is_banned ? '' : 'd'}`} disabled={!!act.busy} onClick={() => toggle(p)}>{p.is_banned ? 'Unban' : 'Ban'}</button> : null}</td>
              </tr>
            ))}
            {data && data.players.length === 0 ? <tr><td colSpan={7} className="center">No players match.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
