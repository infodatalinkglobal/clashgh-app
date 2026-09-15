/**
 * ClashGH admin API client. Same envelope as the app:
 *   { success, data, message }
 * Token lives in sessionStorage (admins sign out when the tab closes).
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
const TOKEN_KEY = 'clashgh_admin_token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const token = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized: () => void = () => {};
export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ApiError(0, 'Cannot reach the API');
  }
  const json = (await res.json().catch(() => null)) as { success: boolean; data: T; message: string } | null;
  if (res.status === 401) onUnauthorized();
  if (!res.ok || !json || json.success === false) throw new ApiError(res.status, json?.message ?? `HTTP ${res.status}`);
  return json.data;
}

// ---------------------------------------------------------------------------
// Types (mirror backend/src/routes/adminDashboard.js + existing routes)
// ---------------------------------------------------------------------------
export type Game = 'efootball' | 'fc_mobile' | 'codm' | 'dls';
export type TStatus = 'open' | 'full' | 'in_progress' | 'completed' | 'cancelled';
export type MStatus = 'pending' | 'active' | 'awaiting_results' | 'disputed' | 'completed';

export interface Profile { id: string; email: string; username: string | null; role: 'player' | 'admin' }

export interface Overview {
  counts: { disputed_matches: number; open_tournaments: number; live_tournaments: number; lobbies_past_close: number; failed_transfers: number; pending_transfers: number; players: number; banned_players: number };
  disputes: { id: string; tournament_id: string; title: string; game: Game; match_round: number; match_number: number; dispute_reason: string | null; updated_at: string; player1: string | null; player2: string | null; player1_pick: string | null; player2_pick: string | null }[];
  lobby_health: { id: string; title: string; game: Game; status: TStatus; max_players: number; entry_fee_pesewas: number; closes_at: string; starts_at: string; paid_count: number; pending_count: number; fill_percent: number; hours_left: number; health: 'healthy' | 'near_full' | 'watch' | 'at_risk' | 'full' | 'full_awaiting_start' | 'past_close' }[];
  failed_transfers: { id: string; type: string; amount_pesewas: number; attempts: number; next_retry_at: string | null; updated_at: string; description: string; tournament_id: string | null; username: string; phone: string | null }[];
  revenue: { platform_fees_total: number; platform_fees_7d: number; collected_total: number; collected_7d: number; paid_out_total: number; refunded_total: number; in_escrow: number };
  recent_actions: AuditRow[];
}

export interface AuditRow { id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown> | null; created_at: string; admin_username?: string }

export interface AdminTournament {
  id: string; title: string; game: Game; status: TStatus; entry_fee_pesewas: number; max_players: number; closes_at: string; starts_at: string;
  result_window_minutes: number; first_place_percent: number; runnerup_percent: number; prize_pool_pesewas: number | null; platform_fee_pesewas: number | null;
  created_at: string; created_by_username: string | null; paid_count: number; disputed_count: number; completed_matches: number; total_matches: number;
  collected_pesewas: number; paid_out_pesewas: number; failed_transfers: number;
}

export interface TournamentDetail {
  tournament: AdminTournament;
  registrations: { id: string; user_id: string; username: string; phone: string | null; momo_provider: string | null; is_banned: boolean; game_uid: string; payment_status: 'pending' | 'paid' | 'refunded'; payment_reference: string; seed: number | null; created_at: string }[];
  matches: { id: string; match_round: number; match_number: number; status: MStatus; player1_id: string | null; player2_id: string | null; player1_username: string | null; player2_username: string | null; winner_id: string | null; winner_username: string | null; room_code: string | null; player1_pick: string | null; player2_pick: string | null; player1_screenshot_url: string | null; player2_screenshot_url: string | null; dispute_reason: string | null; started_at: string | null; deadline_at: string | null }[];
  ledger: { id: string; username: string; type: string; amount_pesewas: number; status: string; direction: string; description: string; attempts: number; created_at: string }[];
  audit: AuditRow[];
}

export interface DisputePlayer { id: string; username: string; pick: string | null; screenshot_url: string | null; game_uid: string; is_banned: boolean; dispute_rate: string | number; matches_played: number }
export interface Dispute { id: string; tournament_id: string; title: string; game: Game; entry_fee_pesewas: number; match_round: number; match_number: number; dispute_reason: string | null; room_code: string | null; started_at: string | null; deadline_at: string | null; updated_at: string; player1: DisputePlayer | null; player2: DisputePlayer | null; is_final: boolean; priority: 'high' | 'normal' }

export interface Player { id: string; username: string | null; email: string; phone: string | null; momo_provider: string | null; phone_verified: boolean; role: string; is_banned: boolean; created_at: string; matches_completed: number; wins: number; open_disputes: number; resolved_disputes: number; dispute_rate: string | number; fees_paid_pesewas: number; winnings_pesewas: number; flagged: boolean }

export interface Analytics {
  days: number;
  funnel: { created: number; filled: number; completed: number; cancelled: number; open_now: number; fill_rate_percent: number; refund_rate_percent: number };
  timing: { avg_hours_to_fill: string | null; avg_match_minutes: string | null; matches_played: number; matches_disputed: number; no_shows: number; dispute_rate_percent: number };
  by_game: { game: Game; tournaments: number; filled: number; unique_players: number; collected_pesewas: number; platform_fee_pesewas: number }[];
  daily: { day: string; collected: number; paid_out: number; platform_fee: number; active_players: number }[];
  gates: Record<'fill_rate' | 'refund_rate' | 'dispute_rate', { value: number; target: number; ok: boolean }>;
}

// ---------------------------------------------------------------------------
export const api = {
  devSignIn: (email: string) => request<{ access_token?: string; token?: string; profile?: Profile }>('/dev/auth/signin', { method: 'POST', body: { email } }),
  me: () => request<{ profile: Profile }>('/me'),
  overview: () => request<Overview>('/admin/overview'),
  tournaments: (status: string) => request<{ tournaments: AdminTournament[] }>(`/admin/tournaments?status=${status}`),
  tournament: (id: string) => request<TournamentDetail>(`/admin/tournaments/${id}`),
  createTournament: (body: Record<string, unknown>) => request<{ tournament: AdminTournament }>('/tournaments', { method: 'POST', body }),
  cancelTournament: (id: string) => request<{ refunded_count: number }>(`/admin/tournaments/${id}/cancel`, { method: 'POST' }),
  payout: (id: string, force = false) => request<unknown>(`/admin/tournaments/${id}/payout${force ? '?force=true' : ''}`, { method: 'POST' }),
  disputes: () => request<{ disputes: Dispute[]; threshold: { rate: number; min_matches: number } }>('/admin/disputes'),
  resolve: (matchId: string, body: { resolution: 'award' | 'replay' | 'refund'; winner_id?: string }) => request<unknown>(`/admin/matches/${matchId}/resolve`, { method: 'POST', body }),
  players: (q: string) => request<{ players: Player[] }>(`/admin/players${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  ban: (id: string, banned: boolean, reason: string) => request<unknown>(`/admin/players/${id}/ban`, { method: 'POST', body: { banned, reason } }),
  audit: () => request<{ audit: AuditRow[] }>('/admin/audit?limit=200'),
  analytics: (days: number) => request<Analytics>(`/admin/analytics?days=${days}`),
};

export const ghs = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `₵${(p / 100).toFixed(2)}`);
export const GAME: Record<Game, string> = { efootball: 'eFootball', fc_mobile: 'FC Mobile', codm: 'CODM', dls: 'DLS' };
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};
export const until = (iso: string) => {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (m <= 0) return 'passed';
  if (m < 60) return `in ${m}m`;
  if (m < 1440) return `in ${Math.floor(m / 60)}h`;
  return `in ${Math.floor(m / 1440)}d`;
};
