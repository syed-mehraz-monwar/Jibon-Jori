-- =============================================================================
-- JibonJori - 0007 RPC layer
-- =============================================================================
-- Design rule applied throughout this file:
--
--   * Anything that RETURNS USER ROWS is SECURITY INVOKER (the default), so RLS
--     remains the single boundary. A bug in the function cannot leak a row the
--     caller could not have read with a plain select.
--   * Anything that returns only an AGGREGATE, or that must WRITE a table which
--     has no client write policy, is SECURITY DEFINER - and then it returns
--     scalars or counts, never private rows, and it re-checks the caller itself.
--
-- These functions replace the removed Express service layer. There is no REST
-- controller left to duplicate their rules.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Distance helper (haversine, kilometres)
-- ---------------------------------------------------------------------------
create or replace function public.haversine_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371.0 * 2 * asin(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )
  );
$$;

create or replace function public.age_from_dob(p_dob date)
returns integer
language sql
immutable
as $$
  select case when p_dob is null then null else date_part('year', age(p_dob))::integer end;
$$;

-- =============================================================================
-- username_available - live availability check while typing.
-- Reachable before sign-in, because the registration form needs it. It returns a
-- boolean and nothing else, so it cannot be used to enumerate profiles.
-- =============================================================================
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when p_username is null then false
    when lower(trim(p_username)) !~ '^[a-z0-9_]{3,32}$' then false
    when exists (
      select 1 from public.profiles
       where username = lower(trim(p_username))::extensions.citext
    ) then false
    else true
  end;
$$;

-- =============================================================================
-- preference_fit - how well a candidate satisfies one seeker's stated criteria.
-- Neutral (50) when the seeker has stated nothing, so an empty preference set
-- neither helps nor penalises.
-- =============================================================================
create or replace function public.preference_fit(p_seeker uuid, p_candidate uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pref      public.partner_preferences;
  candidate public.profiles;
  candidate_age integer;
  total     integer := 0;
  met       integer := 0;
begin
  select * into pref from public.partner_preferences where profile_id = p_seeker;
  if pref.profile_id is null then
    return 50;
  end if;

  select * into candidate from public.profiles where id = p_candidate;
  if candidate.id is null then
    return 50;
  end if;

  candidate_age := public.age_from_dob(candidate.dob);

  if pref.age_min is not null or pref.age_max is not null then
    total := total + 1;
    if candidate_age is not null
       and (pref.age_min is null or candidate_age >= pref.age_min)
       and (pref.age_max is null or candidate_age <= pref.age_max) then
      met := met + 1;
    end if;
  end if;

  if coalesce(array_length(pref.genders, 1), 0) > 0 then
    total := total + 1;
    if candidate.gender is not null and candidate.gender::text = any (pref.genders) then
      met := met + 1;
    end if;
  end if;

  if coalesce(array_length(pref.education_ids, 1), 0) > 0 then
    total := total + 1;
    if candidate.education_id = any (pref.education_ids) then
      met := met + 1;
    end if;
  end if;

  if coalesce(array_length(pref.profession_ids, 1), 0) > 0 then
    total := total + 1;
    if candidate.profession_id = any (pref.profession_ids) then
      met := met + 1;
    end if;
  end if;

  if coalesce(array_length(pref.locations, 1), 0) > 0 then
    total := total + 1;
    if candidate.city is not null and lower(candidate.city) = any (pref.locations) then
      met := met + 1;
    end if;
  end if;

  if total = 0 then
    return 50;
  end if;

  return round(100.0 * met / total)::integer;
end;
$$;

-- =============================================================================
-- compute_compatibility - the deterministic scorer (no randomness anywhere).
-- Mirrors the weights the removed backend used so the displayed breakdown keeps
-- the same meaning: interests 25, preference 25, location 20, education 15,
-- profession 15.
-- =============================================================================
create or replace function public.compute_compatibility(p_a uuid, p_b uuid)
returns table (
  interests_score  smallint,
  education_score  smallint,
  profession_score smallint,
  location_score   smallint,
  preference_score smallint,
  overall_score    smallint,
  inputs_hash      text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.profiles;
  b public.profiles;
  shared_interests integer;
  count_a integer;
  count_b integer;
  union_interests integer;
  tier_a integer;
  tier_b integer;
  s_interests integer;
  s_education integer;
  s_profession integer;
  s_location integer;
  s_preference integer;
  s_overall integer;
  distance_km double precision;
begin
  select * into a from public.profiles where id = p_a;
  select * into b from public.profiles where id = p_b;

  if a.id is null or b.id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'no_data_found';
  end if;

  -- ---- interests (Jaccard overlap; neutral when neither side lists any)
  select count(*) into shared_interests
    from public.profile_interests x
    join public.profile_interests y on y.interest_id = x.interest_id
   where x.profile_id = p_a and y.profile_id = p_b;

  select count(*) into count_a from public.profile_interests where profile_id = p_a;
  select count(*) into count_b from public.profile_interests where profile_id = p_b;

  union_interests := count_a + count_b - shared_interests;
  if union_interests = 0 then
    s_interests := 50;
  else
    s_interests := round(100.0 * shared_interests / union_interests);
  end if;

  -- ---- education and profession: closer tiers score higher
  select tier into tier_a from public.education_levels where id = a.education_id;
  select tier into tier_b from public.education_levels where id = b.education_id;
  if tier_a is null or tier_b is null then
    s_education := 50;
  else
    s_education := greatest(0, 100 - 15 * abs(tier_a - tier_b));
  end if;

  select tier into tier_a from public.professions where id = a.profession_id;
  select tier into tier_b from public.professions where id = b.profession_id;
  if tier_a is null or tier_b is null then
    s_profession := 50;
  else
    s_profession := greatest(0, 100 - 15 * abs(tier_a - tier_b));
  end if;

  -- ---- location: real distance when both consented to coordinates,
  --      otherwise the administrative hierarchy
  if a.lat is not null and a.lng is not null and b.lat is not null and b.lng is not null then
    distance_km := public.haversine_km(a.lat, a.lng, b.lat, b.lng);
    s_location := greatest(0, least(100, round(100 - distance_km)));
  elsif a.city is not null and lower(a.city) = lower(b.city) then
    s_location := 100;
  elsif a.district is not null and lower(a.district) = lower(b.district) then
    s_location := 85;
  elsif a.country is not null and lower(a.country) = lower(b.country) then
    s_location := 65;
  else
    s_location := 45;
  end if;

  -- ---- preference: both directions must be satisfied
  s_preference := round(
    (public.preference_fit(p_a, p_b) + public.preference_fit(p_b, p_a)) / 2.0
  );

  s_overall := round(
      0.25 * s_interests
    + 0.25 * s_preference
    + 0.20 * s_location
    + 0.15 * s_education
    + 0.15 * s_profession
  );

  return query
    select
      s_interests::smallint,
      s_education::smallint,
      s_profession::smallint,
      s_location::smallint,
      s_preference::smallint,
      greatest(0, least(100, s_overall))::smallint,
      md5(concat_ws('|',
        p_a::text, p_b::text,
        s_interests::text, s_education::text, s_profession::text,
        s_location::text, s_preference::text,
        'compatibility-v1'
      ));
end;
$$;

-- =============================================================================
-- compatibility_for - scores the caller against one other profile and caches it.
-- DEFINER because `compatibility_scores` has no client write policy: a client
-- must never be able to author its own compatibility score.
-- =============================================================================
create or replace function public.compatibility_for(p_other uuid)
returns table (
  profile_a_id     uuid,
  profile_b_id     uuid,
  interests_score  smallint,
  education_score  smallint,
  profession_score smallint,
  location_score   smallint,
  preference_score smallint,
  overall_score    smallint,
  model_version    text,
  computed_at      timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
-- The RETURNS TABLE names (profile_a_id, overall_score, ...) are also column
-- names of compatibility_scores, so plain references are ambiguous and the
-- ON CONFLICT target below cannot be qualified. Resolve ambiguity towards the
-- column; every variable used here has a name no column shares.
#variable_conflict use_column
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  scored record;
begin
  if me is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'insufficient_privilege';
  end if;
  if p_other is null or p_other = me then
    raise exception 'INVALID_TARGET' using errcode = 'invalid_parameter_value';
  end if;
  if not public.can_view_profile(p_other) then
    raise exception 'PROFILE_NOT_VISIBLE' using errcode = 'insufficient_privilege';
  end if;

  lo := least(me, p_other);
  hi := greatest(me, p_other);

  select * into scored from public.compute_compatibility(lo, hi);

  insert into public.compatibility_scores as cs (
    profile_a_id, profile_b_id,
    overall_score, interests_score, education_score, profession_score,
    location_score, preference_score, model_version, inputs_hash, computed_at
  )
  values (
    lo, hi,
    scored.overall_score, scored.interests_score, scored.education_score,
    scored.profession_score, scored.location_score, scored.preference_score,
    'compatibility-v1', scored.inputs_hash, now()
  )
  on conflict (profile_a_id, profile_b_id) do update
    set overall_score    = excluded.overall_score,
        interests_score  = excluded.interests_score,
        education_score  = excluded.education_score,
        profession_score = excluded.profession_score,
        location_score   = excluded.location_score,
        preference_score = excluded.preference_score,
        model_version    = excluded.model_version,
        inputs_hash      = excluded.inputs_hash,
        computed_at      = excluded.computed_at;

  return query
    select c.profile_a_id, c.profile_b_id, c.interests_score, c.education_score,
           c.profession_score, c.location_score, c.preference_score,
           c.overall_score, c.model_version, c.computed_at
      from public.compatibility_scores c
     where c.profile_a_id = lo and c.profile_b_id = hi;
end;
$$;

-- =============================================================================
-- search_profiles - SECURITY INVOKER, so RLS decides which profiles exist for
-- this caller. `total_count` comes from a window function so pagination needs a
-- single round trip.
-- =============================================================================
create or replace function public.search_profiles(
  p_gender         public.gender default null,
  p_city           text default null,
  p_age_min        integer default null,
  p_age_max        integer default null,
  p_education_id   uuid default null,
  p_profession_id  uuid default null,
  p_marital_status public.marital_status default null,
  p_interest_ids   uuid[] default null,
  p_near_lat       double precision default null,
  p_near_lng       double precision default null,
  p_radius_km      double precision default null,
  p_limit          integer default 20,
  p_offset         integer default 0
)
returns table (
  id               uuid,
  username         extensions.citext,
  display_name     text,
  age              integer,
  gender           public.gender,
  city             text,
  district         text,
  country          text,
  education_id     uuid,
  profession_id    uuid,
  marital_status   public.marital_status,
  about            text,
  photo_visibility public.photo_visibility,
  completeness     smallint,
  created_at       timestamptz,
  total_count      bigint
)
language sql
stable
set search_path = public, extensions
as $$
  with filtered as (
    select
      p.id, p.username, p.display_name, p.dob, p.gender, p.city, p.district,
      p.country, p.education_id, p.profession_id, p.marital_status, p.about,
      p.photo_visibility, p.completeness, p.created_at, p.lat, p.lng,
      count(*) over () as total_count
    from public.profiles p
    where p.id <> auth.uid()
      and (p_gender is null or p.gender = p_gender)
      and (p_city is null or p.city ilike '%' || p_city || '%')
      and (p_marital_status is null or p.marital_status = p_marital_status)
      and (p_education_id is null or p.education_id = p_education_id)
      and (p_profession_id is null or p.profession_id = p_profession_id)
      and (p_age_min is null or public.age_from_dob(p.dob) >= p_age_min)
      and (p_age_max is null or public.age_from_dob(p.dob) <= p_age_max)
      and (
        p_interest_ids is null or coalesce(array_length(p_interest_ids, 1), 0) = 0
        or exists (
          select 1 from public.profile_interests pi
           where pi.profile_id = p.id and pi.interest_id = any (p_interest_ids)
        )
      )
      and (
        p_near_lat is null or p_near_lng is null or p_radius_km is null
        or (
          p.lat is not null and p.lng is not null
          and public.haversine_km(p_near_lat, p_near_lng, p.lat, p.lng) <= p_radius_km
        )
      )
  )
  select
    f.id, f.username, f.display_name, public.age_from_dob(f.dob), f.gender,
    f.city, f.district, f.country, f.education_id, f.profession_id,
    f.marital_status, f.about, f.photo_visibility, f.completeness, f.created_at,
    f.total_count
  from filtered f
  order by f.completeness desc, f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- =============================================================================
-- recommendations - cached compatibility first, then completeness.
-- SECURITY INVOKER; the join to compatibility_scores only sees the caller's own
-- pairs, and the profiles side is filtered by the profiles policies.
-- =============================================================================
create or replace function public.recommendations(
  p_limit  integer default 20,
  p_offset integer default 0
)
returns table (
  id               uuid,
  username         extensions.citext,
  display_name     text,
  age              integer,
  gender           public.gender,
  city             text,
  country          text,
  completeness     smallint,
  photo_visibility public.photo_visibility,
  overall_score    smallint,
  scored           boolean,
  total_count      bigint
)
language sql
stable
set search_path = public, extensions
as $$
  with candidates as (
    select
      p.id, p.username, p.display_name, p.dob, p.gender, p.city, p.country,
      p.completeness, p.photo_visibility,
      c.overall_score,
      (c.profile_a_id is not null) as scored,
      count(*) over () as total_count
    from public.profiles p
    left join public.compatibility_scores c
      on (c.profile_a_id = least(p.id, auth.uid()) and c.profile_b_id = greatest(p.id, auth.uid()))
    where p.id <> auth.uid()
  )
  select
    c.id, c.username, c.display_name, public.age_from_dob(c.dob), c.gender,
    c.city, c.country, c.completeness, c.photo_visibility,
    coalesce(c.overall_score, 0::smallint) as overall_score,
    c.scored,
    c.total_count
  from candidates c
  order by c.overall_score desc nulls last, c.completeness desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- =============================================================================
-- Aggregates. DEFINER because RLS hides other people's ratings and
-- interactions; these return only counts and an average, never a row.
-- =============================================================================
-- Always returns exactly one row, with all five buckets present (zero-filled), so
-- the UI never has to distinguish "no ratings" from "bucket missing".
create or replace function public.rating_summary(p_profile uuid)
returns table (average numeric, rating_count integer, distribution jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select
      coalesce(round(avg(r.score)::numeric, 2), 0) as average,
      count(r.id)::integer as rating_count
    from public.ratings r
    where r.rated_profile_id = p_profile
  ),
  buckets as (
    select b.score,
           (select count(*) from public.ratings r
             where r.rated_profile_id = p_profile
               and r.score = b.score)::integer as n
    from generate_series(1, 5) as b(score)
  )
  select
    t.average,
    t.rating_count,
    (select jsonb_object_agg(b.score::text, b.n) from buckets b) as distribution
  from totals t;
$$;

create or replace function public.interaction_summary(p_profile uuid)
returns table (likes integer, dislikes integer, favorites integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where value = 1)::integer,
    count(*) filter (where value = -1)::integer,
    count(*) filter (where value = 2)::integer
  from public.interactions
  where target_profile_id = p_profile;
$$;

-- =============================================================================
-- Admin reports. Crystal Reports data source: these return the datasets the
-- report definitions consume. Every one re-checks is_admin() before returning
-- anything, because a DEFINER function would otherwise be an admin bypass.
-- =============================================================================
create or replace function public.report_user_summary()
returns table (bucket date, new_members bigint, published_profiles bigint, active_profiles bigint)
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
      date_trunc('day', p.created_at)::date as bucket,
      count(*)::bigint as new_members,
      count(*) filter (where p.is_public)::bigint as published_profiles,
      count(*) filter (where p.deleted_at is null and not p.is_suspended)::bigint as active_profiles
    from public.profiles p
    group by 1
    order by 1 desc
    limit 90;
end;
$$;

create or replace function public.report_matchmaking()
returns table (
  profile_a_id uuid,
  profile_b_id uuid,
  overall_score smallint,
  interests_score smallint,
  preference_score smallint,
  model_version text,
  computed_at timestamptz
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
    select c.profile_a_id, c.profile_b_id, c.overall_score, c.interests_score,
           c.preference_score, c.model_version, c.computed_at
      from public.compatibility_scores c
     order by c.computed_at desc;
end;
$$;

create or replace function public.report_interactions()
returns table (day date, likes bigint, dislikes bigint, favorites bigint, comments bigint)
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
    with days as (
      select date_trunc('day', created_at)::date as day from public.interactions
      union
      select date_trunc('day', created_at)::date as day from public.comments
    )
    select
      d.day,
      (select count(*) from public.interactions i where date_trunc('day', i.created_at)::date = d.day and i.value = 1)::bigint,
      (select count(*) from public.interactions i where date_trunc('day', i.created_at)::date = d.day and i.value = -1)::bigint,
      (select count(*) from public.interactions i where date_trunc('day', i.created_at)::date = d.day and i.value = 2)::bigint,
      (select count(*) from public.comments c where date_trunc('day', c.created_at)::date = d.day)::bigint
    from days d
    order by d.day desc;
end;
$$;

create or replace function public.report_ratings()
returns table (day date, ratings bigint, average numeric)
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
      date_trunc('day', r.created_at)::date,
      count(*)::bigint,
      coalesce(round(avg(r.score)::numeric, 2), 0)
    from public.ratings r
    group by 1
    order by 1 desc;
end;
$$;

-- =============================================================================
-- Grants. 0004 revoked EXECUTE from PUBLIC; only the intended entry points are
-- granted back, to the narrowest role that needs them.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- reachable before sign-in: the registration form needs it
    grant execute on function public.username_available(text) to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.username_available(text) to authenticated;
    grant execute on function public.haversine_km(double precision, double precision, double precision, double precision) to authenticated;
    grant execute on function public.age_from_dob(date) to authenticated;
    grant execute on function public.search_profiles(
      public.gender, text, integer, integer, uuid, uuid, public.marital_status,
      uuid[], double precision, double precision, double precision, integer, integer
    ) to authenticated;
    grant execute on function public.recommendations(integer, integer) to authenticated;
    grant execute on function public.compatibility_for(uuid) to authenticated;
    grant execute on function public.rating_summary(uuid) to authenticated;
    grant execute on function public.interaction_summary(uuid) to authenticated;

    -- admin-only, but still granted: the FORBIDDEN check inside each one is the
    -- real gate, and a non-admin calling it gets an error rather than data
    grant execute on function public.report_user_summary() to authenticated;
    grant execute on function public.report_matchmaking() to authenticated;
    grant execute on function public.report_interactions() to authenticated;
    grant execute on function public.report_ratings() to authenticated;
  end if;
end;
$$;
