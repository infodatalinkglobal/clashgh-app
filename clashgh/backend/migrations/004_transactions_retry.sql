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
