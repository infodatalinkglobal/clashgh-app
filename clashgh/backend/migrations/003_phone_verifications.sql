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

CREATE TRIGGER phone_verifications_set_updated_at
  BEFORE UPDATE ON public.phone_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migrations (version, name)
VALUES (3, 'phone_verifications')
ON CONFLICT (version) DO NOTHING;

COMMIT;
