import { Config } from '../config';

/**
 * ClashGH API client.
 *
 * Every backend response is an envelope:
 *   { success: boolean, data: T | null, message: string }
 * Errors carry an HTTP status (4xx/5xx) with the same envelope.
 */

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface Envelope<T> {
  success: boolean;
  data: T;
  message: string;
}

type TokenProvider = () => Promise<string | null>;
type OnUnauthorized = () => void;

class Client {
  private tokenProvider: TokenProvider = async () => null;
  private unauthorizedHandler: OnUnauthorized = () => {};

  setTokenProvider(fn: TokenProvider) {
    this.tokenProvider = fn;
  }
  setOnUnauthorized(fn: OnUnauthorized) {
    this.unauthorizedHandler = fn;
  }

  async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const { method = 'GET', body, auth = false } = options;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = await this.tokenProvider();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(`${Config.apiUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Cannot reach the ClashGH servers — check your connection');
    }

    let json: Envelope<T> | null = null;
    try {
      json = (await res.json()) as Envelope<T>;
    } catch {
      // non-JSON response (proxy error, etc.)
    }

    if (res.status === 401 && auth) {
      this.unauthorizedHandler();
    }
    if (!res.ok || !json || json.success === false) {
      throw new ApiError(res.status, json?.message ?? `Request failed (HTTP ${res.status})`, json?.data ?? null);
    }
    return json.data;
  }
}

export const api = new Client();

// ---------------------------------------------------------------------------
// Models — mirrors of the verified backend payloads (1B/1C/1D/1F)
// ---------------------------------------------------------------------------

export type MomoProvider = 'mtn' | 'vodafone' | 'airteltigo';
export type GameType = 'efootball' | 'fc_mobile' | 'codm' | 'dls';
export type TournamentStatus = 'open' | 'full' | 'in_progress' | 'completed' | 'cancelled';

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  phone: string | null;
  phone_verified: boolean;
  momo_provider: MomoProvider | null;
  role: 'player' | 'admin';
  is_banned: boolean;
  created_at: string;
}

export interface Tournament {
  id: string;
  title: string;
  game: GameType;
  entry_fee_pesewas: number;
  max_players: number;
  closes_at: string;
  starts_at: string;
  result_window_minutes: number;
  first_place_percent: number;
  runnerup_percent: number;
  prize_pool_pesewas: number | null;
  platform_fee_pesewas: number | null;
  status: TournamentStatus;
  created_at: string;
  paid_count: number;
  pending_count: number;
  spots_left: number;
  registration_closes: boolean;
  can_join: boolean;
  projection_if_full: {
    total_collected_pesewas: number;
    first_prize_pesewas: number;
    runnerup_prize_pesewas: number;
    platform_fee_pesewas: number;
  };
}

export interface BracketPlayer {
  id: string;
  username: string;
  seed: number | null;
}

export interface BracketMatch {
  id: string;
  match_number: number;
  status: 'pending' | 'active' | 'awaiting_results' | 'disputed' | 'completed';
  player1: BracketPlayer | null;
  player2: BracketPlayer | null;
  winner: string | null;
  room_code: string | null;
  started_at: string | null;
  deadline_at: string | null;
  feeds_next: { round: number; match: number } | null;
}

export interface BracketView {
  tournament_id: string;
  title: string;
  status: TournamentStatus;
  players: number;
  prize_pool_pesewas: number | null;
  platform_fee_pesewas: number | null;
  bracket_generated: boolean;
  rounds: { round: number; matches: BracketMatch[] }[];
}

export interface MatchPlayerView {
  user_id: string;
  username: string;
  seed: number | null;
  game_uid: string;
  pick: 'won' | 'lost' | 'draw' | 'dispute' | null;
  screenshot_url?: string | null;
}

export interface MatchView {
  id: string;
  tournament_id: string;
  tournament_title: string;
  tournament_status: TournamentStatus;
  tournament_starts_at: string;
  match_round: number;
  match_number: number;
  status: 'pending' | 'active' | 'awaiting_results' | 'disputed' | 'completed';
  room_code: string | null;
  started_at: string | null;
  deadline_at: string | null;
  player1: MatchPlayerView | null;
  player2: MatchPlayerView | null;
  winner_id: string | null;
  dispute_reason: string | null;
}

export interface RegistrationView {
  id: string;
  tournament_id: string;
  user_id: string;
  game_uid: string;
  payment_status: 'pending' | 'paid' | 'refunded';
  payment_reference: string;
  created_at: string;
  payment_deadline: string;
}

export type TransactionType = 'entry_fee' | 'payout' | 'refund' | 'platform_fee';
export type TransactionStatus = 'pending' | 'success' | 'failed';

export interface TransactionRow {
  id: string;
  type: TransactionType;
  amount_pesewas: number;
  status: TransactionStatus;
  direction: 'in' | 'out';
  description: string;
  tournament_id: string | null;
  tournament_title: string | null;
  tournament_game: GameType | null;
  paystack_reference: string | null;
  attempts: number;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletTotals {
  fees_paid_pesewas: number;
  winnings_pesewas: number;
  refunds_pesewas: number;
  pending_out_pesewas: number;
  payouts_count: number;
}

export interface ChargeInfo {
  reference: string;
  channel: string;
  provider: MomoProvider;
  amount_pesewas: number;
  authorization_url: string | null;
  note: string;
}

export interface SettleResult {
  settled: boolean;
  reason?: string;
  registrationId?: string;
  tournamentFull?: boolean;
  bracket?: { generated: boolean; players: number; rounds: number; matches: number; prize_pool_pesewas: number; platform_fee_pesewas: number } | null;
}

export interface JoinResult {
  registration: RegistrationView;
  charge: ChargeInfo;
}

// ---------------------------------------------------------------------------
// Endpoint wrappers
// ---------------------------------------------------------------------------

export const endpoints = {
  me: () => api.request<{ profile: Profile }>('/me', { auth: true }),
  updateUsername: (username: string) =>
    api.request<{ username: string }>('/me', { method: 'PATCH', body: { username }, auth: true }),
  requestOtp: (phone: string) =>
    api.request<null>('/me/phone/request-otp', { method: 'POST', body: { phone }, auth: true }),
  verifyOtp: (phone: string, otp: string) =>
    api.request<{ phone: string; momo_provider: MomoProvider; phone_verified: boolean }>(
      '/me/phone/verify',
      { method: 'POST', body: { phone, otp }, auth: true },
    ),

  myTransactions: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.request<{ transactions: TransactionRow[]; totals: WalletTotals; limit: number; offset: number }>(
      `/me/transactions${suffix}`,
      { auth: true },
    );
  },

  listTournaments: (params?: { game?: GameType; status?: TournamentStatus; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.game) qs.set('game', params.game);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.request<{ tournaments: Tournament[]; limit: number; offset: number }>(
      `/tournaments${suffix}`,
    );
  },
  getTournament: (id: string) => api.request<{ tournament: Tournament }>(`/tournaments/${id}`),
  getBracket: (id: string) => api.request<BracketView>(`/tournaments/${id}/bracket`),
  /** My registration for one tournament (null if I haven't joined). */
  myRegistration: (id: string) =>
    api.request<{ registration: RegistrationView | null }>(`/tournaments/${id}/me`, { auth: true }),
  join: (id: string, gameUid: string) =>
    api.request<JoinResult>(`/tournaments/${id}/join`, { method: 'POST', body: { game_uid: gameUid }, auth: true }),

  /** Dev-only: settle a stub charge (mirrors the Paystack webhook). */
  simulateCharge: (reference: string, success = true) =>
    api.request<SettleResult>(`/dev/paystack/simulate-charge`, {
      method: 'POST',
      body: { reference, success },
    }),

  uploadScreenshot: (imageBase64: string, matchId: string) =>
    api.request<{ url: string; bytes: number }>('/uploads/screenshot', {
      method: 'POST',
      body: { image_base64: imageBase64, match_id: matchId },
      auth: true,
    }),

  getMatch: (id: string) => api.request<MatchView>(`/matches/${id}`),
  submitResult: (
    id: string,
    body: { pick: 'won' | 'lost' | 'draw' | 'dispute'; screenshot_url: string; reason?: string },
  ) =>
    api.request<{ status: string; winner_id?: string; message?: string }>(`/matches/${id}/result`, {
      method: 'POST',
      body,
      auth: true,
    }),
};

/** Format pesewas as a cedi string, e.g. 12000 → "₵120.00". */
export function pesewasToGhs(pesewas: number | null): string {
  if (pesewas === null) return '—';
  return `₵${(pesewas / 100).toFixed(2)}`;
}

/** Relative time label: "in 2h 15m", "3m ago". */
export function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  let label: string;
  if (mins < 60) label = `${Math.max(mins, 1)}m`;
  else if (mins < 60 * 24) label = `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim();
  else label = `${Math.floor(mins / (60 * 24))}d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}
