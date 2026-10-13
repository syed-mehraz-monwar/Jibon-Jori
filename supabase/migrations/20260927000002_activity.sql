-- =============================================================================
-- JibonJori - 0002 activity, social and AI-history tables
-- =============================================================================

-- =============================================================================
-- media - metadata for objects held in Supabase Storage (never bytes)
-- =============================================================================

create table public.media (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  kind         public.media_kind not null,
  mime         text not null check (mime ~ '^[a-z]+/[a-z0-9.+-]+$'),
  bytes        integer not null check (bytes > 0 and bytes <= 10485760),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),

  -- only a photo can be the cover image
  constraint media_primary_must_be_photo check (not is_primary or kind = 'photo'),
  -- a row may only ever point inside its own owner's storage folder. This is the
  -- database half of the storage ownership rule: even if a client forges a path,
  -- it cannot register a media row for someone else's object.
  constraint media_path_owned_by_profile check (storage_path like profile_id::text || '/%')
);

create unique index media_one_primary_per_profile_idx
  on public.media (profile_id) where is_primary;
create index media_profile_created_idx on public.media (profile_id, created_at desc);

-- Per-profile quotas, enforced in the database so a direct PostgREST insert
-- cannot bypass the client-side checks.
create or replace function public.enforce_media_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  photo_count integer;
  doc_count   integer;
  total_bytes bigint;
begin
  select count(*) filter (where kind = 'photo'),
         count(*) filter (where kind = 'document'),
         coalesce(sum(bytes), 0)
    into photo_count, doc_count, total_bytes
    from public.media
   where profile_id = new.profile_id;

  if new.kind = 'photo' and photo_count >= 12 then
    raise exception 'MEDIA_LIMIT_PHOTOS' using errcode = 'check_violation';
  end if;
  if new.kind = 'document' and doc_count >= 5 then
    raise exception 'MEDIA_LIMIT_DOCUMENTS' using errcode = 'check_violation';
  end if;
  if total_bytes + new.bytes > 52428800 then
    raise exception 'MEDIA_LIMIT_TOTAL_BYTES' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger media_enforce_limits
  before insert on public.media
  for each row execute function public.enforce_media_limits();

-- =============================================================================
-- interactions - unified like / dislike / favorite
--   -1 = dislike, 1 = like, 2 = favorite
-- =============================================================================

create table public.interactions (
  actor_profile_id  uuid not null references public.profiles (id) on delete cascade,
  target_profile_id uuid not null references public.profiles (id) on delete cascade,
  value             smallint not null check (value in (-1, 1, 2)),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  primary key (actor_profile_id, target_profile_id),
  constraint interactions_no_self check (actor_profile_id <> target_profile_id)
);

create index interactions_target_value_idx on public.interactions (target_profile_id, value);

create trigger interactions_set_updated_at
  before update on public.interactions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- ratings - 1..5, one row per (rater, rated)
-- =============================================================================

create table public.ratings (
  id               uuid primary key default gen_random_uuid(),
  rater_profile_id uuid not null references public.profiles (id) on delete cascade,
  rated_profile_id uuid not null references public.profiles (id) on delete cascade,
  score            smallint not null check (score between 1 and 5),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (rater_profile_id, rated_profile_id),
  constraint ratings_no_self check (rater_profile_id <> rated_profile_id)
);

create index ratings_rated_idx on public.ratings (rated_profile_id);

create trigger ratings_set_updated_at
  before update on public.ratings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- comments - flat in the MVP (no threading)
-- =============================================================================

create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references public.profiles (id) on delete cascade,
  target_profile_id uuid not null references public.profiles (id) on delete cascade,
  body              text not null check (char_length(body) between 1 and 2000),
  created_at        timestamptz not null default now(),

  constraint comments_no_self check (author_profile_id <> target_profile_id)
);

create index comments_target_created_idx on public.comments (target_profile_id, created_at desc);

-- =============================================================================
-- compatibility_scores - current cache of the deterministic scorer
--   canonical pair: profile_a_id < profile_b_id
-- =============================================================================

create table public.compatibility_scores (
  profile_a_id     uuid not null references public.profiles (id) on delete cascade,
  profile_b_id     uuid not null references public.profiles (id) on delete cascade,
  overall_score    smallint not null check (overall_score between 0 and 100),
  interests_score  smallint not null check (interests_score between 0 and 100),
  education_score  smallint not null check (education_score between 0 and 100),
  profession_score smallint not null check (profession_score between 0 and 100),
  location_score   smallint not null check (location_score between 0 and 100),
  preference_score smallint not null check (preference_score between 0 and 100),
  model_version    text not null,
  inputs_hash      text not null,
  computed_at      timestamptz not null default now(),

  primary key (profile_a_id, profile_b_id),
  constraint compatibility_canonical_pair check (profile_a_id < profile_b_id)
);

-- =============================================================================
-- notifications - durable inbox, pushed over Supabase Realtime
-- =============================================================================

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type       public.notification_type not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_created_idx
  on public.notifications (profile_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (profile_id) where read_at is null;

-- =============================================================================
-- AI chatbot transcript (LLM history only - never other users' private data)
-- =============================================================================

create table public.chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title      text check (title is null or char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_conversations_profile_idx
  on public.chat_conversations (profile_id, updated_at desc);

create trigger chat_conversations_set_updated_at
  before update on public.chat_conversations
  for each row execute function public.set_updated_at();

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  role            public.chat_role not null,
  content         text not null check (char_length(content) between 1 and 8000),
  model           text,
  tokens          integer check (tokens is null or tokens >= 0),
  created_at      timestamptz not null default now()
);

create index chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at);

-- =============================================================================
-- audit_logs - append-only security trail
-- =============================================================================

create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action        text not null check (char_length(action) between 1 and 80),
  target        text,
  meta          jsonb not null default '{}'::jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);

create index audit_logs_actor_idx on public.audit_logs (actor_user_id);
create index audit_logs_action_created_idx on public.audit_logs (action, created_at desc);

-- =============================================================================
-- curated_videos - YouTube embed catalogue (id only: no bytes, no API key)
-- =============================================================================

create table public.curated_videos (
  id          uuid primary key default gen_random_uuid(),
  youtube_id  text not null unique check (youtube_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  title       text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  category    text not null default 'general' check (char_length(category) between 1 and 40),
  is_published boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index curated_videos_published_created_idx
  on public.curated_videos (is_published, created_at desc);
create index curated_videos_category_idx on public.curated_videos (category);

create trigger curated_videos_set_updated_at
  before update on public.curated_videos
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Notification fan-out
-- =============================================================================

create or replace function public.notify_on_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- dislikes and favorites are silent; only a like notifies
  if new.value <> 1 then
    return new;
  end if;
  -- an UPDATE that does not change the stance must not notify twice
  if tg_op = 'UPDATE' and old.value = new.value then
    return new;
  end if;

  insert into public.notifications (profile_id, type, payload)
  values (
    new.target_profile_id,
    'like',
    jsonb_build_object('actorProfileId', new.actor_profile_id, 'value', new.value)
  );

  -- mutual like: both sides get a match notification
  if exists (
    select 1 from public.interactions i
     where i.actor_profile_id = new.target_profile_id
       and i.target_profile_id = new.actor_profile_id
       and i.value = 1
  ) then
    insert into public.notifications (profile_id, type, payload)
    values
      (new.target_profile_id, 'match', jsonb_build_object('withProfileId', new.actor_profile_id)),
      (new.actor_profile_id,  'match', jsonb_build_object('withProfileId', new.target_profile_id));
  end if;

  return new;
end;
$$;

create trigger interactions_notify
  after insert or update of value on public.interactions
  for each row execute function public.notify_on_interaction();

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (profile_id, type, payload)
  values (
    new.target_profile_id,
    'comment',
    jsonb_build_object('actorProfileId', new.author_profile_id, 'commentId', new.id)
  );
  return new;
end;
$$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_on_comment();

create or replace function public.notify_on_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (profile_id, type, payload)
  values (
    new.rated_profile_id,
    'rating',
    jsonb_build_object('actorProfileId', new.rater_profile_id, 'score', new.score)
  );
  return new;
end;
$$;

create trigger ratings_notify
  after insert or update of score on public.ratings
  for each row execute function public.notify_on_rating();

-- =============================================================================
-- Profile completeness - derived, maintained in the database
-- =============================================================================

create or replace function public.profile_completeness(p_id uuid)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select (
    case when p.display_name is not null then 10 else 0 end +
    case when p.dob is not null then 10 else 0 end +
    case when p.gender is not null then 10 else 0 end +
    case when p.city is not null then 10 else 0 end +
    case when p.about is not null and char_length(p.about) >= 40 then 10 else 0 end +
    case when p.education_id is not null or p.education_detail is not null then 10 else 0 end +
    case when p.profession_id is not null or p.profession_detail is not null then 10 else 0 end +
    case when (select count(*) from public.profile_interests pi where pi.profile_id = p.id) >= 3 then 15 else 0 end +
    case when (select count(*) from public.media m where m.profile_id = p.id and m.kind = 'photo') >= 1 then 15 else 0 end
  )::smallint
  from public.profiles p
  where p.id = p_id;
$$;

-- pg_trigger_depth() stops the inner UPDATE from re-entering this trigger.
create or replace function public.refresh_profile_completeness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.profiles
     set completeness = public.profile_completeness(new.id)
   where id = new.id;
  return null;
end;
$$;

create trigger profiles_refresh_completeness
  after insert or update on public.profiles
  for each row execute function public.refresh_profile_completeness();

create or replace function public.refresh_related_profile_completeness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  -- `new` is not assigned inside a DELETE trigger, so TG_OP decides the source
  if tg_op = 'DELETE' then
    target := old.profile_id;
  else
    target := new.profile_id;
  end if;
  update public.profiles
     set completeness = public.profile_completeness(target)
   where id = target;
  return null;
end;
$$;

create trigger profile_interests_refresh_completeness
  after insert or delete on public.profile_interests
  for each row execute function public.refresh_related_profile_completeness();

create trigger media_refresh_completeness
  after insert or delete on public.media
  for each row execute function public.refresh_related_profile_completeness();
