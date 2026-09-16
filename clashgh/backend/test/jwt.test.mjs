/**
 * Token verification for both Supabase signing modes:
 *   ES256 asymmetric (new projects, verified via JWKS public key)
 *   HS256 shared secret (dev stub and legacy projects)
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@127.0.0.1:1/x';
process.env.PORT = '0';
process.env.AUTH_PROVIDER = 'supabase';
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_JWT_SECRET = 'legacy-secret-legacy-secret-legacy-secret';

let verifyToken; let _setJwksForTests;
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rogue = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const iss = 'https://demo.supabase.co/auth/v1';
const claims = { aud: 'authenticated', role: 'authenticated', email: 'a@b.gh', iss, sub: '11111111-1111-1111-1111-111111111111' };

before(async () => {
  ({ verifyToken, _setJwksForTests } = await import('../src/middleware/auth.js'));
  _setJwksForTests(new Map([['key-1', publicKey]]));
});

test('ES256 token signed by the project key verifies', async () => {
  const token = jwt.sign(claims, privateKey, { algorithm: 'ES256', keyid: 'key-1', expiresIn: '1h' });
  const p = await verifyToken(token);
  assert.equal(p.sub, claims.sub);
});

test('ES256 token from another key is rejected', async () => {
  const token = jwt.sign(claims, rogue.privateKey, { algorithm: 'ES256', keyid: 'key-1', expiresIn: '1h' });
  await assert.rejects(() => verifyToken(token));
});

test('HS256 legacy token still verifies with the shared secret', async () => {
  const token = jwt.sign(claims, process.env.SUPABASE_JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const p = await verifyToken(token);
  assert.equal(p.email, 'a@b.gh');
});

test('wrong issuer or audience is rejected', async () => {
  const bad = jwt.sign({ ...claims, iss: 'https://evil.example/auth/v1' }, privateKey, { algorithm: 'ES256', keyid: 'key-1', expiresIn: '1h' });
  await assert.rejects(() => verifyToken(bad));
  const none = jwt.sign({ ...claims, alg: 'none' }, '', { algorithm: 'none' });
  await assert.rejects(() => verifyToken(none));
});
