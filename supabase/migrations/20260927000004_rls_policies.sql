-- =============================================================================
-- JibonJori - 0004 Row Level Security
-- =============================================================================
-- Every client-accessible table is reviewed here. For each one the intended
-- answer to "who may SELECT / INSERT / UPDATE / DELETE" is written down as a
-- policy. A verb with no policy is denied - that is deliberate, and it is why
-- there is no INSERT policy on `notifications` or `compatibility_scores`: those
-- rows are produced by triggers and SECURITY DEFINER functions, never by a
-- client.
--
-- `using (true)` is used ONLY on the controlled reference vocabulary
-- (education levels, professions, interests, published curated videos), which is
-- public data by design. It is never used on user data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Identity helpers.
--
-- All of these are SECURITY DEFINER so that the rule they encode is evaluated
-- once, without re-entering RLS on `profiles` (which would be both slow and
-- recursive). They return scalars only - never rows - so they cannot be used as
-- a data-exfiltration oracle.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role = 'admin'
       and deleted_at is null
       and not is_suspended
  );
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and deleted_at is null
       and not is_suspended
  );
$$;

-- The single definition of "may this caller see this profile".
create or replace function public.can_view_profile(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_id
       and p.deleted_at is null
       and not p.is_suspended
       and (
         p.id = auth.uid()
         or public.is_admin()
         or (p.is_public and public.is_active_member())
       )
  );
$$;

-- Photos are an explicitly separate decision from the profile itself.
create or replace function public.can_view_photos(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_id
       and p.deleted_at is null
       and not is_suspended
       and p.is_public
       and p.photo_visibility <> 'private'
       and (public.is_active_member() or p.id = auth.uid())
  );
$$;

-- Guards a cast that would otherwise raise on a malformed storage folder name.
create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_value::uuid;
exception
  when others then
    return null;
end;
$$;

-- =============================================================================
-- profiles
--   SELECT : own row, any published profile, all rows for an admin
--   INSERT : only the caller's own row (normally created by the signup trigger)
--   UPDATE : own row; admins may update any
--   DELETE : admins only. A member closes their account through the
--            `account-delete` Edge Function, which removes the auth user and
--            lets the cascade do the rest, so a client can never orphan
--            auth.users by deleting the profile row directly.
-- =============================================================================
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_discoverable on public.profiles
  for select to authenticated
  using (is_public and deleted_at is null and not is_suspended and public.is_active_member());

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'member' and not is_suspended and deleted_at is null);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- =============================================================================
-- partner_preferences - private matchmaking inputs. Owner and admin only.
-- =============================================================================
alter table public.partner_preferences enable row level security;

create policy partner_preferences_select on public.partner_preferences
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy partner_preferences_insert on public.partner_preferences
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_active_member());

create policy partner_preferences_update on public.partner_preferences
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy partner_preferences_delete on public.partner_preferences
  for delete to authenticated
  using (profile_id = auth.uid());

-- =============================================================================
-- Reference vocabulary - public read, admin write
-- =============================================================================
alter table public.education_levels enable row level security;
create policy education_levels_read on public.education_levels
  for select to anon, authenticated using (true);
create policy education_levels_write_admin on public.education_levels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.professions enable row level security;
create policy professions_read on public.professions
  for select to anon, authenticated using (true);
create policy professions_write_admin on public.professions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.interests enable row level security;
create policy interests_read on public.interests
  for select to anon, authenticated using (true);
create policy interests_write_admin on public.interests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- profile_interests - own rows; other people's are part of a viewable profile
-- =============================================================================
alter table public.profile_interests enable row level security;

create policy profile_interests_select on public.profile_interests
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin() or public.can_view_profile(profile_id));

create policy profile_interests_insert on public.profile_interests
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_active_member());

create policy profile_interests_delete on public.profile_interests
  for delete to authenticated
  using (profile_id = auth.uid());

-- =============================================================================
-- media - metadata. The bytes live in a private bucket behind storage policies.
--   Documents are never visible to another user, whatever the photo visibility.
-- =============================================================================
alter table public.media enable row level security;

create policy media_select on public.media
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_admin()
    or (kind = 'photo' and public.can_view_photos(profile_id))
  );

create policy media_insert on public.media
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_active_member());

create policy media_update on public.media
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy media_delete on public.media
  for delete to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- =============================================================================
-- interactions - the actor owns the row; the target may see what was sent to them
-- =============================================================================
alter table public.interactions enable row level security;

create policy interactions_select on public.interactions
  for select to authenticated
  using (actor_profile_id = auth.uid() or target_profile_id = auth.uid() or public.is_admin());

create policy interactions_insert on public.interactions
  for insert to authenticated
  with check (
    actor_profile_id = auth.uid()
    and public.is_active_member()
    and public.can_view_profile(target_profile_id)
  );

create policy interactions_update on public.interactions
  for update to authenticated
  using (actor_profile_id = auth.uid())
  with check (actor_profile_id = auth.uid());

create policy interactions_delete on public.interactions
  for delete to authenticated
  using (actor_profile_id = auth.uid() or public.is_admin());

-- =============================================================================
-- ratings - one row per (rater, rated)
-- =============================================================================
alter table public.ratings enable row level security;

create policy ratings_select on public.ratings
  for select to authenticated
  using (rater_profile_id = auth.uid() or rated_profile_id = auth.uid() or public.is_admin());

create policy ratings_insert on public.ratings
  for insert to authenticated
  with check (
    rater_profile_id = auth.uid()
    and public.is_active_member()
    and public.can_view_profile(rated_profile_id)
  );

create policy ratings_update on public.ratings
  for update to authenticated
  using (rater_profile_id = auth.uid())
  with check (rater_profile_id = auth.uid());

create policy ratings_delete on public.ratings
  for delete to authenticated
  using (rater_profile_id = auth.uid() or public.is_admin());

-- =============================================================================
-- comments - visible to anyone who can see the profile being commented on
-- =============================================================================
alter table public.comments enable row level security;

create policy comments_select on public.comments
  for select to authenticated
  using (
    author_profile_id = auth.uid()
    or public.is_admin()
    or public.can_view_profile(target_profile_id)
  );

create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_profile_id = auth.uid()
    and public.is_active_member()
    and public.can_view_profile(target_profile_id)
  );

create policy comments_update on public.comments
  for update to authenticated
  using (author_profile_id = auth.uid())
  with check (author_profile_id = auth.uid());

create policy comments_delete on public.comments
  for delete to authenticated
  using (author_profile_id = auth.uid() or public.is_admin());

-- =============================================================================
-- compatibility_scores - read only, and only for pairs you are part of.
--   There are no write policies: the scorer is a SECURITY DEFINER function, so
--   a client cannot fabricate its own compatibility score.
-- =============================================================================
alter table public.compatibility_scores enable row level security;

create policy compatibility_scores_select on public.compatibility_scores
  for select to authenticated
  using (profile_a_id = auth.uid() or profile_b_id = auth.uid() or public.is_admin());

-- =============================================================================
-- notifications - own inbox. Read and mark-as-read; rows are created by triggers.
-- =============================================================================
alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy notifications_update on public.notifications
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy notifications_delete on public.notifications
  for delete to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- =============================================================================
-- AI chat transcript - owner only, and append-only from the client's side.
--   A client may only write a `user` turn; assistant turns are written by the
--   `ai-chat` Edge Function with the service role, so a user cannot forge the
--   assistant's replies into their own history.
-- =============================================================================
alter table public.chat_conversations enable row level security;

create policy chat_conversations_select on public.chat_conversations
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy chat_conversations_insert on public.chat_conversations
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_active_member());

create policy chat_conversations_update on public.chat_conversations
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy chat_conversations_delete on public.chat_conversations
  for delete to authenticated
  using (profile_id = auth.uid() or public.is_admin());

alter table public.chat_messages enable row level security;

create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.chat_conversations c
       where c.id = conversation_id and c.profile_id = auth.uid()
    )
  );

create policy chat_messages_insert_user_turn on public.chat_messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.chat_conversations c
       where c.id = conversation_id and c.profile_id = auth.uid()
    )
  );

-- =============================================================================
-- audit_logs - admin read only. Append-only: no client INSERT/UPDATE/DELETE.
-- =============================================================================
alter table public.audit_logs enable row level security;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_admin());

-- =============================================================================
-- curated_videos - published catalogue is public, administration is admin-only
-- =============================================================================
alter table public.curated_videos enable row level security;

-- Split by role on purpose: a policy expression is evaluated AS the querying
-- role, so if the anonymous policy mentioned public.is_admin() then an anon
-- request would need EXECUTE on a function that is deliberately not granted to
-- anon, and the SELECT would fail rather than simply filter.
create policy curated_videos_read_published on public.curated_videos
  for select to anon
  using (is_published);

create policy curated_videos_read_member on public.curated_videos
  for select to authenticated
  using (is_published or public.is_admin());

create policy curated_videos_write_admin on public.curated_videos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- Function privileges.
--
-- Policy expressions are evaluated as the querying role, so `authenticated`
-- genuinely needs EXECUTE on the helpers the policies call. Nothing else is
-- granted: the definer triggers stay owner-only.
-- =============================================================================
do $$
begin
  revoke execute on all functions in schema public from public;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.is_admin() to authenticated;
    grant execute on function public.is_active_member() to authenticated;
    grant execute on function public.can_view_profile(uuid) to authenticated;
    grant execute on function public.can_view_photos(uuid) to authenticated;
    grant execute on function public.try_uuid(text) to authenticated;
  end if;
end;
$$;
