import { useState } from 'react';
import { api, ghs, when, type Host } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';

/** Community hosts (marketplace): approve applications, suspend bad actors, see what each host earns you. */
export function HostsPage() {
  const [status, setStatus] = useState<string>('');
  const { data, error, reload } = useLoad(() => api.hosts(status), [status]);
  const act = useAction();

  const approve = (h: Host) =>
    void act.run(h.id, () => api.hostAction(h.id, 'approve'), `Approve ${h.username} as a host? They can publish tournaments immediately.`, 'Approved').then(reload);
  const suspend = (h: Host) => {
    const reason = window.prompt(`Suspend ${h.username}? Enter the reason (sent to the host, written to the audit log):`);
    if (!reason) return;
    void act.run(h.id, () => api.hostAction(h.id, 'suspend', reason), undefined, 'Suspended').then(reload);
  };

  const l = data?.limits;
  const totalCommission = (data?.hosts ?? []).reduce((a, h) => a + h.platform_commission_pesewas, 0);
  return (
    <>
      <h1>Hosts</h1>
      <div className="sub">
        Marketplace model: hosts set a cut of up to {l?.host_cut_max_percent ?? 20}% after prizes; ClashGH keeps {l?.platform_commission_percent ?? 50}% of that cut.
        Fees stay in ClashGH escrow; disputes, refunds and payouts stay with you. Min entry {ghs(l?.min_entry_fee_pesewas ?? 500)}.
      </div>
      <div className="tabs" style={{ alignItems: "center" }}>
        {['', 'pending', 'approved', 'suspended'].map((s) => (
          <button key={s} className={`tab ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>{s || 'all'}</button>
        ))}
        <span className="faint" style={{ marginLeft: 'auto' }}>Commission earned from hosted cups: <b>{ghs(totalCommission)}</b></span>
        {act.msg ? <span className={act.msg.ok ? 'ok' : 'err'}>{act.msg.text}</span> : null}
      </div>
      {error && !data ? <div className="err">{error}</div> : null}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Host</th><th>Status</th><th>Pitch</th><th>Tournaments</th><th>Host earned</th><th>Your commission</th><th>Applied</th><th></th></tr></thead>
          <tbody>
            {(data?.hosts ?? []).map((h) => (
              <tr key={h.id}>
                <td><b>{h.username ?? '(no username)'}</b><br /><span className="faint">{h.email}</span><br /><span className="mono faint">{h.phone ?? 'no MoMo'}</span></td>
                <td><span className={`badge ${h.host_status === 'approved' ? 'green' : h.host_status === 'pending' ? 'gold' : 'red'}`}>{h.host_status}</span></td>
                <td style={{ maxWidth: 320 }}><span className="faint">{h.host_note ?? '—'}</span></td>
                <td>{h.hosted_count} hosted · {h.completed_count} done{h.cancelled_count ? ` · ${h.cancelled_count} cancelled` : ''}</td>
                <td className="mono">{ghs(h.earned_pesewas)}</td>
                <td className="mono"><b>{ghs(h.platform_commission_pesewas)}</b></td>
                <td className="faint">{h.host_applied_at ? when(h.host_applied_at) : '—'}</td>
                <td className="row">
                  {h.host_status !== 'approved' ? <button className="btn s" disabled={act.busy === h.id} onClick={() => approve(h)}>Approve</button> : null}
                  {h.host_status !== 'suspended' ? <button className="btn s d" disabled={act.busy === h.id} onClick={() => suspend(h)}>Suspend</button> : null}
                </td>
              </tr>
            ))}
            {data && data.hosts.length === 0 ? <tr><td colSpan={8} className="faint">No hosts{status ? ` with status "${status}"` : ' yet'}.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
