# ClashGH Admin Panel (React + Vite)

Modules **3B — Dispute System**, **3C — Admin Dashboard** and **3F — Analytics**.
Lightweight web dashboard (React 19, Vite 7, TypeScript, **no UI/router/state
libraries** — ~80KB gzipped) hosted next to the API on Render.

## Run

```bash
cd admin
npm install
cp .env.example .env     # defaults work with the backend on :3000
npm run dev              # http://localhost:5173 (proxies /api → :3000)
npm run build            # dist/ (static) — serve from Render static site
```

Sign in with the seeded admin `admin@clashgh.dev` in dev (backend
`AUTH_PROVIDER=stub`). The **role check is server-side**: every `/api/admin/*`
route is `requireAuth + requireAdmin`; a player token gets 403 and is signed
out of the panel.

## Pages

| Page | What it does | Backend |
|---|---|---|
| **Overview** | Action queue (disputes, failed MoMo transfers with *Retry now*, lobbies past close), **lobby health** (healthy / near full / watch / at risk / past close, one-click cancel+refund — R1), revenue KPIs, recent admin actions. 30s refresh. | `GET /admin/overview`, `POST /admin/tournaments/:id/cancel`, `POST /admin/tournaments/:id/payout?force=true` |
| **Tournaments** | List by status with fill / progress / money in-out / flags; **create** form with live prize-split preview and the ₵10 runner-up floor check. | `GET /admin/tournaments`, `POST /tournaments` |
| **Tournament** | Settings, bracket table (room codes, picks, screenshot links), registrations (MoMo, UID, payment ref), full ledger with escrow balance, audit trail; cancel / run or retry payouts. | `GET /admin/tournaments/:id` |
| **Disputes** (3B) | Oldest-first queue, **both screenshots side by side** (click to zoom), each player's pick, in-game ID and historical dispute rate; matches involving a player with ≥30% dispute rate over ≥3 matches are **priority**. Resolutions: **award player** / **replay** / **cancel tournament + refund all** — the only three the backend allows. | `GET /admin/disputes`, `POST /admin/matches/:id/resolve` |
| **Players** | Search, matches/wins, dispute counts + rate, money in/out, **ban / unban** (reason required, audited; banned players are rejected at join). | `GET /admin/players`, `POST /admin/players/:id/ban` |
| **Analytics** (3F) | **Expansion gates** — fill rate ≥70%, refund rate ≤20%, dispute rate ≤10% (agent.md §1/§15); funnel, time-to-fill, match length, no-shows, daily collected / paid-out / active players, per-game table. 7/30/90-day windows. | `GET /admin/analytics?days=` |
| **Audit log** | Every manual override, newest first. | `GET /admin/audit` |

All aggregates are derived from `transactions`, `matches`, `registrations`,
`admin_audit_log` — no analytics table (agent.md §C).

## Structure

```
admin/src/
├── App.tsx            hash router + sidebar (badge counts refresh every 60s)
├── lib/api.ts         typed client (same {success,data,message} envelope), formatters
├── lib/hooks.ts       useLoad (poll + keep-last-data) / useAction (busy, confirm, message)
├── pages/             Login, Overview, Tournaments, Tournament, Disputes, Players, Analytics, Audit
└── styles.css         dark theme tokens shared with the app
```

## Production auth

`VITE_AUTH_MODE=supabase` (+ `VITE_SUPABASE_URL/ANON_KEY`) — admins sign in
with the same Supabase Auth (Google / magic link) as players; the Supabase JWT
is sent as the Bearer token and the backend's `users.role = 'admin'` gate
applies. Promote an admin with
`UPDATE public.users SET role='admin' WHERE email='…'`.
