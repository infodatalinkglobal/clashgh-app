#!/usr/bin/env node
/**
 * Apply SQL migrations (and optionally seeds) to DATABASE_URL.
 *   node scripts/migrate.mjs            # migrations only
 *   node scripts/migrate.mjs --seed     # + seeds/*.sql (dev data)
 *   node scripts/migrate.mjs --check    # print which are applied, change nothing
 *
 * Tracks applied files in public.schema_migrations. Every migration file is
 * idempotent anyway, so re-running is safe. 002 targets Supabase's `auth`
 * schema and is skipped automatically when that schema does not exist
 * (local Postgres / Docker).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = new Set(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set (see .env.example)'); process.exit(1); }

const ssl = /supabase\.co|render\.com|neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined;
const client = new pg.Client({ connectionString: url, ssl });
await client.connect();

const files = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];

try {
  // Migrations record themselves in public.schema_migrations(version, name)
  // (created by 001). Version = the numeric prefix of the file name.
  const { rows: [{ has_table }] } = await client.query(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS has_table`);
  const done = new Set(has_table ? (await client.query('SELECT version FROM public.schema_migrations')).rows.map((r) => r.version) : []);
  const { rows: [{ has_auth }] } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') AS has_auth`);

  for (const f of files(path.join(root, 'migrations'))) {
    const version = Number(f.slice(0, 3));
    const supabaseOnly = /supabase/i.test(f);
    if (supabaseOnly && !has_auth) { console.log(`skip  ${f} (no auth schema — not Supabase)`); continue; }
    if (done.has(version)) { console.log(`ok    ${f}`); continue; }
    if (args.has('--check')) { console.log(`TODO  ${f}`); continue; }
    process.stdout.write(`apply ${f} … `);
    await client.query(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    await client.query(
      `INSERT INTO public.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
      [version, f.slice(4, -4)]);
    console.log('done');
  }

  if (args.has('--seed')) {
    for (const f of files(path.join(root, 'seeds'))) {
      process.stdout.write(`seed  ${f} … `);
      await client.query(fs.readFileSync(path.join(root, 'seeds', f), 'utf8'));
      console.log('done');
    }
  }
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM public.users');
  console.log(`\nDatabase ready — ${n} user(s).`);
} catch (e) {
  console.error('\nMigration failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
