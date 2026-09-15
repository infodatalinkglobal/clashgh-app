import { ago, api, GAME, ghs, until, type Overview } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { go } from '../App';

const HEALTH: Record<Overview['lobby_health'][number]['health'], { label: string; tone: string }> = {
  healthy: { label: 'Healthy', tone: 'green' },
  near_full: { label: 'Near full', tone: 'green' },
  watch: { label: 'Watch', tone: 'gold' },
  at_risk: { label: 'At risk', tone: 'red' },
  full: { label: 'Full', tone: 'blue' },
  full_awaiting_start: { label: 'Full · awaiting start', tone: 'blue' },
  past_close: { label: 'Past close · not full', tone: 'red' },
};

/** "What needs me right now" — disputes, failed transfers, dying lobbies, money. */
export function OverviewPage() {
  const { data, error, reload } = useLoad(() => api.overview(), [], 30_000);
  const act = useAction();
  if (error && !data) return <div className="err">{error}</div>;
  if (!data) return <div className="center">Loading…</div>;
  const { counts, disputes, lobby_health, failed_transfers, revenue, recent_actions } = data;
  const needsAction = counts.disputed_matches + counts.failed_transfers + counts.lobbies_past_close;

  return (
    <>
      <h1>Overview</h1>
      <div className="sub">Auto-refreshes every 30s · {needsAction ? `${needsAction} item(s) need action` : 'Nothing needs action right now'}</div>
      {act.msg ? <div className={act.msg.ok ? 'ok' : 'err'}>{act.msg.text}</div> : null}

      <div className="grid g4">
        <Kpi l="Disputes waiting" v={counts.disputed_matches} tone={counts.disputed_matches ? 'red' : undefined} s="award / replay / refund" onClick={() => go({ page: 'disputes' })} />
        <Kpi l="Failed transfers" v={counts.failed_transfers} tone={counts.failed_transfers ? 'red' : undefined} s={`${counts.pending_transfers} pending`} />
        <Kpi l="Live tournaments" v={counts.live_tournaments} tone="gold" s={`${counts.open_tournaments} open lobbies`} onClick={() => go({ page: 'tournaments' })} />
        <Kpi l="In escrow" v={ghs(revenue.in_escrow)} s="collected − paid out − fees" />
      </div>

      <h2>Action queue</h2>
      {disputes.length + failed_transfers.length + counts.lobbies_past_close === 0 ? <div className="card muted">Queue is empty.</div> : null}
      {disputes.length ? (
        <div className="card warn" style={{ marginBottom: 12 }}>
          <div className="row" style={{ marginBottom: 8 }}><b>Disputed matches</b><span className="badge red">{disputes.length}</span><button className="btn s right" onClick={() => go({ page: 'disputes' })}>Open dispute queue →</button></div>
          <table>
            <thead><tr><th>Tournament</th><th>Match</th><th>Players (picks)</th><th>Reason</th><th>Waiting</th></tr></thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id} className="click" onClick={() => go({ page: 'disputes' })}>
                  <td>{d.title} <span className="badge">{GAME[d.game]}</span></td>
                  <td>R{d.match_round} M{d.match_number}</td>
                  <td>{d.player1 ?? '—'} <span className="faint">({d.player1_pick ?? 'none'})</span> vs {d.player2 ?? '—'} <span className="faint">({d.player2_pick ?? 'none'})</span></td>
                  <td className="muted">{d.dispute_reason ?? '—'}</td>
                  <td className="faint">{ago(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {failed_transfers.length ? (
        <div className="card warn" style={{ marginBottom: 12 }}>
          <div className="row" style={{ marginBottom: 8 }}><b>Failed MoMo transfers</b><span className="badge red">{failed_transfers.length}</span></div>
          <table>
            <thead><tr><th>Player</th><th>Type</th><th>Amount</th><th>Attempts</th><th>Next retry</th><th></th></tr></thead>
            <tbody>
              {failed_transfers.map((f) => (
                <tr key={f.id}>
                  <td>{f.username} <span className="faint mono">{f.phone}</span></td>
                  <td>{f.type}</td>
                  <td><b>{ghs(f.amount_pesewas)}</b></td>
                  <td>{f.attempts}/3 {f.attempts >= 3 ? <span className="badge red">final failure</span> : null}</td>
                  <td className="faint">{f.next_retry_at ? until(f.next_retry_at) : 'no auto-retry'}</td>
                  <td>{f.tournament_id ? <button className="btn s p" disabled={!!act.busy} onClick={() => act.run(f.id, () => api.payout(f.tournament_id as string, true), `Re-initiate the transfer of ${ghs(f.amount_pesewas)} to ${f.username}? (Check the MoMo number first.)`, 'Transfer re-initiated').then(reload)}>Retry now</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2>Lobby health <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>— open lobbies, soonest close first (R1)</span></h2>
      <div className="card">
        {lobby_health.length === 0 ? <div className="muted">No open lobbies. Create a tournament to keep players engaged.</div> : (
          <table>
            <thead><tr><th>Tournament</th><th style={{ width: 220 }}>Fill</th><th>Closes</th><th>Health</th><th>Money held</th><th></th></tr></thead>
            <tbody>
              {lobby_health.map((l) => {
                const h = HEALTH[l.health];
                const canCancel = l.health === 'past_close' || l.health === 'at_risk';
                return (
                  <tr key={l.id}>
                    <td className="click" onClick={() => go({ page: 'tournament', id: l.id })}><b>{l.title}</b><br /><span className="faint">{GAME[l.game]} · {ghs(l.entry_fee_pesewas)} × {l.max_players}</span></td>
                    <td><div className="row"><span className="mono">{l.paid_count}/{l.max_players}</span>{l.pending_count ? <span className="faint">+{l.pending_count} paying</span> : null}</div><div className="bar"><i style={{ width: `${l.fill_percent}%` }} /></div></td>
                    <td>{until(l.closes_at)}<br /><span className="faint">{l.hours_left > 0 ? `${l.hours_left}h left` : 'deadline passed'}</span></td>
                    <td><span className={`badge ${h.tone}`}>{h.label}</span></td>
                    <td>{ghs(l.paid_count * l.entry_fee_pesewas)}</td>
                    <td>{canCancel ? <button className="btn s d" disabled={!!act.busy} onClick={() => act.run(l.id, () => api.cancelTournament(l.id), `Cancel "${l.title}" and refund ${l.paid_count} paid player(s) (${ghs(l.paid_count * l.entry_fee_pesewas)})? This cannot be undone.`, 'Cancelled and refunded').then(reload)}>Cancel + refund</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2>Revenue</h2>
      <div className="grid g4">
        <Kpi l="Platform fees (7d)" v={ghs(revenue.platform_fees_7d)} tone="green" s={`${ghs(revenue.platform_fees_total)} all-time`} />
        <Kpi l="Collected (7d)" v={ghs(revenue.collected_7d)} s={`${ghs(revenue.collected_total)} all-time`} />
        <Kpi l="Paid out to winners" v={ghs(revenue.paid_out_total)} s="all-time, successful" />
        <Kpi l="Refunded" v={ghs(revenue.refunded_total)} s="cancelled lobbies" />
      </div>

      <h2>Recent admin actions</h2>
      <div className="card">
        {recent_actions.length === 0 ? <div className="muted">No manual actions yet.</div> : recent_actions.map((a) => (
          <div key={a.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="badge">{a.action}</span><span className="muted">{a.entity_type}</span><span className="mono faint">{JSON.stringify(a.details)}</span><span className="faint right">{ago(a.created_at)}</span>
          </div>
        ))}
        <div style={{ marginTop: 8 }}><a href="#/audit" className="faint">Full audit log →</a></div>
      </div>
    </>
  );
}

function Kpi({ l, v, s, tone, onClick }: { l: string; v: number | string; s?: string; tone?: 'red' | 'gold' | 'green'; onClick?: () => void }) {
  return (
    <div className={`card kpi ${onClick ? 'click' : ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="l">{l}</div>
      <div className={`v ${tone ?? ''}`}>{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}
