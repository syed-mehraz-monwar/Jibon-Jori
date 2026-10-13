-- =============================================================================
-- LOCAL TEST HARNESS BOOTSTRAP - NEVER APPLIED TO SUPABASE
-- =============================================================================
-- Supabase already provides everything this file creates:
--
--   * the `auth` schema, `auth.users` and `auth.uid()`
--   * the `storage` schema, `storage.buckets`, `storage.objects` and
--     `storage.foldername()`
--   * the `anon`, `authenticated` and `service_role` roles
--
-- A bare PostgreSQL has none of them, so the migrations in ../migrations cannot
-- run there. This file supplies the minimum stand-ins so that the migrations -
-- and, critically, the RLS policies - can be executed and asserted against a
-- throwaway local database.
--
-- This is a test fixture, not a runtime component. Nothing in the delivered
-- architecture connects to a local database: the application talks only to
-- Supabase over HTTPS. `auth.uid()` here is the same definition Supabase uses,
-- so a policy that passes locally behaves identically on the real project.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  phone              text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  -- Both confirmation timestamps exist on Supabase's auth.users and the
  -- pending-account gate reads both, so the stand-in must carry both.
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  created_at         timestamptz not null default now()
);

-- Definition kept identical to Supabase's, so policies that read the JWT claims
-- behave the same here as they do on the project.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage schema
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

-- `foldername('uid/a/b.jpg')` -> {'uid','a'}; element 1 is the owner folder,
-- which is the only element the policies depend on.
create or replace function storage.foldername(p_name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(p_name, '/'))[1:greatest(array_length(string_to_array(p_name, '/'), 1) - 1, 0)];
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Supabase platform default privileges
-- ---------------------------------------------------------------------------
-- A hosted Supabase project configures default privileges so that every object created
-- in `public` is automatically granted to anon/authenticated/service_role. The harness
-- did NOT simulate this, so the suite could not see that `anon` ends up holding SELECT on
-- every table and EXECUTE on every function on a real project - a divergence that only
-- appeared on the first `db push` to Supabase and that migration 0015 now corrects.
-- Modelling the platform here means the posture assertions in rls_assertions.sql are
-- tested against the real grant environment rather than a friendlier one.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
