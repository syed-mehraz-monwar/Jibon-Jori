-- =============================================================================
-- JibonJori - 0012 compatibility scoring parity
-- =============================================================================
-- 0007 implemented the scorer from the summary in `AI_DOCUMENTATION.md` §3.3 and
-- got several things wrong. This migration replaces it with a faithful port of
-- the archived implementation, which is the authority:
--
--   `migration_evidence/extracted/src/compat_compatibility.types.ts`
--   `migration_evidence/extracted/src/compat_compatibility.service.ts`
--
-- Divergences corrected here:
--
--   1. WEIGHTS. 0007 used interests .25 / preference .25 / location .20 /
--      education .15 / profession .15. The contract is
--        interests .25, educationProfession .20, location .15,
--        lifestyle .15, partnerPreference .25.
--   2. COMBINED FACTOR. Education and profession are first scored separately by
--      tier proximity, then averaged into a single `educationProfession` factor
--      that carries the 0.20 weight. 0007 weighted the two tiers directly and
--      never formed the combined factor.
--   3. LIFESTYLE. A whole factor (0.15) was missing.
--   4. UNAVAILABLE. 0007 substituted a neutral 50 for a missing factor. The
--      contract marks the factor unavailable and contributes ZERO, and the
--      whether-a-factor-is-available flag is part of the response.
--   5. TIER GAP. `max(0, 100 - 20 * gap)`, not `100 - 15 * gap`.
--   6. LOCATION. Max of the available signals { city 100, district 70,
--      distance `max(0, 100 - round(km))` }. 0007 also invented a country
--      signal (65), a district value of 85, a floor of 45, and gave distance
--      priority over the administrative signals.
--   7. PREFERENCE. The 0.25 "partnerPreference" factor is the mean of the
--      available per-side satisfaction scores, where each side is the fraction
--      of that seeker's stated clauses the other profile satisfies. 0007
--      averaged a single clause-count ratio for both directions and returned 50
--      when nothing was stated.
--   8. MODEL VERSION. `deterministic-v1`, not `compatibility-v1`.
--   9. ELIGIBILITY. An ineligible pair must return no score and must NOT create
--      a cache row. 0007 scored and cached everything.
--  10. What is PERSISTED. The cache stores the five raw factor columns
--      (interests, education, profession, location, preference) and overall --
--      it does NOT store lifestyle or the combined educationProfession score,
--      because those are response-only outputs (ERD.md §694, §711). The column
--      set in 0002 is therefore already correct and is left alone.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Constants. Weights as a function so callers/tests share one definition.
-- ---------------------------------------------------------------------------
create or replace function public.compat_weights()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'interests', 0.25,
    'educationProfession', 0.20,
    'location', 0.15,
    'lifestyle', 0.15,
    'partnerPreference', 0.25
  );
$$;

create or replace function public.compat_model_version()
returns text
language sql
immutable
as $$ select 'deterministic-v1'::text; $$;

-- ---------------------------------------------------------------------------
-- canonicalValue, ported from `compatibility.service.ts:59-65`.
-- ---------------------------------------------------------------------------
create or replace function public.compat_canonical_value(p_value jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_value is null then 'null'
    when jsonb_typeof(p_value) = 'string'  then 'string:'  || (p_value #>> '{}')
    when jsonb_typeof(p_value) = 'number'  then 'number:'  || (p_value #>> '{}')
    when jsonb_typeof(p_value) = 'boolean' then 'boolean:' || (p_value #>> '{}')
    -- jsonb renders object keys in a stable canonical order, so this is
    -- deterministic for the nested shapes the column can hold
    else p_value::text
  end;
$$;

-- ---------------------------------------------------------------------------
-- readLifestyle: non-object and array values are an empty object.
-- ---------------------------------------------------------------------------
create or replace function public.compat_lifestyle(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when jsonb_typeof(coalesce(p.lifestyle, '{}'::jsonb)) = 'object' then coalesce(p.lifestyle, '{}'::jsonb)
    else '{}'::jsonb
  end
  from public.profiles p
  where p.id = p_profile;
$$;

-- ---------------------------------------------------------------------------
-- Canonical input for one profile, `profileId` deliberately excluded
-- (`compatibility.service.ts:320-336`). Interests and preference arrays are
-- sorted. Rendered through jsonb, whose key ordering is deterministic.
-- ---------------------------------------------------------------------------
create or replace function public.compat_canonical_input(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with profile as (
    select p.*, public.age_from_dob(p.dob) as age
      from public.profiles p
     where p.id = p_profile
  ),
  edu as (
    select e.tier from profile pr join public.education_levels e on e.id = pr.education_id
  ),
  prof as (
    select pr2.tier from profile pr join public.professions pr2 on pr2.id = pr.profession_id
  )
  select jsonb_build_object(
    'gender', (select gender::text from profile),
    'age', (select age from profile),
    'city', (select city from profile),
    'district', (select district from profile),
    'lat', (select lat from profile),
    'lng', (select lng from profile),
    'educationId', (select education_id from profile),
    'educationTier', (select tier from edu),
    'professionId', (select profession_id from profile),
    'professionTier', (select tier from prof),
    'interests', (
      select coalesce(jsonb_agg(pi.interest_id::text order by pi.interest_id::text), '[]'::jsonb)
        from public.profile_interests pi
       where pi.profile_id = p_profile
    ),
    'lifestyle', public.compat_lifestyle(p_profile),
    'preferences', coalesce(
      (
        select jsonb_build_object(
          'ageMin', pp.age_min,
          'ageMax', pp.age_max,
          'genders', coalesce((select jsonb_agg(g order by g) from unnest(pp.genders) g), '[]'::jsonb),
          'educationIds', coalesce((select jsonb_agg(x order by x) from unnest(pp.education_ids) x), '[]'::jsonb),
          'professionIds', coalesce((select jsonb_agg(x order by x) from unnest(pp.profession_ids) x), '[]'::jsonb),
          'locations', coalesce((select jsonb_agg(l order by l) from unnest(pp.locations) l), '[]'::jsonb)
        )
        from public.partner_preferences pp
        where pp.profile_id = p_profile
      ),
      'null'::jsonb
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- inputsHash.
--
-- The removed implementation hashed `{"a":<canonical>,"b":<canonical>}` with the
-- pair ordered by profile id, using SHA-256. This reproduces the same structure,
-- ordering and digest. It is NOT byte-identical to the removed JS output, because
-- JS `JSON.stringify` emits the object-literal key order of that file while this
-- uses jsonb's canonical key order. Byte-parity is not required: it existed to
-- keep hashes of an already-running database valid, and a fresh Supabase
-- database has no legacy hash values. What is required — determinism, and
-- invariance to the order the pair is passed in — holds.
-- ---------------------------------------------------------------------------
create or replace function public.compat_inputs_hash(p_a uuid, p_b uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with ordered as (
    select
      case when p_a::text <= p_b::text then p_a else p_b end as lo,
      case when p_a::text <= p_b::text then p_b else p_a end as hi
  )
  select encode(
    sha256(
      convert_to(
        '{"a":' || public.compat_canonical_input(lo)::text
        || ',"b":' || public.compat_canonical_input(hi)::text || '}',
        'UTF8'
      )
    ),
    'hex'
  )
  from ordered;
$$;

-- ---------------------------------------------------------------------------
-- eligibility, ported from `computeEligibility` (service:97-133). Symmetric.
-- Returns the de-duplicated reason codes in the contract's order.
-- ---------------------------------------------------------------------------
create or replace function public.compute_eligibility(p_a uuid, p_b uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.profiles;
  b public.profiles;
  pa public.partner_preferences;
  pb public.partner_preferences;
  age_a integer;
  age_b integer;
  reasons text[] := array[]::text[];
begin
  select * into a from public.profiles where id = p_a;
  select * into b from public.profiles where id = p_b;
  select * into pa from public.partner_preferences where profile_id = p_a;
  select * into pb from public.partner_preferences where profile_id = p_b;

  age_a := public.age_from_dob(a.dob);
  age_b := public.age_from_dob(b.dob);

  if (age_a is null or age_a < 18) or (age_b is null or age_b < 18) then
    reasons := reasons || 'UNDERAGE';
  end if;

  if coalesce(array_length(pa.genders, 1), 0) > 0
     and not (b.gender::text = any (pa.genders)) then
    reasons := reasons || 'GENDER_NOT_PREFERRED';
  end if;
  if coalesce(array_length(pb.genders, 1), 0) > 0
     and not (a.gender::text = any (pb.genders)) then
    reasons := reasons || 'GENDER_NOT_PREFERRED';
  end if;

  if (pa.age_min is not null or pa.age_max is not null)
     and ((pa.age_min is not null and age_b < pa.age_min)
          or (pa.age_max is not null and age_b > pa.age_max)) then
    reasons := reasons || 'AGE_NOT_IN_RANGE';
  end if;
  if (pb.age_min is not null or pb.age_max is not null)
     and ((pb.age_min is not null and age_a < pb.age_min)
          or (pb.age_max is not null and age_a > pb.age_max)) then
    reasons := reasons || 'AGE_NOT_IN_RANGE';
  end if;

  -- de-duplicate the reason codes. Sorted, so the order is stable and does not
  -- depend on which branch was reached first.
  select coalesce(array_agg(distinct r order by r), array[]::text[])
    into reasons
    from unnest(reasons) r;

  return reasons;
end;
$$;

-- ---------------------------------------------------------------------------
-- preference_side_score: one seeker's satisfaction by the other profile
-- (`preferenceSideScore`, service:227-256). `available` is false when the seeker
-- has no preference row or has stated no clauses at all.
-- ---------------------------------------------------------------------------
create or replace function public.preference_side_score(p_seeker uuid, p_candidate uuid)
returns table (score integer, available boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pref public.partner_preferences;
  cand public.profiles;
  cand_age integer;
  clauses integer[] := array[]::integer[];
  total integer;
  satisfied integer;
begin
  select * into pref from public.partner_preferences where profile_id = p_seeker;
  if pref.profile_id is null then
    return query select 0, false;
    return;
  end if;

  select * into cand from public.profiles where id = p_candidate;
  if cand.id is null then
    return query select 0, false;
    return;
  end if;

  cand_age := public.age_from_dob(cand.dob);

  if pref.age_min is not null then
    clauses := clauses || (case when cand_age is not null and cand_age >= pref.age_min then 1 else 0 end);
  end if;
  if pref.age_max is not null then
    clauses := clauses || (case when cand_age is not null and cand_age <= pref.age_max then 1 else 0 end);
  end if;
  if coalesce(array_length(pref.genders, 1), 0) > 0 then
    clauses := clauses || (case when cand.gender is not null and cand.gender::text = any (pref.genders) then 1 else 0 end);
  end if;
  if coalesce(array_length(pref.education_ids, 1), 0) > 0 then
    clauses := clauses || (case when cand.education_id is not null and cand.education_id = any (pref.education_ids) then 1 else 0 end);
  end if;
  if coalesce(array_length(pref.profession_ids, 1), 0) > 0 then
    clauses := clauses || (case when cand.profession_id is not null and cand.profession_id = any (pref.profession_ids) then 1 else 0 end);
  end if;
  if coalesce(array_length(pref.locations, 1), 0) > 0 then
    clauses := clauses || (
      case when exists (
        select 1 from unnest(pref.locations) as loc
         where lower(loc) = lower(cand.city)
            or lower(loc) = lower(cand.district)
      ) then 1 else 0 end
    );
  end if;

  total := coalesce(array_length(clauses, 1), 0);
  if total = 0 then
    return query select 0, false;
    return;
  end if;

  satisfied := (select coalesce(sum(c), 0) from unnest(clauses) c);
  return query select round(100.0 * satisfied / total)::integer, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The scorer. Drop the 0007 signature first (the return type changes).
-- ---------------------------------------------------------------------------
drop function if exists public.preference_fit(uuid, uuid);
drop function if exists public.compute_compatibility(uuid, uuid);

create or replace function public.compute_compatibility(p_a uuid, p_b uuid)
returns table (
  interests_score             smallint,
  education_score             smallint,
  profession_score            smallint,
  education_profession_score  smallint,
  location_score              smallint,
  lifestyle_score             smallint,
  preference_score            smallint,
  interests_available         boolean,
  education_available         boolean,
  profession_available        boolean,
  education_profession_available boolean,
  location_available          boolean,
  lifestyle_available         boolean,
  preference_available        boolean,
  overall_score               smallint,
  model_version               text,
  inputs_hash                 text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.profiles;
  b public.profiles;
  -- raw tier factors
  f_edu_score integer; f_edu_avail boolean;
  f_prof_score integer; f_prof_avail boolean;
  -- factors
  v_interests_score integer; v_interests_avail boolean;
  v_edprof_score integer; v_edprof_avail boolean;
  v_location_score integer; v_location_avail boolean;
  v_lifestyle_score integer; v_lifestyle_avail boolean;
  v_pref_score integer; v_pref_avail boolean;
  -- intermediates
  edu_tier_a integer; edu_tier_b integer;
  prof_tier_a integer; prof_tier_b integer;
  shared_interests integer; union_interests integer;
  distance_sig integer;
  a_life jsonb; b_life jsonb;
  shared_keys integer; matching_keys integer;
  side_a record; side_b record;
  avail_present integer[] := array[]::integer[];
  v_overall integer;
begin
  select * into a from public.profiles where id = p_a;
  select * into b from public.profiles where id = p_b;
  if a.id is null or b.id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'no_data_found';
  end if;

  -- ---- interests: Jaccard over the union of interest ids
  select count(*) into shared_interests
    from public.profile_interests x
    join public.profile_interests y on y.interest_id = x.interest_id
   where x.profile_id = p_a and y.profile_id = p_b;
  union_interests :=
      (select count(*) from public.profile_interests where profile_id = p_a)
    + (select count(*) from public.profile_interests where profile_id = p_b)
    - shared_interests;
  if union_interests = 0 then
    v_interests_score := 0; v_interests_avail := false;
  else
    v_interests_score := round(100.0 * shared_interests / union_interests);
    v_interests_avail := true;
  end if;

  -- ---- education and profession tier proximity: max(0, 100 - 20 * gap)
  select e.tier into edu_tier_a from public.education_levels e where e.id = a.education_id;
  select e.tier into edu_tier_b from public.education_levels e where e.id = b.education_id;
  if edu_tier_a is null or edu_tier_b is null then
    f_edu_score := 0; f_edu_avail := false;
  else
    f_edu_score := greatest(0, 100 - 20 * abs(edu_tier_a - edu_tier_b));
    f_edu_avail := true;
  end if;

  select pr.tier into prof_tier_a from public.professions pr where pr.id = a.profession_id;
  select pr.tier into prof_tier_b from public.professions pr where pr.id = b.profession_id;
  if prof_tier_a is null or prof_tier_b is null then
    f_prof_score := 0; f_prof_avail := false;
  else
    f_prof_score := greatest(0, 100 - 20 * abs(prof_tier_a - prof_tier_b));
    f_prof_avail := true;
  end if;

  -- ---- educationProfession: mean of whichever tier factors are available
  avail_present := array[]::integer[];
  if f_edu_avail then avail_present := avail_present || f_edu_score; end if;
  if f_prof_avail then avail_present := avail_present || f_prof_score; end if;
  if coalesce(array_length(avail_present, 1), 0) = 0 then
    v_edprof_score := 0; v_edprof_avail := false;
  else
    v_edprof_score := round((select avg(x) from unnest(avail_present) x));
    v_edprof_avail := true;
  end if;

  -- ---- location: max of the available signals
  v_location_avail := false;
  v_location_score := 0;
  if a.city is not null and b.city is not null and lower(a.city) = lower(b.city) then
    v_location_score := 100; v_location_avail := true;
  end if;
  if a.district is not null and b.district is not null and lower(a.district) = lower(b.district) then
    if 70 > v_location_score then v_location_score := 70; end if;
    v_location_avail := true;
  end if;
  if a.lat is not null and a.lng is not null and b.lat is not null and b.lng is not null then
    distance_sig := greatest(0, 100 - round(public.haversine_km(a.lat, a.lng, b.lat, b.lng))::integer);
    if distance_sig > v_location_score then v_location_score := distance_sig; end if;
    v_location_avail := true;
  end if;

  -- ---- lifestyle: fraction of shared keys whose values are canonically equal
  a_life := public.compat_lifestyle(p_a);
  b_life := public.compat_lifestyle(p_b);
  select count(*) into shared_keys
    from jsonb_object_keys(a_life) k
   where b_life ? k;
  if shared_keys = 0 then
    v_lifestyle_score := 0; v_lifestyle_avail := false;
  else
    select count(*) into matching_keys
      from jsonb_object_keys(a_life) k
     where b_life ? k
       and public.compat_canonical_value(a_life -> k) = public.compat_canonical_value(b_life -> k);
    v_lifestyle_score := round(100.0 * matching_keys / shared_keys);
    v_lifestyle_avail := true;
  end if;

  -- ---- partnerPreference: mean of the available per-side satisfaction scores
  select * into side_a from public.preference_side_score(p_a, p_b);
  select * into side_b from public.preference_side_score(p_b, p_a);
  avail_present := array[]::integer[];
  if side_a.available then avail_present := avail_present || side_a.score; end if;
  if side_b.available then avail_present := avail_present || side_b.score; end if;
  if coalesce(array_length(avail_present, 1), 0) = 0 then
    v_pref_score := 0; v_pref_avail := false;
  else
    v_pref_score := round((select avg(x) from unnest(avail_present) x));
    v_pref_avail := true;
  end if;

  -- ---- overall: weighted sum over available factors; unavailable contributes 0
  v_overall := round(
      0.25 * case when v_interests_avail then v_interests_score else 0 end
    + 0.20 * case when v_edprof_avail then v_edprof_score else 0 end
    + 0.15 * case when v_location_avail then v_location_score else 0 end
    + 0.15 * case when v_lifestyle_avail then v_lifestyle_score else 0 end
    + 0.25 * case when v_pref_avail then v_pref_score else 0 end
  );

  return query select
    v_interests_score::smallint,
    f_edu_score::smallint,
    f_prof_score::smallint,
    v_edprof_score::smallint,
    v_location_score::smallint,
    v_lifestyle_score::smallint,
    v_pref_score::smallint,
    v_interests_avail,
    f_edu_avail,
    f_prof_avail,
    v_edprof_avail,
    v_location_avail,
    v_lifestyle_avail,
    v_pref_avail,
    greatest(0, least(100, v_overall))::smallint,
    public.compat_model_version(),
    public.compat_inputs_hash(p_a, p_b);
end;
$$;

-- =============================================================================
-- compatibility_for: the caller-facing entry point. Eligibility is checked
-- first; an ineligible pair returns no score and writes no cache row.
-- =============================================================================
drop function if exists public.compatibility_for(uuid);

create or replace function public.compatibility_for(p_other uuid)
returns table (
  profile_a_id                uuid,
  profile_b_id                uuid,
  eligible                    boolean,
  eligibility_reasons         text[],
  interests_score             smallint,
  education_score             smallint,
  profession_score            smallint,
  education_profession_score  smallint,
  location_score              smallint,
  lifestyle_score             smallint,
  preference_score            smallint,
  interests_available         boolean,
  education_available         boolean,
  profession_available        boolean,
  education_profession_available boolean,
  location_available          boolean,
  lifestyle_available         boolean,
  preference_available        boolean,
  overall_score               smallint,
  model_version               text,
  inputs_hash                 text,
  from_cache                  boolean,
  computed_at                 timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
-- RETURNS TABLE names collide with compatibility_scores columns; prefer column.
#variable_conflict use_column
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  reasons text[];
  scored record;
  existing public.compatibility_scores;
  v_hash text;
  v_from_cache boolean := false;
  v_computed_at timestamptz;
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

  reasons := public.compute_eligibility(lo, hi);
  v_hash := public.compat_inputs_hash(lo, hi);

  -- Ineligible: no score, no cache row. The hash is still reported, matching the
  -- contract, which builds it before the eligibility branch.
  if coalesce(array_length(reasons, 1), 0) > 0 then
    return query select
      lo, hi, false, reasons,
      null::smallint, null::smallint, null::smallint, null::smallint,
      null::smallint, null::smallint, null::smallint,
      null::boolean, null::boolean, null::boolean, null::boolean,
      null::boolean, null::boolean, null::boolean,
      null::smallint, public.compat_model_version(), v_hash,
      false, null::timestamptz;
    return;
  end if;

  select * into scored from public.compute_compatibility(lo, hi);

  select * into existing
    from public.compatibility_scores c
   where c.profile_a_id = lo and c.profile_b_id = hi;

  v_from_cache :=
    existing.profile_a_id is not null
    and existing.inputs_hash = v_hash
    and existing.model_version = public.compat_model_version();

  if v_from_cache then
    v_computed_at := existing.computed_at;
  else
    v_computed_at := now();
    insert into public.compatibility_scores as cs (
      profile_a_id, profile_b_id,
      overall_score, interests_score, education_score, profession_score,
      location_score, preference_score, model_version, inputs_hash, computed_at
    )
    values (
      lo, hi,
      scored.overall_score, scored.interests_score, scored.education_score,
      scored.profession_score, scored.location_score, scored.preference_score,
      public.compat_model_version(), v_hash, v_computed_at
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
  end if;

  return query select
    lo, hi, true, reasons,
    scored.interests_score, scored.education_score, scored.profession_score,
    scored.education_profession_score, scored.location_score,
    scored.lifestyle_score, scored.preference_score,
    scored.interests_available, scored.education_available, scored.profession_available,
    scored.education_profession_available, scored.location_available,
    scored.lifestyle_available, scored.preference_available,
    scored.overall_score, scored.model_version, scored.inputs_hash,
    v_from_cache, v_computed_at;
end;
$$;

-- =============================================================================
-- Grants. 0004 revoked EXECUTE from PUBLIC.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.compat_weights() to authenticated;
    grant execute on function public.compat_model_version() to authenticated;
    grant execute on function public.compat_canonical_input(uuid) to authenticated;
    grant execute on function public.compat_inputs_hash(uuid, uuid) to authenticated;
    grant execute on function public.compute_eligibility(uuid, uuid) to authenticated;
    grant execute on function public.preference_side_score(uuid, uuid) to authenticated;
    grant execute on function public.compute_compatibility(uuid, uuid) to authenticated;
    grant execute on function public.compatibility_for(uuid) to authenticated;
  end if;
end;
$$;
