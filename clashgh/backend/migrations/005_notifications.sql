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
CREATE TRIGGER push_tokens_set_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens   ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migrations (version, name)
VALUES (5, 'notifications')
ON CONFLICT (version) DO NOTHING;

COMMIT;
