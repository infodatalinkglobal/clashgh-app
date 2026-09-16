/**
 * Test harness for the money-path suite.
 *
 * - Creates a throwaway database (TEST_DATABASE_NAME, default clashgh_test)
 *   on the same server as DATABASE_URL, runs the migrations (no seeds), and
 *   points the app at it. Dev data is never touched.
 * - Boots the real Express app on an ephemeral port (stub auth, stub
 *   Paystack, mock mail/push, local screenshots) and talks to it over HTTP
 *   exactly like the mobile app does.
 * - Sweepers are NOT started; tests call the sweep functions directly and
 *   move time by editing timestamps in SQL, so the suite is deterministic
 *   and takes seconds, not hours.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL must point at a Postgres server (see .env.example)');
const testDbName = process.env.TEST_DATABASE_NAME || 'clashgh_test';

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export const testDbUrl = withDatabase(baseUrl, testDbName);

/** Drop + create the test database and apply migrations. */
export async function resetDatabase() {
  const admin = new pg.Client({ connectionString: withDatabase(baseUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [testDbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
    await admin.query(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end();
  }
  const r = spawnSync(process.execPath, [path.join(backendRoot, 'scripts/migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: testDbUrl },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`migrations failed:\n${r.stdout}\n${r.stderr}`);
}

/**
 * Start the app against the test database. Must be called before any
 * module that imports src/config/env.js is loaded, hence the dynamic import.
 */
export async function startApp() {
  process.env.DATABASE_URL = testDbUrl;
  process.env.NODE_ENV = 'test';
  process.env.PORT = process.env.PORT || '0';
  process.env.AUTH_PROVIDER = 'stub';
  process.env.PAYSTACK_MODE = 'stub';
  process.env.MAIL_PROVIDER = 'mock';
  process.env.PUSH_PROVIDER = 'mock';
  process.env.SCREENSHOT_STORAGE = 'local';
  process.env.STUB_JWT_SECRET = process.env.STUB_JWT_SECRET || 'test-secret-test-secret-test-secret';
  process.env.HOST_COMMISSION_PERCENT = process.env.HOST_COMMISSION_PERCENT || '50';
  process.env.HOST_CUT_MAX_PERCENT = process.env.HOST_CUT_MAX_PERCENT || '20';
  process.env.HOST_MIN_ENTRY_PESEWAS = process.env.HOST_MIN_ENTRY_PESEWAS || '500';

  const { createApp } = await import('../src/app.js');
  const { pool } = await import('../src/db/pool.js');
  const matches = await import('../src/services/matches.js');
  const payment = await import('../src/services/payment.js');
  const bracket = await import('../src/services/bracket.js');
  const prize = await import('../src/utils/prize.js');

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const api = async (method, urlPath, { token, body } = {}) => {
    const res = await fetch(origin + urlPath, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json };
  };

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  };

  return { api, pool, close, origin, services: { ...matches, ...payment, ...bracket, ...prize } };
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

let phoneCounter = 0;

/** Sign in (creating the user), set username + MoMo number so they can join. */
export async function makePlayer(api, pool, name, { admin = false } = {}) {
  const email = `${name}@test.gh`;
  const signin = await api('POST', '/api/dev/auth/signin', { body: { email } });
  if (!signin.success) throw new Error(`signin failed: ${signin.message}`);
  const token = signin.data.token;
  const id = signin.data.user.id;
  if (admin) await pool.query(`UPDATE public.users SET role = 'admin' WHERE id = $1`, [id]);
  const patched = await api('PATCH', '/api/me', { token, body: { username: `p_${name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(0, 20) } });
  if (!patched.success) throw new Error(`username failed: ${patched.message}`);
  phoneCounter += 1;
  const phone = `024${String(1000000 + phoneCounter).slice(-7)}`;
  const momo = await api('PUT', '/api/me/momo', { token, body: { phone } });
  if (!momo.success) throw new Error(`momo failed: ${momo.message}`);
  return { id, token, email, name };
}

export function futureDates({ closesInHours = 2, startsInHours = 4 } = {}) {
  const now = Date.now();
  return {
    closes_at: new Date(now + closesInHours * 3600_000).toISOString(),
    starts_at: new Date(now + startsInHours * 3600_000).toISOString(),
  };
}

export async function createOfficialCup(api, admin, overrides = {}) {
  const res = await api('POST', '/api/tournaments', {
    token: admin.token,
    body: {
      title: 'Test cup',
      game: 'efootball',
      entry_fee_pesewas: 2000,
      max_players: 4,
      result_window_minutes: 30,
      ...futureDates(),
      ...overrides,
    },
  });
  if (!res.success) throw new Error(`create tournament failed: ${res.status} ${res.message}`);
  return res.data.tournament;
}

/** Join + settle the charge. Returns the registration/charge payload. */
export async function joinAndPay(api, player, tournamentId, { pay = true, gameUid } = {}) {
  const join = await api('POST', `/api/tournaments/${tournamentId}/join`, {
    token: player.token,
    body: { game_uid: gameUid ?? `uid_${player.name}` },
  });
  if (!join.success) throw new Error(`join failed for ${player.name}: ${join.status} ${join.message}`);
  if (pay) {
    const settle = await api('POST', '/api/dev/paystack/simulate-charge', { body: { reference: join.data.charge.reference } });
    if (!settle.success) throw new Error(`charge failed for ${player.name}: ${settle.message}`);
  }
  return join.data;
}

export async function fillCup(api, pool, tournament, players) {
  for (const p of players) await joinAndPay(api, p, tournament.id);
  const { rows: [t] } = await pool.query('SELECT status FROM public.tournaments WHERE id = $1', [tournament.id]);
  if (t.status !== 'full') throw new Error(`expected 'full' after ${players.length} payments, got '${t.status}'`);
}

/**
 * Move the tournament start into the past and let the 24h scheduling window
 * of every open match lapse, then run activation (the "nobody agreed" path).
 */
export async function kickOff(pool, services, tournamentId) {
  await pool.query(`UPDATE public.tournaments SET closes_at = now() - interval '2 minutes', starts_at = now() - interval '1 minute' WHERE id = $1`, [tournamentId]);
  await lapseWindows(pool, tournamentId);
  await services.activateDueMatches();
}

/** Pretend the scheduling window of every pending, fully-seated match has passed. */
export async function lapseWindows(pool, tournamentId) {
  await pool.query(
    `UPDATE public.matches SET round_opens_at = now() - interval '25 hours'
      WHERE tournament_id = $1 AND status = 'pending' AND player1_id IS NOT NULL AND player2_id IS NOT NULL`,
    [tournamentId],
  );
}

export async function activeMatches(pool, tournamentId, round) {
  const { rows } = await pool.query(
    `SELECT * FROM public.matches WHERE tournament_id = $1 AND match_round = $2 ORDER BY match_number`,
    [tournamentId, round],
  );
  return rows;
}

export const SHOT = (origin, tag) => `${origin}/uploads-dev/${tag}.jpg`;

export async function submit(api, origin, player, matchId, pick, reason) {
  return api('POST', `/api/matches/${matchId}/result`, {
    token: player.token,
    body: { pick, screenshot_url: SHOT(origin, `${player.name}_${matchId.slice(0, 8)}`), ...(reason ? { reason } : {}) },
  });
}

/** Both players agree: `winner` won, the other lost. */
export async function agree(api, origin, byId, match, winnerId) {
  const loserId = match.player1_id === winnerId ? match.player2_id : match.player1_id;
  const a = await submit(api, origin, byId[winnerId], match.id, 'won');
  if (!a.success) throw new Error(`winner submit: ${a.status} ${a.message}`);
  const b = await submit(api, origin, byId[loserId], match.id, 'lost');
  if (!b.success) throw new Error(`loser submit: ${b.status} ${b.message}`);
  return b.data;
}

/** Ledger summary for a tournament, all in pesewas. */
export async function ledger(pool, tournamentId) {
  const { rows: [r] } = await pool.query(
    `SELECT
       coalesce(sum(amount_pesewas) FILTER (WHERE type = 'entry_fee'    AND status = 'success'), 0)::int AS fees_in,
       coalesce(sum(amount_pesewas) FILTER (WHERE type = 'payout'       AND status = 'success'), 0)::int AS prizes_out,
       coalesce(sum(amount_pesewas) FILTER (WHERE type = 'host_share'   AND status = 'success'), 0)::int AS host_out,
       coalesce(sum(amount_pesewas) FILTER (WHERE type = 'platform_fee' AND status = 'success'), 0)::int AS platform_out,
       coalesce(sum(amount_pesewas) FILTER (WHERE type = 'refund'       AND status = 'success'), 0)::int AS refunds_out,
       (count(*) FILTER (WHERE type = 'payout'))::int AS payout_rows,
       (count(*) FILTER (WHERE type = 'platform_fee'))::int AS platform_rows,
       (count(*) FILTER (WHERE type = 'host_share'))::int AS host_rows,
       (count(*) FILTER (WHERE type = 'refund'))::int AS refund_rows
     FROM public.transactions WHERE tournament_id = $1`,
    [tournamentId],
  );
  return { ...r, money_out: r.prizes_out + r.host_out + r.platform_out + r.refunds_out };
}

/** Bypass the 5-minute grace in the invariant check for freshly completed cups. */
export async function ageTournaments(pool) {
  await pool.query(`UPDATE public.tournaments SET updated_at = now() - interval '10 minutes'`);
}
