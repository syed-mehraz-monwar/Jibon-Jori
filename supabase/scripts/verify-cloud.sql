-- =============================================================================
-- JibonJori - READ-ONLY cloud verification
-- =============================================================================
-- Confirms that a hosted Supabase project is in the state the migrations intend.
-- This file only SELECTs from catalogs and system tables. It creates one temporary
-- table to collect results, and it never writes application data.
--
-- Run it with:
--
--   npm run cloud -- verify
--
-- or paste it into the dashboard's SQL Editor (Dashboard -> SQL Editor -> New query).
--
-- It is NOT the adversarial RLS suite. `supabase/tests/rls_assertions.sql` creates a
-- synthetic `auth.users` stand-in and inserts fake identities, so it must never be run
-- against a real project. To exercise the adversarial suite in the cloud, use a
-- throwaway project or a `supabase branches` preview branch.
-- =============================================================================

-- A session-scoped temporary table collects the results. It is deliberately NOT
-- declared `on commit drop`: psql runs each statement in its own implicit transaction,
-- so `on commit drop` would remove the table the instant it was created. Nothing is
-- written to any permanent table.
create temporary table if not exists jj_verify (
  claim  text,
  ok     boolean,
  detail text
);

truncate jj_verify;

-- ---------------------------------------------------------------------------
-- 1. Every public table from the migrations exists.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'all 17 public tables exist',
  count(*) = 17,
  format('%s of 17 present', count(*))
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
  and table_name in (
    'profiles', 'partner_preferences', 'profile_interests', 'media', 'interactions',
    'ratings', 'comments', 'compatibility_scores', 'notifications', 'chat_conversations',
    'chat_messages', 'curated_videos', 'ml_artifacts', 'audit_logs',
    'education_levels', 'professions', 'interests'
  );

-- ---------------------------------------------------------------------------
-- 2. RLS is enabled on every one of them.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'RLS enabled on every public table',
  count(*) filter (where c.relrowsecurity) = count(*),
  format('%s of %s tables have RLS',
         count(*) filter (where c.relrowsecurity), count(*))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- ---------------------------------------------------------------------------
-- 3. audit_logs is append-only: no client INSERT/UPDATE/DELETE policy.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'audit_logs has no client write policy',
  count(*) = 0,
  format('%s write polic%s found', count(*), case when count(*) = 1 then 'y' else 'ies' end)
from pg_policies
where schemaname = 'public'
  and tablename = 'audit_logs'
  and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

-- ---------------------------------------------------------------------------
-- 4. The two storage buckets exist, are private, and keep their limits.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'storage buckets exist, private, with limits',
  count(*) = 2
    and bool_and(not public)
    and bool_and(file_size_limit is not null)
    and bool_and(allowed_mime_types is not null),
  coalesce(string_agg(format('%s(public=%s,limit=%s)', id, public, file_size_limit), ', '),
           'no buckets found')
from storage.buckets
where id in ('profile-photos', 'profile-documents');

-- ---------------------------------------------------------------------------
-- 5. Realtime publishes exactly the five intended tables.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'realtime publishes the 5 intended tables',
  count(*) = 5,
  coalesce(string_agg(tablename, ', ' order by tablename), 'publication missing')
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('comments', 'interactions', 'ratings', 'notifications', 'chat_messages');

-- ---------------------------------------------------------------------------
-- 6. `profiles` is deliberately NOT published.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'profiles is not published to realtime',
  count(*) = 0,
  format('%s row(s)', count(*))
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles';

-- ---------------------------------------------------------------------------
-- 7. All six report functions exist.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'all 6 report_* functions exist',
  count(*) = 6,
  format('%s of 6 present', count(*))
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'report_users', 'report_matchmaking', 'report_compatibility',
    'report_ratings', 'report_ratings_summary', 'report_admin'
  );

-- ---------------------------------------------------------------------------
-- 8. The RPCs the client calls all exist.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'the client-facing RPCs exist',
  count(*) = 9,
  format('%s of 9 present', count(*))
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'username_available', 'search_profiles', 'recommendations', 'compatibility_for',
    'rating_summary', 'interaction_summary', 'has_verified_contact',
    'is_active_member', 'account_state'
  );

-- ---------------------------------------------------------------------------
-- 9. anon can read only the four reference tables, and nothing else.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'anon holds SELECT on only the 4 reference tables',
  count(*) = 4
    and bool_and(table_name in ('curated_videos', 'education_levels', 'interests', 'professions')),
  coalesce(string_agg(table_name, ', ' order by table_name), 'none')
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT';

-- ---------------------------------------------------------------------------
-- 10. anon may execute exactly one function: username_available.
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'anon may execute only username_available',
  count(distinct p.proname) = 1 and bool_and(p.proname = 'username_available'),
  coalesce(string_agg(distinct p.proname, ', '), 'none')
from information_schema.routine_privileges g
join pg_proc p on p.proname = g.routine_name
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where g.routine_schema = 'public' and g.grantee = 'anon';

-- ---------------------------------------------------------------------------
-- 11. Reference data is seeded (migration 0008 is idempotent).
-- ---------------------------------------------------------------------------
insert into jj_verify (claim, ok, detail)
select
  'reference data is seeded',
  (select count(*) from public.education_levels) > 0
    and (select count(*) from public.professions) > 0
    and (select count(*) from public.interests) > 0,
  format('education_levels=%s professions=%s interests=%s',
         (select count(*) from public.education_levels),
         (select count(*) from public.professions),
         (select count(*) from public.interests));

-- ---------------------------------------------------------------------------
-- 12. The migration history is present and complete.
--
-- Done in a DO block with dynamic SQL: referencing the table directly would raise a
-- SQL error when it does not exist, and a guard in a WHERE clause is not enough,
-- because a target list with no FROM is evaluated before the filter. The result is a
-- reported claim either way, never an error.
-- ---------------------------------------------------------------------------
do $$
declare
  recorded integer;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    insert into jj_verify (claim, ok, detail)
    values ('the migration history records every migration', false,
            'supabase_migrations.schema_migrations not found - has `db push` run?');
  else
    execute 'select count(distinct version) from supabase_migrations.schema_migrations'
      into recorded;
    insert into jj_verify (claim, ok, detail)
    values ('the migration history records every migration', recorded >= 15,
            format('%s versions recorded', recorded));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------
select claim, case when ok then 'PASS' else 'FAIL' end as result, detail
  from jj_verify
 order by ok asc, claim;

do $$
declare
  failed integer;
  total integer;
begin
  select count(*) into failed from jj_verify where not ok;
  select count(*) into total from jj_verify;
  if failed > 0 then
    raise exception 'CLOUD VERIFICATION FAILED: % of % claims did not hold', failed, total;
  end if;
  raise notice 'CLOUD VERIFICATION PASSED: all % claims held.', total;
end
$$;
