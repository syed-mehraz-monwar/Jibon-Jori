-- =============================================================================
-- JibonJori - 0011 pending-account gating
-- =============================================================================
-- The archived application refused a `status = 'pending'` account twice over: it
-- could not log in (`auth.service.ts`: ACCOUNT_PENDING), and it could not open an
-- authenticated socket. A pending account was one whose email or phone had not
-- been verified. The old `UserStatus` enum drove that, and `status` was derived
-- from verification plus moderation, not stored independently.
--
-- In the Supabase architecture there is no `users` table: verification lives on
-- `auth.users` (`email_confirmed_at` / `phone_confirmed_at`) and moderation lives
-- on `profiles` (`is_suspended`, `deleted_at`). Supabase Auth's own
-- `enable_confirmations` setting is the FIRST gate (no session is issued before
-- confirmation). This migration is the SECOND gate: the database refuses to treat
-- an unverified principal as an active member, so a token obtained by any other
-- route still cannot read or write member data.
--
-- Both gates are required. Relying only on the Auth setting would leave the data
-- layer open if that setting were ever changed or bypassed.
--
-- Two distinct checks are needed, because discoverability in the old model
-- required the *candidate* to be an active user, not merely the viewer:
--
--   is_active_member()   - the CALLER (viewer) is verified and in good standing
--   is_active_profile(id) - the TARGET profile belongs to such a user
--
-- `account_state()` reproduces the old four-state status for the reports.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Has the account verified an email or a phone number?
-- ---------------------------------------------------------------------------
create or replace function public.has_verified_contact(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = p_id
       and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  );
$$;

-- ---------------------------------------------------------------------------
-- The caller is a verified member in good standing.
--
-- REDEFINED from 0004: verification is now part of "active". Every policy and
-- helper that already called is_active_member() therefore gains the gate without
-- being individually rewritten, which is why the change is made here rather than
-- by editing each policy.
--
-- Deliberately still true for an unverified caller: reading and updating their
-- own `profiles` row (those policies use `id = auth.uid()` and do not consult
-- this function), because completing the profile is part of onboarding. What an
-- unverified caller cannot do is participate: discover others, appear in
-- discovery, interact, comment, rate, upload, or open a chat.
-- ---------------------------------------------------------------------------
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
        from public.profiles p
       where p.id = auth.uid()
         and p.deleted_at is null
         and not p.is_suspended
    )
    and public.has_verified_contact(auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- The TARGET profile belongs to a verified member in good standing.
--
-- This is the candidate-side half of the old "public and active user" filter.
-- ---------------------------------------------------------------------------
create or replace function public.is_active_profile(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_id
       and p.deleted_at is null
       and not p.is_suspended
  )
  and public.has_verified_contact(p_id);
$$;

-- ---------------------------------------------------------------------------
-- Old four-state status, derived. Used by the `users` report (0013) and by the
-- adversarial tests, so a single definition is shared.
-- ---------------------------------------------------------------------------
create or replace function public.account_state(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.id is null then null
    when p.deleted_at is not null then 'deleted'
    when p.is_suspended then 'suspended'
    when not public.has_verified_contact(p.id) then 'pending'
    else 'active'
  end
  from public.profiles p
  where p.id = p_id;
$$;

-- =============================================================================
-- Tighten the two read paths that decide what exists for a viewer.
--
-- `can_view_profile` / `can_view_photos` are the single definitions used by the
-- policies, so adding the target-side check here propagates everywhere.
-- =============================================================================
create or replace function public.can_view_profile(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_id
       and p.deleted_at is null
       and not p.is_suspended
       and (
         p.id = auth.uid()
         or public.is_admin()
         or (p.is_public and public.is_active_profile(p.id) and public.is_active_member())
       )
  );
$$;

create or replace function public.can_view_photos(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_id
       and p.deleted_at is null
       and not p.is_suspended
       and p.is_public
       and p.photo_visibility <> 'private'
       and (p.id = auth.uid() or (public.is_active_profile(p.id) and public.is_active_member()))
  );
$$;

-- The discovery policy must also require the target to be an active user.
drop policy if exists profiles_select_discoverable on public.profiles;
create policy profiles_select_discoverable on public.profiles
  for select to authenticated
  using (
    is_public
    and deleted_at is null
    and not is_suspended
    and public.is_active_profile(id)
    and public.is_active_member()
  );

-- =============================================================================
-- Grants. 0004 revoked EXECUTE from PUBLIC, and these helpers are called from
-- policy expressions, so the querying role needs EXECUTE on them.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.has_verified_contact(uuid) to authenticated;
    grant execute on function public.is_active_profile(uuid) to authenticated;
    grant execute on function public.account_state(uuid) to authenticated;
  end if;
end;
$$;
