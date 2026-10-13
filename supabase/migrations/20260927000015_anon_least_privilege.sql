-- =============================================================================
-- JibonJori - 0015 least privilege for `anon`
-- =============================================================================
-- Reconciliation with a real hosted Supabase project.
--
-- Migrations 0003/0004 grant exactly what each role needs and revoke EXECUTE from
-- PUBLIC. On a bare PostgreSQL (the local harness) those explicit statements are the
-- whole story, so `anon` ends up with SELECT on only the 4 reference tables and
-- EXECUTE on only `username_available`.
--
-- A hosted Supabase project is different: the platform configures
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES/FUNCTIONS/SEQUENCES TO anon,
-- authenticated, service_role` for the schema, so every object the migrations CREATE
-- is ALSO auto-granted to `anon`. The result on the hosted project was `anon` holding
-- SELECT on all 17 tables and EXECUTE on all 46 functions - exactly the two claims
-- `verify-cloud.sql` asserts, and the two that failed on the first real `db push`.
--
-- Row level security still denied `anon` the rows, so this was not a data leak. It is
-- still a real defense-in-depth gap: a future permissive policy, or a disabled RLS,
-- would turn a redundant GRANT into exposure. This migration removes the excess and
-- restores the intended minimum, and neutralises the platform default privileges for
-- objects this role creates so the gap cannot silently come back.
--
-- Idempotent: every statement is a REVOKE/GRANT of fixed privileges on fixed objects,
-- and the whole block is guarded on the `anon` role existing (it does not on a
-- vanilla PostgreSQL server).
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- Tables: `anon` may read the four reference tables and nothing else.
    execute 'revoke all privileges on all tables in schema public from anon';
    execute $g$
      grant select on
        public.education_levels,
        public.professions,
        public.interests,
        public.curated_videos
      to anon
    $g$;

    -- Sequences: `anon` never inserts, so it never advances a sequence.
    execute 'revoke all privileges on all sequences in schema public from anon';

    -- Functions: `anon` may call only the username availability check.
    execute 'revoke execute on all functions in schema public from anon';
    execute 'grant execute on function public.username_available(text) to anon';

    -- Stop objects created by this role from re-granting to `anon` by default. This is
    -- what makes the fix durable rather than a one-off snapshot.
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on functions from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
  end if;
end;
$$;

comment on schema public is
  'JibonJori application schema. anon: SELECT on the 4 reference tables + username_available() only; authenticated: RLS-gated access to the app tables; service_role: full access for Edge Functions.';
