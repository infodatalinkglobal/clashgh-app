/**
 * Player scheduling: propose / counter / accept / silence / reschedule /
 * window lapse, and contact-number visibility. Runs on the same throwaway
 * database as the money suite.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDatabase, startApp, makePlayer, createOfficialCup, fillCup, activeMatches, agree,
} from './helpers.mjs';

let app; let api; let pool; let origin; let svc; let admin;
let seq = 0;
const players = async (n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(await makePlayer(api, pool, `s${seq++}`));
  return out;
};
const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p]));
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();

async function openCup() {
  const ps = await players(4);
  const t = await createOfficialCup(api, admin, { title: `Sched ${seq}`, max_players: 4 });
  await fillCup(api, pool, t, ps);
  // Kick-off reached: round-1 windows open now.
  await pool.query(`UPDATE public.tournaments SET closes_at = now() - interval '2 minutes', starts_at = now() - interval '1 minute' WHERE id = $1`, [t.id]);
  await pool.query(`UPDATE public.matches SET round_opens_at = now() - interval '1 minute' WHERE tournament_id = $1 AND match_round = 1`, [t.id]);
  await svc.activateDueMatches();
  const r1 = await activeMatches(pool, t.id, 1);
  return { t, ps, ids: byId(ps), r1 };
}
const sched = (p, matchId, body) => api('POST', `/api/matches/${matchId}/schedule`, { token: p.token, body });
const view = (p, matchId) => api('GET', `/api/matches/${matchId}`, { token: p?.token });

before(async () => {
  await resetDatabase();
  app = await startApp();
  ({ api, pool, origin } = app);
  svc = app.services;
  admin = await makePlayer(api, pool, 'admin', { admin: true });
});
after(async () => app.close());

test('round 1 matches stay pending at kick-off until a time is agreed or the window lapses', async () => {
  const { r1 } = await openCup();
  assert.ok(r1.every((m) => m.status === 'pending'), 'no room codes yet');
  assert.ok(r1.every((m) => m.round_opens_at), 'window is open');
});

test('propose, counter, accept: match activates at the agreed time and not before', async () => {
  const { ids, r1: [m] } = await openCup();
  const a = ids[m.player1_id]; const b = ids[m.player2_id];

  const tooSoon = await sched(a, m.id, { action: 'propose', at: inMin(5) });
  assert.equal(tooSoon.status, 400);
  const tooLate = await sched(a, m.id, { action: 'propose', at: inMin(25 * 60) });
  assert.equal(tooLate.status, 400);
  const nothing = await sched(b, m.id, { action: 'accept' });
  assert.equal(nothing.status, 409);

  const p1 = await sched(a, m.id, { action: 'propose', at: inMin(120) });
  assert.ok(p1.success, p1.message);
  assert.equal(p1.data.proposed_by, a.id);
  const own = await sched(a, m.id, { action: 'accept' });
  assert.equal(own.status, 409, 'cannot accept your own proposal');

  const counter = await sched(b, m.id, { action: 'propose', at: inMin(180) });
  assert.ok(counter.success);
  assert.equal(counter.data.proposed_by, b.id);
  const acc = await sched(a, m.id, { action: 'accept' });
  assert.ok(acc.success, acc.message);
  assert.equal(acc.data.proposed_at, null);
  assert.ok(acc.data.scheduled_at);
  assert.equal(acc.data.reschedules_left, 1);

  await svc.activateDueMatches();
  let { rows: [row] } = await pool.query('SELECT status FROM public.matches WHERE id = $1', [m.id]);
  assert.equal(row.status, 'pending', 'not before the agreed time');
  await pool.query(`UPDATE public.matches SET scheduled_at = now() - interval '1 second' WHERE id = $1`, [m.id]);
  await svc.activateDueMatches();
  ({ rows: [row] } = await pool.query('SELECT status, room_code FROM public.matches WHERE id = $1', [m.id]));
  assert.equal(row.status, 'active');
  assert.ok(row.room_code);
  const late = await sched(b, m.id, { action: 'propose', at: inMin(60) });
  assert.equal(late.status, 409, 'no scheduling once started');
});

test('silence: an unanswered proposal stands and activates the match at that time', async () => {
  const { ids, r1: [m] } = await openCup();
  const a = ids[m.player1_id];
  const p = await sched(a, m.id, { action: 'propose', at: inMin(90) });
  assert.ok(p.success);
  await svc.activateDueMatches();
  let { rows: [row] } = await pool.query('SELECT status FROM public.matches WHERE id = $1', [m.id]);
  assert.equal(row.status, 'pending');
  await pool.query(`UPDATE public.matches SET proposed_at = now() - interval '1 second' WHERE id = $1`, [m.id]);
  await svc.activateDueMatches();
  ({ rows: [row] } = await pool.query('SELECT status FROM public.matches WHERE id = $1', [m.id]));
  assert.equal(row.status, 'active');
});

test('nobody proposes: the match activates when the 24h window closes', async () => {
  const { r1: [m] } = await openCup();
  await pool.query(`UPDATE public.matches SET round_opens_at = now() - interval '23 hours 59 minutes' WHERE id = $1`, [m.id]);
  await svc.activateDueMatches();
  let { rows: [row] } = await pool.query('SELECT status FROM public.matches WHERE id = $1', [m.id]);
  assert.equal(row.status, 'pending');
  await pool.query(`UPDATE public.matches SET round_opens_at = now() - interval '24 hours 1 minute' WHERE id = $1`, [m.id]);
  await svc.activateDueMatches();
  ({ rows: [row] } = await pool.query('SELECT status FROM public.matches WHERE id = $1', [m.id]));
  assert.equal(row.status, 'active');
});

test('one reschedule per match, then the agreed time stands', async () => {
  const { ids, r1: [m] } = await openCup();
  const a = ids[m.player1_id]; const b = ids[m.player2_id];
  await sched(a, m.id, { action: 'propose', at: inMin(60) });
  await sched(b, m.id, { action: 'accept' });
  const move = await sched(b, m.id, { action: 'propose', at: inMin(240) });
  assert.ok(move.success, 'either player may ask to move once');
  const v = await view(a, m.id);
  assert.ok(v.data.schedule.scheduled_at, 'agreed time is kept while the move is pending');
  assert.ok(v.data.schedule.proposed_at);
  const ok = await sched(a, m.id, { action: 'accept' });
  assert.ok(ok.success);
  assert.equal(ok.data.reschedules_left, 0);
  const again = await sched(a, m.id, { action: 'propose', at: inMin(300) });
  assert.equal(again.status, 409, 'second reschedule refused');
});

test('later rounds: the next match window opens when both players are known', async () => {
  const { ids, t, r1 } = await openCup();
  for (const m of r1) {
    await pool.query(`UPDATE public.matches SET round_opens_at = now() - interval '25 hours' WHERE id = $1`, [m.id]);
  }
  await svc.activateDueMatches();
  const [m1, m2] = await activeMatches(pool, t.id, 1);
  await agree(api, origin, ids, m1, m1.player1_id);
  let [final] = await activeMatches(pool, t.id, 2);
  assert.equal(final.round_opens_at, null, 'not open with one player');
  await agree(api, origin, ids, m2, m2.player1_id);
  [final] = await activeMatches(pool, t.id, 2);
  assert.ok(final.round_opens_at, 'opens as soon as the second finalist is known');
  assert.equal(final.status, 'pending');
  const { rows: n } = await pool.query(`SELECT count(DISTINCT user_id)::int c FROM public.notifications WHERE template = 'schedule_open' AND payload->>'match_id' = $1`, [final.id]);
  assert.equal(n[0].c, 2, 'both finalists are told to schedule');
});

test('contact number is shown only to the current opponent while the match is open', async () => {
  const { ids, r1: [m] } = await openCup();
  const a = ids[m.player1_id]; const b = ids[m.player2_id];
  const bad = await api('PATCH', '/api/me', { token: a.token, body: { contact_phone: '12345' } });
  assert.equal(bad.status, 400);
  const set = await api('PATCH', '/api/me', { token: a.token, body: { contact_phone: '0551234567' } });
  assert.ok(set.success, set.message);
  assert.equal(set.data.contact_phone, '+233551234567');

  const asB = await view(b, m.id);
  assert.equal(asB.data.player1.contact_phone, '+233551234567', 'opponent sees it');
  const asA = await view(a, m.id);
  assert.equal(asA.data.player1.contact_phone, null, 'never echoed back to yourself');
  const anon = await view(null, m.id);
  assert.equal(anon.data.player1.contact_phone, null, 'public view hides it');
  const [stranger] = await players(1);
  const asStranger = await view(stranger, m.id);
  assert.equal(asStranger.data.player1.contact_phone, null, 'non-participants never see it');

  const clear = await api('PATCH', '/api/me', { token: a.token, body: { contact_phone: null } });
  assert.ok(clear.success);
  assert.equal((await view(b, m.id)).data.player1.contact_phone, null);
});
