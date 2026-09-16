import { useState } from 'react';
import { api, GAME, when, type ScheduleRow, type ScheduleState } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { go } from '../App';

const LABEL: Record<ScheduleState, string> = { unscheduled: 'no time yet', proposed: 'proposed', agreed: 'agreed', active: 'playing', awaiting_results: 'awaiting results' };
const TONE: Record<ScheduleState, string> = { unscheduled: '', proposed: 'gold', agreed: 'green', active: 'blue', awaiting_results: 'gold' };
type Filter = 'all' | 'overdue' | ScheduleState;

/**
 * Every unfinished match in a live tournament, with its scheduling state.
 * Read only: the scheduling rules run themselves (an unanswered proposal
 * activates at its time, no proposal activates at window close). This page
 * exists so an admin can see who is stalling and phone them if needed.
 */
export function SchedulePage() {
  const { data, error } = useLoad(() => api.schedule(), [], 30_000);
  const [filter, setFilter] = useState<Filter>('all');
  if (error && !data) return <div className="err">{error}</div>;
  if (!data) return <div className="center">Loading…</div>;
  const { matches, counts, round_window_hours } = data;
  const shown = matches.filter((m) => filter === 'all' ? true : filter === 'overdue' ? m.overdue : m.state === filter);
  const chip = (f: Filter, label: string, n: number) => (
    <button key={f} className={`btn ${filter === f ? 'p' : ''}`} onClick={() => setFilter(f)}>{label} {n}</button>
  );
  return (
    <>
      <h1>Match schedule</h1>
      <div className="sub">Players get {round_window_hours} hours per round to agree a time and play. Times shown in your local time zone.</div>
      <div className="row" style={{ marginBottom: 14 }}>
        {chip('all', 'All', counts.total)}
        {chip('overdue', 'Overdue', counts.overdue)}
        {chip('unscheduled', 'No time yet', counts.unscheduled)}
        {chip('proposed', 'Proposed', counts.proposed)}
        {chip('agreed', 'Agreed', counts.agreed)}
        {chip('active', 'Playing', counts.playing)}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Tournament</th><th>Match</th><th>Players</th><th>State</th><th>Time</th><th>Window closes</th><th>Contact</th></tr></thead>
          <tbody>
            {shown.map((m) => <Row key={m.id} m={m} />)}
            {shown.length === 0 ? <tr><td colSpan={7} className="center">{matches.length === 0 ? 'No live matches waiting to be played.' : 'Nothing in this filter.'}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ m }: { m: ScheduleRow }) {
  const time = m.state === 'active' || m.state === 'awaiting_results'
    ? <>started {when(m.started_at)}<div className="faint">results due {when(m.deadline_at)}</div></>
    : m.scheduled_at ? <>{when(m.scheduled_at)}{m.reschedule_count > 0 ? <div className="faint">rescheduled once</div> : null}</>
    : m.proposed_at ? <>{when(m.proposed_at)}<div className="faint">by {m.proposed_by_username ?? 'a player'}, stands if unanswered</div></>
    : <span className="faint">activates at window close</span>;
  return (
    <tr className={m.overdue ? 'warn' : ''}>
      <td><b className="click" style={{ cursor: 'pointer' }} onClick={() => go({ page: 'tournament', id: m.tournament_id })}>{m.title}</b> <span className="badge">{GAME[m.game]}</span></td>
      <td className="mono">R{m.match_round} M{m.match_number}{m.is_final ? ' final' : ''}</td>
      <td>{m.player1_username ?? 'TBD'} vs {m.player2_username ?? 'TBD'}</td>
      <td><span className={`badge ${TONE[m.state]}`}>{LABEL[m.state]}</span>{m.overdue ? <span className="badge red" style={{ marginLeft: 6 }}>overdue</span> : null}</td>
      <td>{time}</td>
      <td className="faint">{when(m.window_closes_at)}</td>
      <td className="mono faint">{m.player1_contact ?? 'none'} / {m.player2_contact ?? 'none'}</td>
    </tr>
  );
}
