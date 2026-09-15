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
CREATE TABLE public.users (
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

CREATE INDEX users_role_idx ON public.users (role);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 4. tournaments
-- -------------------------------------------------------------
CREATE TABLE public.tournaments (
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

CREATE INDEX tournaments_status_idx    ON public.tournaments (status);
CREATE INDEX tournaments_game_idx      ON public.tournaments (game);
CREATE INDEX tournaments_starts_at_idx ON public.tournaments (starts_at);
CREATE INDEX tournaments_closes_at_idx ON public.tournaments (closes_at);

CREATE TRIGGER tournaments_set_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 5. registrations
--    Only 'paid' rows count toward lobby fill. 'pending' rows are
--    deleted by the sweeper after REGISTRATION_PENDING_TTL_MINUTES.
-- -------------------------------------------------------------
CREATE TABLE public.registrations (
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
CREATE INDEX registrations_tournament_payment_idx ON public.registrations (tournament_id, payment_status);
CREATE INDEX registrations_user_idx ON public.registrations (user_id);

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
CREATE TABLE public.matches (
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

CREATE INDEX matches_tournament_round_idx ON public.matches (tournament_id, match_round);
CREATE INDEX matches_status_idx           ON public.matches (status);
CREATE INDEX matches_deadline_idx         ON public.matches (deadline_at);

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
CREATE TABLE public.transactions (
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
CREATE INDEX transactions_user_created_idx    ON public.transactions (user_id, created_at DESC);
-- Revenue / payout reports (Module 3F)
CREATE INDEX transactions_tournament_type_idx ON public.transactions (tournament_id, type);
-- Double-payout guard (see IMPORTANT above)
CREATE UNIQUE INDEX transactions_payout_match_user_unique
  ON public.transactions (match_id, user_id)
  WHERE type = 'payout' AND match_id IS NOT NULL;

CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 8. webhook_events
--    Idempotency ledger for Paystack webhooks: a duplicate event id
--    is rejected by the unique constraint and dropped by the handler.
-- -------------------------------------------------------------
CREATE TABLE public.webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paystack_event_id VARCHAR(128) UNIQUE,
  event_type        VARCHAR(64) NOT NULL,
  payload           JSONB,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_events_type_idx ON public.webhook_events (event_type);

CREATE TRIGGER webhook_events_set_updated_at
  BEFORE UPDATE ON public.webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 9. admin_audit_log
--    Every manual override (dispute resolution, cancel, re-payout,
--    ban/unban) is logged here: who, what, before/after.
-- -------------------------------------------------------------
CREATE TABLE public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES public.users (id),
  action      VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id   UUID,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_entity_idx ON public.admin_audit_log (entity_type, entity_id);
CREATE INDEX admin_audit_admin_idx  ON public.admin_audit_log (admin_id);

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
