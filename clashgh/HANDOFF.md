# ClashGH — session handoff (2026-09-15)

Branch: `arena/01a0a65e-clashgh-app` · last commit `2a30173` · everything pushed, working tree clean.

## What exists
- **Backend** (`clashgh/backend`): full API — auth, tournaments, brackets, Paystack MoMo (stub/live),
  match flow, disputes, payouts w/ retries, notifications outbox (email+push), uploads, admin
  dashboard, **community hosts** (migration 006). Serves the web app when `WEB_DIST` is set.
- **Mobile/Web** (`clashgh/mobile`): Expo app, web is first-class (PWA, persistent session,
  480px desktop frame). Esports redesign (theme, key art, animations). Screens: SignIn,
  Onboarding, Home, Tournament, Join, Match, SubmitResult, Wallet, Inbox, Account, **Host Studio**.
- **Admin** (`clashgh/admin`): Vite SPA — Overview, Tournaments, Disputes, Players, **Hosts**,
  Analytics, Audit.
- `render.yaml` at repo root — one Render service = API + web build.

## Marketplace model (decided)
Apply → admin approves · host cut ≤ 20% after prizes · **50/50** host/ClashGH split ·
paid via the same auto-MoMo pipeline · hosts create/cancel only · official cups unchanged.
Env: `HOST_COMMISSION_PERCENT=50`, `HOST_CUT_MAX_PERCENT=20`, `HOST_MIN_ENTRY_PESEWAS=500`.

## Local setup outside the sandbox
See `clashgh/SETUP.md` (Docker Postgres, `npm run migrate:seed`, VS Code tasks, Copilot instructions in
`.github/copilot-instructions.md`). The owner intends to continue in VS Code + Copilot with real keys.

## Open items / ideas for next session
1. ~~Verify host button in the user's browser~~ ✅ confirmed 2026-09-16 (full apply→approve→publish loop).
2. Host reputation on cards (cups completed, cancel rate) — data exists in `/admin/hosts`.
3. Distinctive display font (expo-font + OFL face) for the esports look.
4. Path to launch: Supabase + Render deploy, Paystack test keys e2e, Resend/Cloudinary keys,
   `eas init` + phone build, money-path test suite, closed beta.

## Dev stack (sandbox may be recycled — rebuild if ports are dead)
- Postgres: embedded, `/tmp/pg/start.mjs` (5433) — re-run migrations 001,003–006 + seeds if lost.
- API: `cd clashgh/backend && node src/server.js` (3000).
- Web preview: `cd clashgh/mobile && EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 npm run web:export &&
  PORT=8082 STATIC_DIR=web-dist API_TARGET=http://localhost:3000 node scripts/web-preview-proxy.mjs`.
- Admin: `cd clashgh/admin && npm run dev -- --host 0.0.0.0 --port 5173`.
- Seed logins (dev sign-in, any email below): admin@clashgh.dev, kofi/ama/yao/efua/kwame/akos/
  nana/abena@dev.gh, newbie@dev.gh. `nana` is an approved host with one completed cup.
