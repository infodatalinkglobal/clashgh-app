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

COMMIT;
