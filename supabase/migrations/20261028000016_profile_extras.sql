-- =============================================================================
-- JibonJori - 0016 profile extras
-- =============================================================================
-- Adds the optional profile information requested for the profile editor:
-- religious practice, blood group, biodata and social links.
--
-- Shape of this migration:
--   * one additive table (`profile_details`) 1:1 with `profiles`, because the
--     three groups have different visibility rules and RLS is row level, not
--     column level. Keeping them in a child table lets the owner-only policy
--     cover writes without leaking a private field through a discoverable
--     profile row.
--   * a SECURITY DEFINER read function for *other* members that masks each
--     field according to its own visibility setting. No client ever selects
--     another member's `profile_details` row directly.
--
-- Non-destructive: no existing table, column, row or policy is altered or
-- dropped. Existing profiles simply have no `profile_details` row until the
-- owner saves optional information, which reads as "not provided".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Social link validation
-- -----------------------------------------------------------------------------
-- Allowed platforms are fixed, and every value must be an absolute https URL.
-- `javascript:`, `data:` and plain `http:` are rejected here as well as in the
-- client, so a hand-crafted PostgREST call cannot store an unsafe scheme.
create or replace function public.social_links_valid(p_links jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  link_key text;
  link_value text;
begin
  if p_links is null then
    return true;
  end if;
  if jsonb_typeof(p_links) <> 'object' then
    return false;
  end if;

  for link_key, link_value in select * from jsonb_each_text(p_links) loop
    if link_key not in ('facebook', 'instagram', 'linkedin', 'x', 'youtube', 'website') then
      return false;
    end if;
    if link_value !~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+([/?#][^[:space:]]*)?$' then
      return false;
    end if;
    if char_length(link_value) > 300 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function public.social_links_valid(jsonb) is
  'True when every key is an allowed platform and every value is an absolute https URL.';

-- -----------------------------------------------------------------------------
-- profile_details
-- -----------------------------------------------------------------------------
create table if not exists public.profile_details (
  profile_id                uuid primary key references public.profiles (id) on delete cascade,
  religious_practice        text check (
    religious_practice is null
    or religious_practice in (
      'not_practicing',
      'slightly_practicing',
      'moderately_practicing',
      'practicing',
      'very_practicing',
      'prefer_not_to_say'
    )
  ),
  blood_group               text check (
    blood_group is null
    or blood_group in (
      'a_positive', 'a_negative',
      'b_positive', 'b_negative',
      'ab_positive', 'ab_negative',
      'o_positive', 'o_negative',
      'unknown', 'prefer_not_to_say'
    )
  ),
  biodata                   text check (biodata is null or char_length(biodata) <= 4000),
  social_links              jsonb not null default '{}'::jsonb,
  -- Visibility is per group; blood group is private unless the owner opts in.
  religious_practice_visibility public.photo_visibility not null default 'members',
  blood_group_visibility        public.photo_visibility not null default 'private',
  biodata_visibility            public.photo_visibility not null default 'members',
  social_links_visibility       public.photo_visibility not null default 'members',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint profile_details_social_links_shape check (public.social_links_valid(social_links))
);

comment on table public.profile_details is
  'Optional, visibility-scoped profile information. Owner-only for direct reads; other members read the masked result of public_profile_details().';
comment on column public.profile_details.blood_group is
  'Never a matchmaking factor. Private by default and only shared when blood_group_visibility allows it.';

drop trigger if exists profile_details_set_updated_at on public.profile_details;
create trigger profile_details_set_updated_at
  before update on public.profile_details
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: owner (and admin) only. Other members go through the function below.
-- -----------------------------------------------------------------------------
alter table public.profile_details enable row level security;

drop policy if exists profile_details_select_own on public.profile_details;
create policy profile_details_select_own on public.profile_details
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists profile_details_select_admin on public.profile_details;
create policy profile_details_select_admin on public.profile_details
  for select to authenticated
  using (public.is_admin());

drop policy if exists profile_details_insert_own on public.profile_details;
create policy profile_details_insert_own on public.profile_details
  for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists profile_details_update_own on public.profile_details;
create policy profile_details_update_own on public.profile_details
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists profile_details_delete_own on public.profile_details;
create policy profile_details_delete_own on public.profile_details
  for delete to authenticated
  using (profile_id = auth.uid());

grant select, insert, update, delete on public.profile_details to authenticated;

-- -----------------------------------------------------------------------------
-- Masked read for other members
-- -----------------------------------------------------------------------------
-- Returns one row per requested profile, with each field nulled (or emptied)
-- when its own visibility setting does not allow the caller to see it. The
-- function is DEFINER because `profile_details` is owner-only, and it re-checks
-- the discoverability rules itself so it cannot become a privacy bypass.
create or replace function public.public_profile_details(p_profile uuid)
returns table (
  religious_practice text,
  blood_group        text,
  biodata            text,
  social_links       jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when d.religious_practice_visibility = 'public' then d.religious_practice
      when d.religious_practice_visibility = 'members' and auth.uid() is not null then d.religious_practice
      else null
    end as religious_practice,
    case
      when d.blood_group_visibility = 'public' then d.blood_group
      when d.blood_group_visibility = 'members' and auth.uid() is not null then d.blood_group
      else null
    end as blood_group,
    case
      when d.biodata_visibility = 'public' then d.biodata
      when d.biodata_visibility = 'members' and auth.uid() is not null then d.biodata
      else null
    end as biodata,
    case
      when d.social_links_visibility = 'public' then d.social_links
      when d.social_links_visibility = 'members' and auth.uid() is not null then d.social_links
      else '{}'::jsonb
    end as social_links
  from public.profile_details d
  join public.profiles p on p.id = d.profile_id
  where d.profile_id = p_profile
    and d.profile_id <> auth.uid()
    and p.is_public
    and p.deleted_at is null
    and not p.is_suspended
    and public.is_active_profile(p.id)
    and public.is_active_member();
$$;

comment on function public.public_profile_details(uuid) is
  'Visibility-masked optional profile fields for one other member. Owner reads use the table directly.';

revoke all on function public.public_profile_details(uuid) from public;
grant execute on function public.public_profile_details(uuid) to authenticated;
