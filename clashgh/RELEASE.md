# ClashGH release guide: Android build, Play Store, closed beta

Everything here is done by a person with the accounts. Nothing in this file is automated.

## 1. Android build with EAS

One time:

```bash
npm i -g eas-cli
eas login                      # Expo account
cd clashgh/mobile
eas init                       # links the project, writes extra.eas.projectId into app.json
eas credentials -p android     # let EAS generate the upload keystore; copy the SHA-256 fingerprint
```

Put the SHA-256 fingerprint into the backend env as `ANDROID_SHA256_FINGERPRINTS` so
`https://clashgh.app/.well-known/assetlinks.json` verifies and links like
`https://clashgh.app/app/match/...` open the app. After Play App Signing is on, add the
Play signing key fingerprint too (Play Console, Setup, App signing), comma separated.

Builds (profiles live in `mobile/eas.json`, both point the app at `https://clashgh.app/api`
with Supabase auth and live Paystack):

```bash
eas build -p android --profile preview      # APK you can send to testers on WhatsApp
eas build -p android --profile production   # AAB for the Play Store, versionCode auto increments
eas submit -p android --profile production  # uploads to the Play internal track as a draft
```

Before the first production build set `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` as EAS secrets:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://xxxx.supabase.co
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value eyJ...
eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value 1234-xxxx.apps.googleusercontent.com
```

Add `clashgh://auth/callback` and `https://clashgh.app/app/auth/callback` to the Supabase
Auth redirect allow list.

## 2. Play Console

Google Play developer account (one time fee), then create the app with these answers:

| Field | Value |
|---|---|
| App name | ClashGH |
| Default language | English (United Kingdom) |
| App or game | App (it is a tournament organiser, not a game) |
| Free or paid | Free |
| Category | Sports, or Entertainment |
| Contains ads | No |
| In app purchases | No (entry fees are collected through Paystack Mobile Money, outside Play Billing, because they are entries to skill competitions with cash prizes, not digital goods) |
| Target audience | 18 and over |
| Data safety | Collects email, name, phone number (for payouts), photos (score screenshots). Data is encrypted in transit. Users can request deletion through support@clashgh.app |
| Privacy policy URL | https://clashgh.app/privacy |

Real money skill competitions are allowed on Google Play in Ghana only if you complete the
"Real-Money Gambling, Games, and Contests" declaration under App content and state that
ClashGH runs skill based tournaments with cash prizes, no chance element, entry limited to
Ghana, 18 and over. Have your business registration ready; Google may ask for it.

Store listing copy (plain, no marketing filler):

Short description (80 characters max):

    Paid 1v1 eFootball, FC Mobile, CODM and DLS tournaments in Ghana. MoMo in and out.

Full description:

    ClashGH runs paid one versus one tournaments for mobile games played in Ghana:
    eFootball, FC Mobile, Call of Duty Mobile and Dream League Soccer.

    How it works
    1. Pick an open tournament and pay the entry fee with MTN, Telecel or AirtelTigo Mobile Money.
    2. When the lobby fills, the bracket is generated and you are paired with an opponent.
    3. Agree a time with your opponent inside the app, play the match in the game itself, and submit the final score screenshot.
    4. Winners advance. Champion and runner up prizes are sent to their MoMo numbers automatically.

    Entry fees are held until the tournament ends. If a tournament is cancelled, every player is refunded in full.
    Disputes are reviewed by a person who looks at both screenshots.

    Approved community hosts can run their own cups and earn a share of the entry fees.

    Players must be 18 or over and in Ghana. Full rules: https://clashgh.app/rules

Screenshots: take 4 to 8 phone screenshots of the real app (tournament list, tournament
page, match page with scheduling, submit result, wallet). No mock ups.

## 3. Closed beta: one real cup with four friends

Do this before telling anyone else about the app. Budget: four entries at 5 cedis, one
evening.

Setup, the day before
- [ ] Production API is up on https://clashgh.app with `NODE_ENV=production` (it will refuse to boot if any dev setting is left on).
- [ ] Paystack is in live mode and the webhook URL `https://clashgh.app/api/paystack/webhook` is registered in the Paystack dashboard.
- [ ] Your own MoMo number is set as an admin, and you have signed in to the admin panel.
- [ ] Preview APK installed on four phones (at least one MTN, one Telecel or AirtelTigo).
- [ ] Each tester has signed in with Google, set a username, and added their MoMo number (the app checks the name on the number with Paystack).

The cup
- [ ] Create a hosted or official cup: 5 cedis entry, 4 players, closes in 1 hour, starts 1 hour after close.
- [ ] All four join and pay. Check in admin: 4 paid registrations, ledger shows 4 entry fees, escrow 20 cedis.
- [ ] Wait for close: bracket appears with two round 1 matches. Each player gets an email.
- [ ] Match 1: player A proposes a time, player B accepts. Match 2: player C proposes and player D never answers. Check the admin Schedule page shows "agreed" and "proposed".
- [ ] At the agreed time both matches activate, room codes appear, players get the opponent's contact number if they opted in.
- [ ] Play both. Match 1: both submit matching results with screenshots. Match 2: submit conflicting results to force a dispute.
- [ ] Admin: resolve the dispute from the Disputes page (both screenshots visible, award to the real winner).
- [ ] Final: one player does not show up. The other waits 15 minutes, submits "won" with a screenshot. Check the walkover completes.
- [ ] Payouts: champion and runner up receive MoMo within a few minutes. Ledger balanced (collected equals paid out plus platform fee, plus host share if hosted).

Things to write down while testing
- Any screen where a tester asked "what do I do now".
- Time from tapping Pay to the MoMo prompt arriving, per network.
- Time from final result to money landing.
- Anything that needed the admin to intervene that should not have.

If all boxes tick, do a second cup with 8 players you do not know personally, then open the
Play internal track to 20 testers.
