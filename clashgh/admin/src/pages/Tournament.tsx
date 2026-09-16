import { api, GAME, ghs, when, type TournamentDetail } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';

const MT: Record<string, string> = { pending: '', active: 'gold', awaiting_results: 'gold', disputed: 'red', completed: 'green' };

/** One tournament: settings, registrations, every match, the ledger, and the audit trail. */
export function TournamentPage({ id }: { id: string }) {
  const { data, error, reload } = useLoad(() => api.tournament(id), [id], 30_000);
  const act = useAction();
  if (error && !data) return <div className="err">{error}</div>;
  if (!data) return <div className="center">Loading…</div>;
  const { tournament: t, registrations, matches, ledger, audit } = data;
  const paid = registrations.filter((r) => r.payment_status === 'paid');
  const collected = ledger.filter((l) => l.type === 'entry_fee' && l.status === 'success').reduce((s, l) => s + l.amount_pesewas, 0);
  const out = ledger.filter((l) => l.type !== 'entry_fee' && l.status === 'success').reduce((s, l) => s + l.amount_pesewas, 0);
  const finalDone = matches.length > 0 && matches.every((m) => m.status === 'completed');
  const canCancel = (t.status === 'open' || t.status === 'full') && new Date(t.starts_at) > new Date();
  const failed = ledger.filter((l) => l.status === 'failed').length;

  return (
    <>
      <a href="#/tournaments" className="faint">‹ Tournaments</a>
      <div className="row"><h1>{t.title}</h1><span className="badge gold">{GAME[t.game]}</span><span className="badge">{t.status.replace('_', ' ')}</span></div>
      <div className="sub">{ghs(t.entry_fee_pesewas)} × {t.max_players} · split {t.first_place_percent}/{t.runnerup_percent}/{100 - t.first_place_percent - t.runnerup_percent} · result window {t.result_window_minutes}m · closes {when(t.closes_at)} · kick-off {when(t.starts_at)} · by {t.created_by_username ?? 'n/a'}</div>

      <div className="row" style={{ marginBottom: 16 }}>
        {canCancel ? <button className="btn d" disabled={!!act.busy} onClick={() => act.run('cancel', () => api.cancelTournament(t.id), `Cancel and refund ${paid.length} paid player(s) (${ghs(collected)})?`, 'Cancelled + refunded').then(reload)}>Cancel + refund all</button> : null}
        {finalDone && (t.status === 'in_progress' || failed > 0) ? <button className="btn p" disabled={!!act.busy} onClick={() => act.run('payout', () => api.payout(t.id, failed > 0), failed > 0 ? 'Re-initiate the FAILED transfer(s)?' : 'Run payouts now (the sweeper normally does this within 60s)?', 'Payout initiated').then(reload)}>{failed > 0 ? 'Retry failed payouts' : 'Run payouts'}</button> : null}
        {act.msg ? <span className={act.msg.ok ? 'ok' : 'err'}>{act.msg.text}</span> : null}
      </div>

      <div className="grid g4">
        <K l="Paid players" v={`${paid.length}/${t.max_players}`} />
        <K l="Collected" v={ghs(collected)} />
        <K l="Paid out / refunded" v={ghs(out)} s={collected - out > 0 && t.status !== 'completed' ? `${ghs(collected - out)} in escrow` : collected === out && collected > 0 ? 'balanced' : ''} />
        <K l="Prize pool" v={ghs(t.prize_pool_pesewas)} s={t.platform_fee_pesewas !== null ? `platform ${ghs(t.platform_fee_pesewas)}` : 'fixed at bracket generation'} />
      </div>

      <h2>Bracket</h2>
      <div className="card" style={{ padding: 0 }}>
        {matches.length === 0 ? <div className="center">Bracket not generated yet.</div> : (
          <table>
            <thead><tr><th>Match</th><th>Player 1</th><th>Player 2</th><th>Status</th><th>Room</th><th>Picks</th><th>Winner</th><th>Scheduled</th><th>Window</th></tr></thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td className="mono">R{m.match_round} M{m.match_number}</td>
                  <td>{m.player1_username ?? <span className="faint">TBD</span>}</td>
                  <td>{m.player2_username ?? <span className="faint">TBD</span>}</td>
                  <td><span className={`badge ${MT[m.status]}`}>{m.status.replace('_', ' ')}</span>{m.dispute_reason ? <div className="faint">{m.dispute_reason}</div> : null}</td>
                  <td className="mono">{m.room_code ?? 'n/a'}</td>
                  <td className="faint">{m.player1_pick ?? '·'} / {m.player2_pick ?? '·'}{m.player1_screenshot_url ? <> · <a href={m.player1_screenshot_url} target="_blank" rel="noreferrer">shot 1</a></> : null}{m.player2_screenshot_url ? <> · <a href={m.player2_screenshot_url} target="_blank" rel="noreferrer">shot 2</a></> : null}</td>
                  <td>{m.winner_username ? <b>{m.winner_username}</b> : 'n/a'}</td>
                  <td className="faint">{scheduleCell(m)}</td>
                  <td className="faint">{m.started_at ? `${when(m.started_at)} to ${when(m.deadline_at)}` : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Registrations</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Seed</th><th>Player</th><th>MoMo</th><th>In-game ID</th><th>Payment</th><th>Reference</th><th>Joined</th></tr></thead>
          <tbody>
            {registrations.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.seed ?? 'n/a'}</td>
                <td>{r.username}{r.is_banned ? <span className="badge red" style={{ marginLeft: 6 }}>banned</span> : null}</td>
                <td className="mono">{r.phone} <span className="faint">{r.momo_provider}</span></td>
                <td className="mono">{r.game_uid}</td>
                <td><span className={`badge ${r.payment_status === 'paid' ? 'green' : r.payment_status === 'refunded' ? 'blue' : 'gold'}`}>{r.payment_status}</span></td>
                <td className="mono faint">{r.payment_reference}</td>
                <td className="faint">{when(r.created_at)}</td>
              </tr>
            ))}
            {registrations.length === 0 ? <tr><td colSpan={7} className="center">No registrations yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Ledger</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>When</th><th>Player</th><th>Type</th><th>Amount</th><th>Status</th><th>Description</th></tr></thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td className="faint">{when(l.created_at)}</td><td>{l.username}</td><td>{l.type}</td>
                <td className="mono">{l.direction === 'in' ? '+' : '−'}{ghs(l.amount_pesewas)}</td>
                <td><span className={`badge ${l.status === 'success' ? 'green' : l.status === 'failed' ? 'red' : 'gold'}`}>{l.status}{l.attempts ? ` (${l.attempts})` : ''}</span></td>
                <td className="muted">{l.description}</td>
              </tr>
            ))}
            {ledger.length === 0 ? <tr><td colSpan={6} className="center">No money has moved yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Audit trail</h2>
      <div className="card">
        {audit.length === 0 ? <span className="muted">No manual actions on this tournament.</span> : audit.map((a) => (
          <div key={a.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="badge">{a.action}</span><span className="muted">{a.entity_type}</span><span className="mono faint">{JSON.stringify(a.details)}</span><span className="faint right">{a.admin_username} · {when(a.created_at)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function scheduleCell(m: TournamentDetail['matches'][number]) {
  if (m.status === 'completed') return m.scheduled_at ? when(m.scheduled_at) : 'n/a';
  if (m.scheduled_at) return <>{when(m.scheduled_at)}{m.reschedule_count > 0 ? <div>rescheduled once</div> : null}</>;
  if (m.proposed_at) return <>{when(m.proposed_at)}<div>proposed by {m.proposed_by_username ?? 'a player'}, awaiting reply</div></>;
  if (m.round_opens_at && m.status === 'pending') return <>no time yet<div>window from {when(m.round_opens_at)}</div></>;
  return 'n/a';
}

function K({ l, v, s }: { l: string; v: string; s?: string }) {
  return <div className="card kpi"><div className="l">{l}</div><div className="v" style={{ fontSize: 22 }}>{v}</div>{s ? <div className="s">{s}</div> : null}</div>;
}
export type { TournamentDetail };
