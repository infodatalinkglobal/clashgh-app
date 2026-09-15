# ClashGH Mobile (React Native + Expo)

Android-first tournament app for the ClashGH eFootball / FC Mobile / CODM / DLS
league. Modules **2A — Auth Screens**, **2B — Home & Lobby**,
**2C — Tournament View**, **2D — Match Room** and **2E — Score Submit** are
built; 2F adds the wallet (transaction history) UI.

## Stack

- **Expo SDK 57** (React Native 0.86, React 19, TypeScript strict)
- **React Navigation** (native stack) — no tab/drawer until 2B needs them
- **No heavy native deps** (agent.md §14): theme and bracket views are
  hand-rolled; `expo-secure-store` is the only storage native module
  (tokens), `expo-auth-session`/`@supabase/supabase-js` are used only in
  `supabase` auth mode
- Verified bundle: **2.5MB** Hermes bytecode (well under the 15MB APK
  budget; APK checkpoint at the end of 2B per the guide)

## Run it

```bash
cd mobile
npm install
cp .env.example .env          # adjust EXPO_PUBLIC_API_URL if needed
npm start                     # Expo dev server → scan QR / press a
```

API base URL for the dev sandbox: a physical Android device reaches the
host's localhost at `http://10.0.2.2:3000/api` (the default). On a LAN
device use the host's LAN IP.

## Auth modes (`EXPO_PUBLIC_AUTH_MODE`)

| Mode | Sign-in | When |
|---|---|---|
| `stub` (default) | "Google" button presents a dev identity picker → `POST /api/dev/auth/signin` issues the same JWT format production uses | dev/sandbox — no Google or Supabase credentials needed |
| `supabase` | Google OAuth + email magic link via Supabase Auth; the JWT Supabase issues is what the backend verifies (`/api/me`, deep link `clashgh://auth/callback?code=…`) | once the Supabase project exists — **zero app route changes** (1B was built for this swap) |

## Onboarding (one-time, after first sign-in)

1. Username (3-20 chars: lowercase/numbers/underscore)
2. MoMo number — the ONE number that both pays and receives; provider
   (MTN / Telecel / AirtelTigo) detected live from the prefix
3. SMS OTP — verified exactly once (`POST /api/me/phone/verify`); no
   repeated OTPs. In dev the code is printed by the mock SMS provider in
   the API server console.

Unverified users are hard-gated to the onboarding screen; verified users
go to Home.

## Home & Lobby + Join (Module 2B)

- **Home**: tournament list (`GET /tournaments`), game filter chips,
  entry fee / paid count / spots left / 1st + runner-up prizes / close
  and start times, "Last updated" label, pull-to-refresh and refresh on
  focus. Per-card state comes from `GET /tournaments/:id/me`: **Join**,
  **Finish payment →** (resume a pending registration), **You're in ✓**,
  Full / In progress / Closed / Cancelled.
- **Join** (`screens/JoinScreen.tsx`): enter the in-game UID for that
  game → `POST /tournaments/:id/join` creates the pending registration +
  MoMo charge → the screen shows a **10-minute countdown** (the backend's
  pending TTL) and polls `/tournaments/:id/me` every 4s until the
  webhook flips the registration to `paid`. The app never assumes
  success — only the settled webhook does. Live Paystack opens
  `authorization_url` in the system browser; in `EXPO_PUBLIC_PAYSTACK_MODE=stub`
  a dev panel simulates the webhook (Approve / Decline) via
  `POST /dev/paystack/simulate-charge`.
- Joining again with a pending registration (409) resumes the payment
  screen instead of erroring.

## Tournament View (Module 2C)

- `screens/TournamentScreen.tsx`: prize pool with the 1st / runner-up
  split (projected while the lobby is open, fixed once the bracket is
  drawn — recomputed client-side with the same floor math as
  `utils/prize.js`), schedule, paid-count progress, my status badges
  (You're in / Champion / Eliminated), Join / Finish payment / Go to match
  actions. Polls every `matchPollMs` only while `in_progress`.
- `components/Bracket.tsx`: hand-rolled single-elimination bracket — one
  horizontally scrolled column per round, each match centred against the
  two matches that feed it; my matches are highlighted and tappable
  (→ Match room, 2D), LIVE / Disputed / Done pills, seeds, winner ✓ and
  struck-through losers. No bracket libraries (APK budget).

## Match Room (Module 2D)

`screens/MatchScreen.tsx` follows one match through its whole life from
`GET /matches/:id` (public — the backend exposes usernames, seeds and
in-game IDs so players can find each other):

| status | what the player sees |
|---|---|
| `pending` | opponent (or "TBD" until the previous round finishes), live countdown to kick-off (`tournament_starts_at`, added to the match payload) — room code hidden |
| `active` | **room code** large + selectable, both in-game IDs, result-window countdown (turns red under 5 min), 5-step instructions, **Submit result →** (2E) |
| `awaiting_results` | my pick badge, waiting for opponent |
| `disputed` | under-review card with the reason; payouts locked |
| `completed` | won / eliminated banner (champion / runner-up copy once the cup is `completed`) |

Polls every `Config.matchPollMs` (30s) only while the match is not
completed, so the room code shows up within a sweep of activation
without push notifications (3E adds those).

## Score Submit (Module 2E)

`screens/SubmitResultScreen.tsx` + `services/screenshots.ts`:

1. **Screenshot first** (gallery or camera via `expo-image-picker`) — the
   pick cannot be submitted without one (agent.md §3; the API also
   rejects it with 400).
2. Compression on-device with `expo-image-manipulator`: longest edge
   ≤1280px, JPEG quality stepped 0.8 → 0.2 until **≤500KB** (agent.md §4
   low-data rule). The size is shown in the preview.
3. Pick **I won / I lost / Draw / Dispute** (+ a short reason for
   dispute). Rules for what each pick does are explained inline.
4. Confirm → `POST /uploads/screenshot` (base64 JPEG, auth) → URL →
   `POST /matches/:id/result`. Upload happens only at confirm time.
5. Outcome screen: completed (won / confirmed), waiting for opponent, or
   under admin review.

Storage is the backend's concern (`SCREENSHOT_STORAGE=local` writes to
`backend/uploads-dev`; `cloudinary` is wired in `services/screenshots.js`
for Module 3D — no app change needed).

### Web preview (dev only)

`npx expo start --web` works for a quick look (needs `react-dom` +
`react-native-web`, installed with `--no-save`). The backend sends CORS
headers outside production; set `EXPO_PUBLIC_API_URL` to the API's URL as
seen from the browser.

## Structure (agent.md §10)

```
mobile/src/
├── screens/       SignIn, Onboarding, Home (lobby list), Tournament (bracket), Join (UID + pay), Match (room), SubmitResult (screenshot + pick), Me
├── components/    ui.tsx (Screen, Button, TextField, Badge, Logo), Bracket.tsx
├── components/    ui.tsx — Screen, Button, TextField, Badge, Logo
├── navigation/    RootNavigator (auth-gated stack)
├── services/      api.ts (typed client + models), auth.ts (providers), screenshots.ts (pick → compress → upload)
├── store/         AuthContext (session state)
├── utils/         phone.ts (E.164, provider detection, username rules)
├── config.ts      API URL, auth mode, Supabase creds (EXPO_PUBLIC_*)
└── theme.ts       colors / spacing / typography tokens
```

## What was verified (Module 2A test log)

- [x] `tsc --noEmit` clean (strict)
- [x] `expo export --platform android` bundles: 2.5MB Hermes bytecode, no unresolved imports
- [x] Full app HTTP flow against the live sandbox API, mirroring the app's
      endpoint wrappers: dev sign-in (new user, profile bootstrapped) →
      `GET /me` (unverified, no username) → `PATCH /me` (username) →
      `request-otp` (code via mock SMS) → `verify-otp` (MTN provider
      detected from `024` prefix) → `GET /me` (verified profile) →
      `GET /tournaments` (Home list with fees/status/spots)
- [x] Phone utils mirror the backend's canonical prefix list (MTN
      024/025/053/054/055/059 · Telecel 020/050 · AirtelTigo
      026/027/028/056/057) and E.164 normalization

## Notes for 2B+

- `endpoints.ts` already wraps join / bracket / match / result — the
  screens can call them directly
- Match screens should poll at `Config.matchPollMs` (30s), never faster
- Screenshots (2E) are submitted as URLs; the upload endpoint (Cloudinary)
  lands with that module
- Screenshot quality: full score screen, no crops; compress ≤ 500KB
  before upload (agent.md §14)
