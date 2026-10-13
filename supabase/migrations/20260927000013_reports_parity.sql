-- =============================================================================
-- JibonJori - 0013 reports and rating-summary parity
-- =============================================================================
-- 0007 guessed at the report surface. The archive defines it exactly, in
-- `reports.types.ts` / `reports.routes.ts` / `reports.service.ts`:
--
--   REPORT_KINDS = users, matchmaking, compatibility, ratings,
--                  ratings-summary, admin          (six, not four)
--
-- and two of them are caller-scoped, which 0007 got backwards:
--
--   * `matchmaking` is the requesting admin's OWN recommendation list
--     (getRecommendations(adminUserId, page 1, limit 50)) with the full factor
--     breakdown -- not a dump of every cached pair.
--   * `ratings` is the requesting admin's OWN given ratings
--     (listRatings(adminUserId, page 1, limit 50)) -- not every rating.
--
-- 0007 also invented a "daily buckets" shape for `users` and an `interactions`
-- kind that is not in REPORT_KINDS. Those functions are removed here.
--
-- The 0007 `rating_summary` is corrected too: the contract rounds the average to
-- ONE decimal and returns null (not 0) when there are no ratings, and it refuses
-- to summarise a profile that is not public and active
-- (`ratings.service.ts:244-296`).
--
-- Column names are camelCase to match the dataset field names the Crystal
-- bindings in `CRYSTAL_REPORTS_DATASET_BINDING.md` are written against.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- rating_summary -- corrected average/scale and visibility gate.
-- ---------------------------------------------------------------------------
create or replace function public.rating_summary(p_profile uuid)
returns table (average numeric, rating_count integer, distribution jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visible boolean;
begin
  select (p.is_public and p.deleted_at is null and not p.is_suspended and public.is_active_profile(p.id))
    into visible
    from public.profiles p
   where p.id = p_profile;

  if visible is distinct from true then
    raise exception 'PROFILE_NOT_AVAILABLE' using errcode = 'no_data_found';
  end if;

  return query
  with totals as (
    select
      count(r.id)::integer as rating_count,
      case when count(r.id) > 0
           then round(avg(r.score)::numeric, 1)
           else null
      end as average
    from public.ratings r
    where r.rated_profile_id = p_profile
  ),
  buckets as (
    select b.score,
           (select count(*) from public.ratings r
             where r.rated_profile_id = p_profile and r.score = b.score)::integer as n
    from generate_series(1, 5) as b(score)
  )
  select
    t.average,
    t.rating_count,
    (select jsonb_object_agg(b.score::text, b.n) from buckets b)
  from totals t;
end;
$$;

-- ---------------------------------------------------------------------------
-- Remove the 0007 report functions (wrong shapes and kinds).
-- ---------------------------------------------------------------------------
drop function if exists public.report_user_summary();
drop function if exists public.report_matchmaking();
drop function if exists public.report_interactions();
drop function if exists public.report_ratings();

-- =============================================================================
-- 2.1 users
-- =============================================================================
create or replace function public.report_users()
returns table (
  "userId"          uuid,
  "username"        text,
  "role"            text,
  "status"          text,
  "displayName"     text,
  "age"             integer,
  "gender"          text,
  "maritalStatus"   text,
  "city"            text,
  "district"        text,
  "educationLabel"  text,
  "professionLabel" text,
  "isPublic"        boolean,
  "registeredAt"    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      p.id,
      p.username::text,
      p.role::text,
      public.account_state(p.id),
      p.display_name,
      public.age_from_dob(p.dob),
      p.gender::text,
      p.marital_status::text,
      p.city,
      p.district,
      e.label,
      pr.label,
      p.is_public,
      p.created_at
    from public.profiles p
    left join public.education_levels e on e.id = p.education_id
    left join public.professions pr on pr.id = p.profession_id
    order by p.created_at asc, p.id asc
    limit 1000;
end;
$$;

-- =============================================================================
-- 2.2 matchmaking -- the CALLER's own recommendations, full breakdown.
-- The candidate pool is bounded (R-028: report datasets must not be unbounded);
-- the bound is reported via the Edge Function's rowLimit.
-- =============================================================================
create or replace function public.report_matchmaking()
returns table (
  "profileId"       uuid,
  "eligible"        boolean,
  "overallScore"    integer,
  "interestsScore"  integer,
  "educationScore"  integer,
  "professionScore" integer,
  "locationScore"   integer,
  "lifestyleScore"  integer,
  "preferenceScore" integer,
  "modelVersion"    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  with me as (
    select auth.uid() as id
  ),
  pool as (
    select p.id
      from public.profiles p, me
     where p.id <> me.id
       and p.is_public
       and p.deleted_at is null
       and not p.is_suspended
       and public.is_active_profile(p.id)
     order by p.completeness desc, p.created_at desc
     limit 200
  ),
  scored as (
    select
      pool.id,
      c.interests_score,
      c.education_score,
      c.profession_score,
      c.location_score,
      c.lifestyle_score,
      c.preference_score,
      c.overall_score,
      c.model_version,
      (select public.compute_eligibility(me.id, pool.id)) as reasons
    from pool
    cross join me
    cross join lateral public.compute_compatibility(me.id, pool.id) c
  )
  select
    s.id,
    true,
    s.overall_score,
    s.interests_score,
    s.education_score,
    s.profession_score,
    s.location_score,
    s.lifestyle_score,
    s.preference_score,
    s.model_version
  from scored s, me
  where coalesce(array_length(s.reasons, 1), 0) = 0
  order by s.overall_score desc, s.id
  limit 50;
end;
$$;

-- =============================================================================
-- 2.3 compatibility -- single row for (admin, target). Reuses compatibility_for
-- so the eligibility gate, cache reuse and cache write are not duplicated.
-- =============================================================================
create or replace function public.report_compatibility(p_target uuid)
returns table (
  "targetProfileId"          uuid,
  "eligible"                 boolean,
  "overallScore"             integer,
  "interestsScore"           integer,
  "educationScore"           integer,
  "professionScore"          integer,
  "educationProfessionScore" integer,
  "locationScore"            integer,
  "lifestyleScore"           integer,
  "preferenceScore"          integer,
  "modelVersion"             text,
  "fromCache"                boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  target_ok boolean;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;

  select (p.is_public and p.deleted_at is null and not p.is_suspended and public.is_active_profile(p.id))
    into target_ok
    from public.profiles p
   where p.id = p_target;

  if target_ok is distinct from true then
    raise exception 'PROFILE_NOT_AVAILABLE' using errcode = 'no_data_found';
  end if;

  select * into r from public.compatibility_for(p_target);

  return query select
    p_target,
    r.eligible,
    r.overall_score,
    r.interests_score,
    r.education_score,
    r.profession_score,
    r.education_profession_score,
    r.location_score,
    r.lifestyle_score,
    r.preference_score,
    r.model_version,
    r.from_cache;
end;
$$;

-- =============================================================================
-- 2.4 ratings -- the CALLER's own given ratings.
-- =============================================================================
create or replace function public.report_ratings()
returns table (
  "raterProfileId" uuid,
  "ratedProfileId" uuid,
  "score"          integer,
  "createdAt"      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.rater_profile_id,
    r.rated_profile_id,
    r.score,
    r.created_at
  from public.ratings r
  where r.rater_profile_id = auth.uid()
  order by r.created_at desc
  limit 50;
end;
$$;

-- =============================================================================
-- 2.5 ratings-summary -- single row for a target.
-- =============================================================================
create or replace function public.report_ratings_summary(p_target uuid)
returns table (
  "targetProfileId" uuid,
  "count"           integer,
  "average"         numeric,
  "distribution"    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.rating_summary(p_target);

  return query select p_target, s.rating_count, s.average, s.distribution::text;
end;
$$;

-- =============================================================================
-- 2.6 admin -- system-wide aggregates over real data.
-- =============================================================================
create or replace function public.report_admin()
returns table ("metric" text, "value" integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select * from (values
    ('users',                (select count(*) from auth.users)),
    ('profiles',             (select count(*) from public.profiles)),
    ('educationLevels',      (select count(*) from public.education_levels)),
    ('professions',          (select count(*) from public.professions)),
    ('interests',            (select count(*) from public.interests)),
    ('ratings',              (select count(*) from public.ratings)),
    ('compatibilityScores',  (select count(*) from public.compatibility_scores)),
    ('educationLevelOptions',(select count(*) from public.education_levels)),
    ('professionOptions',    (select count(*) from public.professions)),
    ('interestOptions',      (select count(*) from public.interests)),
    ('genderOptions',        (select count(*) from pg_enum e
                                join pg_type t on t.oid = e.enumtypid
                               where t.typname = 'gender' and t.typnamespace = 'public'::regnamespace)),
    ('maritalStatusOptions', (select count(*) from pg_enum e
                                join pg_type t on t.oid = e.enumtypid
                               where t.typname = 'marital_status' and t.typnamespace = 'public'::regnamespace)),
    ('notificationTypeOptions', (select count(*) from pg_enum e
                                join pg_type t on t.oid = e.enumtypid
                               where t.typname = 'notification_type' and t.typnamespace = 'public'::regnamespace))
  ) as v(metric, value);
end;
$$;

-- =============================================================================
-- Grants. All six are admin-gated internally; the grant is to authenticated so a
-- non-admin receives FORBIDDEN rather than a permission error.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.rating_summary(uuid) to authenticated;
    grant execute on function public.report_users() to authenticated;
    grant execute on function public.report_matchmaking() to authenticated;
    grant execute on function public.report_compatibility(uuid) to authenticated;
    grant execute on function public.report_ratings() to authenticated;
    grant execute on function public.report_ratings_summary(uuid) to authenticated;
    grant execute on function public.report_admin() to authenticated;
  end if;
end;
$$;
