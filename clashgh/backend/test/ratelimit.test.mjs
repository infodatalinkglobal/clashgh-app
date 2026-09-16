import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { perIp, perUser, resetRateLimits } from '../src/middleware/rateLimit.js';

async function withApp(mw, fn) {
  const app = express();
  app.use((req, _res, next) => { req.user = req.headers['x-user'] ? { id: req.headers['x-user'] } : undefined; next(); });
  app.post('/x', mw, (_req, res) => res.json({ success: true }));
  const server = app.listen(0);
  const port = server.address().port;
  try { await fn((headers = {}) => fetch(`http://127.0.0.1:${port}/x`, { method: 'POST', headers })); }
  finally { server.close(); resetRateLimits(); }
}

test('perIp: blocks the (max+1)th request with 429, Retry-After and the envelope', async () => {
  await withApp(perIp({ windowMs: 60_000, max: 3, name: 't' }), async (hit) => {
    for (let i = 0; i < 3; i++) assert.equal((await hit()).status, 200);
    const r = await hit();
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.equal(r.headers.get('ratelimit-remaining'), '0');
    const body = await r.json();
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.match(body.message, /Too many requests/);
  });
});

test('perUser: counters are separate per user', async () => {
  await withApp(perUser({ windowMs: 60_000, max: 2, name: 'u' }), async (hit) => {
    assert.equal((await hit({ 'x-user': 'a' })).status, 200);
    assert.equal((await hit({ 'x-user': 'a' })).status, 200);
    assert.equal((await hit({ 'x-user': 'a' })).status, 429);
    assert.equal((await hit({ 'x-user': 'b' })).status, 200);
  });
});
