# ClashGH — local setup & going live

Written so that you (or an AI assistant like GitHub Copilot in VS Code) can set the
project up end-to-end. **Secrets go only into `.env` files — never into source or git.**

---

## 0. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 LTS | backend, admin, mobile |
| Docker Desktop | any recent | local Postgres (or use Supabase directly, see §2b) |
| Git | any | |
| Expo Go app (phone) | latest | optional, to run the mobile app on a device |

Open the repo folder in VS Code. Recommended extensions are suggested automatically
(`.vscode/extensions.json`). Tasks are in **Terminal → Run Task…**.

---

## 1. Install dependencies

```bash
npm ci --prefix clashgh/backend
npm ci --prefix clashgh/admin
npm ci --prefix clashgh/mobile
```
(or VS Code task **install all**)

---

## 2. Database

### 2a. Local (Docker) — quickest for development
```bash
cd clashgh && docker compose up -d          # Postgres 16 on localhost:5433, user/pass clashgh/clashgh
```

### 2b. Supabase (needed for real Google sign-in and for production)
1. Create a project at https://supabase.com → note the **Project URL**, **anon key**,
   **service_role key**, and **JWT secret** (Project Settings → API).
2. Get the **connection string** (Project Settings → Database → URI, "Transaction" pooler is fine).
3. In **Authentication → Providers** enable **Google** (paste OAuth client ID/secret from Google Cloud)
   and **Email** (magic links). Add redirect URLs:
   `clashgh://auth/callback`, `http://localhost:8081/auth/callback`, and your web URL `/auth/callback`.

---

## 3. Backend `.env`

```bash
cp clashgh/backend/.env.example clashgh/backend/.env
```
Then fill in. **Minimal dev (stub everything, local Docker DB):**

```ini
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://clashgh:clashgh@localhost:5433/clashgh
AUTH_PROVIDER=stub
STUB_JWT_SECRET=<any long random string>
PAYSTACK_MODE=stub
MAIL_PROVIDER=mock
PUSH_PROVIDER=mock
SCREENSHOT_STORAGE=local
```

**Real services (add as you get the keys):**

| Variable | Where to get it | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase → Settings → Database | replaces the Docker URL |
| `AUTH_PROVIDER=supabase` + `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | JWT secret verifies user tokens |
| `PAYSTACK_MODE=live` + `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_SECRET` | https://dashboard.paystack.com → Settings → API Keys | use **test** keys (`sk_test_…`) first; webhook secret = the secret key. Set webhook URL to `https://<api-host>/api/paystack/webhook`. Enable Mobile Money + Transfers for Ghana. |
| `MAIL_PROVIDER=resend` + `RESEND_API_KEY`, `MAIL_FROM` | https://resend.com | verify your sending domain |
| `PUSH_PROVIDER=expo` (+ optional `EXPO_ACCESS_TOKEN`) | https://expo.dev → Access tokens | push notifications to phones |
| `SCREENSHOT_STORAGE=cloudinary` + `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | https://cloudinary.com dashboard | screenshot proof storage |
| `ADMIN_ALERT_EMAIL` | your email | disputes, failed payouts, host applications |
| `CORS_ORIGINS` | your admin panel URL | production only |
| `WEB_DIST=../mobile/web-dist` | — | serve the web app from the API (one origin) |

Marketplace knobs (defaults are the agreed model): `HOST_COMMISSION_PERCENT=50`,
`HOST_CUT_MAX_PERCENT=20`, `HOST_MIN_ENTRY_PESEWAS=500`.

---

## 4. Create the schema (+ dev data)

```bash
cd clashgh/backend
npm run migrate:seed        # dev: schema + demo users/tournaments
# or
npm run migrate             # production: schema only
npm run migrate:check       # see what is applied
```
The runner applies `migrations/*.sql` in order, skips the Supabase-only migration on plain
Postgres, and records versions in `schema_migrations`. Safe to re-run.

Dev identities after seeding (sign in with the email in the app's dev field):
`admin@clashgh.dev` (admin) · `kofi@dev.gh`, `ama@dev.gh`, `yao@dev.gh`, `efua@dev.gh`,
`kwame@dev.gh`, `akos@dev.gh`, `nana@dev.gh`, `abena@dev.gh` (players) · `newbie@dev.gh` (not onboarded).

---

## 5. Run

| What | Command | URL |
|---|---|---|
| API | `cd clashgh/backend && npm run dev` | http://localhost:3000/api/health |
| Admin panel | `cd clashgh/admin && cp .env.example .env && npm run dev` | http://localhost:5173 |
| Mobile app (web) | `cd clashgh/mobile && cp .env.example .env && npx expo start --web` | http://localhost:8081 |
| Mobile app (phone) | same, scan the QR in Expo Go | set `EXPO_PUBLIC_API_URL` to your LAN IP |

VS Code: task **start everything**.

Mobile `.env` for local web dev: `EXPO_PUBLIC_API_URL=http://localhost:3000/api`,
`EXPO_PUBLIC_AUTH_MODE=stub`, `EXPO_PUBLIC_PAYSTACK_MODE=stub`. When you switch the backend to
Supabase/Paystack live, mirror it: `EXPO_PUBLIC_AUTH_MODE=supabase`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_PAYSTACK_MODE=live`.

---

## 6. Smoke test (5 minutes)

1. Admin → sign in `admin@clashgh.dev` → Tournaments → create a 4-player cup.
2. App → sign in `kofi@dev.gh` → join → (stub) **Approve** payment. Repeat with `ama`, `yao`, `efua`.
3. Lobby fills → bracket generates. App → Account → **Become a host** → apply; Admin → **Hosts** → Approve.
4. App → Host Studio → publish a hosted cup; note the money preview.
5. Admin → Overview shows escrow, Analytics shows fees.

---

## 7. Deploy (production)

- **Render**: `render.yaml` at the repo root defines one web service (API + web app on one origin).
  Connect the GitHub repo, then paste the secrets from §3 into the Render dashboard (they're marked
  `sync: false`). Build runs `npm run web:export`; start runs the API with `WEB_DIST` set.
- **Database**: Supabase. Run `npm run migrate` once against the production `DATABASE_URL`
  (from your machine, or a Render one-off job). Do **not** run `--seed` in production.
- **Paystack**: switch to live keys only after a full test-key run (charge → payout → refund).
- **Mobile store builds**: `npm i -g eas-cli && eas login && cd clashgh/mobile && eas init && eas build -p android`.

---

## 8. Asking Copilot to do this

Suggested prompt once your keys are in hand:

> Read `.github/copilot-instructions.md` and `clashgh/SETUP.md`. Create `clashgh/backend/.env`
> from `.env.example` using these values: DATABASE_URL=…, SUPABASE_URL=…, … (paste keys).
> Then run `npm run migrate:seed` in `clashgh/backend`, start the API, and confirm
> `GET /api/health` returns success. Do not commit the `.env` file.

Copilot should never need your keys in chat beyond writing them into `.env`; if it suggests
committing them or pasting them into source files, refuse.

## Tests (money path)

```bash
cd clashgh/backend && npm test
```

Creates a separate database `clashgh_test` on the server in `DATABASE_URL`, runs the migrations, boots the API on a random port with stub Paystack, and plays full tournaments end to end over HTTP: 4 and 8 player official cups, a hosted cup with the 50/50 commission, cancel and refund, a late payment, a disputed final, a mid-cup refund, a replayed webhook, and finally the same money invariant checker the sweeper runs in production. Every scenario asserts that fees in equal prizes plus host share plus platform fee (or refunds) to the pesewa. Runs in about two seconds. Never touches the dev database.
