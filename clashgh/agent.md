# agent.md — ClashGH Project Guide

> **This file is the single source of truth for AI-assisted development on ClashGH.**
> Read this file in full before generating any code. Follow every rule, convention, and constraint listed below.

---

## 1. Project Overview

**ClashGH** is a mobile-first tournament escrow app built for the Ghana market. Players pay entry fees via Mobile Money (MoMo), get auto-matched into single-elimination brackets for popular mobile games, play using shared room codes, submit score screenshots with a result pick, and winners receive automatic MoMo payouts.

### Supported Games
- eFootball
- FC Mobile
- Call of Duty: Mobile (CODM)
- Dream League Soccer (DLS)

### Core Flow
Player signs in (Google OAuth, or email magic link)
→ Onboarding: sets username + verifies MoMo phone number (one-time OTP)
→ Browses tournaments
→ Pays entry fee via MoMo (Paystack)
→ Gets placed in bracket when the lobby fills
→ At the tournament's scheduled start, receives room code + opponent UID
→ Plays match on their game app
→ Submits score screenshot + result pick (I won / I lost / draw / dispute)
→ Opponent's opposing pick confirms, or match is disputed
→ Winner advances; at tournament end, champion + runner-up are paid out via MoMo

### Launch Strategy (v1)
- **4–8 player brackets only** (fastest fill); expand bracket sizes only when fill-rate metrics are healthy
- **1–2 most popular games first** (validate with the launch community); add games as liquidity allows
- Admin sets **close times of 24–48h** to bound how long players' money sits
- See §15 Risk Register for the metrics that gate expansion

---

## 2. Tech Stack

| Layer            | Technology                  | Notes                              |
| ---------------- | --------------------------- | ---------------------------------- |
| Backend          | Node.js + Express           | REST API                           |
| Database         | PostgreSQL (Supabase)       | Hosted Postgres, use SQL directly  |
| Payments         | Paystack API                | MoMo collect + MoMo transfer      |
| Mobile App       | React Native (Expo)         | Android-first, target SDK 21+      |
| Admin Panel      | React (Vite)                | Lightweight web dashboard          |
| Image Storage    | Cloudinary                  | Score screenshots only             |
| Authentication   | Supabase Auth + JWT         | Google OAuth (primary) + email magic link (fallback); Express verifies the JWT |
| Hosting          | Render                      | Backend + admin panel              |
| Environment Vars | dotenv                      | All secrets, keys, URLs            |

---

## 3. Business Rules — NEVER VIOLATE THESE

### Money & Currency
- All monetary values are in **Ghana Cedis (GHS)**, symbol **₵**
- Store all amounts as **integers in pesewas** (1 GHS = 100 pesewas) to avoid floating-point errors
- Display amounts to users as GHS with 2 decimal places (e.g., ₵5.00)
- **No in-app wallet.** Money flows MoMo → Paystack merchant → MoMo transfer. There is no stored balance to manage; "wallet" is a read-only history derived from `transactions`.

### Entry Fees & Escrow
- Entry fees are collected **BEFORE** a player is placed into a bracket — no pay, no play
- Collected fees are held in escrow (tracked in the `transactions` table, not a separate wallet)
- A lobby that does not fill by its close time does **not** start: all paid registrations are refunded and the tournament is cancelled
- Only **paid** registrations count toward filling a lobby. Pending (unpaid) registrations expire after **10 minutes** and free their slot

### Prize Pool & Payout Split
- The **total collected** is split **70% / 20% / 10%**: **1st place** gets `first_place_percent` (default 70), the **runner-up** gets `runnerup_percent` (default 20), and the **platform fee** is the remainder (default 10)
- Percentages are of the **total collected** and must sum to 100 — platform = `100 − first_place_percent − runnerup_percent`, so the platform fee is always non-negative
- **Prize pool** (the part paid to players) = total collected − platform fee = `first + runnerup`
- **Integer pesewa math** — `first = floor(total × first_place_percent / 100)`, `runnerup = floor(total × runnerup_percent / 100)`, `platform = total − first − runnerup`. Any rounding remainder (≤ 2 pesewas) is absorbed by the platform fee
- With the default split the effective payout is exactly **70% of the total to 1st** and **20% to the runner-up**
- Split ratios are configurable per tournament (admin sets them at creation). Platform fee is calculated once at bracket generation and recorded as a transaction at payout

### Payouts
- Payouts are triggered **ONLY** when:
  - **Both players** submit opposing result picks (winner/loser agree), **OR**
  - An **admin manually resolves** a dispute/draw
- If a match's result window expires and only one player has submitted a pick of **"I won"**, that player wins (deadline rule)
- Never release escrow funds without a verified, confirmed result
- Payouts are sent via **Paystack Transfer** to each winner's MoMo number — champion **and** runner-up are paid when the final match completes

### Brackets
- **Single-elimination only** — no double elimination, no round-robin, **no byes** (lobbies must fill to exactly the player cap)
- Brackets are auto-generated when the tournament lobby reaches its player cap
- Bracket sizes must be powers of 2: 4, 8, 16, 32, 64
- NULL player slots in `matches` exist **only** as placeholders for future rounds

### Match Mechanics
- **Scheduled start**: every tournament has a fixed start time (`starts_at`). Round 1 matches become active at that time; each later round becomes active as soon as **all** matches of the previous round are completed
- **Room codes**: 6-character alphanumeric random strings (A–Z and 2–9 only — no 0, O, 1, I, L)
- **UIDs**: Game-specific player IDs entered by each player during registration
- Room code is generated **when the match becomes active** and revealed to both players only while the match is active
- Each match has a **result window** to submit results (per-tournament `result_window_minutes`, default 30) starting when the match becomes active. It is enforced by a backend sweeper job (runs ~every 60s, no extra infrastructure)

### Result Submission & Verification
- Both players must submit a **screenshot** of the final score screen **plus a result pick**: `won`, `lost`, `draw`, or `dispute` (from their own perspective)
- A result pick is **only accepted if a screenshot is attached** (API-enforced in Module 1F)
- Agreement rule:
  - Player 1 picks `won` **and** Player 2 picks `lost` → Player 1 wins (auto-advance)
  - Player 1 picks `lost` **and** Player 2 picks `won` → Player 2 wins (auto-advance)
  - Both pick `draw` → match is flagged **draw** for admin decision (replay or award)
  - Any pick of `dispute`, or any other mismatch → match is flagged **disputed** for admin review
- When the result window expires:
  - Exactly one pick submitted and it is `won` → that player wins
  - Any other state (draw pick only, dispute pick, or no picks) → admin resolves
- Screenshots are stored on Cloudinary and linked to the match record; admins review both side-by-side

### Phone Numbers & Identity
- **Login identity** is managed by Supabase Auth: Google OAuth (primary) or email magic link (fallback). No OTP at login
- **One phone number per account** — the MoMo number. The same number is used to pay entry fees and to receive payouts. It is verified **once at onboarding** with a one-time OTP; no repeated OTPs (keeps SMS cost near zero)
- The verified phone is also the contact channel for critical SMS alerts (match start, payout sent)
- Ghana phone format: `0XXXXXXXXX` (10 digits starting with 0)
- Provider prefixes (canonical list — use for Paystack MoMo provider detection):
  - **MTN**: 024, 025, 053, 054, 055, 059
  - **Vodafone/Telecel**: 020, 050
  - **AirtelTigo**: 026, 027, 028, 056, 057
- Store phone numbers in E.164 format internally: `+233XXXXXXXXX`
- Display to users in local format: `0XXXXXXXXX`
- The `momo_provider` enum values stay `mtn` / `vodafone` / `airteltigo` to match Paystack's API provider codes (Vodafone Ghana rebranded to Telecel in 2023 — do not rename)

### Tournaments
- **v1: only admins can create tournaments** (platform-hosted). `tournaments.created_by` records the admin
- Admins may cancel a tournament **before** `starts_at` → all paid registrations refunded. No cancellation after start; problems are handled per-match via the dispute flow
- Every tournament has a **close time** (`closes_at`, the registration deadline). If paid registrations < max players at close, the admin confirms cancellation from the dashboard and the system refunds all paid registrations
- **Minimum prize floor**: a tournament cannot be created if the runner-up prize would be less than `MIN_PRIZE_PESOWAS` (default ₵10.00) — guarantees every payout clears Paystack's MoMo transfer minimum. Checked at creation: `entry_fee × max_players × runnerup_percent / 100 >= MIN_PRIZE_PESOWAS`

---

## 4. Ghana Market Constraints — CRITICAL

These constraints affect every technical decision. Do not ignore them.

| Constraint                | Requirement                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| **Android-first**         | 95% of users are on Android. iOS is not a launch priority.                  |
| **Low-end devices**       | Must work on Tecno, Infinix, Itel phones with 2GB RAM, Android 8+          |
| **Low data / 3G**         | Compress images before upload (max 500KB), minimize API payload sizes       |
| **MoMo only**             | No card payments, no bank transfers. Paystack MoMo is the only method.     |
| **Offline-friendly**      | Cache tournament lists, bracket state, and recent transactions locally      |
| **App size**              | Final APK must be **under 15MB**. Avoid heavy dependencies; hand-roll the bracket view; verify APK size early (end of Module 2B) |
| **Simple UX**             | Many users are not tech-savvy. Minimal steps, clear labels, large buttons. |

---

## 5. Coding Conventions

### Language & Syntax
- **JavaScript only** — no TypeScript anywhere in the project
- **ES Modules** — use `import` / `export` (not `require` / `module.exports`)
- Set `"type": "module"` in all `package.json` files
- **async/await** for all asynchronous code — never use raw callbacks or `.then()` chains
- Use `const` by default, `let` only when reassignment is necessary, never `var`

### Functions & Structure
- Write **small, single-purpose functions** — one function does one thing
- Name functions descriptively: `calculatePrizePool()`, `verifyPaystackWebhook()`, `generateRoomCode()`
- Keep files under ~200 lines. If a file grows beyond that, split it
- Group related logic into modules/folders, not monolithic files

### Error Handling
- Wrap **every** async operation in `try/catch`
- Never let unhandled promise rejections crash the server
- Log errors with enough context to debug (include user ID, tournament ID, etc.)
- Return user-friendly error messages — never expose stack traces or internal details to clients

### Environment Variables
- **Never hardcode** API keys, secrets, phone numbers, amounts, URLs, or credentials
- Use `dotenv` and a `.env` file (which is `.gitignore`-d)
- Provide a `.env.example` file with all required variable names (no values)
- Access via `process.env.VARIABLE_NAME`

### API Response Format
Every API endpoint must return responses in this exact shape:

```json
{
  "success": true,
  "data": {},
  "message": "Human-readable message"
}
```

- `success`: true for 2xx responses, false for 4xx/5xx
- `data`: The response payload (object, array, or null)
- `message`: A short, clear string explaining what happened

### HTTP Status Codes

| Code | Usage                                                        |
| ---- | ------------------------------------------------------------ |
| 200  | Successful GET, PUT, PATCH, or general OK                    |
| 201  | Successful resource creation (POST)                          |
| 400  | Bad request / validation error                               |
| 401  | Unauthorized / invalid or missing JWT                        |
| 403  | Forbidden / insufficient permissions                         |
| 404  | Resource not found                                           |
| 409  | Conflict (e.g., already registered)                          |
| 500  | Internal server error                                        |

### Comments
- Comment complex business logic (escrow calculations, bracket generation, webhook verification)
- Don't comment obvious code
- Use `// TODO:` for known incomplete items
- Use `// IMPORTANT:` for business-critical logic that must not be changed carelessly

### Security
- Validate and sanitize all user input on the backend
- Validate Paystack webhook signatures on every webhook — reject unsigned requests
- Use parameterized queries (never concatenate SQL strings)
- Rate-limit auth endpoints (OTP requests, login attempts)
- JWTs should have reasonable expiry (access: 1 hour, refresh: 30 days)

### Database
- Use snake_case for all table and column names
- Always include created_at and updated_at timestamps on every table
- Use UUIDs for primary keys (generated by PostgreSQL gen_random_uuid())
- Use database-level constraints (NOT NULL, UNIQUE, CHECK, FOREIGN KEY) — don't rely solely on application-level validation
- Use ENUMs or CHECK constraints for status fields

---

## 6. Build Plan — 3 Parts, 18 Modules

Build modules in this exact order. Do not skip ahead. Each module must be functional and testable before moving to the next.

### PART 1: BACKEND ENGINE

| #  | Module           | Description                                                                  | Status |
| -- | ---------------- | ---------------------------------------------------------------------------- | ------ |
| 1A | Database Schema  | PostgreSQL schema: users (profile linked to Supabase Auth), tournaments, registrations, matches, transactions, webhook_events, admin_audit_log | ✅ |
| 1B | Auth API         | Supabase Auth (Google OAuth + email magic link), one-time phone verification via OTP at onboarding, JWT verification middleware, admin role check | ✅ |
| 1C | Tournament API   | Create (admin only, enforces min prize floor), list, filter, join, manage tournaments | ✅ |
| 1D | Bracket Engine   | Auto-generate single-elimination brackets when a lobby fills                 | ✅ |
| 1E | Paystack MoMo    | Collect entry fees via MoMo, verify webhooks, track escrow, refunds, transfers, payout retry, webhook dedupe | ✅ |
| 1F | Match Flow       | Scheduled activation, room code generation, UID exchange, result picks, winner advancement, deadline sweeper, money invariant checks | ✅ |

### PART 2: MOBILE APP (Player-Facing)

| #  | Module            | Description                                                                    | Status |
| -- | ----------------- | ------------------------------------------------------------------------------ | ------ |
| 2A | Auth Screens      | Google sign-in, magic link fallback, onboarding (username + MoMo number + one-time OTP) | ✅ |
| 2B | Home & Lobby      | Browse tournaments, filter by game, join button, entry fee display             | ⬜ |
| 2C | Tournament View   | Full bracket visualization, player position, prize pool + split, schedule      | ⬜ |
| 2D | Match Room        | Opponent info, scheduled start, room code reveal, UID display, instructions    | ⬜ |
| 2E | Score Submit      | Screenshot capture/upload, result pick (won/lost/draw/dispute)                 | ⬜ |
| 2F | Wallet            | Payout/fee history (read-only, derived from transactions), payout status       | ⬜ |

### PART 3: ADMIN & VERIFICATION

| #  | Module               | Description                                                          | Status |
| -- | -------------------- | -------------------------------------------------------------------- | ------ |
| 3A | Score Verification   | Opposing-pick confirmation logic, auto-advance on agreement          | ⬜ |
| 3B | Dispute System       | Flag disputes, lock payouts, auto-flag high-dispute-rate players, admin resolution (award player OR cancel+refund) | ⬜ |
| 3C | Admin Dashboard      | Web panel: action queue, lobby health, tournaments, players, disputes, revenue, admin alerts       | ⬜ |
| 3D | Screenshot Storage   | Cloudinary upload integration, image compression, URL storage        | ⬜ |
| 3E | Notifications        | Push + SMS: scheduled-start reminders (30min/5min before), match start, opponent ready, payout sent | ⬜ |
| 3F | Analytics            | Revenue, active players, popular games, payout volume, fill rate, time-to-fill, refund rate, no-show rate       | ⬜ |

---

## 7. Database Schema Overview

Implemented in `backend/migrations/001_initial_schema.sql` (Module 1A ✅) + `002_supabase_auth_integration.sql` (Supabase trigger). This is the schema overview.

### users
- `id` (UUID, PK — **equals Supabase `auth.users.id`**; identity (Google `sub` / email) lives in Supabase Auth, not in this table)
- `email` (VARCHAR, UNIQUE, NULLABLE — from Google profile or magic link)
- `phone` (VARCHAR, UNIQUE, E.164 — the single MoMo number: pays entry fees AND receives payouts)
- `phone_verified` (BOOLEAN, default false — set true after the one-time onboarding OTP; users cannot join tournaments until verified)
- `username` (VARCHAR, UNIQUE)
- `momo_provider` (ENUM: 'mtn', 'vodafone', 'airteltigo' — derived from the phone prefix)
- `role` (ENUM: 'player', 'admin')
- `is_banned` (BOOLEAN, default false — banned users cannot register for tournaments)
- `created_at`, `updated_at`

*(v1.1: `balance_pesewas` and `is_verified` removed. v1.3: auth moved to Supabase Auth — `id` links to `auth.users.id`, `email` added, `momo_number` merged into `phone` (same number pays and receives), `phone_verified` added.)*

*(v1.3: the custom `refresh_tokens` table was dropped — Supabase Auth issues and rotates refresh tokens natively.)*

### tournaments
- `id` (UUID, PK)
- `title` (VARCHAR)
- `game` (ENUM: 'efootball', 'fc_mobile', 'codm', 'dls')
- `entry_fee_pesewas` (INTEGER)
- `max_players` (INTEGER — must be power of 2)
- `starts_at` (TIMESTAMP — scheduled round-1 start)
- `closes_at` (TIMESTAMP — registration deadline)
- `result_window_minutes` (INTEGER, default 30)
- `first_place_percent` (INTEGER, default 70 — % of total collected to 1st)
- `runnerup_percent` (INTEGER, default 20 — % of total collected to runner-up)
- `prize_pool_pesewas` (INTEGER, computed at bracket generation — = first + runnerup)
- `platform_fee_pesewas` (INTEGER, computed at bracket generation — = 100 − first% − runnerup%)
- CHECK: `first_place_percent + runnerup_percent <= 100` (platform fee must be non-negative)
- `status` (ENUM: 'open', 'full', 'in_progress', 'completed', 'cancelled')
- `created_by` (UUID, FK → users — admin in v1)
- `created_at`, `updated_at`

### registrations
- `id` (UUID, PK)
- `tournament_id` (UUID, FK → tournaments)
- `user_id` (UUID, FK → users)
- `game_uid` (VARCHAR — player's in-game ID for this tournament)
- `payment_status` (ENUM: 'pending', 'paid', 'refunded')
- `payment_reference` (VARCHAR — Paystack reference)
- `seed` (INTEGER — bracket position, assigned at bracket generation)
- `eliminated` (BOOLEAN, default false)
- `created_at`, `updated_at`
- UNIQUE constraint on (tournament_id, user_id)
- *Only `paid` rows count toward filling the lobby. `pending` rows older than 10 minutes are deleted by the sweeper.*

### matches
- `id` (UUID, PK)
- `tournament_id` (UUID, FK → tournaments)
- `match_round` (INTEGER — 1 = first round, 2 = second, etc. — named `match_round`, not `round`, to sidestep the PostgreSQL ROUND keyword)
- `match_number` (INTEGER — position within the round)
- `player1_id` (UUID, FK → users, NULLABLE — NULL only as a future-round placeholder)
- `player2_id` (UUID, FK → users, NULLABLE)
- `room_code` (VARCHAR(6) — generated when the match becomes active)
- `player1_pick` (ENUM: 'won', 'lost', 'draw', 'dispute', NULLABLE)
- `player2_pick` (ENUM: 'won', 'lost', 'draw', 'dispute', NULLABLE)
- `player1_screenshot_url` (VARCHAR, NULLABLE)
- `player2_screenshot_url` (VARCHAR, NULLABLE)
- `winner_id` (UUID, FK → users, NULLABLE)
- `status` (ENUM: 'pending', 'active', 'awaiting_results', 'disputed', 'completed')
- `dispute_reason` (TEXT, NULLABLE)
- `started_at` (TIMESTAMP, NULLABLE — set on activation)
- `deadline_at` (TIMESTAMP, NULLABLE — set on activation = started_at + result window)
- `created_at`, `updated_at`

### transactions
- `id` (UUID, PK)
- `user_id` (UUID, FK → users)
- `tournament_id` (UUID, FK → tournaments, NULLABLE)
- `match_id` (UUID, FK → matches, NULLABLE)
- `type` (ENUM: 'entry_fee', 'payout', 'refund', 'platform_fee')
- `amount_pesewas` (INTEGER)
- `status` (ENUM: 'pending', 'success', 'failed')
- `paystack_reference` (VARCHAR, NULLABLE)
- `paystack_transfer_code` (VARCHAR, NULLABLE)
- `direction` (ENUM: 'in', 'out') — 'in' = money collected from a player, 'out' = money paid to a player
- `description` (TEXT)
- `created_at`, `updated_at`
- *One payout transaction per prize recipient (champion + runner-up), both linked to the final match — so the final match legitimately holds TWO payout rows. Double-payout guard: partial unique index on (match_id, user_id) WHERE type = 'payout' AND match_id IS NOT NULL (blocks paying the same user twice for the same match).*

### webhook_events
- `id` (UUID, PK)
- `paystack_event_id` (VARCHAR, UNIQUE, NULLABLE — dedupe key for idempotent webhook processing)
- `event_type` (VARCHAR — e.g., charge.success, transfer.success)
- `payload` (JSONB — raw event for audit)
- `processed_at` (TIMESTAMP, NULLABLE)
- `created_at`, `updated_at`

### admin_audit_log
- `id` (UUID, PK)
- `admin_id` (UUID, FK → users)
- `action` (VARCHAR — e.g., 'resolve_dispute', 'cancel_tournament', 'payout_retry', 'ban_user', 'unban_user')
- `entity_type` (VARCHAR — e.g., 'match', 'tournament', 'user', 'transaction')
- `entity_id` (UUID, NULLABLE)
- `details` (JSONB — before/after values)
- `created_at`, `updated_at`

### Match status transitions
- `pending` → `active`: scheduled time reached (round 1 at `starts_at`; later rounds when the previous round fully completes). Room code generated, `started_at`/`deadline_at` set
- `active` → `awaiting_results`: first player submits a pick
- `awaiting_results` → `completed`: opposing picks submitted (agreement), or deadline rule (single `won` pick), or admin resolution
- `active`/`awaiting_results` → `disputed`: any `dispute` pick, mismatched picks, or both `draw`
- Tournament → `in_progress`: at `starts_at` (round 1 activates). Tournament → `completed`: final match completed **and** payouts initiated

---

## 8. Paystack Integration Notes

### MoMo Collection (Entry Fees)
- Use Paystack Charge API with `mobile_money` channel
- Provider detection based on phone prefix (see canonical list in §3)
- Initialize charge → user approves on phone → Paystack sends webhook → verify and credit
- One active charge per pending registration; the charge reference is stored on the registration

### MoMo Payout (Winnings)
- Use Paystack Transfer API
- Create transfer recipient with MoMo details → initiate transfer → track status via webhook
- Only initiate after match result is verified; champion **and** runner-up are paid when the final match completes
- // TODO(1E): verify Paystack's current MoMo transfer fee schedule and minimum transfer amount — fees erode the 10% platform fee and must be covered by MIN_PRIZE_PESOWAS

### Webhook Security
- Always verify the webhook signature using Paystack's secret key
- Verify by computing **HMAC SHA-512 of the raw request body** (base64-encoded digest) with your Paystack secret key and comparing to the `x-paystack-signature` header
- Reject any webhook that fails signature verification
- Webhooks should be idempotent — handle duplicate deliveries gracefully (dedupe via `webhook_events.paystack_event_id`)

### Required Environment Variables
```
PAYSTACK_SECRET_KEY=sk_live_xxx
PAYSTACK_PUBLIC_KEY=pk_live_xxx
PAYSTACK_WEBHOOK_SECRET=whsec_xxx (same as secret key for signature verification)
```

---

## 9. Key Algorithms

### Room Code Generation
```
Characters: A-Z, 2-9 (exclude 0, O, 1, I, L to avoid confusion)
Length: 6 characters
Example: "K7W3N9"
Must be unique across all matches with an unresolved status
(active, awaiting_results, disputed)
Generated at match activation, not at bracket creation
```

### Bracket Generation
```
Input: Array of registered players (verified paid, count == max_players)
1. Shuffle players randomly
2. Assign seeds 1 to N
3. Generate round 1 matches by pairing seeds: (1v2), (3v4), (5v6), etc.
4. Pre-create placeholder matches for subsequent rounds (player IDs null)
5. When a match completes, slot the winner into the next round's match
6. When all matches of round N are completed, activate all of round N+1
```

### Prize Pool & Split Calculation
```
total    = entry_fee × number_of_players
first    = floor(total × first_place_percent / 100)   # default 70
runnerup = floor(total × runnerup_percent / 100)      # default 20
platform = total - first - runnerup                   # default 10, absorbs rounding
prize_pool = first + runnerup                          # total paid to players

Example: 8 players × ₵5.00 = ₵40.00 collected (4000 pesewas)
first    = floor(4000 × 70 / 100) = 2800   → ₵28.00
runnerup = floor(4000 × 20 / 100) = 800    → ₵8.00
platform = 4000 - 2800 - 800 = 400         → ₵4.00
prize_pool = 3600                          → ₵36.00
```

### Result Agreement Logic
```
p1, p2 ∈ {won, lost, draw, dispute}   (each player's pick, from their own perspective)

if (p1 == 'won'  && p2 == 'lost') → player1 wins
if (p1 == 'lost' && p2 == 'won')  → player2 wins
if (p1 == 'draw' && p2 == 'draw') → draw → admin decides (replay or award)
otherwise                          → disputed → admin review
```

### Deadline Sweeper (runs ~every 60s in the backend)
```
1. Activate matches:
   - Round 1: tournament.status == 'full' AND starts_at <= now
   - Round N+1: all round N matches completed
   → set status 'active', room_code, started_at, deadline_at
2. Enforce deadlines:
   For matches in ('active', 'awaiting_results') with deadline_at < now:
   - Exactly one pick submitted and it is 'won' → complete, that player wins
   - Any other state → status 'disputed' (admin resolves: award, replay, or refund)
3. Progress tournaments:
   - 'full' + starts_at passed → 'in_progress'
   - Final match completed → 'completed', trigger payouts
4. Clean up stale pending registrations (older than 10 minutes)
5. Flag lobbies that missed their close time (paid < max) for admin cancellation
6. Retry failed payouts: 'failed' payout transactions retried with backoff
   (15min / 1h / 6h, max 3); after the final failure they stay 'failed'
   and the admin is alerted (one-click re-payout in 3C)
7. Money invariant check (hourly) — log + alert the admin on any violation:
   - every 'completed' tournament → exactly 2 successful 'payout'
     + 1 'platform_fee' transaction
   - every 'cancelled' tournament → a 'refund' for every paid registration
   - every final-round 'completed' match → payout initiated
```

---

## 10. Project Folder Structure (Planned)

```
clashgh/
├── backend/
│   ├── src/
│   │   ├── config/          # Database, Paystack, Cloudinary config
│   │   ├── middleware/      # Auth, error handling, validation
│   │   ├── routes/          # Express route definitions
│   │   ├── controllers/     # Request handlers
│   │   ├── services/        # Business logic
│   │   ├── sweeper/         # Deadline/activation/timeout job loop
│   │   ├── utils/           # Helpers (room codes, phone formatting, etc.)
│   │   └── app.js           # Express app setup
│   ├── migrations/          # Versioned SQL migration files
│   ├── seeds/               # Test data
│   ├── .env.example
│   ├── .gitignore
│   └── package.json
│
├── mobile/                  # React Native (Expo) app
│   ├── src/
│   │   ├── screens/         # Screen components
│   │   ├── components/      # Reusable UI components
│   │   ├── navigation/      # React Navigation setup
│   │   ├── services/        # API calls
│   │   ├── store/           # Local state management
│   │   ├── utils/           # Helpers
│   │   └── assets/          # Images, fonts
│   ├── app.json
│   └── package.json
│
├── admin/                   # React (Vite) admin panel
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── services/
│   │   └── App.jsx
│   ├── .env.example
│   └── package.json
│
├── agent.md                 # THIS FILE — AI project guide
└── README.md
```

**Migrations (v1.1 decision):** versioned `.sql` files in `backend/migrations/` (e.g., `001_initial_schema.sql`), applied manually via the Supabase SQL editor in development, tracked in a `schema_migrations` table. No ORM/migration framework in v1.

---

## 11. Environment Variables Template

```
# === Backend (.env) ===

# Server
PORT=3000
NODE_ENV=development

# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Supabase (Auth + Postgres)
SUPABASE_URL=your-project-url
SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret
SUPABASE_JWT_SECRET=your-jwt-secret (used by Express to verify tokens)
# Google OAuth client + magic link email are configured in the Supabase dashboard, not in .env

# Paystack
PAYSTACK_SECRET_KEY=sk_test_xxx
PAYSTACK_PUBLIC_KEY=pk_test_xxx

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# OTP (if using an SMS provider)
SMS_API_KEY=your-sms-api-key
SMS_SENDER_ID=ClashGH

# App
DEFAULT_RESULT_WINDOW_MINUTES=30
DEFAULT_FIRST_PLACE_PERCENT=70
DEFAULT_RUNNERUP_PERCENT=20
DEFAULT_PLATFORM_PERCENT=10
REGISTRATION_PENDING_TTL_MINUTES=10
MIN_ENTRY_FEE_PESOWAS=1000
MIN_PRIZE_PESOWAS=1000
```

---

## 12. Testing Strategy

- Each module must be independently testable
- Backend: Test with Postman or HTTP client, include example requests in module docs
- Database: Use Supabase SQL editor for direct query testing
- Payments: Use Paystack test mode keys — never test with live keys during development
- Mobile: Test on actual low-end Android device or emulator configured with limited RAM
- Admin: Browser testing, responsive design verification
- Pre-launch soak test: run a full simulated tournament (join → pay → bracket → matches → payout) in Paystack test mode end-to-end

---

## 13. Rules for the AI — FOLLOW STRICTLY

1. Always read this agent.md file in full before generating any code for ClashGH
2. Build one module at a time, in order: 1A → 1B → 1C → 1D → 1E → 1F → 2A → 2B → 2C → 2D → 2E → 2F → 3A → 3B → 3C → 3D → 3E → 3F
3. Never hardcode API keys, phone numbers, monetary amounts, or credentials
4. Always validate Paystack webhook signatures — no exceptions
5. Never release escrow without a verified, confirmed match result
6. Prioritize simplicity over cleverness — this must run on a ₵500 Tecno phone over 3G
7. Every module must be testable independently before moving to the next
8. Update the module status in the build plan (⬜ → ✅) after completing each module
9. Do NOT assume project structure, file names, or implementation details. Before generating code for any module, ask the user clarifying questions about:
   - Folder structure and file naming preferences
   - Database-specific decisions (indexes, constraints, naming)
   - Any ambiguous requirements
   - Integration points with other modules
10. Ask before building. If any requirement is unclear or ambiguous, stop and ask the user for clarification. Do not guess
11. When writing backend code, always include:
    - Input validation
    - Proper error responses in the standard format
    - Appropriate HTTP status codes
    - Error logging with context
12. When writing mobile code, always consider:
    - Low memory usage
    - Image compression before upload
    - Offline state handling
    - Large tap targets for touch
    - Minimal dependencies to keep APK size small
13. Store monetary values as integers (pesewas) — never use floats for money
14. All database queries must use parameterized queries — never string concatenation

---

## 14. Glossary

| Term            | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| GHS / ₵         | Ghana Cedis — the currency                                                 |
| Pesewas         | 1/100 of a Cedi — used for internal storage (like cents)                  |
| MoMo            | Mobile Money — digital wallet tied to a phone number                       |
| Paystack        | Payment gateway supporting MoMo in Ghana                                   |
| Room Code       | 6-char code (A–Z, 2–9) players use to create/join a private game match     |
| UID / Game UID  | Player's unique ID within a specific mobile game                           |
| Bracket         | Single-elimination tournament structure                                    |
| Seed            | Player's assigned position in the bracket                                  |
| Escrow          | Entry fees held until match results are verified                           |
| Platform Fee    | 10% of total entry fees taken by ClashGH (default split)                   |
| Prize Split     | Division of total collected: 1st / runner-up / platform (default 70/20/10, per-tournament) |
| Result Pick     | A player's declared outcome: won / lost / draw / dispute                   |
| Dispute         | When players disagree on a match result (or a pick is 'dispute')           |
| Lobby           | Waiting room while a tournament fills up                                   |
| Result Window   | Time allowed to submit a result after a match starts (default 30 min)      |

---

## 15. Risk Register & Mitigations

> Ranked **most → least product risk** (probability × impact on delivering value and holding user trust). Each item lists the mitigations now built into this plan and where they land.

### R1. Liquidity / cold start — HIGH probability × HIGH impact
Tournaments only start when fully filled. In a new app, lobbies sit unfilled → refunds → players churn before their first match. An empty app attracts no players; no players means nothing fills. This is the most likely cause of product failure — a funnel problem, not a bug.
**Mitigations in plan:**
- Launch with 4–8 player brackets only; expand only on healthy fill-rate metrics (§1 Launch Strategy)
- Focus on 1–2 most popular games first (§1)
- Mandatory `closes_at` with 24–48h admin-set windows bounds how long money sits (§3)
- 3C: "lobby health" view — near-full and at-risk lobbies, one-click cancel+refund
- 3F: track % of tournaments starting, time-to-fill, refund rate; these numbers gate expansion

### R2. Trust & fraud (fake screenshots, collusion) — MEDIUM × HIGH
Payouts rest on player-submitted screenshots. Colluding or fabricated results drain escrow, and in a small market one public incident of a winner losing money is reputationally fatal.
**Mitigations in plan:**
- A result pick is only accepted with a screenshot attached — API-enforced (§3, 1F)
- Screenshot quality guidance on the submit screen (full score screen, no crops) — 2E
- `users.is_banned` + ban flow; banned users blocked at join — 1A, 3C
- 3B: matches involving players with high historical dispute rates are auto-flagged for priority admin review
- Admin resolution limited to: award a player, or cancel tournament + refund everyone (no partial hacks) — 3B
- `admin_audit_log` records every manual override — 1A, 3B/3C

### R3. Payout reliability & small-prize floor — MEDIUM × HIGH
MoMo transfers fail (provider outage, invalid number, limits). If a champion is not paid, all trust evaporates. Additionally, small tournaments can produce runner-up prizes below Paystack's MoMo transfer minimum (e.g., 8 × ₵5.00 → ₵8.00 runner-up).
**Mitigations in plan:**
- Minimum prize floor: creation rejected if runner-up prize < `MIN_PRIZE_PESOWAS` (default ₵10) — §3, 1C
- Verify Paystack MoMo transfer minimums + fee schedule before 1E (open item; sizes MIN_PRIZE_PESOWAS)
- Payout retry with backoff (15min/1h/6h, max 3); final failure → admin alert + one-click re-payout — 1E, sweeper §9
- Validate phone (Ghana 10-digit prefix) before initiating a transfer — 1E
- Player-visible payout status (pending/paid/failed) — 2F
- One payout per (match, user) enforced at DB level — 1A

### R4. Money integrity (escrow correctness, concurrency, webhook duplicates) — LOW-MEDIUM × VERY HIGH
Double-credited webhooks, concurrent-join races, double payouts → miscounted money. Rare, but each incident is real money lost and a trust incident.
**Mitigations in plan:**
- `webhook_events` table with UNIQUE `paystack_event_id` → idempotent processing, duplicates dropped — 1A, 1E
- All money-state transitions in DB transactions with row locks (`SELECT ... FOR UPDATE`) — 1C, 1E, 1F
- Integer pesewas everywhere (§5 rule)
- Sweeper money invariant check (hourly): completed tournaments need 2 payouts + 1 fee; cancelled need all refunds; violations logged + admin-alerted — §9, 1F
- `admin_audit_log` for every manual override — 1A

### R5. Match no-shows at scheduled start — HIGH × MEDIUM
With scheduled starts, one player not showing wastes the other's time and creates disputes.
**Mitigations in plan:**
- Push + SMS reminders 30min and 5min before scheduled start — 3E
- Deadline rule already handles non-submission (single `won` pick wins; else admin) — §3
- Admin can award a player or cancel+refund — 3B
- 3F: no-show rate tracked per tournament; feeds launch scheduling decisions

### R6. Auth provider dependency (Google outage, missing GMS) & SMS cost — MEDIUM × MEDIUM
Login now rides on Google OAuth or email delivery; some budget Androids ship without Google Play services, and a Google outage would lock users out.
**Mitigations in plan:**
- Google OAuth (primary) + email magic link (fallback) — no-GMS devices and Google outages still get in — 1B, 2A
- One-time OTP at onboarding only — the only signup SMS per user, so SMS cost stays near zero at scale — 1B
- Supabase Auth manages refresh tokens (30-day) + revocation — no re-auth per session — 1B
- Choose an SMS provider with strong Ghana delivery before 1B (open item; now used only for onboarding + critical alerts)

### R7. Admin throughput (single human in the loop) — NEAR-CERTAIN × MEDIUM
Disputes, lobbies, refunds and payout failures all wait on an admin. If nobody is watching, the product stalls.
**Mitigations in plan:**
- 3C: "action required" queue (disputes, failed payouts, lobbies closing unfilled) sorted by age
- SMS alerts to admins on: dispute created, payout failed, lobby closed unfilled — 3C, 3E
- Dispute SLA target (e.g., 24h) displayed in the dashboard — 3B

### R8. Regulatory (Ghana gaming rules on paid-entry tournaments) — LOW × EXISTENTIAL
Paid entry + cash prizes is a grey area under Ghana gaming regulation (skill games are generally treated differently from betting). Low probability after a review, but the impact is app shutdown — so it is a launch gate.
**Mitigations in plan:**
- One-off legal check before launch (open item — gates go-live, not modules)
- App copy says "entry fee", never "bet"; no in-app side betting between players (out of scope) — 2A–2F copy review

### R9. Device & data constraints (2GB RAM, 3G, <15MB APK) — MEDIUM × MEDIUM
If the app is slow or heavy, low-income users drop it.
**Mitigations in plan:**
- Hand-rolled bracket view, no heavy native dependencies — 2C
- Image compression ≤ 500KB before upload — 2E
- Lightweight list endpoints + pagination; trimmed payloads — 1C
- Modest polling (30–60s on match screens) — 2D
- APK size checkpoint at the end of every 2x module; cut dependencies if trending > 15MB — 2A–2F

### R10. Stale offline data — LOW × LOW
Cached bracket/prize data goes stale while offline.
**Mitigations in plan:**
- "Last updated" labels + refresh on screen focus — 2B, 2C

---

## 16. Decisions Log

### v2.0 — 2026-09-14 (Module 2A complete — mobile app starts)
1. **2A built + verified** — Expo SDK 57 / RN 0.86 / TypeScript strict app scaffold (`mobile/`, §10 structure) plus the auth screens: Google sign-in (primary) with dev-identity simulation in stub mode, email magic-link fallback, and one-time onboarding (username → MoMo number with live provider detection → SMS OTP). Auth-gated navigation: signed-out → SignIn, unverified → Onboarding, verified → Home/Me
2. **App auth mode mirrors the backend's**: `EXPO_PUBLIC_AUTH_MODE=stub|supabase`. Stub uses the backend's dev endpoints (same JWT format); supabase mode uses `@supabase/supabase-js` (Google OAuth + magic links, deep link `clashgh://auth/callback?code=…` + `exchangeCodeForSession`) — the 1B promise holds: adding a Supabase project later is a config swap, zero route/app-flow changes
3. **Token storage**: `expo-secure-store` (only storage native module; keeps the APK lean per the 15MB budget — verified 2.5MB JS bundle so far)
4. **2A = the scaffold + auth screens** (the roadmap's "App Scaffold" label is folded into 2A); the Home screen ships as a thin placeholder that already hits the real list endpoint with the "last updated" convention from §14
5. **Sandbox reset lesson**: Postgres and `node_modules` are NOT persisted across sandbox restarts — rebuild recipe: `apt-get install postgresql`, `CREATE ROLE clashgh LOGIN PASSWORD 'clashgh' BYPASSRLS; CREATE DATABASE clashgh OWNER clashgh;`, apply `migrations/001,003,004` + `seeds/001_dev_seed.sql` (002 is Supabase-only: create the `handle_new_user` function manually + record the migration), then **transfer public-schema ownership to `clashgh`** (`ALTER TABLE/TYPE/FUNCTION/SEQUENCE … OWNER TO clashgh`; skip `_`-prefixed array types and table row types — a failed DO block rolls back the whole thing)

### v1.9 — 2026-09-14 (Module 1F complete — backend done)
1. **1F built + verified** — scheduled activation (round 1 at `starts_at`, round N+1 when round N is fully completed), 6-char room codes from `A-HJ-KM-NP-Z2-9` (minted at activation, DB CHECK-validated), winner-pick result model with mandatory screenshot, agreement logic (won+lost / lost+won / draw+draw / mismatch / immediate-dispute), deadline sweeper (single `won` → win, else `disputed`), winner advancement (`ceil(M/2)`, odd→player1 even→player2, same transaction), auto-payout on final completion, hourly money-invariant check
2. **Pick is final once submitted** (v1: no edits — a mis-click is handled by admin replay); the in-game UID is public on the match view (that is the "UID exchange" — how players find each other in the room)
3. **Admin dispute resolution** = `award` (winner + advance) / `replay` (picks cleared, fresh room code + window) / `refund` — refund cancels the whole tournament and refunds every paid registration (reuses the 1C cancel flow, extended with an `allowInProgress` gate that is ONLY reachable from the dispute path)
4. **Cancel flow extracted to `src/services/cancel.js`** (1C route + 1F dispute both call it); gateway rule: open/full pre-start for plain cancel, in_progress only via dispute refund
5. **UID exchange needs no new endpoint** — `GET /api/matches/:id` exposes both players' game_uid (public by design); screenshots are stored as URLs submitted with the pick (upload endpoint lands with the app in 2C/2D)
6. **Money invariants (hourly)**: completed → exactly 2 successful payouts + 1 platform fee; cancelled → a refund row per refunded registration; final completed → payout rows exist; violations log + alert (push/SMS in 3E); 5-minute grace for just-completed tournaments (payout can still be in flight)
7. **Backend is complete (1A–1F)** — next is the React Native app (2A–2D); API surface for it: auth, tournaments, bracket, matches, results, admin
8. Node-postgres gotcha logged for future modules: `count(*)` comes back as an **int8 string** — cast `(count(*) FILTER (...))::int` or comparisons silently fail

### v1.8 — 2026-09-14 (Module 1E complete)
1. **1E built + verified** — real Paystack HTTP client (charge init, MoMo transfer recipients/init), signed webhook endpoint (`HMAC-SHA-512` of the RAW body vs `x-paystack-signature`, timing-safe), `webhook_events` dedupe, MoMo refunds on cancel, champion + runner-up payouts, payout retry backoff 15min/1h/6h max 3 with FINAL FAILURE alert; live path integration-tested end-to-end via a local Paystack test double (`test/mock-paystack.js`) — zero real keys, zero real money
2. **`PAYSTACK_MODE=stub|live` is the only switch** — stub settles via the dev endpoint and completes transfers instantly; live settles only via verified webhooks. Join flow restructured: charge initiation (an HTTP call in live) happens OUTSIDE the DB transaction, with a capacity re-check before insert
3. **Refunds are `pending` until MoMo confirms** (live): cancel writes refund ledger rows + audit in one transaction, then initiates transfers after commit; `transfer.success` flips each row. Failed refunds are NOT auto-retried — admin action (3C). Payouts ARE auto-retried (sweeper) per §9
4. **Payout execution** (`executePayout`): idempotent (existing payout rows block re-initiation; partial unique index is the DB backstop), runs under the tournament advisory lock, flips the tournament to `completed` when initiated. 3C one-click re-payout = `POST /api/admin/tournaments/:id/payout?force=true` (retries FAILED rows after final failure)
5. **Retry tracking**: migration 004 adds `attempts` + `next_retry_at` to transactions; the 60s sweep retries due failed payouts (backoff from migration-004 columns); after the 3rd failed retry the row stays `failed` with no `next_retry_at` + console admin alert (push/SMS alert lands in 3E)
6. **Lesson (fixed)**: a webhook route must be mounted with `express.raw` BEFORE the global `express.json()`, or the JSON body is consumed before the HMAC can be verified on the raw bytes
7. **Open item stands**: verify Paystack's current MoMo transfer fee schedule + minimums before launch — fees erode the 10% platform fee and validate `MIN_PRIZE_PESOWAS`

### v1.7 — 2026-09-14 (Module 1D complete)
1. **Bracket engine built + verified** — on the settling payment that fills the lobby, the bracket generates synchronously: crypto Fisher-Yates shuffle → seeds 1..N → round 1 pairs (1v2)(3v4)... with player1 = lower seed → placeholder matches for rounds 2..log2(N); `prize_pool_pesewas`/`platform_fee_pesewas` fixed in integer pesewa at generation
2. **No advancement links in the schema** — wiring is positional and documented: winner of round R match M feeds round R+1 match `ceil(M/2)` (exposed as `feeds_next` in the bracket endpoint; Module 1F uses it to slot winners)
3. **Double trigger**: synchronous generation at fill + a 60s safety sweep (`generateMissingBrackets`) for crashes between settle and generate; generation is idempotent and runs under the same per-tournament advisory lock as join/cancel
4. **Bracket view endpoint** `GET /api/tournaments/:id/bracket` (public) — the exact payload Module 2C renders
5. No byes, no partial brackets: generation requires exactly `max_players` paid registrations (4/8/16/32/64); a non-full lobby gets no matches

### v1.6 — 2026-09-14 (Module 1C complete)
1. **1C built + verified** — admin-only create (min entry fee ₵10, min prize floor checked as `fee × max_players × runnerup% / 100 >= MIN_PRIZE_PESOWAS`), list/detail with computed lobby state + integer-pesewa prize projection, join (verified, not banned, game_uid required), admin cancel+refund+audit before `starts_at`; live-tested end-to-end (see `backend/README.md`)
2. **Pay-first join flow**: join creates a pending registration and initiates the entry-fee charge in one transaction; the slot is held for `REGISTRATION_PENDING_TTL_MINUTES` (10); settlement (stub dev endpoint now, verified Paystack webhook in 1E) writes the entry-fee transaction, and the 8th/last payment flips the lobby `open → full`
3. **Payment is a pluggable service** (`src/services/payment.js`): `PAYSTACK_MODE=stub` in dev; 1E swaps in the real Paystack Charge API + HMAC-SHA-512 webhooks into the same settle/refund ledger functions — no route changes
4. **Cancel rule**: `open` OR `full` and `now < starts_at` → cancel + refund every paid registration + `admin_audit_log` row, single transaction; after start → 409 (disputes handle it per-match)
5. **Concurrency**: joins and cancels serialize on a per-tournament advisory lock (`pg_advisory_xact_lock`); slot counts use lazy TTL so expired pendings release slots instantly (the 60s reaper physically deletes them)
6. **Lesson (fixed in code)**: a charge reference written via a *pool* connection inside a join transaction missed the uncommitted row (0-row UPDATE) — write such fields in the same client/transaction

### v1.5 — 2026-09-14 (Module 1B complete)
1. **1B built + verified** — Express API (ESM, JS-only): JWT verification middleware (HS256, issuer + audience checks), profile routes, one-time phone OTP flow, admin guard; live-tested against the sandbox Postgres (see `backend/README.md` test logs)
2. **Auth dev mode**: `AUTH_PROVIDER=stub` issues Supabase-shaped JWTs locally (dev sign-in by email, profile bootstrap mimics the 002 trigger); `AUTH_PROVIDER=supabase` switches on with zero route changes — chosen by user on 2026-09-14 (no Supabase project yet)
3. **SMS is pluggable**: `SMS_PROVIDER=mock` logs OTPs to the server console (chosen by user 2026-09-14, provider undecided); real Ghana provider plugs into `src/services/sms.js` behind the same interface before launch
4. **OTP security**: 6 digits, scrypt-hashed with per-row salt in `phone_verifications` (migration 003), 10-min TTL, 5 attempts per code, one active challenge per phone, deleted on verify; rate limits 3 requests / 10 verifies per 10 min
5. **Service-role pattern locally**: the backend's DB user has `BYPASSRLS` (mirrors Supabase `service_role`); role/player claims are ALWAYS read from `public.users`, never from token claims
6. **Dev-only routes** (`/api/dev/*`) mount only when `AUTH_PROVIDER=stub` AND `NODE_ENV != production`

### v1.4 — 2026-09-14 (Module 1A complete)
1. **1A schema implemented + verified** — `backend/migrations/001_initial_schema.sql` + `002_supabase_auth_integration.sql`; applied to a clean PostgreSQL 17 database, 12/12 constraint and behavior tests pass, dev seed idempotent (run twice)
2. **No FK into `auth.users`** — Supabase forbids incoming FKs to the managed auth schema; the `public.users` profile is auto-created by the `handle_new_user()` trigger (002) using the same UUID as `auth.users.id`
3. **`matches.round` → `match_round`** — column renamed to sidestep the PostgreSQL ROUND keyword; all queries must use `match_round`
4. **Double-payout guard** — partial unique index is on **(match_id, user_id)** where `type='payout' AND match_id IS NOT NULL` (the final match legitimately has TWO payout rows: champion + runner-up)
5. **RLS**: enabled on all 7 business tables, zero policies (default deny) — all app traffic goes through the service role in the backend
6. **Debug lesson**: "invalid input syntax for type uuid" during seed was typo'd UUID literals in generated SQL (41-char and 31-char), not schema or keyword issues — validate all generated UUID literals programmatically before suspecting the DB

### v1.3 — 2026-09-14 (auth model)
1. **Auth**: Supabase Auth — Google OAuth primary + email magic link fallback (mobile app + admin panel)
2. **Single phone number**: one MoMo number per account, used to pay AND receive, verified once at onboarding (one-time OTP); no OTP at login
3. **users schema**: `momo_number` merged into `phone`, `email` added, `phone_verified` added; `id` references Supabase `auth.users.id`
4. **`refresh_tokens` table dropped** — Supabase manages refresh tokens (rotation + revocation) natively
5. **Env**: JWT_* vars replaced by SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWT_SECRET
6. **Open item resolved**: admin panel login = same Supabase Auth + role check
7. **Risk R6 rewritten**: OTP cost risk → auth provider dependency, mitigated by magic link fallback

### v1.2 — 2026-09-14 (risk review)
1. **Risk register added** (§15) — 10 ranked product risks with in-plan mitigations
2. **Minimum prize floor** — creation rejected if runner-up prize < MIN_PRIZE_PESOWAS (default ₵10.00); MIN_ENTRY_FEE_PESOWAS added
3. **`webhook_events` + `admin_audit_log` tables** — idempotent webhooks, audited manual overrides
4. **`users.is_banned`** — fraud mitigation, enforced at join
5. **Sweeper** — payout retry with backoff, hourly money invariant check
6. **Launch strategy** (§1) — 4–8 player brackets, 1–2 games, 24–48h close times, metrics-gated expansion
7. **Module scope updates** — 3C action queue + lobby health + alerts; 3E scheduled-start reminders; 3F liquidity & no-show metrics
8. **Result pick requires screenshot** — API-enforced (fraud mitigation)

### v1.1 — 2026-09-14 (review of v1.0)
1. **Prize split**: total collected split 70% 1st / 20% runner-up / 10% platform (per-tournament ratios, integer pesewa math, rounding absorbed by platform). Updated from v1.1's 70/30-of-pool to a direct 70/20/10 of the total on 2026-09-14
2. **Result confirmation**: winner-pick model — screenshot + pick (`won`/`lost`/`draw`/`dispute`); replaced single score pair and confirmed flags on `matches`
3. **Match start**: scheduled — `starts_at` on tournaments; later rounds activate when the previous round completes
4. **Deadline rule**: single `won` pick at expiry → that player wins; everything else → admin
5. **Tournament creation**: admins only in v1
6. **No wallet**: `users.balance_pesewas` removed; wallet screen is a derived read-only history
7. **`users.is_verified` removed** (no verification step in v1)
8. **`refresh_tokens` table added** (token hash, revocation, rotation)
9. **Lobby close**: `closes_at` + admin-confirmed cancellation + refund flow; only paid registrations count toward fill; pending TTL 10 min
10. **Phone prefixes reconciled** (added 053, 056, 057); Paystack enum names kept
11. **"Byes" removed** from match semantics — placeholders for future rounds only
12. **Text fixes**: room code wording (6-character, A–Z/2–9), §13 renumbered, trailing generation prompt removed, platform-fee timing clarified
13. **Migrations**: versioned `.sql` files + `schema_migrations` table, applied via Supabase SQL editor

### Open items (resolve before the affected module)
- **Supabase project + Google Cloud OAuth client** — before switching `AUTH_PROVIDER=supabase` (create project, configure Google provider + magic link email in the dashboard; 1B already targets this mode)
- **Real SMS provider** (Termii / Africa's Talking / Twilio) — before launch (pluggable interface in `src/services/sms.js` is in place; `mock` until then)
- **Confirm default split 70/20/10** is the business default (set as the default; admin can change per tournament)
- **Paystack MoMo transfer fee schedule + minimums** — before 1E (validates MIN_PRIZE_PESOWAS)
- **Regulatory check** (Ghana gaming rules on paid-entry tournaments) — before launch; gates go-live, not modules

---

Last updated: 2026-09-14
Version: 2.0
Next module to build: 2B — Home & Lobby
