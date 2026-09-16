import { useState } from 'react';
import { ago, api, GAME, ghs, when, type Dispute, type DisputePlayer } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { go } from '../App';

/**
 * Dispute queue (3B). Both screenshots side by side, each player's pick and
 * historical dispute rate; high-rate players float to the top ("priority").
 * Resolutions are exactly the three the backend allows:
 *   award <player>  → winner set, bracket advances (payout if final)
 *   replay          → same players, fresh room code + result window
 *   refund          → whole tournament cancelled, every paid player refunded
 * Every resolution is written to admin_audit_log by the backend.
 */
export function DisputesPage() {
  const { data, error, reload } = useLoad(() => api.disputes(), [], 30_000);
  if (error && !data) return <div className="err">{error}</div>;
  if (!data) return <div className="center">Loading…</div>;
  const { disputes, threshold } = data;
  return (
    <>
      <h1>Disputes</h1>
      <div className="sub">
        {disputes.length} waiting, oldest first. <span className="badge red">priority</span> marks a player with a dispute rate of {Math.round(threshold.rate * 100)}% or more over at least {threshold.min_matches} matches.
      </div>
      {disputes.length === 0 ? <div className="card muted">No disputed matches.</div> : disputes.map((d) => <DisputeCard key={d.id} d={d} onDone={reload} />)}
    </>
  );
}

function DisputeCard({ d, onDone }: { d: Dispute; onDone: () => void }) {
  const act = useAction();
  const [zoom, setZoom] = useState<string | null>(null);
  const award = (p: DisputePlayer) =>
    act.run('award', () => api.resolve(d.id, { resolution: 'award', winner_id: p.id }), `Award this match to ${p.username}?${d.is_final ? ' This is the final. Champion and runner-up payouts will be sent immediately.' : ' They advance to the next round.'}`, `Awarded to ${p.username}`).then((ok) => ok && onDone());
  const replay = () => act.run('replay', () => api.resolve(d.id, { resolution: 'replay' }), 'Schedule a replay? Picks and screenshots are cleared and a new room code + result window issued.', 'Replay scheduled').then((ok) => ok && onDone());
  const refund = () => act.run('refund', () => api.resolve(d.id, { resolution: 'refund' }), `Cancel the WHOLE tournament "${d.title}" and refund every paid player? Use only when the match cannot be fairly decided or replayed.`, 'Tournament cancelled and refunded').then((ok) => ok && onDone());

  return (
    <div className={`card ${d.priority === 'high' ? 'warn' : ''}`} style={{ marginBottom: 14 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        {d.priority === 'high' ? <span className="badge red">priority</span> : null}
        <b className="click" style={{ cursor: 'pointer' }} onClick={() => go({ page: 'tournament', id: d.tournament_id })}>{d.title}</b>
        <span className="badge">{GAME[d.game]}</span>
        <span className="muted">Round {d.match_round} · Match {d.match_number}{d.is_final ? ' · FINAL' : ''}</span>
        <span className="faint">room {d.room_code ?? 'n/a'} · agreed time {d.scheduled_at ? when(d.scheduled_at) : 'none'}{d.reschedule_count > 0 ? ' (rescheduled once)' : ''} · started {when(d.started_at)} · window closed {when(d.deadline_at)}</span>
        <span className="faint right">waiting {ago(d.updated_at)}</span>
      </div>
      <div className="muted" style={{ marginBottom: 12 }}><b>Reason:</b> {d.dispute_reason ?? 'n/a'}</div>

      <div className="grid g2">
        {[d.player1, d.player2].map((p, i) => p ? <PlayerSide key={p.id} p={p} side={i + 1} onZoom={setZoom} onAward={() => award(p)} busy={!!act.busy} /> : <div key={i} className="card muted">No player</div>)}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={!!act.busy} onClick={replay}>Replay match</button>
        <button className="btn d" disabled={!!act.busy} onClick={refund}>Cancel tournament + refund all</button>
        {act.msg ? <span className={act.msg.ok ? 'ok' : 'err'}>{act.msg.text}</span> : null}
        <span className="faint right">Entry {ghs(d.entry_fee_pesewas)} · award is final and audited</span>
      </div>

      {zoom ? (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'grid', placeItems: 'center', zIndex: 10, cursor: 'zoom-out' }}>
          <img src={zoom} alt="screenshot" style={{ maxWidth: '95vw', maxHeight: '95vh' }} />
        </div>
      ) : null}
    </div>
  );
}

function PlayerSide({ p, side, onZoom, onAward, busy }: { p: DisputePlayer; side: number; onZoom: (u: string) => void; onAward: () => void; busy: boolean }) {
  const rate = Math.round(Number(p.dispute_rate) * 100);
  return (
    <div className="card" style={{ background: 'var(--alt)' }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="faint">P{side}</span><b>{p.username}</b>
        {p.is_banned ? <span className="badge red">banned</span> : null}
        <span className={`badge ${p.pick === 'won' ? 'green' : p.pick === 'lost' ? '' : p.pick === 'dispute' ? 'red' : 'gold'}`}>picked: {p.pick ?? 'nothing'}</span>
        <span className="faint right">{p.matches_played} matches · {rate}% disputed</span>
      </div>
      <div className="faint mono" style={{ marginBottom: 8 }}>in-game ID {p.game_uid}</div>
      {p.screenshot_url ? (
        <img className="shot" src={p.screenshot_url} alt={`${p.username} screenshot`} style={{ cursor: 'zoom-in' }} onClick={() => onZoom(p.screenshot_url as string)} />
      ) : (
        <div className="shot center" style={{ display: 'grid', placeItems: 'center' }}>No screenshot submitted</div>
      )}
      <button className="btn p" style={{ marginTop: 10, width: '100%' }} disabled={busy || p.is_banned} onClick={onAward}>Award win to {p.username}</button>
    </div>
  );
}
