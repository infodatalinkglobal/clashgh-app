/**
 * Live Paystack code path against an in-process mock of Paystack's REST API.
 *
 * Verifies the exact request shapes the real integration sends:
 *   POST /transaction/initialize   channels ['mobile_money'], GHS, reference, callback_url
 *   POST /transferrecipient        type mobile_money, local 0XXXXXXXXX number, telco code, GHS
 *   POST /transfer                 source balance, recipient_code, reference [a-z0-9_-]{16,50}
 * and the webhook handler (HMAC-SHA-512 of the raw body, idempotent by event id).
 *
 * Runs on its own process because PAYSTACK_MODE is read once at boot.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { resetDatabase, testDbUrl } from './helpers.mjs';

const WEBHOOK_SECRET = 'whsec_test_0123456789';
const calls = [];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
    const ok = (data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: true, message: 'ok', data })); };
    if (req.url === '/transaction/initialize') return ok({ authorization_url: 'https://checkout.paystack.com/abc', access_code: 'abc', reference: body.reference });
    if (req.url === '/transferrecipient') return ok({ recipient_code: 'RCP_test123', type: body.type });
    if (req.url === '/transfer') return ok({ transfer_code: 'TRF_test456', status: 'pending', reference: body.reference });
    res.writeHead(404); res.end('{}');
  });
});

let api; let origin; let pool; let services; let close;

before(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  await resetDatabase();
  process.env.DATABASE_URL = testDbUrl;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.AUTH_PROVIDER = 'stub';
  process.env.STUB_JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.PAYSTACK_MODE = 'live';
  process.env.PAYSTACK_API_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
  process.env.PAYSTACK_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.MAIL_PROVIDER = 'mock';
  process.env.PUSH_PROVIDER = 'mock';
  process.env.SCREENSHOT_STORAGE = 'local';
  process.env.SITE_ORIGIN = 'https://clashgh.test';
  process.env.RATE_LIMIT_DISABLED = '1';

  const { createApp } = await import('../src/app.js');
  ({ pool } = await import('../src/db/pool.js'));
  services = await import('../src/services/payment.js');
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
  api = async (method, urlPath, { token, body, headers, rawBody } = {}) => {
    const res = await fetch(origin + urlPath, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  };
  close = async () => { await new Promise((r) => server.close(r)); await pool.end(); await new Promise((r) => mock.close(r)); };
});
after(async () => { await close?.(); });

async function player(name, { admin = false } = {}) {
  const s = await api('POST', '/api/dev/auth/signin', { body: { email: `${name}@live.gh` } });
  const token = s.data.token; const id = s.data.user.id;
  if (admin) await pool.query(`UPDATE public.users SET role = 'admin' WHERE id = $1`, [id]);
  await api('PATCH', '/api/me', { token, body: { username: `l_${name}` } });
  // Live mode resolves the MoMo name through Paystack; write the number directly so the test stays about payments.
  await pool.query(`UPDATE public.users SET phone = $2, momo_provider = 'mtn', phone_verified = true WHERE id = $1`, [id, `+23324${String(4000000 + Math.floor(Math.random() * 1e6)).slice(-7)}`]);
  return { id, token };
}

const sign = (raw) => crypto.createHmac('sha512', WEBHOOK_SECRET).update(raw).digest('base64');

test('join initialises a Paystack Mobile Money checkout with our reference and a callback back to the tournament', async () => {
  const admin = await player('admin', { admin: true });
  const kofi = await player('kofi');
  const now = Date.now();
  const cup = (await api('POST', '/api/tournaments', { token: admin.token, body: {
    title: 'Live cup', game: 'efootball', entry_fee_pesewas: 2000, max_players: 4, result_window_minutes: 30,
    closes_at: new Date(now + 2 * 3600e3).toISOString(), starts_at: new Date(now + 4 * 3600e3).toISOString(),
  } })).data.tournament;

  const join = await api('POST', `/api/tournaments/${cup.id}/join`, { token: kofi.token, body: { game_uid: 'kofi_1' } });
  assert.equal(join.success, true, join.message);
  assert.equal(join.data.charge.authorization_url, 'https://checkout.paystack.com/abc');

  const init = calls.find((c) => c.url === '/transaction/initialize');
  assert.ok(init, 'POST /transaction/initialize was called');
  assert.equal(init.auth, 'Bearer sk_test_fake');
  assert.equal(init.body.amount, 2000);
  assert.equal(init.body.currency, 'GHS');
  assert.deepEqual(init.body.channels, ['mobile_money']);
  assert.match(init.body.reference, /^CHRG_/);
  assert.equal(init.body.callback_url, `https://clashgh.test/app/tournament/${cup.id}`);
  assert.equal(init.body.email, 'kofi@live.gh');

  // Webhook: wrong signature rejected, right signature settles, replay ignored.
  const evt = JSON.stringify({ event: 'charge.success', id: 'evt_1', data: { reference: init.body.reference, amount: 2000 } });
  const bad = await api('POST', '/api/paystack/webhook', { rawBody: evt, headers: { 'x-paystack-signature': 'nope' } });
  assert.equal(bad.status, 401);
  const good = await api('POST', '/api/paystack/webhook', { rawBody: evt, headers: { 'x-paystack-signature': sign(evt) } });
  assert.equal(good.status, 200, good.message);
  const again = await api('POST', '/api/paystack/webhook', { rawBody: evt, headers: { 'x-paystack-signature': sign(evt) } });
  assert.equal(again.status, 200);

  const { rows: [reg] } = await pool.query('SELECT payment_status FROM public.registrations WHERE tournament_id = $1 AND user_id = $2', [cup.id, kofi.id]);
  assert.equal(reg.payment_status, 'paid');
  const { rows: fees } = await pool.query(`SELECT count(*)::int AS n FROM public.transactions WHERE tournament_id = $1 AND type = 'entry_fee' AND status = 'success'`, [cup.id]);
  assert.equal(fees[0].n, 1, 'replayed webhook did not double count');
});

test('a payout creates a Ghana MoMo recipient and a transfer with a valid reference', async () => {
  const ama = await player('ama');
  const { rows: [tx] } = await pool.query(
    `INSERT INTO public.transactions (user_id, type, direction, amount_pesewas, status, description)
     VALUES ($1, 'payout', 'out', 1500, 'pending', 'test prize') RETURNING *`, [ama.id]);
  const result = await services.initiateTransferForTx(tx);
  assert.equal(result.transfer_code, 'TRF_test456');

  const rcp = calls.find((c) => c.url === '/transferrecipient');
  assert.ok(rcp, 'POST /transferrecipient was called');
  assert.equal(rcp.body.type, 'mobile_money');
  assert.equal(rcp.body.bank_code, 'MTN');
  assert.equal(rcp.body.currency, 'GHS');
  assert.match(rcp.body.account_number, /^0\d{9}$/, 'local Ghana number format');

  const trf = calls.find((c) => c.url === '/transfer');
  assert.ok(trf, 'POST /transfer was called');
  assert.equal(trf.body.source, 'balance');
  assert.equal(trf.body.recipient, 'RCP_test123');
  assert.equal(trf.body.amount, 1500);
  assert.equal(trf.body.currency, 'GHS');
  assert.match(trf.body.reference, /^[a-z0-9_-]{16,50}$/, 'Paystack transfer reference rules');

  const { rows: [saved] } = await pool.query('SELECT paystack_transfer_code FROM public.transactions WHERE id = $1', [tx.id]);
  assert.equal(saved.paystack_transfer_code, 'TRF_test456');

  const evt = JSON.stringify({ event: 'transfer.success', id: 'evt_2', data: { transfer_code: 'TRF_test456' } });
  const r = await api('POST', '/api/paystack/webhook', { rawBody: evt, headers: { 'x-paystack-signature': sign(evt) } });
  assert.equal(r.status, 200);
  const { rows: [done] } = await pool.query('SELECT status FROM public.transactions WHERE id = $1', [tx.id]);
  assert.equal(done.status, 'success');
});
