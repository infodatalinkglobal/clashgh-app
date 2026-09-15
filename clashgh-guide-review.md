# ClashGH `agent.md` — Review

*Reviewed 2026-09-14 against the guide in `uploads/Markdown.txt` (v1.0).*

**Overall:** Strong, well-structured guide. The "NEVER VIOLATE" business rules are explicit and testable, the Ghana constraints table is well-grounded, and the escrow invariant (no payout without verified, confirmed result) is stated clearly. It is ready to start building after resolving ~6 schema-affecting decisions below and a few text inconsistencies.

---

## A. Decisions needed before Module 1A (schema-affecting)

### A1. Prize pool split is undefined
§9's example says the pool "goes to tournament winner" (100% champion), but §3 never states the distribution.
- **Recommendation:** v1 = 100% of the 90% pool to the champion. State it explicitly in §3.
- If you want 1st/2nd splits, the `tournaments` schema needs split-ratio fields now.

### A2. Result confirmation model is ambiguous (biggest schema gap)
The schema has ONE `(player1_score, player2_score)` pair per match, but two players each "submit" a result. How are the two submissions compared?
- **Option a (recommended):** each player submits a screenshot + taps **"I won / I lost / draw"**. Opposing selections (A: won, B: lost) → auto-advance. No score parsing, simplest UX for non-tech-savvy users.
- **Option b:** each player enters the final score from their perspective → schema needs per-player claims (`player1_claim_*` / `player2_claim_*` or a `result_submissions` table).
- **Option c (hybrid):** winner-pick drives logic; score entry optional, stored for stats.

### A3. `users.balance_pesewas` contradicts the escrow rule
§3 says fees are tracked "in the `transactions` table, **not a separate wallet**", and money flows MoMo → Paystack merchant → MoMo transfer — no funds ever sit in an app wallet.
- **Recommendation:** drop the column (or mark it derived). Module 2F "Wallet" becomes a read-only history (fees paid, winnings, refunds) built from `transactions`.

### A4. No refresh-token storage
Auth promises an "access + refresh token pattern" (1h / 30d), but there is no `refresh_tokens` table — refresh tokens can't be revoked (logout, device change, compromise).
- **Recommendation:** add `refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at)`.

### A5. Match timing is undefined
- Nothing defines when a match goes `pending → active`, what the 30-min timer counts from, or who enforces the deadline.
- "Configurable per tournament" result window → **no column exists on `tournaments`** (only the `MATCH_DEADLINE_MINUTES` env var).
- **Recommendation:** on-demand model — match goes `active` when **both players press "I'm ready"** in the Match Room; timer starts then. Add `result_window_minutes` to `tournaments`. Deadline enforcement via a lightweight sweeper loop in the backend (~every 60s, no extra infra on Render).

### A6. No lobby deadline → refund path is undefined
If 12/16 players have joined, when does the lobby close? §3 says "if it doesn't fill, refund" — but nothing defines *when* "doesn't fill" is decided.
- **Recommendation:** `registration_deadline` (or auto-close window) on `tournaments`; refund workflow = Paystack refund API against each charge reference, admin-triggered or auto on close. Also define `cancelled`: who can cancel, and funds always refunded.

### A7. Who can create tournaments?
`tournaments.created_by` exists but no permission rule exists anywhere.
- **Recommendation:** v1 = **admin-created only** (platform-hosted). If players host, you need creator revenue/pricing rules before 1C.

### A8. Draws are unhandled
Single elimination requires a winner, but eFootball/FC Mobile/DLS can end level.
- **Recommendation:** "draw" is a valid confirm option; if both players pick draw → match is flagged for admin (replay decision or sudden-death rule per game, defined in §3).

### A9. Pending registrations hold slots forever (undefined)
A player who initiates a charge and abandons it holds a `pending` registration.
- **Recommendation:** only `paid` registrations count toward fill status; a cleanup job expires stale pendings (e.g., 10 min).

### A10. `users.is_verified` — meaning undefined
KYC? MoMo verified? Either define it or drop it from v1.

### A11. "Byes" contradict the fill rule
The `matches` comment says NULL player slots are "for byes or future rounds", but the lobby must fill to exactly the cap → byes can't happen.
- **Fix:** NULLs are for **future-round placeholders only**. Remove "byes" from the doc.

### A12. Phone prefix lists disagree
§3 lists 024, 025, 026, 027, 028, 020, 050, 054, 055, 059 — **missing 053 (MTN) and 056/057 (AirtelTigo)** that §8 includes. Reconcile.
- Keep the enum values `'mtn' | 'vodafone' | 'airteltigo'` — they match Paystack's API provider codes (retain even though Vodafone Ghana rebranded to Telecel in 2023).

---

## B. Text fixes (non-blocking)

1. Room code: the trailing prompt says "6-**digit**" — standardize on **"6 characters, A–Z and 2–9"**.
2. §13 items are numbered 95–108 instead of 1–14.
3. The file ends with the original generation prompt — remove it from the canonical guide; rename file `Markdown.txt` → `agent.md`.
4. "Platform fee calculated once at payout" vs `platform_fee_pesewas` "computed at bracket generation" — clarify: computed at bracket generation, **recorded as a transaction at payout**.

---

## C. Gaps to resolve before later modules

| Module | Gap | Recommendation |
|---|---|---|
| 1B Auth | OTP policy unspecified | 5-min expiry, max 5 attempts, 60s resend cooldown. **SMS provider undecided** (Termii / Africa's Talking / Twilio) — per-SMS cost is a real line item in Ghana; decide now. Username rules (3–20 chars, `[a-z0-9_]`). Refresh token rotation + revocation flow. |
| 1B/3C | How admins log into the web panel | Same phone+OTP + role check, or admin email+password (decide in 3C). |
| 1D Brackets | `current_players` is a denormalized counter — race condition on concurrent joins | Compute fill from `COUNT(paid registrations)` or `UPDATE ... WHERE` with a row lock. |
| 1E Payments | Webhook signature encoding | Paystack docs example uses HMAC-SHA512 → **base64**, compared to `x-paystack-signature`. Confirm during implementation. |
| 1E Payments | Transfer fees & minimums | Paystack MoMo transfers have fees/minimums — they eat into the 10% platform fee. Verify current schedule; decide if prize pool nets them. |
| 1F Matches | `game_uid` validation | Define min length/charset per game (eFootball UID ≠ CODM ID). |
| 1F Matches | Duplicate payout protection | Partial unique index on `transactions (match_id) WHERE type = 'payout'`. |
| 3B Disputes | Admin SLA + resolution options undefined | Resolution = confirm winner, or void match (refund + define bracket slot handling). No auto-penalty system in v1 (manual ban at most). |
| 3E Notifications | SMS provider decision gates SMS | Same as 1B. Push via Expo is fine. |
| 2F Wallet | "Cache wallet balance offline" | Becomes "cache recent transactions" if A3 drops the balance. |
| Mobile | APK < 15MB | Tight but achievable: hand-rolled bracket view (no bracket libs), avoid heavy native deps; verify size early at end of 2B. |
| 1A DB | Migration runner undecided | Versioned `.sql` files applied via Supabase SQL editor + a `schema_migrations` table tracking applied versions (simplest, matches "use SQL directly"). |
| 3F Analytics | No events table | Derive from `transactions` + `matches` in v1; no separate table needed. |

---

## D. What the guide does well (keep as-is)

- Explicit "NEVER VIOLATE" money/escrow rules with the exact payout trigger conditions.
- Ghana constraints table that actually drives technical decisions.
- Standardized API response shape + status code table.
- Integer-pesewas money rule, E.164 internal / local display split.
- "Ask before building, don't guess" rule — this review is following it.
- Module status tracking (⬜/✅) with a strict build order.

---

## E. Suggested next steps

1. Lock in decisions A1–A8 + A7 (five questions).
2. Apply A9–A12 + §B fixes → produce the canonical `clashgh/agent.md` (v1.1).
3. Start **Module 1A** with a final clarifying round (indexes, final column list, migration approach).
