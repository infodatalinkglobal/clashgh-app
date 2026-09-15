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
