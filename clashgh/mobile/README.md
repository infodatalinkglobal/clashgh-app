# ClashGH Mobile (React Native + Expo)

Android-first tournament app for the ClashGH eFootball / FC Mobile / CODM / DLS
league. Modules **2A — Auth Screens** is built (with the app scaffold it
sits on); 2B–2D add the lobby, bracket and match-room UIs.

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

## Structure (agent.md §10)

```
mobile/src/
├── screens/       SignIn, Onboarding, Home (2B placeholder), Me
├── components/    ui.tsx — Screen, Button, TextField, Badge, Logo
├── navigation/    RootNavigator (auth-gated stack)
├── services/      api.ts (typed client + models), auth.ts (providers)
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
