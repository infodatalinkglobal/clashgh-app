-- =============================================================
-- ClashGH — Dev seed (idempotent: safe to re-run)
-- Works on Supabase AND local Postgres.
--
-- NOTE: the profile rows below have NO Supabase auth identity —
-- they cannot log in. To get a working admin login on Supabase:
--   1. Sign up through the app with your own email.
--   2. In the SQL editor:
--        UPDATE public.users SET role = 'admin'
--        WHERE id = '<your auth user id>';
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Users: 1 admin + 8 players (covers all three MoMo providers)
-- -------------------------------------------------------------
INSERT INTO public.users (id, email, phone, phone_verified, username, momo_provider, role) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'admin@clashgh.dev',    '+233240000001', true, 'clash_admin', 'mtn',          'admin'),
  ('a1000000-0000-0000-0000-000000000002', 'kofi@dev.gh',          '+233241111111', true, 'kofi_gh',     'mtn',          'player'),
  ('a1000000-0000-0000-0000-000000000003', 'ama@dev.gh',           '+233252222222', true, 'ama_picks',   'mtn',          'player'),
  ('a1000000-0000-0000-0000-000000000004', 'yao@dev.gh',           '+233533333333', true, 'yao_striker', 'mtn',          'player'),
  ('a1000000-0000-0000-0000-000000000005', 'efua@dev.gh',          '+233544444444', true, 'efua9',       'mtn',          'player'),
  ('a1000000-0000-0000-0000-000000000006', 'kwame@dev.gh',         '+233201234567', true, 'kwame_fc',    'vodafone',     'player'),
  ('a1000000-0000-0000-0000-000000000007', 'akos@dev.gh',          '+233501234568', true, 'akos_dls',    'vodafone',     'player'),
  ('a1000000-0000-0000-0000-000000000008', 'nana@dev.gh',          '+233261234569', true, 'nana_codm',   'airteltigo',   'player'),
  ('a1000000-0000-0000-0000-000000000009', 'abena@dev.gh',         '+233561234570', true, 'abena_ef',    'airteltigo',   'player')
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------
-- Tournaments
--   t1: FULL 8-player eFootball cup (lobby filled, awaiting start)
--   t2: OPEN 4-player CODM shootout (3 paid, 1 pending)
-- -------------------------------------------------------------
INSERT INTO public.tournaments
  (id, title, game, entry_fee_pesewas, max_players, closes_at, starts_at, status, created_by)
VALUES
  ('c3000000-0000-0000-0000-000000000001', 'Accra eFootball Friday Cup', 'efootball', 500, 8,
   now() - interval '1 hour', now() + interval '1 day', 'full',
   'a1000000-0000-0000-0000-000000000001'),
  ('c3000000-0000-0000-0000-000000000002', 'CODM Weekend Shootout', 'codm', 1000, 4,
   now() + interval '3 days', now() + interval '4 days', 'open',
   'a1000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------
-- Registrations (+ seeds for the full tournament)
-- -------------------------------------------------------------
INSERT INTO public.registrations
  (id, tournament_id, user_id, game_uid, payment_status, seed)
VALUES
  -- t1: all 8 paid, seeds 1-8
  ('b2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'EF_100234', 'paid', 1),
  ('b2000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'EF_200345', 'paid', 2),
  ('b2000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 'EF_300456', 'paid', 3),
  ('b2000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'EF_400567', 'paid', 4),
  ('b2000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006', 'EF_500678', 'paid', 5),
  ('b2000000-0000-0000-0000-000000000006', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000007', 'EF_600789', 'paid', 6),
  ('b2000000-0000-0000-0000-000000000007', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000008', 'EF_700890', 'paid', 7),
  ('b2000000-0000-0000-0000-000000000008', 'c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000009', 'EF_800901', 'paid', 8),
  -- t2: 3 paid + 1 pending (the pending row is what the sweeper reaps)
  ('b2000000-0000-0000-0000-000000000009', 'c3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'CODM_55012', 'paid', NULL),
  ('b2000000-0000-0000-0000-00000000000A', 'c3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003', 'CODM_55013', 'paid', NULL),
  ('b2000000-0000-0000-0000-00000000000B', 'c3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000004', 'CODM_55014', 'paid', NULL),
  ('b2000000-0000-0000-0000-00000000000C', 'c3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000005', 'CODM_55015', 'pending', NULL)
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------
-- Entry fee transactions for every PAID registration (escrow 'in')
-- -------------------------------------------------------------
DELETE FROM public.transactions WHERE paystack_reference LIKE 'CHRG_SEED_%';

INSERT INTO public.transactions
  (user_id, tournament_id, type, amount_pesewas, status, paystack_reference, direction, description)
SELECT
  r.user_id,
  r.tournament_id,
  'entry_fee',
  t.entry_fee_pesewas,
  'success',
  'CHRG_SEED_' || upper(substr(r.id::text, 10, 4)),
  'in',
  'Entry fee — ' || t.title
FROM public.registrations r
JOIN public.tournaments t ON t.id = r.tournament_id
WHERE r.payment_status = 'paid';

-- -------------------------------------------------------------
-- Bracket for t1 (pre-created, status 'pending' — Module 1D will
-- reuse this shape): round 1 pairs (1v2, 3v4, 5v6, 7v8),
-- round 2 + final are placeholders with NULL players.
-- -------------------------------------------------------------
DELETE FROM public.matches WHERE id BETWEEN 'd4000000-0000-0000-0000-000000000001' AND 'd4000000-0000-0000-0000-00000000000F';

INSERT INTO public.matches
  (id, tournament_id, match_round, match_number, player1_id, player2_id, status)
VALUES
  ('d4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 1, 1,
   'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003', 'pending'),
  ('d4000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 1, 2,
   'a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000005', 'pending'),
  ('d4000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', 1, 3,
   'a1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000007', 'pending'),
  ('d4000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000001', 1, 4,
   'a1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000009', 'pending'),
  ('d4000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000001', 2, 1,
   NULL, NULL, 'pending'),
  ('d4000000-0000-0000-0000-000000000006', 'c3000000-0000-0000-0000-000000000001', 2, 2,
   NULL, NULL, 'pending'),
  ('d4000000-0000-0000-0000-000000000007', 'c3000000-0000-0000-0000-000000000001', 3, 1,
   NULL, NULL, 'pending')
ON CONFLICT (id) DO NOTHING;

COMMIT;
