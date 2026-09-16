import { api, when } from '../lib/api';
import { useLoad } from '../lib/hooks';

/** Every manual override, newest first (agent.md §15 R2). */
export function AuditPage() {
  const { data, error } = useLoad(() => api.audit(), []);
  if (error && !data) return <div className="err">{error}</div>;
  return (
    <>
      <h1>Audit log</h1>
      <div className="sub">Cancellations, dispute resolutions, payouts, bans. Who did what, and when.</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {(data?.audit ?? []).map((a) => (
              <tr key={a.id}>
                <td className="faint">{when(a.created_at)}</td>
                <td>{a.admin_username}</td>
                <td><span className="badge">{a.action}</span></td>
                <td>{a.entity_type} <span className="mono faint">{a.entity_id?.slice(0, 8)}</span></td>
                <td className="mono faint">{JSON.stringify(a.details)}</td>
              </tr>
            ))}
            {data && data.audit.length === 0 ? <tr><td colSpan={5} className="center">No manual actions yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
