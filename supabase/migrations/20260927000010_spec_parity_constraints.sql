-- =============================================================================
-- JibonJori - 0010 specification parity: constraints and cardinalities
-- =============================================================================
-- Phase 1 comparison against the archived source specification
-- (`migration_evidence/extracted/`) found validation contracts that the new
-- schema did not enforce yet. They are added here rather than by editing the
-- earlier migrations, so the reason for each is recorded in one auditable place.
--
-- Sources (archive = authority):
--   * `backend/src/modules/profile/profile.schemas.ts`      -> field bounds, adult-only, lat/lng pairing, lifestyle shape
--   * `backend/src/modules/partner-preferences/partner-preferences.schemas.ts` -> cardinalities, preference-rule shape
--   * `backend/src/modules/auth/reserved-usernames.ts`      -> reserved handle list and its normalization
--   * `backend/docs/CRYSTAL_REPORTS_DATASET_BINDING.md`     -> report contracts (handled in 0013)
--
-- Every bound below is a database invariant, not a client convenience: a direct
-- PostgREST insert or a forged request must fail at the database.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Reserved usernames.
--
-- Reproduces the archived normalization exactly: lower-case, then strip every
-- character that is not [a-z0-9]. That is why `Admin`, `a_d_m_i_n` and
-- `jibon-jori` are all reserved. IMMUTABLE so it can be used in a CHECK.
-- ---------------------------------------------------------------------------
create or replace function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
as $$
  with normalized as (
    select regexp_replace(lower(trim(coalesce(p_username, ''))), '[^a-z0-9]', '', 'g') as handle
  ),
  reserved(handle) as (
    values
      ('jibonjori'), ('jibonjoriadmin'), ('jibonjoriofficial'), ('jibonjorisupport'),
      ('admin'), ('administrator'), ('superadmin'), ('superuser'), ('root'),
      ('sysadmin'), ('moderator'), ('mod'), ('staff'), ('official'), ('owner'),
      ('founder'), ('management'), ('security'), ('system'), ('support'), ('help'),
      ('helpdesk'), ('service'), ('billing'), ('webmaster'), ('postmaster'),
      ('hostmaster'), ('abuse'), ('noreply'), ('noreply'),
      ('api'), ('graphql'), ('socket'), ('socketio'), ('realtime'), ('static'),
      ('assets'), ('cdn'), ('health'), ('status'), ('metrics'), ('webhook'),
      ('webhooks'), ('callback'), ('oauth'), ('sso'), ('login'), ('logout'),
      ('signup'), ('register'), ('auth'), ('account'), ('accounts'), ('settings'),
      ('profile'), ('profiles'), ('search'), ('matches'), ('reports'), ('report'),
      ('audit'),
      ('null'), ('undefined'), ('none'), ('anonymous'), ('guest'), ('user'),
      ('test'), ('testing'), ('demo'), ('example'), ('sample'), ('deleted'),
      ('me'), ('self'), ('you')
  )
  select exists (select 1 from normalized n join reserved r on r.handle = n.handle);
$$;

comment on function public.is_reserved_username(text) is
  'Matches the archived reserved-usernames.ts normalization: lower-case, strip non [a-z0-9].';

-- ---------------------------------------------------------------------------
-- lifestyle shape.
--
-- The archived schema is strict: exactly the three known questions, a closed
-- value set each, unknown keys rejected. An empty string is dropped rather than
-- stored (the archived transform filters `""`), so it is rejected here too.
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_lifestyle(p_lifestyle jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(p_lifestyle) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(p_lifestyle) as key
       where key not in ('smoking', 'drinking', 'diet')
    )
    and (
      not p_lifestyle ? 'smoking'
      or p_lifestyle ->> 'smoking' in ('never', 'occasionally', 'regularly')
    )
    and (
      not p_lifestyle ? 'drinking'
      or p_lifestyle ->> 'drinking' in ('never', 'occasionally', 'regularly')
    )
    and (
      not p_lifestyle ? 'diet'
      or p_lifestyle ->> 'diet' in ('vegetarian', 'non_vegetarian', 'eggetarian', 'vegan')
    );
$$;

-- ---------------------------------------------------------------------------
-- Preference rule shape (must_have / dealbreakers).
--
-- Strict key set, bounded lists, and minHeightCm <= maxHeightCm. Lists are
-- bounded by the archived maxima so one request cannot store an unbounded array.
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_preference_rules(p_rules jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(p_rules) = 'object'
    -- closed key set
    and not exists (
      select 1 from jsonb_object_keys(p_rules) as key
       where key not in (
         'educationIds', 'professionIds', 'locations', 'religions',
         'maritalStatuses', 'minHeightCm', 'maxHeightCm',
         'requiresVerifiedContact', 'notes'
       )
    )
    -- every present list is an array within its cap
    and (not p_rules ? 'educationIds'  or (jsonb_typeof(p_rules -> 'educationIds')  = 'array' and jsonb_array_length(p_rules -> 'educationIds')  <= 50))
    and (not p_rules ? 'professionIds' or (jsonb_typeof(p_rules -> 'professionIds') = 'array' and jsonb_array_length(p_rules -> 'professionIds') <= 50))
    and (not p_rules ? 'locations'     or (jsonb_typeof(p_rules -> 'locations')     = 'array' and jsonb_array_length(p_rules -> 'locations')     <= 100))
    and (not p_rules ? 'religions'     or (jsonb_typeof(p_rules -> 'religions')     = 'array' and jsonb_array_length(p_rules -> 'religions')     <= 30))
    and (not p_rules ? 'maritalStatuses' or (jsonb_typeof(p_rules -> 'maritalStatuses') = 'array' and jsonb_array_length(p_rules -> 'maritalStatuses') <= 4))
    -- scalar bounds
    and (not p_rules ? 'minHeightCm' or (p_rules ->> 'minHeightCm')::numeric between 100 and 250)
    and (not p_rules ? 'maxHeightCm' or (p_rules ->> 'maxHeightCm')::numeric between 100 and 250)
    and (not p_rules ? 'notes' or char_length(p_rules ->> 'notes') <= 500)
    and (not p_rules ? 'requiresVerifiedContact' or jsonb_typeof(p_rules -> 'requiresVerifiedContact') = 'boolean')
    -- internal consistency
    and (
      not (p_rules ? 'minHeightCm' and p_rules ? 'maxHeightCm')
      or (p_rules ->> 'minHeightCm')::numeric <= (p_rules ->> 'maxHeightCm')::numeric
    );
$$;

-- =============================================================================
-- profiles
-- =============================================================================
-- The bounds below arrive as unnamed column CHECKs (`profiles_about_check`,
-- `profiles_lat_check`, …). Rather than guess names, drop any CHECK on the
-- column and add a named replacement, so the resulting constraint set is exactly
-- what this file declares.
do $$
declare
  constraint_name text;
  target_column text;
  redefined text[] := array['about', 'lat', 'lng', 'height_cm', 'completeness'];
begin
  foreach target_column in array redefined loop
    for constraint_name in
      select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
       where nsp.nspname = 'public'
         and rel.relname = 'profiles'
         and con.contype = 'c'
         and pg_get_constraintdef(con.oid) ilike '%' || target_column || '%'
    loop
      execute format('alter table public.profiles drop constraint %I', constraint_name);
    end loop;
  end loop;
end;
$$;

alter table public.profiles
  -- age 18+ (archived `profiles_adult_only`). Kept nullable: the row is created
  -- at signup before the date is known, but it cannot hold a minor's date.
  add constraint profiles_adult_only check (dob is null or dob <= current_date - interval '18 years'),
  -- both coordinates or neither (archived `profiles_lat_lng_conull`)
  add constraint profiles_lat_lng_conull check ((lat is null) = (lng is null)),
  add constraint profiles_height_range check (height_cm is null or height_cm between 100 and 250),
  add constraint profiles_completeness_range check (completeness between 0 and 100),
  add constraint profiles_lat_range check (lat is null or lat between -90 and 90),
  add constraint profiles_lng_range check (lng is null or lng between -180 and 180),
  -- field bounds, verbatim from the archived profile schema
  add constraint profiles_display_name_len check (display_name is null or char_length(display_name) between 2 and 80),
  add constraint profiles_about_len check (about is null or char_length(about) <= 2000),
  add constraint profiles_city_len check (city is null or char_length(city) between 1 and 100),
  add constraint profiles_district_len check (district is null or char_length(district) <= 100),
  add constraint profiles_country_len check (country is null or char_length(country) <= 100),
  add constraint profiles_religion_len check (religion is null or char_length(religion) <= 100),
  add constraint profiles_caste_len check (caste_community is null or char_length(caste_community) <= 100),
  add constraint profiles_education_detail_len check (education_detail is null or char_length(education_detail) <= 255),
  add constraint profiles_profession_detail_len check (profession_detail is null or char_length(profession_detail) <= 255),
  add constraint profiles_income_band_len check (income_band is null or char_length(income_band) <= 50),
  -- structured, closed-shape lifestyle
  add constraint profiles_lifestyle_shape check (public.is_valid_lifestyle(lifestyle)),
  -- reserved handles cannot be taken, at the database
  add constraint profiles_username_not_reserved check (not public.is_reserved_username(username::text));

-- =============================================================================
-- comments: body 1..1000 (the archived bound; 2.7 recorded 1..2000 in error)
-- =============================================================================
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'comments'
       and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%char_length(body)%'
  loop
    execute format('alter table public.comments drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.comments
  add constraint comments_body_len check (char_length(body) between 1 and 1000);

-- =============================================================================
-- partner_preferences: cardinalities and rule shapes
-- =============================================================================
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'partner_preferences'
       and con.contype = 'c'
       and (pg_get_constraintdef(con.oid) ilike '%age_min%' or pg_get_constraintdef(con.oid) ilike '%age_max%')
  loop
    execute format('alter table public.partner_preferences drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.partner_preferences
  add constraint partner_preferences_age_min_range check (age_min is null or age_min between 18 and 100),
  add constraint partner_preferences_age_max_range check (age_max is null or age_max between 18 and 100),
  add constraint partner_preferences_age_order check (age_min is null or age_max is null or age_min <= age_max),
  add constraint partner_preferences_genders_max check (coalesce(array_length(genders, 1), 0) <= 3),
  add constraint partner_preferences_education_max check (coalesce(array_length(education_ids, 1), 0) <= 50),
  add constraint partner_preferences_profession_max check (coalesce(array_length(profession_ids, 1), 0) <= 50),
  add constraint partner_preferences_locations_max check (coalesce(array_length(locations, 1), 0) <= 100),
  add constraint partner_preferences_must_have_shape check (public.is_valid_preference_rules(must_have)),
  add constraint partner_preferences_dealbreakers_shape check (public.is_valid_preference_rules(dealbreakers));

-- =============================================================================
-- profile_interests: at most 20 interests per profile.
--
-- A cardinality across rows cannot be a CHECK, so this is a trigger. It mirrors
-- the archived `interestIds` cap. The profile form submits a full replacement
-- set, so a bulk replace is expected to delete then insert; the limit is applied
-- to the resulting count, not per statement.
-- =============================================================================
create or replace function public.enforce_profile_interest_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  interest_count integer;
begin
  select count(*) into interest_count
    from public.profile_interests
   where profile_id = new.profile_id;

  if interest_count >= 20 then
    raise exception 'PROFILE_INTEREST_LIMIT' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists profile_interests_enforce_limit on public.profile_interests;
create trigger profile_interests_enforce_limit
  before insert on public.profile_interests
  for each row execute function public.enforce_profile_interest_limit();

-- ---------------------------------------------------------------------------
-- The reserved-name rule must also hold on the read paths that already consult
-- availability, and the signup trigger must not mint a reserved default from an
-- email local-part (e.g. `admin@example.com` would otherwise become `admin`).
--
-- A username the user EXPLICITLY chose is never silently renamed: if it is
-- reserved (CHECK) or already taken (unique index) the signup insert fails and
-- the client reports it, which is what the archived API did. Only the fallback
-- path -- no username supplied, or an unusable one -- derives a handle, and that
-- derived handle is re-checked so it cannot be reserved either.
-- ---------------------------------------------------------------------------
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
    when public.is_reserved_username(p_username) then false
    when exists (
      select 1 from public.profiles
       where username = lower(trim(p_username))::extensions.citext
    ) then false
    else true
  end;
$$;

create or replace function public.derive_username(p_email text, p_id uuid)
returns extensions.citext
language plpgsql
immutable
as $$
declare
  candidate text;
begin
  candidate := lower(split_part(coalesce(p_email, 'user'), '@', 1));
  candidate := regexp_replace(candidate, '[^a-z0-9_]', '_', 'g');
  candidate := regexp_replace(candidate, '^_+', '');
  candidate := substr(candidate || '_' || substr(p_id::text, 1, 8), 1, 32);
  candidate := regexp_replace(candidate, '^[^a-z0-9_]+', '');

  if candidate !~ '^[a-z0-9_]{3,32}$' or public.is_reserved_username(candidate) then
    candidate := 'user_' || substr(replace(p_id::text, '-', ''), 1, 12);
  end if;

  return candidate::extensions.citext;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  candidate extensions.citext;
  explicit extensions.citext;
begin
  explicit := nullif(lower(trim(coalesce(new.raw_user_meta_data ->> 'username', ''))), '');

  -- A well-formed explicit choice is used verbatim. A reserved one violates the
  -- CHECK and a duplicate violates the unique index: either way the signup fails
  -- rather than being renamed behind the user's back.
  if explicit is not null and explicit::text ~ '^[a-z0-9_]{3,32}$' then
    candidate := explicit;
  else
    candidate := public.derive_username(new.email, new.id);
  end if;

  insert into public.profiles (id, username) values (new.id, candidate)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants for the newly added helpers (0004 revoked EXECUTE from PUBLIC).
-- `is_reserved_username` and `is_valid_lifestyle` are referenced by CHECK
-- constraints, so the writing role needs EXECUTE on them.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.is_reserved_username(text) to authenticated;
    grant execute on function public.is_valid_lifestyle(jsonb) to authenticated;
    grant execute on function public.is_valid_preference_rules(jsonb) to authenticated;
    grant execute on function public.username_available(text) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.username_available(text) to anon;
  end if;
end;
$$;
