# ClashGH Backend

Modules **1A — Database Schema**, **1B — Auth API**, **1C — Tournament API**, **1D — Bracket Engine**, **1E — Paystack MoMo** and **1F — Match Flow** are built — the full backend is complete. Migrations in `migrations/`, the Express API in `src/` per the structure in `agent.md`.

## Contents

| Path | Purpose |
|---|---|
| `migrations/001_initial_schema.sql` | All 7 business tables + enums + indexes + RLS (Supabase **and** local) |
| `migrations/002_supabase_auth_integration.sql` | Auto-creates a `users` profile on sign-in (**Supabase only** — skip locally) |
| `migrations/003_phone_verifications.sql` | One-time OTP challenge table (hashed OTP, expiry, attempt count) |
| `migrations/004_transactions_retry.sql` | `attempts` + `next_retry_at` on transactions (payout retry backoff) |
| `seeds/001_dev_seed.sql` | Dev data: 1 admin + 8 players, 2 tournaments, a full 8-slot bracket (idempotent) |
| `src/` | Express API (ESM, no TypeScript): config, db pool, middleware (auth / rate-limit / errors), routes (1B auth, 1C tournaments, 1D bracket view, 1E webhook + admin payout, 1F matches + admin dispute resolve), services (Paystack client, payment/escrow, bracket engine, match flow, cancel, notifications outbox + pluggable mail/push), sweepers (pending-TTL reaper, bracket-gen safety sweep, payout retry, match flow + hourly money invariants, notifications dispatcher) |
| `src/routes/adminDashboard.js` | Modules 3B/3C/3F admin API: overview (action queue, lobby health, revenue), tournaments list/detail, dispute queue with dispute-rate priority, players + ban/unban (audited), audit log, analytics with expansion gates |
| `GET /api/me/transactions` (in `src/routes/auth.js`) | Module 2F wallet history: user's ledger rows newest-first (no `platform_fee`), + lifetime totals (fees / winnings / refunds / pending out) |
| `src/routes/uploads.js` + `src/services/screenshots.js` | `POST /api/uploads/screenshot` (auth, base64 JPEG ≤600KB) → public URL. Storage pluggable: `local` (dev, `uploads-dev/`) or `cloudinary` (3D) |
| `test/mock-paystack.js` | Local Paystack test double — integration-tests the LIVE path (charges, transfers, signed webhooks) with zero real keys |

## Apply to Supabase (~5 minutes)

1. Go to [supabase.com](https://supabase.com) → **New project** (any region close to Ghana, e.g. europe-west / us-east).
2. Wait for the project to finish provisioning (~2 min).
3. Open **SQL Editor** → **New query**.
4. Paste the full contents of `migrations/001_initial_schema.sql` → **Run**.
5. Paste the full contents of `migrations/002_supabase_auth_integration.sql` → **Run**.
6. Paste the full contents of `migrations/003_phone_verifications.sql` → **Run**.
7. Verify: in the **Table Editor** you should see `users`, `tournaments`, `registrations`, `matches`, `transactions`, `webhook_events`, `admin_audit_log`, `phone_verifications`, `schema_migrations`.
8. (Optional) Paste `seeds/001_dev_seed.sql` → **Run** — gives you realistic data to build against.
9. **Create your first admin**: sign up through the app (or the Supabase Auth dashboard test sign-in) with your own email, then in the SQL editor:
   ```sql
   UPDATE public.users SET role = 'admin' WHERE email = 'your@email.com';
   ```
10. Copy **Settings → Database → Connection string** (URI) into your `.env` as `DATABASE_URL`.

> Note: Google OAuth sign-in itself is configured in the Supabase dashboard (Auth → Providers → Google) when the project is created — the backend needs no change.

## Local development (no Supabase needed)

PostgreSQL 13+ works (the sandbox-verified version is 17).

```bash
# 1. Create a database
createdb clashgh

# 2. Stub the Supabase auth schema (only needed to test migration 002's trigger)
psql -d clashgh -c "CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320),
  encrypted_password TEXT NOT NULL DEFAULT '',
  raw_app_metadata JSONB NOT NULL DEFAULT '{}',
  aud VARCHAR(16) NOT NULL DEFAULT 'authenticated',
  role VARCHAR(32) NOT NULL DEFAULT 'authenticated',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);"

# 3. Apply migrations in order
psql -d clashgh -v ON_ERROR_STOP=1 -f migrations/001_initial_schema.sql
psql -d clashgh -v ON_ERROR_STOP=1 -f migrations/002_supabase_auth_integration.sql
psql -d clashgh -v ON_ERROR_STOP=1 -f migrations/003_phone_verifications.sql

# 4. Seed dev data
psql -d clashgh -v ON_ERROR_STOP=1 -f seeds/001_dev_seed.sql
```

### Clean re-run (drop everything)

```sql
DROP SCHEMA public CASCADE;
DROP SCHEMA auth CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;
```
then re-apply steps 2–4 above.

## Run the API (Module 1B)

The backend connects to Postgres as its **own service-role user** — the same
pattern as Supabase's `service_role` key, which bypasses RLS. Clients never
hold this credential; every request is authenticated via JWT at the API layer.

```sql
-- one-time: create the service user (run as superuser)
CREATE ROLE clashgh LOGIN PASSWORD 'clashgh';
ALTER ROLE clashgh BYPASSRLS;
GRANT CONNECT ON DATABASE clashgh TO clashgh;
GRANT USAGE ON SCHEMA public TO clashgh;
GRANT ALL ON ALL TABLES IN SCHEMA public TO clashgh;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO clashgh;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO clashgh;
```

> On real Supabase the API connects with the `service_role` key, which already
> bypasses RLS — no extra role needed.

```bash
cp .env.example .env    # fill DATABASE_URL, STUB_JWT_SECRET (dev), etc.
npm install
npm start               # or: npm run dev (auto-restart on change)
```

Auth modes (`AUTH_PROVIDER`):
- **`stub`** (default, dev): `POST /api/dev/auth/signin {"email":"..."}` signs in
  / creates the profile exactly like Supabase's trigger would, and issues a
  Supabase-shaped JWT (HS256, `aud=authenticated`, `iss=<base>/auth/v1`).
  Mounted only when `NODE_ENV != production`.
- **`supabase`** (prod): tokens come from Supabase Auth (Google OAuth / magic
  link); the mobile app sends the JWT in the `Authorization` header. The dev
  sign-in route is not mounted. **No API code changes between the two modes.**

### Testing the LIVE Paystack path without real keys

`test/mock-paystack.js` is a local Paystack double (charge init, MoMo approve/decline screens,
transfer recipients/init, real HMAC-SHA-512-signed webhooks). Run it, then start the API in
live mode pointed at it:

```bash
node test/mock-paystack.js &                                  # mock on :4000
PAYSTACK_MODE=live \
PAYSTACK_API_URL=http://127.0.0.1:4000 \
PAYSTACK_SECRET_KEY=mock-api-secret \
PAYSTACK_WEBHOOK_SECRET=mock-paystack-secret \
npm start
```

Joining a tournament now returns a real `authorization_url` (the mock's phone-approval screen);
hitting it delivers a signed `charge.success` webhook to `/api/paystack/webhook`. Transfers
whose recipient username matches `/fail/i` fail, which drives the payout retry backoff.

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Liveness + auth modes |
| POST | `/api/dev/auth/signin` | — | Dev stub sign-in (stub mode only) |
| POST | `/api/dev/paystack/simulate-charge` | — | Dev stub charge settle (stub mode only — stands in for 1E's verified webhook) |
| GET | `/api/me` | Bearer | Current profile (1B) |
| PATCH | `/api/me` | Bearer | Set username (3–20, `[a-z0-9_]`) (1B) |
| POST | `/api/me/momo/resolve` | Bearer | Validate MoMo number, detect provider, resolve account name (live) (3E) |
| PUT | `/api/me/momo` | Bearer | Set + lock the MoMo number, no OTP (3E) |
| PUT/DELETE | `/api/me/push-token` | Bearer | Register / remove this device's Expo push token (3E) |
| GET | `/api/me/notifications` | Bearer | Recent in-app notifications (3E) |
| GET | `/api/admin/ping` | Bearer + admin | Proves admin guard (1B) |
| POST | `/api/tournaments` | Bearer + admin | Create (enforces min entry fee ₵10 + min prize floor ₵10 runner-up) (1C) |
| GET | `/api/tournaments` | — | List: `?game=&status=&limit=&offset=`, computed lobby state + prize projection (1C) |
| GET | `/api/tournaments/:id` | — | Detail (1C) |
| GET | `/api/tournaments/:id/me` | Bearer | Caller's registration or null (1C) |
| POST | `/api/tournaments/:id/join` | Bearer, phone-verified, not banned | Join + start entry-fee charge; pending slot held 10 min (1C) |
| POST | `/api/tournaments/:id/cancel` | Bearer + admin | Cancel before `starts_at` (open or full) + refund all paid + audit log (1C) |
| GET | `/api/tournaments/:id/bracket` | — | Bracket view: rounds, players + seeds, `feeds_next` advancement wiring, prize pool (1D) |
| POST | `/api/paystack/webhook` | signed | Paystack webhook (LIVE mode only): HMAC-SHA-512 verified, event dedupe, settles charges / transfer status |
| POST | `/api/admin/tournaments/:id/payout` | Bearer + admin | Run champion + runner-up payouts (`?force=true` = 3C one-click re-payout of failed rows) |
| GET | `/api/matches/:id` | — | Match view: players (username, seed, in-game UID), room code once active, picks, deadline, winner |
| POST | `/api/matches/:id/result` | Bearer + participant | Submit a pick (`won`/`lost`/`draw`/`dispute`) + screenshot URL; picks are final (v1) |
| POST | `/api/admin/matches/:id/resolve` | Bearer + admin | Resolve a dispute: `award` (winner_id) / `replay` (new room code) / `refund` (cancel tournament + refund all) |

## What was verified (Module 1A test log)

The migrations were executed against a real PostgreSQL 17 instance. Checks:

- [x] 001 applies cleanly from scratch (all tables, enums, indexes, triggers)
- [x] 002 applies cleanly on a stub `auth` schema; inserting into `auth.users` auto-creates a `public.users` profile
- [x] 003 applies cleanly (idempotent)
- [x] Seeds apply cleanly and are idempotent (re-run changes nothing)
- [x] Constraint rejections tested and confirmed:
  - `max_players = 6` rejected (must be 4/8/16/32/64)
  - split `70 + 35` rejected (must sum ≤ 100)
  - `starts_at` before `closes_at` rejected
  - phone `+14155551234` (non-Ghana) rejected
  - momo_provider mismatched with phone prefix rejected
  - duplicate (tournament, user) registration rejected
  - room code `K7W3N0` (contains `0`) rejected
  - second payout for the same (match, user) rejected (double-payout guard)
  - completed match without winner rejected

## What was verified (Module 1B test log)

Live API (port 3000) against the sandbox PostgreSQL 17 + seeded database:

- [x] Health endpoint; 401 on missing / garbage / tampered / expired token; 403 player-on-admin-route; 404 unknown route
- [x] Dev sign-in: new email creates the profile like the 002 trigger would (201), existing user re-signs in (200); JWT verified with HS256 + issuer + audience
- [x] Username: valid → 200, `Ab` → 400, taken `kofi_gh` → 409
- [x] ~~OTP happy path~~ superseded by 3E: MoMo number set via `POST /me/momo/resolve` + `PUT /me/momo`, no SMS
- [x] One-time rule: `PUT /me/momo` after the number is set → 409
- [x] Rejections: unsupported prefix `023…` → 400; verify with no challenge → 400
- [x] Lockout: 5 wrong codes → "Too many wrong attempts"; correct code still rejected while locked; a fresh request rotates the challenge and unlocks (verified end-to-end)
- [x] Expiry: backdated challenge → "Code expired" even with the correct code
- [x] Rate limit: 3 request-otp calls within 10 min OK, 4th → 429
- [x] OTPs stored only as scrypt hashes with per-row salt — never logged, never returned to clients

## What was verified (Module 1C test log)

Live API against the seeded sandbox database (after test cleanup the DB returns to the seed state; the seed's deliberately-stale pending registration was reaped by the TTL sweeper, as designed):

- [x] Admin-only create: player → 403; bad game / fee below ₵10 min / `max_players=6` / start-before-close / split 70+35 → 400 each
- [x] Min prize floor: ₵10 × 4 players @ 20% → runner-up ₵8.00 → 400 with the computed breakdown in the message
- [x] List: computed `paid_count` / `spots_left` / `projection_if_full` (integer pesewa math verified: ₵50×8 → 28000/8000/4000), filters by game/status, invalid filter → 400, `limit`/`offset`
- [x] Join guards: no token → 401, unverified phone → 403, missing `game_uid` → 400, re-join pending → 409, full → 409, cancelled → 409, bad uuid → 400, unknown uuid → 404
- [x] Pay-first: join → 201 with charge reference + 10-min `payment_deadline`; settle → entry-fee transaction (direction `in`) + `paid_count` increments; re-settle same reference → 404 (idempotent, no double ledger entry)
- [x] 8th payment flips the lobby `open → full` (verified live with 8 distinct payers)
- [x] Cancel (admin, pre-start, open OR full): all paid registrations refunded (8 × ₵50 = ₵400 out), registrations → `refunded`, tournament → `cancelled`, `admin_audit_log` row written — one transaction; re-cancel → 409; join after cancel → 409
- [x] Cancel blocked after `starts_at` (in_progress tournament → 409, "handle per-match via disputes")
- [x] 10-min pending TTL: expired pending stops holding a slot immediately (lazy TTL in counts), another player can take the slot, re-join still 409 while the row exists, reaper SQL deletes the stale row, then re-join succeeds
- [x] Race safety: joins and cancels serialize on a per-tournament advisory lock (`pg_advisory_xact_lock`); the charge reference is written in the join INSERT itself (a pool connection would miss the uncommitted row — bug found and fixed during testing)

## What was verified (Module 1F test log)

Live API + direct sweeper runs against the seeded sandbox database:

- [x] Activation: `full` + `starts_at` passed → tournament `in_progress`, round 1 matches `active` with unique 6-char room codes (charset `^[A-HJ-KM-NP-Z2-9]{6}$`, DB CHECK-validated) and 30-min result window; round N+1 activates only when every round N match is completed
- [x] Result guards: non-participant → 403, missing screenshot → 400, bad pick → 400, submit before activation → 409, double submit → 409, submit after the deadline closed → 409
- [x] Winner-pick model: `won`+`lost` → completed (winner), `lost`+`won` → winner p2, `draw`+`draw` → disputed (admin: replay or award), any mismatch → disputed, `dispute` pick → disputed immediately with the player's reason
- [x] Advancement: winner of round R match M slots into round R+1 match `ceil(M/2)` (odd → player1, even → player2) inside the completion transaction
- [x] Deadline sweeper: exactly one `won` pick → that player wins; no picks / no agreement → `disputed` with a reason — verified through the built-in 60s sweeper
- [x] Admin resolutions: `award` (winner + advancement + audit), `replay` (picks/screenshots cleared, fresh room code + window), `refund` (whole tournament cancelled, every paid registration refunded, double audit trail)
- [x] Final match completed → automatic payouts (champion 8400 + runner-up 2400 + platform 1200 pesewas for a ₵30×4 cup) → tournament `completed`; money in = money out
- [x] Hourly money-invariant check: completed → 2 successful payouts + 1 platform fee; cancelled → a refund row for every refunded registration; final completed → payout exists — all clean after a full test cycle
- [x] Bugs found & fixed during 1F: room-code charset contained `L` (DB excludes it); first pick was evaluated as a mismatch instead of `awaiting_results`; missing-JOIN `t.` reference in two sweep queries (500); next-round query compared against max completed round instead of `+1`; final-round detection used `count(*)` instead of `max(match_round)`; `count(*)` int8 string comparison in the invariants (false-positive alerts); cancel gate blocked the dispute `refund` path on started tournaments

## What was verified (Module 1E test log)

Live code path exercised end-to-end against `test/mock-paystack.js` (real HTTP, real
HMAC-SHA-512 signatures, webhook-driven state changes — no real keys or money):

- [x] Live charge flow: join returns Paystack `authorization_url`; phone approval → signed `charge.success` webhook → registration paid, entry-fee transaction, bracket generated on fill
- [x] Webhook security: bad signature → 401, missing signature → 401, tampered body (valid sig for different bytes) → 401
- [x] Webhook idempotency: replayed event (valid sig) → 200, settle is a no-op, exactly one entry-fee transaction; every event recorded in `webhook_events`
- [x] Charge decline: `charge.failure` webhook → registration stays pending (rejoinable after the 10-min window)
- [x] Cancel refunds (live): paid registrations → refund ledger rows `pending` → real transfer initiation (recipient + `transfer/initialize`) → `transfer.success` webhooks → rows `success`; audit log + `refunded` registrations; pending (unpaid) registration untouched; money in = money out (₵120 in → ₵120 out incl. platform fee on completed cups)
- [x] Payout (live): final completed → `POST /api/admin/tournaments/:id/payout` → champion + runner-up MoMo transfers initiated, platform-fee row, tournament → `completed`; re-payout is a no-op (`already_initiated`)
- [x] Payout failure + retry backoff: failing transfer → `transfer.failed` → row `failed`, retry in 15min; sweep retry 1 → fail → 1h; retry 2 → fail → 6h; retry 3 → fail → **FINAL FAILURE** (no further retries, console admin alert)
- [x] 3C one-click re-payout: `?force=true` re-initiates the failed transfer (admin override after final failure)
- [x] Stub mode regression: full join→pay→bracket→payout cycle still works via the dev endpoints (₵120 in → 8400 + 2400 + 1200 out, integer pesewa exact)
- [x] Lesson (fixed): the webhook route must be mounted with `express.raw` BEFORE the global `express.json()`, or the body is consumed before the signature is verified

## What was verified (Module 1D test log)

Live API against the seeded sandbox database:

- [x] 4-player lobby: bracket auto-generated by the 4th (settling) payment — 3 matches (2 real round-1 + 1 placeholder), seeds 1–4 assigned by crypto Fisher-Yates shuffle, prize pool fixed at generation (₵20×4 = ₵80 → 5600/1600/800 pesewas, `prize_pool_pesewas=7200`)
- [x] 8-player lobby: 7 matches (4 + 2 + 1), 8/8 seeds, pairing exactly (1v2)(3v4)(5v6)(7v8) with player1 = lower seed
- [x] Advancement wiring: R1M1+R1M2 → R2M1, R1M3+R1M4 → R2M2, R2M1+R2M2 → final R3M1 (verified via `feeds_next` in the bracket endpoint; winner advancement itself lands in 1F)
- [x] Bracket endpoint: structured rounds with usernames/seeds, `bracket_generated=false` + empty rounds for a non-full lobby
- [x] Idempotency: a second `generateBracket()` call is a no-op ("bracket already exists")
- [x] Crash recovery: matches deleted to simulate a crash between settle and generate → `generateMissingBrackets()` (the 60s safety sweep) regenerated the bracket correctly
- [x] Seed data untouched (the pre-seeded full cup still has its 7 matches)

## Conventions reminder (from agent.md §5)

- snake_case everywhere, `created_at`/`updated_at` on every table, UUID PKs
- Money: **integers in pesewas**, never floats
- Status fields: Postgres ENUM types (extending one = new migration)
- RLS is enabled on all business tables with **no policies** = default deny. The Express API uses the service role, which bypasses RLS. No client ever talks to Postgres directly.
- Every API response: `{ success, data, message }` — no exceptions

## Module 3E — Notifications (email + push) & MoMo number without OTP

**Decision (2026-09-15):** no SMS. Email (Resend) for money/outcome events,
Expo push for time-sensitive ones. The MoMo number is set once in onboarding
and proven by money movement, not a code.

### MoMo number (replaces OTP)
| Endpoint | Purpose |
|---|---|
| `POST /api/me/momo/resolve {phone}` | Validates + detects provider; in `PAYSTACK_MODE=live` resolves the registered account name via Paystack `/bank/resolve` so the player sees "MTN · KOFI MENSAH" before confirming |
| `PUT /api/me/momo {phone}` | Locks the number (`phone_verified=true`). 409 if already set or linked to another account |

The first entry-fee charge is approved on that phone — a wrong number cannot
pay, so it cannot play. `users.phone_verified` keeps its name; every
`requireVerified` route is unchanged.

### Outbox (`notifications` table)
`notify(q, {userId, template, payload})` inserts one row per channel using
the caller's transaction client, so the row commits/rolls back with the
business change. The dispatcher sweeper (20s) claims due rows with
`FOR UPDATE SKIP LOCKED`, renders the template, sends, and marks
`sent | skipped | failed`. Provider errors retry with backoff 1m/5m/30m/2h/6h,
5 attempts. `userId = null` = admin alert → `ADMIN_ALERT_EMAIL`.

| Template | Push | Email | Fired from |
|---|---|---|---|
| `entry_receipt` | | ✓ | charge settled |
| `lobby_full` | ✓ | | last seat paid |
| `start_reminder` | ✓ | | 30 min and 5 min before `starts_at` (idempotent, sweeper) |
| `match_ready` (room code) | ✓ | ✓ | match activated / replay |
| `opponent_submitted` | ✓ | | first pick in |
| `match_result` | ✓ | | match completed |
| `dispute_opened` | ✓ | | any dispute path |
| `dispute_resolved` | ✓ | ✓ | admin award / replay |
| `payout_sent` | ✓ | ✓ | transfer success (stub: immediately) |
| `tournament_cancelled` | ✓ | | cancel |
| `refund_issued` | ✓ | ✓ | refund transfer success |
| `admin_dispute`, `admin_payout_failed` | | ✓ (admin) | dispute / final payout failure |

Push: `PUT/DELETE /api/me/push-token {token, platform}`; `GET /api/me/notifications`
returns the player's recent push-channel rows as an in-app inbox. Dead
tokens (`DeviceNotRegistered`) are pruned automatically.

Providers: `src/services/mail.js` (`mock` | `resend`), `src/services/push.js`
(`mock` | `expo`). Both are single `fetch` calls — no SDKs.

### What was verified (3E test log)
Full lifecycle on a 4-player ₵10 cup (stub Paystack, mock providers), all
via the outbox: receipt → lobby_full ×4 → match_ready ×4 (email w/ room code
+ push to the one registered device) → opponent_submitted → match_result →
dispute (both "won") → admin_dispute alert (skipped: no ADMIN_ALERT_EMAIL) →
dispute_resolved ×2 → final → payout_sent (₵28 champion / ₵8 runner-up, email
+ push). Cancel of the 8-player cup → tournament_cancelled ×8 + refund_issued
×8. Provider failure (bad Resend key) → row stays `pending`, `attempts=1`,
`next_attempt_at` +1 min, error recorded. Onboarding: duplicate number → 409,
second change → 409.
