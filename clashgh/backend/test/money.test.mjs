/**
 * Money-path suite: proves that every pesewa collected is accounted for.
 *
 *   npm test          (needs DATABASE_URL pointing at a local Postgres server;
 *                      uses a separate database `clashgh_test`, never dev data)
 *
 * Every scenario runs through the real HTTP API with stub Paystack, then
 * checks the ledger and the same money-invariant checker the hourly
 * sweeper runs in production.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDatabase, startApp, makePlayer, createOfficialCup, joinAndPay, fillCup,
  kickOff, lapseWindows, activeMatches, agree, submit, ledger, ageTournaments,
} from './helpers.mjs';

let app; let api; let pool; let origin; let svc;
let admin;
let seq = 0;
const players = async (n, prefix) => {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(await makePlayer(api, pool, `${prefix}${seq++}`));
  return out;
};
const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p]));

/** Play a whole bracket with agreed results; the first player in each match wins. */
async function playThrough(tournamentId, ids, { pickWinner = (m) => m.player1_id } = {}) {
  const rounds = Math.round(Math.log2(Object.keys(ids).length));
  for (let r = 1; r <= rounds; r += 1) {
    const ms = await activeMatches(pool, tournamentId, r);
    assert.equal(ms.length, 2 ** (rounds - r), `round ${r} match count`);
    for (const m of ms) {
      assert.equal(m.status, 'active', `round ${r} match ${m.match_number} should be active`);
      await agree(api, origin, ids, m, pickWinner(m));
    }
    if (r < rounds) { await lapseWindows(pool, tournamentId); await svc.activateDueMatches(); }
  }
  await svc.progressTournaments();
}

async function expectBalanced(tournamentId, { host = false } = {}) {
  const l = await ledger(pool, tournamentId);
  const { rows: [t] } = await pool.query('SELECT * FROM public.tournaments WHERE id = $1', [tournamentId]);
  assert.equal(t.status, 'completed');
  assert.equal(l.payout_rows, 2, 'exactly two prize rows');
  assert.equal(l.platform_rows, 1, 'exactly one platform fee row');
  assert.equal(l.host_rows, host ? 1 : 0, 'host share rows');
  assert.equal(l.fees_in, t.entry_fee_pesewas * t.max_players, 'fees in = fee x players');
  assert.equal(l.fees_in, l.money_out, `fees in ${l.fees_in} must equal money out ${l.money_out}`);
  const split = svc.computeSplit(l.fees_in, t.first_place_percent, t.runnerup_percent, host ? Number(process.env.HOST_COMMISSION_PERCENT) : null);
  assert.equal(l.prizes_out, split.first + split.runnerup);
  assert.equal(l.host_out, split.host);
  assert.equal(l.platform_out, split.platform);
  return { l, t, split };
}

before(async () => {
  await resetDatabase();
  app = await startApp();
  ({ api, pool, origin } = app);
  svc = app.services;
  admin = await makePlayer(api, pool, 'admin', { admin: true });
});

after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------

test('computeSplit never loses or invents a pesewa', () => {
  for (const total of [400, 500, 999, 1000, 1234, 2000, 6400, 51199, 320000]) {
    for (const [f, r] of [[70, 20], [60, 30], [50, 30], [64, 16], [70, 10], [99, 1]]) {
      const a = svc.computeSplit(total, f, r);
      assert.equal(a.first + a.runnerup + a.platform + a.host, total);
      assert.equal(a.host, 0);
      const b = svc.computeSplit(total, f, r, 50);
      assert.equal(b.first + b.runnerup + b.platform + b.host, total);
      assert.ok(b.host <= b.platform, 'platform absorbs rounding, never the host');
    }
  }
});

test('4-player official cup: fees in equal prizes plus platform fee', async () => {
  const ps = await players(4, 'a');
  const t = await createOfficialCup(api, admin, { title: 'Four official', entry_fee_pesewas: 2000, max_players: 4 });
  await fillCup(api, pool, t, ps);
  await kickOff(pool, svc, t.id);
  await playThrough(t.id, byId(ps));
  const { split } = await expectBalanced(t.id);
  assert.deepEqual([split.first, split.runnerup, split.platform], [5600, 1600, 800]);
});

test('8-player official cup with an awkward fee: rounding lands on the platform', async () => {
  const ps = await players(8, 'b');
  const t = await createOfficialCup(api, admin, { title: 'Eight official', entry_fee_pesewas: 1333, max_players: 8, first_place_percent: 65, runnerup_percent: 25 });
  await fillCup(api, pool, t, ps);
  await kickOff(pool, svc, t.id);
  await playThrough(t.id, byId(ps));
  const { l } = await expectBalanced(t.id);
  assert.equal(l.fees_in, 10664);
});

test('payout is idempotent: running it again creates no extra rows', async () => {
  const ps = await players(4, 'c');
  const t = await createOfficialCup(api, admin, { title: 'Idempotent', max_players: 4 });
  await fillCup(api, pool, t, ps);
  await kickOff(pool, svc, t.id);
  await playThrough(t.id, byId(ps));
  const before = await ledger(pool, t.id);
  const again = await svc.executePayout(t.id);
  assert.equal(again.payout, 'already_initiated');
  const viaApi = await api('POST', `/api/admin/tournaments/${t.id}/payout`, { token: admin.token });
  assert.equal(viaApi.data.payout, 'already_initiated');
  await svc.progressTournaments();
  assert.deepEqual(await ledger(pool, t.id), before);
});

test('hosted cup: host gets 50% of the cut, platform the rest, players 80%+', async () => {
  const host = await makePlayer(api, pool, 'hostess');
  const apply = await api('POST', '/api/me/host/apply', { token: host.token, body: { note: 'Weekly eFootball nights in Osu' } });
  assert.equal(apply.status, 201);
  const approve = await api('POST', `/api/admin/hosts/${host.id}/approve`, { token: admin.token });
  assert.ok(approve.success, approve.message);

  const tooGreedy = await api('POST', '/api/host/tournaments', {
    token: host.token,
    body: { title: 'Greedy', game: 'fc_mobile', entry_fee_pesewas: 2000, max_players: 4, first_place_percent: 50, runnerup_percent: 20, closes_at: new Date(Date.now() + 2 * 3600e3).toISOString(), starts_at: new Date(Date.now() + 4 * 3600e3).toISOString() },
  });
  assert.equal(tooGreedy.status, 400, 'a 30% host cut must be rejected');

  const tooCheap = await api('POST', '/api/host/tournaments', {
    token: host.token,
    body: { title: 'Cheap', game: 'fc_mobile', entry_fee_pesewas: 400, max_players: 4, closes_at: new Date(Date.now() + 2 * 3600e3).toISOString(), starts_at: new Date(Date.now() + 4 * 3600e3).toISOString() },
  });
  assert.equal(tooCheap.status, 400, 'entry below the hosted minimum must be rejected');

  const created = await api('POST', '/api/host/tournaments', {
    token: host.token,
    body: { title: 'Osu night', game: 'fc_mobile', entry_fee_pesewas: 2000, max_players: 4, first_place_percent: 60, runnerup_percent: 20, closes_at: new Date(Date.now() + 2 * 3600e3).toISOString(), starts_at: new Date(Date.now() + 4 * 3600e3).toISOString() },
  });
  assert.equal(created.status, 201, created.message);
  const t = created.data.tournament;

  const ps = await players(4, 'h');
  await fillCup(api, pool, t, ps);
  await kickOff(pool, svc, t.id);
  await playThrough(t.id, byId(ps));
  const { l } = await expectBalanced(t.id, { host: true });
  // 8000 total: 4800 + 1600 prizes, 1600 remainder -> 800 host, 800 platform
  assert.equal(l.prizes_out, 6400);
  assert.equal(l.host_out, 800);
  assert.equal(l.platform_out, 800);
  const { rows: [hs] } = await pool.query(`SELECT user_id FROM public.transactions WHERE tournament_id = $1 AND type = 'host_share'`, [t.id]);
  assert.equal(hs.user_id, host.id, 'host share is booked to the host');
  const { rows: [pf] } = await pool.query(`SELECT user_id FROM public.transactions WHERE tournament_id = $1 AND type = 'platform_fee'`, [t.id]);
  assert.notEqual(pf.user_id, host.id, 'platform fee is never booked to the host');
});

test('cancel before start refunds every paid player exactly once', async () => {
  const ps = await players(4, 'd');
  const t = await createOfficialCup(api, admin, { title: 'Cancelled', max_players: 8, entry_fee_pesewas: 1500 });
  for (const p of ps.slice(0, 3)) await joinAndPay(api, p, t.id);
  await joinAndPay(api, ps[3], t.id, { pay: false }); // pending, never paid
  const cancel = await api('POST', `/api/tournaments/${t.id}/cancel`, { token: admin.token, body: { reason: 'test' } });
  assert.ok(cancel.success, cancel.message);
  const l = await ledger(pool, t.id);
  assert.equal(l.fees_in, 4500);
  assert.equal(l.refund_rows, 3, 'one refund per paid player, none for the unpaid one');
  assert.equal(l.refunds_out, 4500);
  assert.equal(l.payout_rows + l.platform_rows, 0, 'no prizes or fees on a cancelled cup');
  const { rows } = await pool.query(`SELECT payment_status, count(*)::int n FROM public.registrations WHERE tournament_id = $1 GROUP BY 1 ORDER BY 1`, [t.id]);
  assert.deepEqual(rows, [{ payment_status: 'pending', n: 1 }, { payment_status: 'refunded', n: 3 }]);
  const again = await api('POST', `/api/tournaments/${t.id}/cancel`, { token: admin.token });
  assert.equal(again.status, 409, 'cancelling twice must be refused');
  assert.equal((await ledger(pool, t.id)).refund_rows, 3);
});

test('a charge that lands after the slot expired is refunded, not seated', async () => {
  const [p] = await players(1, 'late');
  const t = await createOfficialCup(api, admin, { title: 'Late payer', max_players: 4 });
  const j = await joinAndPay(api, p, t.id, { pay: false });
  await pool.query(`UPDATE public.registrations SET created_at = now() - interval '30 minutes' WHERE id = $1`, [j.registration.id]);
  const settle = await svc.settleChargeSuccess(j.charge.reference, {
    amount: 2000, metadata: { user_id: p.id, tournament_id: t.id },
  });
  assert.equal(settle.settled, false);
  assert.ok(settle.late_refund, 'late money is refunded');
  const l = await ledger(pool, t.id);
  assert.equal(l.fees_in, 0, 'no entry fee is booked');
  assert.equal(l.refund_rows, 1);
  assert.equal(l.refunds_out, 2000);
  const { rows: [reg] } = await pool.query('SELECT payment_status FROM public.registrations WHERE id = $1', [j.registration.id]);
  assert.equal(reg.payment_status, 'pending', 'the seat was not granted');
});

test('disputed final resolved by award pays out correctly; no-show is settled by deadline', async () => {
  const ps = await players(4, 'e');
  const ids = byId(ps);
  const t = await createOfficialCup(api, admin, { title: 'Disputes', max_players: 4 });
  await fillCup(api, pool, t, ps);
  await kickOff(pool, svc, t.id);

  // Round 1, match 1: only one player submits 'won', the other never shows.
  const [m1, m2] = await activeMatches(pool, t.id, 1);
  const r1 = await submit(api, origin, ids[m1.player1_id], m1.id, 'won');
  assert.ok(r1.success, r1.message);
  // Match 2: agreed.
  await agree(api, origin, ids, m2, m2.player2_id);
  // Deadline passes on match 1.
  await pool.query(`UPDATE public.matches SET deadline_at = now() - interval '1 minute' WHERE id = $1`, [m1.id]);
  const enforced = await svc.enforceDeadlines();
  assert.deepEqual(enforced.map((e) => e.outcome), ['completed']);
  assert.equal(enforced[0].winner_id, m1.player1_id, 'single won pick wins on deadline');

  await lapseWindows(pool, t.id);
  await svc.activateDueMatches();
  const [final] = await activeMatches(pool, t.id, 2);
  assert.equal(final.status, 'active');
  // Both claim the win -> disputed.
  await submit(api, origin, ids[final.player1_id], final.id, 'won');
  const clash = await submit(api, origin, ids[final.player2_id], final.id, 'won');
  assert.equal(clash.data.status, 'disputed');
  // No payout while disputed.
  await svc.progressTournaments();
  assert.equal((await ledger(pool, t.id)).payout_rows, 0, 'nothing is paid while the final is disputed');

  const badWinner = await api('POST', `/api/admin/matches/${final.id}/resolve`, { token: admin.token, body: { resolution: 'award', winner_id: admin.id } });
  assert.equal(badWinner.status, 400);
  const award = await api('POST', `/api/admin/matches/${final.id}/resolve`, { token: admin.token, body: { resolution: 'award', winner_id: final.player2_id } });
  assert.ok(award.success, award.message);
  await svc.progressTournaments();
  await expectBalanced(t.id);
  const { rows: [champ] } = await pool.query(`SELECT user_id FROM public.transactions WHERE tournament_id = $1 AND type = 'payout' ORDER BY amount_pesewas DESC LIMIT 1`, [t.id]);
  assert.equal(champ.user_id, final.player2_id, 'the awarded player receives the champion prize');
});

test('dispute resolved by refund cancels a started cup and returns every fee', async () => {
  const ps = await players(4, 'f');
  const ids = byId(ps);
  const t = await createOfficialCup(api, admin, { title: 'Refund mid-cup', max_players: 4, entry_fee_pesewas: 2500 });
  await fillCup(api, pool, t, ps);
  await kickOff(pool, svc, t.id);
  const [m1] = await activeMatches(pool, t.id, 1);
  const d = await submit(api, origin, ids[m1.player1_id], m1.id, 'dispute', 'Opponent used a modded client');
  assert.equal(d.data.status, 'disputed');
  const refund = await api('POST', `/api/admin/matches/${m1.id}/resolve`, { token: admin.token, body: { resolution: 'refund' } });
  assert.ok(refund.success, refund.message);
  const l = await ledger(pool, t.id);
  assert.equal(l.fees_in, 10000);
  assert.equal(l.refund_rows, 4);
  assert.equal(l.refunds_out, 10000);
  assert.equal(l.payout_rows + l.platform_rows + l.host_rows, 0);
  const { rows: [row] } = await pool.query('SELECT status FROM public.tournaments WHERE id = $1', [t.id]);
  assert.equal(row.status, 'cancelled');
});

test('double payment on one registration books a single entry fee', async () => {
  const [p] = await players(1, 'dup');
  const t = await createOfficialCup(api, admin, { title: 'Double webhook', max_players: 4 });
  const j = await joinAndPay(api, p, t.id);
  const second = await api('POST', '/api/dev/paystack/simulate-charge', { body: { reference: j.charge.reference } });
  assert.equal(second.success, false, 'a replayed charge must not settle twice');
  const { rows: [c] } = await pool.query(`SELECT count(*)::int n FROM public.transactions WHERE tournament_id = $1 AND type = 'entry_fee'`, [t.id]);
  assert.equal(c.n, 1);
  const rejoin = await api('POST', `/api/tournaments/${t.id}/join`, { token: p.token, body: { game_uid: 'x' } });
  assert.equal(rejoin.status, 409, 'a paid player cannot take a second seat');
});

test('the production invariant checker sees no violations across every scenario', async () => {
  await ageTournaments(pool);
  const { violations } = await svc.runMoneyInvariantCheck();
  assert.deepEqual(violations, []);
});
