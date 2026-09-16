-- ClashGH: full schema for Supabase. Paste into SQL Editor and Run once.
-- Generated 2026-09-16 from migrations 001, 003-007 and the Supabase auth trigger (002).
-- Every statement is idempotent; re-running is safe.

-- ===== 001_initial_schema =====
-- =============================================================
-- ClashGH — Migration 001: Initial Schema
-- Target: PostgreSQL 13+ (Supabase Postgres / local dev)
-- Apply in order: 001 → 002 (Supabase only)
-- Idempotent enough for re-runs in dev: re-running fails on
-- CREATE TABLE (by design) — for a clean re-run, see README.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 0. Enum types
--    Fixed status sets. Extending an enum later = ALTER TYPE
--    (new value, new migration).
-- -------------------------------------------------------------
DO $$ BEGIN CREATE TYPE public.user_role AS ENUM ('player', 'admin');        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.momo_provider AS ENUM ('mtn', 'vodafone', 'airteltigo'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.game_type AS ENUM ('efootball', 'fc_mobile', 'codm', 'dls'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.tournament_status AS ENUM ('open', 'full', 'in_progress', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.match_pick AS ENUM ('won', 'lost', 'draw', 'dispute'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.match_status AS ENUM ('pending', 'active', 'awaiting_results', 'disputed', 'completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.transaction_type AS ENUM ('entry_fee', 'payout', 'refund', 'platform_fee'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.transaction_status AS ENUM ('pending', 'success', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.tx_direction AS ENUM ('in', 'out'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------
-- 1. Migration tracking
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------
-- 2. updated_at trigger (shared)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 3. users
--    IMPORTANT: id = Supabase auth.users.id. There is NO foreign
--    key to auth.users because the auth schema is managed by
--    Supabase and does not accept incoming FKs. Profile rows are
--    created by the handle_new_user() trigger (migration 002).
--    `phone` is the single MoMo number: pays entry fees AND
--    receives payouts. Verified once at onboarding.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id             UUID PRIMARY KEY,
  email          VARCHAR(320) UNIQUE,
  phone          VARCHAR(20) UNIQUE,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  username       VARCHAR(30) UNIQUE,
  momo_provider  public.momo_provider,
  role           public.user_role NOT NULL DEFAULT 'player',
  is_banned      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ghana only: E.164 = +233 followed by 9 digits
  CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^\+233[0-9]{9}$'),
  -- Onboarding username rules (3-20, lowercase alphanumeric + underscore)
  CONSTRAINT users_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'),
  -- momo_provider must be consistent with the phone prefix it was derived from
  CONSTRAINT users_provider_consistency CHECK (
    phone IS NULL OR momo_provider IS NULL OR (
      (phone ~ '^\+233(24|25|53|54|55|59)' AND momo_provider = 'mtn') OR
      (phone ~ '^\+233(20|50)'              AND momo_provider = 'vodafone') OR
      (phone ~ '^\+233(26|27|28|56|57)'     AND momo_provider = 'airteltigo')
    )
  )
);

CREATE INDEX IF NOT EXISTS users_role_idx ON public.users (role);

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 4. tournaments
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournaments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 VARCHAR(120) NOT NULL,
  game                  public.game_type NOT NULL,
  entry_fee_pesewas     INTEGER NOT NULL CHECK (entry_fee_pesewas > 0),
  max_players           INTEGER NOT NULL CHECK (max_players IN (4, 8, 16, 32, 64)),
  starts_at             TIMESTAMPTZ NOT NULL,
  closes_at             TIMESTAMPTZ NOT NULL,
  result_window_minutes INTEGER NOT NULL DEFAULT 30 CHECK (result_window_minutes BETWEEN 5 AND 240),
  -- Split is a % of the TOTAL collected; platform fee is the remainder.
  -- Checked at the API (Module 1C) against MIN_ENTRY_FEE / MIN_PRIZE_PESOWAS.
  first_place_percent   INTEGER NOT NULL DEFAULT 70 CHECK (first_place_percent BETWEEN 1 AND 99),
  runnerup_percent      INTEGER NOT NULL DEFAULT 20 CHECK (runnerup_percent BETWEEN 1 AND 99),
  prize_pool_pesewas    INTEGER CHECK (prize_pool_pesewas IS NULL OR prize_pool_pesewas > 0),
  platform_fee_pesewas  INTEGER CHECK (platform_fee_pesewas IS NULL OR platform_fee_pesewas >= 0),
  status                public.tournament_status NOT NULL DEFAULT 'open',
  created_by            UUID NOT NULL REFERENCES public.users (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tournaments_split_check CHECK (first_place_percent + runnerup_percent <= 100),
  CONSTRAINT tournaments_timing_check CHECK (starts_at > closes_at)
);

CREATE INDEX IF NOT EXISTS tournaments_status_idx    ON public.tournaments (status);
CREATE INDEX IF NOT EXISTS tournaments_game_idx      ON public.tournaments (game);
CREATE INDEX IF NOT EXISTS tournaments_starts_at_idx ON public.tournaments (starts_at);
CREATE INDEX IF NOT EXISTS tournaments_closes_at_idx ON public.tournaments (closes_at);

DROP TRIGGER IF EXISTS tournaments_set_updated_at ON public.tournaments;
CREATE TRIGGER tournaments_set_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 5. registrations
--    Only 'paid' rows count toward lobby fill. 'pending' rows are
--    deleted by the sweeper after REGISTRATION_PENDING_TTL_MINUTES.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  game_uid          VARCHAR(64) NOT NULL CHECK (char_length(game_uid) BETWEEN 1 AND 64),
  payment_status    public.payment_status NOT NULL DEFAULT 'pending',
  payment_reference VARCHAR(128),
  seed              INTEGER CHECK (seed IS NULL OR seed >= 1),
  eliminated        BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registrations_unique_user_tournament UNIQUE (tournament_id, user_id)
);

-- Lobby fill counts (the hot query for the sweeper + tournament list)
CREATE INDEX IF NOT EXISTS registrations_tournament_payment_idx ON public.registrations (tournament_id, payment_status);
CREATE INDEX IF NOT EXISTS registrations_user_idx ON public.registrations (user_id);

DROP TRIGGER IF EXISTS registrations_set_updated_at ON public.registrations;
CREATE TRIGGER registrations_set_updated_at
  BEFORE UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 6. matches
--    NULL player slots are future-round placeholders only (no byes).
--    room_code charset: A-Z minus I,O,L + 2-9 (6 chars), unique
--    while non-null (completed matches never clash: codes are random
--    and never reused).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matches (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id          UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
  match_round        INTEGER NOT NULL CHECK (match_round >= 1),
  match_number           INTEGER NOT NULL CHECK (match_number >= 1),
  player1_id             UUID REFERENCES public.users (id),
  player2_id             UUID REFERENCES public.users (id),
  room_code              VARCHAR(6),
  player1_pick           public.match_pick,
  player2_pick           public.match_pick,
  player1_screenshot_url TEXT,
  player2_screenshot_url TEXT,
  winner_id              UUID REFERENCES public.users (id),
  status                 public.match_status NOT NULL DEFAULT 'pending',
  dispute_reason         TEXT,
  started_at             TIMESTAMPTZ,
  deadline_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT matches_players_distinct CHECK (player1_id IS NULL OR player2_id IS NULL OR player1_id <> player2_id),
  CONSTRAINT matches_room_code_format CHECK (room_code IS NULL OR room_code ~ '^[A-HJ-KM-NP-Z2-9]{6}$'),
  CONSTRAINT matches_room_code_unique UNIQUE (room_code),
  CONSTRAINT matches_one_winner CHECK (
    status <> 'completed' OR winner_id IS NOT NULL AND winner_id IN (player1_id, player2_id)
  )
);

CREATE INDEX IF NOT EXISTS matches_tournament_round_idx ON public.matches (tournament_id, match_round);
CREATE INDEX IF NOT EXISTS matches_status_idx           ON public.matches (status);
CREATE INDEX IF NOT EXISTS matches_deadline_idx         ON public.matches (deadline_at);

DROP TRIGGER IF EXISTS matches_set_updated_at ON public.matches;
CREATE TRIGGER matches_set_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 7. transactions
--    Escrow ledger. Money in = entry fees; money out = payouts,
--    refunds. platform_fee rows record the platform's cut at payout.
--    IMPORTANT (double-payout guard): at most ONE payout per
--    (match, user). The final match legitimately carries TWO payout
--    rows (champion + runner-up) — one per user.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  tournament_id        UUID REFERENCES public.tournaments (id) ON DELETE SET NULL,
  match_id             UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  type                 public.transaction_type NOT NULL,
  amount_pesewas       INTEGER NOT NULL CHECK (amount_pesewas > 0),
  status               public.transaction_status NOT NULL DEFAULT 'pending',
  paystack_reference   VARCHAR(128),
  paystack_transfer_code VARCHAR(128),
  direction            public.tx_direction NOT NULL,
  description          TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wallet history (Module 2F): a user's money, newest first
CREATE INDEX IF NOT EXISTS transactions_user_created_idx    ON public.transactions (user_id, created_at DESC);
-- Revenue / payout reports (Module 3F)
CREATE INDEX IF NOT EXISTS transactions_tournament_type_idx ON public.transactions (tournament_id, type);
-- Double-payout guard (see IMPORTANT above)
CREATE UNIQUE INDEX IF NOT EXISTS transactions_payout_match_user_unique
  ON public.transactions (match_id, user_id)
  WHERE type = 'payout' AND match_id IS NOT NULL;

DROP TRIGGER IF EXISTS transactions_set_updated_at ON public.transactions;
CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 8. webhook_events
--    Idempotency ledger for Paystack webhooks: a duplicate event id
--    is rejected by the unique constraint and dropped by the handler.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paystack_event_id VARCHAR(128) UNIQUE,
  event_type        VARCHAR(64) NOT NULL,
  payload           JSONB,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_type_idx ON public.webhook_events (event_type);

DROP TRIGGER IF EXISTS webhook_events_set_updated_at ON public.webhook_events;
CREATE TRIGGER webhook_events_set_updated_at
  BEFORE UPDATE ON public.webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 9. admin_audit_log
--    Every manual override (dispute resolution, cancel, re-payout,
--    ban/unban) is logged here: who, what, before/after.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES public.users (id),
  action      VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id   UUID,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_entity_idx ON public.admin_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS admin_audit_admin_idx  ON public.admin_audit_log (admin_id);

DROP TRIGGER IF EXISTS admin_audit_log_set_updated_at ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_set_updated_at
  BEFORE UPDATE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 10. Row Level Security (defense in depth)
--     No client ever talks to Postgres directly: all data access
--     goes through the Express API using the service role, which
--     bypasses RLS. Enabling RLS with NO policies means any
--     direct anon/authenticated access is denied by default.
-- -------------------------------------------------------------
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- 11. Record this migration
-- -------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES (1, 'initial_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ===== 003_phone_verifications =====
-- =============================================================
-- ClashGH — Migration 003: Phone verification challenges (1B)
-- One active challenge per phone: the hashed OTP for the one-time
-- onboarding verification. Row is deleted on successful verify.
-- Idempotent: safe to re-run in dev.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.phone_verifications (
  phone      VARCHAR(15) PRIMARY KEY,
  otp_hash   TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT phone_verifications_format CHECK (phone ~ '^\+233[0-9]{9}$')
);

DROP TRIGGER IF EXISTS phone_verifications_set_updated_at ON public.phone_verifications;
CREATE TRIGGER phone_verifications_set_updated_at
  BEFORE UPDATE ON public.phone_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migrations (version, name)
VALUES (3, 'phone_verifications')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ===== 004_transactions_retry =====
-- =============================================================
-- ClashGH — Migration 004: Payout retry tracking (Module 1E)
-- `attempts` + `next_retry_at` on transactions power the payout
-- retry backoff (15min / 1h / 6h, max 3 — agent.md §9 step 6).
-- Idempotent: safe to re-run in dev.
-- =============================================================

BEGIN;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS transactions_retry_idx
  ON public.transactions (next_retry_at)
  WHERE type = 'payout' AND status = 'failed';

INSERT INTO public.schema_migrations (version, name)
VALUES (4, 'transactions_retry_tracking')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ===== 005_notifications =====
-- =============================================================
-- ClashGH — Migration 005: Notifications (3E) + MoMo number w/o OTP
--
-- Decisions (user, 2026-09-15):
--  * No SMS OTP. The MoMo number is set once in onboarding and proven
--    by money movement: Paystack name-resolution when it is entered
--    (live mode) and the first successful charge/transfer to it.
--    `users.phone_verified` keeps its name (every route reads it) but
--    now means "MoMo number confirmed by the player".
--  * Email (Resend) for money/outcome events, Expo push for the
--    time-sensitive ones. Sends go through an outbox table so a
--    provider outage never blocks or rolls back a money transaction.
-- Idempotent: safe to re-run in dev.
-- =============================================================

BEGIN;

DROP TABLE IF EXISTS public.phone_verifications;

DO $$ BEGIN CREATE TYPE public.notification_channel AS ENUM ('email', 'push'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.notification_status  AS ENUM ('pending', 'sent', 'failed', 'skipped'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Outbox: one row per (recipient, channel, event). Written INSIDE the
-- business transaction; delivered by the notifications sweeper.
CREATE TABLE IF NOT EXISTS public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.users(id) ON DELETE CASCADE,  -- NULL = admin alert
  channel         public.notification_channel NOT NULL,
  template        VARCHAR(40) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          public.notification_status NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_due_idx
  ON public.notifications (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);

DROP TRIGGER IF EXISTS notifications_set_updated_at ON public.notifications;
DROP TRIGGER IF EXISTS notifications_set_updated_at ON public.notifications;
CREATE TRIGGER notifications_set_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Expo push tokens. A user may have several devices; a token belongs to
-- exactly one user (re-registering after switching accounts moves it).
CREATE TABLE IF NOT EXISTS public.push_tokens (
  token       VARCHAR(200) PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform    VARCHAR(10) NOT NULL DEFAULT 'android',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_format CHECK (token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$')
);

CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens (user_id);

DROP TRIGGER IF EXISTS push_tokens_set_updated_at ON public.push_tokens;
DROP TRIGGER IF EXISTS push_tokens_set_updated_at ON public.push_tokens;
CREATE TRIGGER push_tokens_set_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens   ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migrations (version, name)
VALUES (5, 'notifications')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ===== 006_hosts =====
-- =============================================================
-- ClashGH — Migration 006: Community hosts (marketplace model)
--
-- Decisions (user, 2026-09-15):
--  * Verified players apply to host; an admin approves. Hosts create
--    and cancel their own tournaments; disputes/refunds/payouts stay
--    automated/admin.
--  * Money: entry fees still flow into the platform's Paystack account.
--    The remainder after 1st + runner-up (host_cut, capped at 20%) is
--    split 50/50 between host and platform (HOST_COMMISSION_PERCENT).
--    Official tournaments (host_id NULL) keep the remainder as platform fee.
--  * Host share is paid by the same auto-MoMo pipeline as prizes.
-- Idempotent.
-- =============================================================
BEGIN;

DO $$ BEGIN CREATE TYPE public.host_status AS ENUM ('none', 'pending', 'approved', 'suspended'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS host_status      public.host_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS host_applied_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS host_note        VARCHAR(300);   -- application pitch / admin reason

CREATE INDEX IF NOT EXISTS users_host_status_idx ON public.users (host_status) WHERE host_status <> 'none';

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS host_id             UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS host_share_pesewas  INTEGER CHECK (host_share_pesewas IS NULL OR host_share_pesewas >= 0),
  ADD COLUMN IF NOT EXISTS rules_text          VARCHAR(600);

CREATE INDEX IF NOT EXISTS tournaments_host_idx ON public.tournaments (host_id) WHERE host_id IS NOT NULL;

-- New money leg: the host's share paid out at completion.
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'host_share';

INSERT INTO public.schema_migrations (version, name)
VALUES (6, 'hosts')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ===== 007_match_scheduling =====
-- =============================================================
-- ClashGH — Migration 007: Player-scheduled matches
--
-- Decisions (user, 2026-09-16):
--  * The two players agree on ONE time for their match. Either proposes,
--    the other accepts or counter-proposes.
--  * Each round gives players 24 hours (ROUND_WINDOW_HOURS) from the moment
--    the round opens (round 1: tournament.starts_at; later rounds: when
--    both players are known) to agree and play.
--  * If the opponent never answers, the proposed time stands at that time.
--    If nobody proposes at all, the match activates when the window ends.
--  * One reschedule per match (either player), then a missed time is a
--    walkover: the present player submits "won" and the deadline rule
--    settles it.
--  * Players may add an optional contact number (WhatsApp) shown only to
--    their current opponent while the match is open.
-- Idempotent.
-- =============================================================
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS round_opens_at    TIMESTAMPTZ,          -- scheduling window start
  ADD COLUMN IF NOT EXISTS proposed_at       TIMESTAMPTZ,          -- the time currently on the table
  ADD COLUMN IF NOT EXISTS proposed_by       UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS scheduled_at      TIMESTAMPTZ,          -- agreed time (activation moment)
  ADD COLUMN IF NOT EXISTS reschedule_count  INTEGER NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0);

CREATE INDEX IF NOT EXISTS matches_pending_due_idx
  ON public.matches (round_opens_at, scheduled_at, proposed_at)
  WHERE status = 'pending';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(16)
    CHECK (contact_phone IS NULL OR contact_phone ~ '^\+233[0-9]{9}$');

-- Existing round-1 matches of not-yet-started brackets get their window
-- from the tournament start, so nothing already in flight is stranded.
UPDATE public.matches m
   SET round_opens_at = t.starts_at
  FROM public.tournaments t
 WHERE t.id = m.tournament_id AND m.match_round = 1 AND m.round_opens_at IS NULL;

UPDATE public.matches
   SET round_opens_at = now()
 WHERE round_opens_at IS NULL AND player1_id IS NOT NULL AND player2_id IS NOT NULL;

COMMIT;

-- ===== 002_supabase_auth_integration =====
-- =============================================================
-- ClashGH — Migration 002: Supabase Auth integration
-- TARGET: Supabase ONLY (requires the managed `auth` schema).
-- Skip this file in local dev (see backend/README.md).
--
-- Creates a public.users profile row automatically whenever a
-- new user signs in via Supabase Auth (Google OAuth or magic
-- link). username/phone stay NULL until onboarding completes.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, 'player')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Privileges: on Supabase the service_role (used by the Express API)
-- already has full access to the public schema by default, so no
-- explicit GRANT is needed. (If you run a custom Supabase with
-- reduced defaults, grant SELECT/INSERT/UPDATE/DELETE on
-- public.users to service_role manually.)

-- Record this migration
INSERT INTO public.schema_migrations (version, name)
VALUES (2, 'supabase_auth_integration')
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ===== bookkeeping: record 007 (its file predates the version row) =====
INSERT INTO public.schema_migrations (version, name) VALUES (7, 'match_scheduling') ON CONFLICT (version) DO NOTHING;
