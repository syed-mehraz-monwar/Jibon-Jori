-- =============================================================================
-- JibonJori - 0003 indexes, privileged-column guard, grants
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Indexes for the search and discovery hot paths.
-- The discovery indexes are partial (`is_public and deleted_at is null`) because
-- every discovery query carries exactly that predicate, and it keeps the index
-- from carrying rows nobody may ever see.
-- ---------------------------------------------------------------------------

create index profiles_public_created_idx
  on public.profiles (created_at desc) where is_public and deleted_at is null;
create index profiles_public_dob_idx
  on public.profiles (dob) where is_public and deleted_at is null;
create index profiles_public_marital_idx
  on public.profiles (marital_status) where is_public and deleted_at is null;
create index profiles_gender_city_idx
  on public.profiles (gender, city) where is_public and deleted_at is null;
create index profiles_education_idx on public.profiles (education_id);
create index profiles_profession_idx on public.profiles (profession_id);

-- Case-insensitive substring city search cannot use btree.
create index profiles_city_trgm_idx
  on public.profiles using gin (city extensions.gin_trgm_ops);

-- Username prefix/substring search in the admin screens.
create index profiles_username_trgm_idx
  on public.profiles using gin ((username::text) extensions.gin_trgm_ops);

-- Proximity search range-scans lat and evaluates lng inside the index.
create index profiles_lat_lng_idx on public.profiles (lat, lng);

-- ---------------------------------------------------------------------------
-- Privileged columns must not be self-serviceable.
-- RLS decides which ROWS a caller may update; it cannot restrict COLUMNS, so a
-- member could otherwise set `role = 'admin'` on their own row. This trigger is
-- the column-level control.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_admin boolean;
begin
  -- No authenticated identity: migrations, the service role and definer triggers
  -- are not constrained here.
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  ) into caller_is_admin;

  if caller_is_admin then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'PROFILE_COLUMN_PROTECTED: role' using errcode = 'insufficient_privilege';
  end if;
  if new.is_suspended is distinct from old.is_suspended then
    raise exception 'PROFILE_COLUMN_PROTECTED: is_suspended' using errcode = 'insufficient_privilege';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'PROFILE_COLUMN_PROTECTED: deleted_at' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

-- ---------------------------------------------------------------------------
-- Grants.
-- On Supabase the anon/authenticated/service_role roles exist; on a bare
-- PostgreSQL used by the test harness they do not, so the whole block is
-- guarded and is a no-op there.
--
-- Note that RLS is what actually restricts rows. These grants only decide which
-- verbs are reachable at all; a table with no policy for a verb stays denied.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then

    grant usage on schema public to anon, authenticated;

    -- Reference data is readable before sign-in so the registration screen can
    -- populate its dropdowns.
    grant select on public.education_levels to anon, authenticated;
    grant select on public.professions to anon, authenticated;
    grant select on public.interests to anon, authenticated;
    grant select on public.curated_videos to anon, authenticated;

    -- Everything else is reachable only by a signed-in user, and only as far as
    -- the policies allow. `profiles` is deliberately NOT granted to anon.
    grant select, insert, update, delete on all tables in schema public to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
  end if;
end;
$$;

-- Every SECURITY DEFINER function is executable by PUBLIC unless revoked, which
-- would let anon call privileged helpers. Revoke now; the RPC migration grants
-- back only the specific entry points that are meant to be public.
do $$
begin
  revoke execute on all functions in schema public from public;
exception
  when undefined_object then null;
end;
$$;
