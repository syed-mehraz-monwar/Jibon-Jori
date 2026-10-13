-- =============================================================================
-- JibonJori - 0001 foundation
-- Target: Supabase PostgreSQL (also applies cleanly to plain PostgreSQL 14+,
-- which is what makes the RLS policies testable in supabase/tests).
--
-- This is a FRESH schema for a pure Supabase BaaS deployment. The previous
-- Prisma schema is not preserved: `users`, `otp_verifications` and `sessions`
-- are gone because Supabase Auth owns identity, credentials, email verification
-- and session refresh. `profiles.id` is the Supabase Auth user id.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions. Supabase ships an `extensions` schema; create it so the same
-- migration works on a bare PostgreSQL instance used by the test harness.
-- ---------------------------------------------------------------------------
create schema if not exists extensions;

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('member', 'admin');
create type public.gender as enum ('male', 'female', 'other');
create type public.marital_status as enum ('never_married', 'divorced', 'widowed', 'annulled');
create type public.photo_visibility as enum ('public', 'members', 'private');
create type public.media_kind as enum ('photo', 'document');
create type public.notification_type as enum ('like', 'comment', 'rating', 'match', 'security', 'system');
create type public.chat_role as enum ('user', 'assistant', 'system');

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at without relying on application code.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- Reference / lookup tables
-- =============================================================================

create table public.education_levels (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  label      text not null,
  tier       smallint not null check (tier between 0 and 10),
  created_at timestamptz not null default now()
);

create table public.professions (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  label      text not null,
  tier       smallint not null check (tier between 0 and 10),
  created_at timestamptz not null default now()
);

create table public.interests (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  label      text not null,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- profiles - the application identity, 1:1 with auth.users
-- =============================================================================
-- Nullable profile fields are deliberate: the row is created by the signup
-- trigger before the user has filled anything in, and `completeness` tracks
-- progress. The CHECK constraints below make it impossible to *publish* an
-- incomplete profile, so nullable never means "advertised with missing data".

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  username            extensions.citext not null unique,
  display_name        text,
  dob                 date,
  gender              public.gender,
  height_cm           smallint check (height_cm between 100 and 250),
  marital_status      public.marital_status,
  religion            text,
  caste_community     text,
  education_id        uuid references public.education_levels (id) on delete restrict,
  education_detail    text,
  profession_id       uuid references public.professions (id) on delete restrict,
  profession_detail   text,
  income_band         text,
  city                text,
  district            text,
  country             text,
  lat                 double precision check (lat between -90 and 90),
  lng                 double precision check (lng between -180 and 180),
  location_consent    boolean not null default false,
  show_exact_location boolean not null default false,
  about               text check (about is null or char_length(about) <= 4000),
  lifestyle           jsonb not null default '{}'::jsonb,
  is_public           boolean not null default false,
  photo_visibility    public.photo_visibility not null default 'public',
  completeness        smallint not null default 0 check (completeness between 0 and 100),
  role                public.user_role not null default 'member',
  is_suspended        boolean not null default false,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- usernames are stored lower-case so the citext uniqueness index and the
  -- availability RPC agree on what "taken" means
  constraint profiles_username_shape check (username::text ~ '^[a-z0-9_]{3,32}$'),
  constraint profiles_username_lowercase check (username::text = lower(username::text)),

  -- publishing requires the fields the discovery screens actually render
  constraint profiles_publish_requires_core_fields check (
    not is_public
    or (display_name is not null and dob is not null and gender is not null and city is not null)
  ),

  -- precise coordinates may only be exposed when consent was given
  constraint profiles_exact_location_requires_consent check (
    not show_exact_location or location_consent
  )
);

comment on column public.profiles.id is
  'Supabase Auth user id. Never accepted from the client: RLS uses auth.uid().';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Signup trigger - creates the profile row for a new Supabase Auth user
-- =============================================================================
-- The username is taken from the signup metadata when present. A collision is
-- NOT silently papered over with a suffix (that would rename a user's chosen
-- handle behind their back): the unique index raises and signUp reports it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  candidate extensions.citext;
begin
  candidate := nullif(lower(trim(coalesce(new.raw_user_meta_data ->> 'username', ''))), '');

  if candidate is null or candidate::text !~ '^[a-z0-9_]{3,32}$' then
    candidate := lower(split_part(coalesce(new.email, 'user'), '@', 1));
    candidate := regexp_replace(candidate, '[^a-z0-9_]', '_', 'g');
    candidate := substr(candidate || '_' || substr(new.id::text, 1, 8), 1, 32);
    -- guarantee the shape even for pathological emails
    candidate := substr(regexp_replace(candidate, '^[^a-z0-9_]+', ''), 1, 32);
    if candidate::text !~ '^[a-z0-9_]{3,32}$' then
      candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
    end if;
  end if;

  insert into public.profiles (id, username) values (new.id, candidate)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- partner_preferences - private matchmaking inputs, 1:1 with profiles
-- =============================================================================

create table public.partner_preferences (
  profile_id     uuid primary key references public.profiles (id) on delete cascade,
  age_min        smallint check (age_min between 18 and 99),
  age_max        smallint check (age_max between 18 and 99),
  genders        text[] not null default '{}',
  education_ids  uuid[] not null default '{}',
  profession_ids uuid[] not null default '{}',
  locations      text[] not null default '{}',
  must_have      jsonb not null default '{}'::jsonb,
  dealbreakers   jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint partner_preferences_age_range check (age_min is null or age_max is null or age_min <= age_max)
);

create trigger partner_preferences_set_updated_at
  before update on public.partner_preferences
  for each row execute function public.set_updated_at();

-- =============================================================================
-- profile_interests - explicit M2M
-- =============================================================================

create table public.profile_interests (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  interest_id uuid not null references public.interests (id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (profile_id, interest_id)
);

create index profile_interests_interest_id_idx on public.profile_interests (interest_id);
