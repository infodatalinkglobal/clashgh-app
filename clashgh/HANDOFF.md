# ClashGH handoff for VS Code (2026-09-16)

Branch `arena/01a0a65e-clashgh-app`, last commit `45b4015`, everything pushed, tree clean.

## Decision
Launch as a website first. The public site is server rendered at `/`, the signed in part
(tournaments, join and pay, matches, wallet, hosting) runs in the browser at `/app`. Same
code becomes the Play Store and App Store apps later (see `RELEASE.md` section 2). Do not
build native yet.

## Get running in 10 minutes
```bash
git clone <repo> && cd clashgh-app && git checkout arena/01a0a65e-clashgh-app
npm ci --prefix clashgh/backend && npm ci --prefix clashgh/admin && npm ci --prefix clashgh/mobile
cd clashgh && docker compose up -d                       # Postgres on 5433
cp backend/.env.example backend/.env                     # then edit: DATABASE_URL, STUB_JWT_SECRET, WEB_DIST=../mobile/web-dist
cp mobile/.env.example mobile/.env                       # EXPO_PUBLIC_API_URL=/api for the web build
cd backend && npm run migrate -- --seed && cd ..
cd mobile && EXPO_NO_TELEMETRY=1 npm run web:export && cd ..
cd backend && npm run dev                                # http://localhost:3000  (site at /, app at /app)
cd admin && npm run dev                                  # http://localhost:5173  admin panel
```
VS Code tasks for each step are in `.vscode/tasks.json`. Copilot context is in
`.github/copilot-instructions.md` and `agent.md` (the rules) plus its dated addenda at the end.

Dev sign in (no password): admin@clashgh.dev, kofi/ama/yao/efua/kwame/akos/nana/abena@dev.gh.
nana is an approved host. Payments are stubbed: the join screen shows Approve / Decline buttons.

Tests: `cd clashgh/backend && npm test` (money path 18, Paystack live path 2, rate limits 2).

## What is done
Backend API, public SEO site, browser app, admin panel, community hosts (50/50 split, 20% cap,
5 cedi hosted minimum), match scheduling (24 h window, propose/accept, one reschedule,
walkover), notifications outbox (email + push), rate limits and production boot guards,
Paystack client aligned with the current API and tested against a mock, Render blueprint.

## What is left (accounts, not code)
Owner answers so far: no domain yet (buying this week), Paystack test keys only, Google sign in,
hosts open from day one, players mostly on phones.

1. Paystack: business registration, then live keys and Mobile Money transfers enabled.
   Until then run end to end against the TEST keys: set `PAYSTACK_MODE=live` with the
   `sk_test_` key and `PAYSTACK_API_URL=https://api.paystack.co`; use ngrok for the webhook.
2. Supabase project + Google OAuth client. `AUTH_PROVIDER=supabase`, run migration 002 there.
3. Resend (email) and Cloudinary (screenshots) keys.
4. Render from `render.yaml`; free `*.onrender.com` URL works with no domain (SITE_ORIGIN
   falls back to RENDER_EXTERNAL_URL). When the domain arrives: set SITE_ORIGIN, uncomment
   `domains:` in render.yaml, add the two DNS records.
5. Set `SITE_LEGAL_NAME` to the registered business name.
6. Closed beta: `RELEASE.md` section 3.

Full checklist with every env var: `RELEASE.md` section 1.

## Conventions (short)
snake_case JSON, integer pesewas, `{ success, data, message }` envelope, no heavy deps,
no dashes or emoji in user facing text, neutral dark theme with gold accent, no gradients.
Commit small, run `npm test` before pushing.
