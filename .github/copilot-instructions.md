# ClashGH — instructions for AI assistants

Read `clashgh/HANDOFF.md`, `clashgh/SETUP.md` and `clashgh/agent.md` first.

## What this is
Paid mobile-game tournament platform for Ghana (eFootball, FC Mobile, CODM, DLS). Players pay entry fees
by Mobile Money (Paystack), play 1v1 single-elimination brackets, winners are paid to MoMo automatically.
Community hosts can run their own cups; ClashGH keeps 50 % of the host cut. Monorepo:

- `clashgh/backend` — Node 22 + Express + Postgres (`pg`), no ORM. Entry `src/server.js`. Migrations are
  plain SQL in `migrations/`, applied with `npm run migrate` (`scripts/migrate.mjs`).
- `clashgh/mobile` — Expo (React Native) app; web is a first-class target (`npm run web:export`).
- `clashgh/admin` — Vite + React admin panel.

## Hard rules (do not break)
- Money is **integer pesewas** (₵1 = 100). Never floats. Split math lives in `backend/src/utils/prize.js`;
  `first + runnerup + host + platform === total` must always hold.
- API responses are always `{ success, data, message }`. Errors via `ApiError(status, message)`.
- DB columns and JSON are `snake_case`; UUID primary keys. Money movements are rows in `transactions`
  (`entry_fee | payout | refund | platform_fee | host_share`); never update balances in place.
- Auth: Bearer JWT. `AUTH_PROVIDER=stub` (dev identities) or `supabase`. Dev-only routes under `/api/dev/*`
  and the `X-ClashGH-Token` header are disabled when `NODE_ENV=production`.
- Paystack: `PAYSTACK_MODE=stub` simulates charges/transfers; `live` needs real keys + webhook secret.
  Webhook signature must be verified; settlement is idempotent by `reference`.
- No heavy dependencies in mobile (APK < 15 MB, must run on 2 GB Android phones). No secrets in git.

## Setup / environment
Follow `clashgh/SETUP.md`. Secrets go in `clashgh/backend/.env` (copy from `.env.example`),
`clashgh/admin/.env` and `clashgh/mobile/.env` — all gitignored. Never paste secrets into source files,
commit messages or docs.

## Verifying changes
- Backend: start the API and exercise routes with curl; money changes must be proven against the
  `transactions` table and `runMoneyInvariantCheck()` in `services/matches.js`.
- Mobile: `npx tsc --noEmit -p clashgh/mobile` must pass; web build via `npm run web:export`.
- Admin: `npm run typecheck`.
