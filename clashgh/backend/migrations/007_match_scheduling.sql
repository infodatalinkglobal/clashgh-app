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
