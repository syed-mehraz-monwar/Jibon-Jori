# Database

The database is PostgreSQL (Supabase). The application schema is created by 16
forward-only migrations in `supabase/migrations/`. This document is a reference for
what those migrations actually declare. Nothing here is invented: every statement
cites the migration that defines it.

Status vocabulary: VERIFIED (exercised on a real PostgreSQL and recorded in
`docs/SUPABASE_MIGRATION_FINAL_REPORT.md` / `docs/SUPABASE_MIGRATION_INVENTORY.md`),
PARTIAL, ENVIRONMENT-GATED, BLOCKED, NOT VERIFIED, NOT APPLICABLE.

> Evidence note: the migration/RLS results cited below are taken from the existing
> migration documents. This document itself ran no gate.

Migration order:

| # | File | Adds |
| --- | --- | --- |
| 0001 | `foundation.sql` | extensions, enums, reference tables, `profiles`, `partner_preferences`, `profile_interests`, signup trigger |
| 0002 | `activity.sql` | `media`, `interactions`, `ratings`, `comments`, `compatibility_scores`, `notifications`, chat, `audit_logs`, `curated_videos`, notification fan-out, completeness |
| 0003 | `indexes_and_guards.sql` | discovery indexes, privileged-column guard, grants |
| 0004 | `rls_policies.sql` | identity helpers and all RLS policies |
| 0005 | `storage.sql` | two private Storage buckets and their `storage.objects` policies |
| 0006 | `realtime.sql` | `supabase_realtime` publication + replica identity |
| 0007 | `rpc.sql` | first RPC layer |
| 0008 | `seed_reference_data.sql` | education / profession / interest seed |
| 0009 | `ml_artifacts.sql` | on-device ML artifact table |
| 0010 | `spec_parity_constraints.sql` | field bounds, reserved usernames, lifestyle/preference shapes |
| 0011 | `pending_account_gating.sql` | verified-contact gate |
| 0012 | `compatibility_parity.sql` | faithful deterministic scorer |
| 0013 | `reports_parity.sql` | six report datasets, corrected `rating_summary` |
| 0014 | `graphql.sql` | enables `pg_graphql` |
| 0015 | `anon_least_privilege.sql` | revokes broad grants and re-applies least-privilege selects on reference tables |
| 0016 | `profile_extras.sql` | `profile_details` 1:1 extras table + `social_links_valid()` guard + member-read masking RPC |

---

## 1. Enum types

All declared in `20260927000001_foundation.sql:24-30`.

| Type | Labels |
| --- | --- |
| `user_role` | `member`, `admin` |
| `gender` | `male`, `female`, `other` |
| `marital_status` | `never_married`, `divorced`, `widowed`, `annulled` |
| `photo_visibility` | `public`, `members`, `private` |
| `media_kind` | `photo`, `document` |
| `notification_type` | `like`, `comment`, `rating`, `match`, `security`, `system` |
| `chat_role` | `user`, `assistant`, `system` |

Extensions: `citext` and `pg_trgm` are created in the `extensions` schema
(`0001:16-19`); `pg_graphql` is enabled by 0014 (guarded, see §11).

---

## 2. Tables

### 2.1 Reference vocabulary

| Table | Columns | Notes |
| --- | --- | --- |
| `education_levels` | `id uuid pk default gen_random_uuid()`, `slug text not null unique`, `label text not null`, `tier smallint not null check 0..10`, `created_at timestamptz not null default now()` | `0001:49-55` |
| `professions` | same shape as `education_levels` | `0001:57-63` |
| `interests` | `id uuid pk`, `slug text not null unique`, `label text not null`, `created_at` | no `tier`; `0001:65-70` |

### 2.2 `profiles` — application identity, 1:1 with `auth.users`

`id uuid primary key references auth.users(id) on delete cascade`,
`username extensions.citext not null unique`
(`20260927000001_foundation.sql:80-128`). Nullable profile fields are deliberate:
the row is created at signup before the user has filled anything in.

| Column | Type | Constraint |
| --- | --- | --- |
| `display_name` | text | 2..80 after 0010 |
| `dob` | date | adult-only after 0010 |
| `gender` | `gender` | |
| `height_cm` | smallint | 100..250 |
| `marital_status` | `marital_status` | |
| `religion`, `caste_community` | text | ≤100 after 0010 |
| `education_id` | uuid → `education_levels(id) on delete restrict` | |
| `education_detail` | text | ≤255 after 0010 |
| `profession_id` | uuid → `professions(id) on delete restrict` | |
| `profession_detail` | text | ≤255 after 0010 |
| `income_band` | text | ≤50 after 0010 |
| `city` | text | 1..100 after 0010 |
| `district`, `country` | text | ≤100 after 0010 |
| `lat` | double precision | −90..90; must pair with `lng` |
| `lng` | double precision | −180..180; must pair with `lat` |
| `location_consent` | boolean not null default false | |
| `show_exact_location` | boolean not null default false | requires `location_consent` |
| `about` | text | ≤2000 after 0010 |
| `lifestyle` | jsonb not null default `'{}'` | strict shape after 0010 |
| `is_public` | boolean not null default false | opt-in publishing |
| `photo_visibility` | `photo_visibility` not null default `'public'` | |
| `completeness` | smallint not null default 0 | 0..100, maintained by trigger |
| `role` | `user_role` not null default `'member'` | column-guarded |
| `is_suspended` | boolean not null default false | column-guarded |
| `deleted_at` | timestamptz | column-guarded |
| `created_at`, `updated_at` | timestamptz not null default now() | |

Named CHECK constraints on `profiles`:

| Constraint | Rule | Source |
| --- | --- | --- |
| `profiles_username_shape` | `^[a-z0-9_]{3,32}$` | `0001:115` |
| `profiles_username_lowercase` | `username = lower(username)` | `0001:116` |
| `profiles_publish_requires_core_fields` | publishing needs `display_name`, `dob`, `gender`, `city` | `0001:119-122` |
| `profiles_exact_location_requires_consent` | `show_exact_location ⇒ location_consent` | `0001:125-127` |
| `profiles_adult_only` | `dob is null or dob <= current_date - interval '18 years'` | `0010:163` |
| `profiles_lat_lng_conull` | `(lat is null) = (lng is null)` | `0010:165` |
| `profiles_height_range` | 100..250 | `0010:166` |
| `profiles_completeness_range` | 0..100 | `0010:167` |
| `profiles_lat_range` / `profiles_lng_range` | coordinate ranges | `0010:168-169` |
| `profiles_display_name_len` | 2..80 | `0010:171` |
| `profiles_about_len` | ≤2000 | `0010:172` |
| `profiles_city_len` | 1..100 | `0010:173` |
| `profiles_district_len` / `profiles_country_len` / `profiles_religion_len` / `profiles_caste_len` | ≤100 | `0010:174-177` |
| `profiles_education_detail_len` / `profiles_profession_detail_len` | ≤255 | `0010:178-179` |
| `profiles_income_band_len` | ≤50 | `0010:180` |
| `profiles_lifestyle_shape` | `is_valid_lifestyle(lifestyle)` | `0010:182` |
| `profiles_username_not_reserved` | `not is_reserved_username(username)` | `0010:184` |

`0010:137-158` first drops the earlier unnamed column CHECKs on `about`, `lat`,
`lng`, `height_cm`, `completeness` so the final constraint set is exactly the named
one above.

### 2.3 `partner_preferences` — private matchmaking inputs

1:1 with `profiles` (`profile_id uuid pk references profiles(id) on delete cascade`),
`0001:181-195`. Columns: `age_min`, `age_max`, `genders text[]`, `education_ids
uuid[]`, `profession_ids uuid[]`, `locations text[]`, `must_have jsonb`,
`dealbreakers jsonb`, timestamps. `0001` had an age-order CHECK; `0010:230-239`
drops it and adds named replacements:

| Constraint | Rule |
| --- | --- |
| `partner_preferences_age_min_range` / `age_max_range` | 18..100 |
| `partner_preferences_age_order` | `age_min <= age_max` |
| `partner_preferences_genders_max` | ≤3 |
| `partner_preferences_education_max` / `profession_max` | ≤50 |
| `partner_preferences_locations_max` | ≤100 |
| `partner_preferences_must_have_shape` / `dealbreakers_shape` | `is_valid_preference_rules(...)` |

### 2.4 `profile_interests` — explicit M2M

`(profile_id uuid → profiles on delete cascade, interest_id uuid → interests on
delete restrict)` with a composite primary key (`0001:205-210`). No rows update:
the profile form replaces the whole set by delete-then-insert
(`frontend/src/api/profile.api.ts:69-82`).

### 2.5 `media` — storage metadata (never bytes)

`0002:9-25`. `bytes` must be 1..10485760. Constraints:
`media_primary_must_be_photo` (`not is_primary or kind = 'photo'`) and
`media_path_owned_by_profile` (`storage_path like profile_id::text || '/%'`).

### 2.6 `interactions` — unified like / dislike / favourite

`0002:74-83`. Primary key `(actor_profile_id, target_profile_id)`, no self
interaction, `value check (value in (-1, 1, 2))` where −1 = dislike, 1 = like,
2 = favourite.

### 2.7 `ratings` — 1..5, one row per (rater, rated)

`0002:95-105`. `unique (rater_profile_id, rated_profile_id)`,
`ratings_no_self`, `score between 1 and 5`.

### 2.8 `comments` — flat (no threading)

`0002:117-125`. `comments_no_self`. Body length originally 1..2000, corrected to
1..1000 by `comments_body_len` (`0010:206-207`).

### 2.9 `compatibility_scores` — deterministic scorer cache

`0002:134-149`. Primary key `(profile_a_id, profile_b_id)`, canonical-pair CHECK
`profile_a_id < profile_b_id`. Stores the five raw factor columns plus
`overall_score`, `model_version` and `inputs_hash`; it does **not** store `lifestyle`
or the combined `educationProfession` score, which are response-only outputs
(`0012:38-42`).

### 2.10 `notifications` — durable inbox

`0002:155-167`. `type notification_type`, `payload jsonb default '{}'`, nullable
`read_at`. No client write policy: rows come from triggers.

### 2.11 `chat_conversations` / `chat_messages`

`0002:173-199`. Conversations belong to a profile; messages have a `chat_role`,
`content` 1..8000, optional `model` and `tokens`.

### 2.12 `audit_logs` — append-only security trail

`0002:205-216`. `actor_user_id uuid → auth.users(id) on delete set null`, `action`
1..80, `meta jsonb`, `ip inet`.

### 2.13 `curated_videos` — YouTube catalogue (id only)

`0002:222-236`. `youtube_id unique check (~ '^[A-Za-z0-9_-]{6,20}$')`, title 1..200,
description ≤2000, `category` 1..40, `is_published` default true,
`created_by → profiles(id) on delete set null`.

### 2.14 `ml_artifacts` — on-device ML artifact host

`0009:19-45`. `version text not null unique`, `feature_version`, `artifact jsonb`,
`is_active boolean default false`. Shape CHECKs: `ml_artifacts_name_shape`,
`ml_artifacts_version_shape`, `ml_artifacts_has_layers` (non-empty `layers` array),
`ml_artifacts_has_input_order`. A partial unique index
`ml_artifacts_one_active_per_name_idx` allows exactly one active row per model name.

### 2.15 `profile_details` — optional profile extras (migration 0016)

`20261028000016_profile_extras.sql`. One additive table 1:1 with `profiles`
(`profile_id uuid pk → profiles(id) on delete cascade`) because the optional groups
have different visibility rules and RLS is row level, not column level. Columns:
`religious_practice`, `blood_group`, `biodata`, `social_links jsonb` and the
visibility trio (`photo_visibility`, `biodata_visibility`, `social_links_visibility`).
`social_links_valid(p_links jsonb)` is a guard requiring allowed platform keys and
absolute `https://` URLs ≤300 chars (rejecting `javascript:`/`data:`/`http:`), enforced
by a CHECK. Members read another profile's row only through the `public_profile_details`
SECURITY DEFINER masking RPC; no client selects another member's row directly.

---

## 3. Indexes

| Index | Definition | Source |
| --- | --- | --- |
| `profile_interests_interest_id_idx` | `(interest_id)` | `0001:212` |
| `media_one_primary_per_profile_idx` | unique, `(profile_id) where is_primary` | `0002:27` |
| `media_profile_created_idx` | `(profile_id, created_at desc)` | `0002:29` |
| `interactions_target_value_idx` | `(target_profile_id, value)` | `0002:85` |
| `ratings_rated_idx` | `(rated_profile_id)` | `0002:107` |
| `comments_target_created_idx` | `(target_profile_id, created_at desc)` | `0002:127` |
| `notifications_profile_created_idx` | `(profile_id, created_at desc)` | `0002:164` |
| `notifications_unread_idx` | `(profile_id) where read_at is null` | `0002:166` |
| `chat_conversations_profile_idx` | `(profile_id, updated_at desc)` | `0002:181` |
| `chat_messages_conversation_created_idx` | `(conversation_id, created_at)` | `0002:198` |
| `audit_logs_actor_idx` | `(actor_user_id)` | `0002:215` |
| `audit_logs_action_created_idx` | `(action, created_at desc)` | `0002:216` |
| `curated_videos_published_created_idx` | `(is_published, created_at desc)` | `0002:234` |
| `curated_videos_category_idx` | `(category)` | `0002:236` |
| `profiles_public_created_idx` | `(created_at desc) where is_public and deleted_at is null` | `0003:12-13` |
| `profiles_public_dob_idx` | `(dob)` partial, same predicate | `0003:14-15` |
| `profiles_public_marital_idx` | `(marital_status)` partial | `0003:16-17` |
| `profiles_gender_city_idx` | `(gender, city)` partial | `0003:18-19` |
| `profiles_education_idx` | `(education_id)` | `0003:20` |
| `profiles_profession_idx` | `(profession_id)` | `0003:21` |
| `profiles_city_trgm_idx` | gin `(city gin_trgm_ops)` | `0003:24-25` |
| `profiles_username_trgm_idx` | gin `((username::text) gin_trgm_ops)` | `0003:28-29` |
| `profiles_lat_lng_idx` | `(lat, lng)` | `0003:32` |
| `ml_artifacts_one_active_per_name_idx` | unique, `(name) where is_active` | `0009:41-42` |
| `ml_artifacts_active_idx` | `(name, trained_at desc) where is_active` | `0009:44-45` |

The discovery indexes are partial because every discovery query carries exactly the
`is_public and deleted_at is null` predicate (`0003:7-9`).

---

## 4. Foreign keys and delete behaviour

| Child | Parent | On delete |
| --- | --- | --- |
| `profiles.id` | `auth.users(id)` | cascade |
| `profiles.education_id` | `education_levels(id)` | restrict |
| `profiles.profession_id` | `professions(id)` | restrict |
| `partner_preferences.profile_id` | `profiles(id)` | cascade |
| `profile_interests.profile_id` | `profiles(id)` | cascade |
| `profile_interests.interest_id` | `interests(id)` | restrict |
| `media.profile_id` | `profiles(id)` | cascade |
| `interactions.actor_profile_id` / `target_profile_id` | `profiles(id)` | cascade |
| `ratings.rater_profile_id` / `rated_profile_id` | `profiles(id)` | cascade |
| `comments.author_profile_id` / `target_profile_id` | `profiles(id)` | cascade |
| `compatibility_scores.profile_a_id` / `profile_b_id` | `profiles(id)` | cascade |
| `notifications.profile_id` | `profiles(id)` | cascade |
| `chat_conversations.profile_id` | `profiles(id)` | cascade |
| `chat_messages.conversation_id` | `chat_conversations(id)` | cascade |
| `audit_logs.actor_user_id` | `auth.users(id)` | set null |
| `curated_videos.created_by` | `profiles(id)` | set null |

Account closure does **not** use this cascade: `account-delete` soft-closes the
account by stamping `profiles.deleted_at` (and revoking sessions) rather than
deleting rows, precisely because these cascades would destroy other members'
interactions, ratings and comments (archived spec B-72;
`supabase/functions/account-delete/index.ts`). The cascade remains as the
integrity guarantee if the auth user is ever removed out of band.

---

## 5. Triggers

| Trigger | Table | Timing | Function |
| --- | --- | --- | --- |
| `profiles_set_updated_at` | profiles | before update | `set_updated_at` (`0001:133-135`) |
| `on_auth_user_created` | auth.users | after insert | `handle_new_user` (`0001:173-175`) |
| `partner_preferences_set_updated_at` | partner_preferences | before update | `set_updated_at` (`0002:197-199`) |
| `interactions_set_updated_at` | interactions | before update | `set_updated_at` (`0002:87-89`) |
| `ratings_set_updated_at` | ratings | before update | `set_updated_at` (`0002:109-111`) |
| `chat_conversations_set_updated_at` | chat_conversations | before update | `set_updated_at` (`0002:184-186`) |
| `curated_videos_set_updated_at` | curated_videos | before update | `set_updated_at` (`0002:238-240`) |
| `media_enforce_limits` | media | before insert | `enforce_media_limits` (`0002:65-67`) |
| `interactions_notify` | interactions | after insert/update of value | `notify_on_interaction` (`0002:286-288`) |
| `comments_notify` | comments | after insert | `notify_on_comment` (`0002:307-309`) |
| `ratings_notify` | ratings | after insert/update of score | `notify_on_rating` (`0002:328-330`) |
| `profiles_refresh_completeness` | profiles | after insert/update | `refresh_profile_completeness` (`0002:376-378`) |
| `profile_interests_refresh_completeness` | profile_interests | after insert/delete | `refresh_related_profile_completeness` (`0002:402-404`) |
| `media_refresh_completeness` | media | after insert/delete | `refresh_related_profile_completeness` (`0002:406-408`) |
| `profiles_guard_privileged` | profiles | before update | `guard_profile_privileged_columns` (`0003:78-80`) |
| `profile_interests_enforce_limit` | profile_interests | before insert | `enforce_profile_interest_limit` (`0010:270-273`) |

Notable behaviours:

- **Signup** (`handle_new_user`, redefined `0010:327-353`): a well-formed explicit
  `username` from signup metadata is used verbatim; a reserved name fails the CHECK
  and a duplicate fails the unique index, so signup fails loudly instead of silently
  renaming. Only the fallback path derives a handle via `derive_username`, and the
  derived handle is itself re-checked against the reserved list.
- **Notification fan-out**: only a like notifies (dislike/favourite are silent), and
  an UPDATE that does not change the stance does not notify twice
  (`0002:246-284`). A mutual like produces `match` notifications for both sides
  (`0002:269-280`).
- **Completeness**: `profile_completeness(p_id)` scores nine conditions to 0..100
  (`0002:336-356`); `refresh_profile_completeness` is guarded by
  `pg_trigger_depth() > 1` to stop the inner UPDATE re-entering the trigger
  (`0002:358-374`).
- **Privileged columns** (`guard_profile_privileged_columns`, `0003:40-76`): when a
  caller is not `auth.uid()`-admin, any change to `role`, `is_suspended` or
  `deleted_at` raises `PROFILE_COLUMN_PROTECTED`. RLS controls rows; this trigger
  controls columns.

---

## 6. Functions and RPCs

### 6.1 Trigger / helper functions

| Function | Returns | Source |
| --- | --- | --- |
| `set_updated_at()` | trigger | `0001:35-43` |
| `handle_new_user()` | trigger (definer) | `0010:327-353` |
| `enforce_media_limits()` | trigger (definer) | `0002:33-63` |
| `notify_on_interaction()` / `notify_on_comment()` / `notify_on_rating()` | trigger (definer) | `0002:246-330` |
| `profile_completeness(p_id uuid)` | smallint | `0002:336-356` |
| `refresh_profile_completeness()` / `refresh_related_profile_completeness()` | trigger | `0002:359-408` |
| `guard_profile_privileged_columns()` | trigger (definer) | `0003:40-76` |
| `enforce_profile_interest_limit()` | trigger (definer) | `0010:249-268` |
| `is_reserved_username(p_username text)` | boolean (immutable) | `0010:26-53` |
| `is_valid_lifestyle(p_lifestyle jsonb)` | boolean (immutable) | `0010:65-88` |
| `is_valid_preference_rules(p_rules jsonb)` | boolean (immutable) | `0010:96-128` |
| `derive_username(p_email text, p_id uuid)` | citext (immutable) | `0010:305-325` |
| `haversine_km(lat1,lng1,lat2,lng2)` | double precision (immutable) | `0007:20-37` |
| `age_from_dob(p_dob date)` | integer (immutable) | `0007:39-45` |

### 6.2 Identity / visibility helpers (all definer, scalars only)

| Function | Returns | Source |
| --- | --- | --- |
| `is_admin()` | boolean | `0004:25-39` |
| `is_active_member()` | boolean | redefined `0011:62-78` — profile in good standing **and** verified contact |
| `is_active_profile(p_id uuid)` | boolean | `0011:85-100` — target side of the gate |
| `can_view_profile(p_id uuid)` | boolean | redefined `0011:130-149` |
| `can_view_photos(p_id uuid)` | boolean | redefined `0011:151-168` |
| `has_verified_contact(p_id uuid)` | boolean | `0011:33-46` |
| `account_state(p_id uuid)` | text (`deleted`/`suspended`/`pending`/`active`) | `0011:106-122` |
| `try_uuid(p_value text)` | uuid | `0004:97-108` |

### 6.3 Client-facing RPCs

| Function | Parameters | Returns | Source |
| --- | --- | --- | --- |
| `username_available(text)` | `p_username` | boolean | redefined `0010:286-303` |
| `search_profiles(...)` | 13 params (gender, city, age range, education, profession, marital status, interest ids, near lat/lng, radius, limit, offset) | table: id, username, display_name, age, gender, city, district, country, education_id, profession_id, marital_status, about, photo_visibility, completeness, created_at, total_count | `0007:353-429`, invoker |
| `recommendations(integer, integer)` | `p_limit` default 20, `p_offset` default 0 | table: id, username, display_name, age, gender, city, country, completeness, photo_visibility, overall_score, scored, total_count | `0007:436-480`, invoker |
| `compatibility_for(uuid)` | `p_other` | 22-column table incl. `eligible`, `eligibility_reasons`, all factor scores + availability flags, `overall_score`, `model_version`, `inputs_hash`, `from_cache`, `computed_at` | redefined `0012:519-641` |
| `rating_summary(uuid)` | `p_profile` | table: `average numeric`, `rating_count integer`, `distribution jsonb` | redefined `0013:33-75` |
| `interaction_summary(uuid)` | `p_profile` | table: `likes`, `dislikes`, `favorites` (integer) | `0007:516-529` |

Additional explicitness helpers used by the client and shown in §7.2 of
`docs/AI_MATCHMAKING.md`: `compat_weights()`, `compat_model_version()`,
`compat_canonical_input(uuid)`, `compat_inputs_hash(uuid, uuid)`,
`compute_eligibility(uuid, uuid)`, `preference_side_score(uuid, uuid)`,
`compute_compatibility(uuid, uuid)` (`0012:48-511`).

### 6.4 Report functions (all admin-gated internally)

| Function | Parameters | Returns | Source |
| --- | --- | --- | --- |
| `report_users()` | — | 14 columns (`userId` … `registeredAt`), up to 1000 rows | `0013:88-137` |
| `report_matchmaking()` | — | 10 columns; the caller's own recommendation list, ≤50 rows | `0013:144-214` |
| `report_compatibility(uuid)` | `p_target` | 12 columns, single row | `0013:220-273` |
| `report_ratings()` | — | `raterProfileId, ratedProfileId, score, createdAt`, ≤50 rows | `0013:278-306` |
| `report_ratings_summary(uuid)` | `p_target` | `targetProfileId, count, average, distribution` | `0013:311-334` |
| `report_admin()` | — | 13 `(metric, value)` rows | `0013:339-374` |

Superseded 0007 functions were dropped: `report_user_summary`,
`report_interactions` (removed without replacement), and the old
`report_matchmaking` / `report_ratings` shapes (`0013:80-83`). `preference_fit`
and the first `compute_compatibility` / `compatibility_for` were dropped by
`0012:334-335`, `:517`.

### 6.5 Grants

`0003:120-125` and `0004:435-446` revoke `execute` from `PUBLIC`; the RPC
migrations grant back only the intended entry points. `username_available` is
granted to `anon` (usable before sign-in) and to `authenticated`
(`0007:645-672`, `0010:360-372`). The `report_*` functions are granted to
`authenticated` but each re-checks `is_admin()` and raises `FORBIDDEN` for a
non-admin (`0013:380-391`).

---

## 7. Row Level Security

RLS is enabled on every client-accessible table in `0004`. A verb with no policy is
denied; that is deliberate (`0004:5-9`).

| Table | Policies (verb → rule) |
| --- | --- |
| `profiles` | select: own (`:122-124`); discoverable (`:126-128`, redefined `0011:172-180`); admin (`:130-132`). insert: own, `role='member'` (`:134-136`). update: own (`:138-141`); admin (`:143-146`). delete: admin only (`:148-150`) |
| `partner_preferences` | select/update/delete: owner or admin; insert: owner + active member (`:157-172`) |
| `education_levels`, `professions`, `interests` | select `using (true)` to `anon, authenticated`; `all` to admin (`:177-193`) |
| `profile_interests` | select: own/admin/`can_view_profile`; insert: owner + active; delete: owner (`:200-210`) |
| `media` | select: own/admin/photo-and-`can_view_photos`; insert: owner + active; update: owner; delete: owner/admin (`:218-237`) |
| `interactions` | select: actor/target/admin; insert: actor + active + `can_view_profile(target)`; update: actor; delete: actor/admin (`:244-263`) |
| `ratings` | select: rater/rated/admin; insert: rater + active + `can_view_profile(rated)`; update: rater; delete: rater/admin (`:270-289`) |
| `comments` | select: author/admin/`can_view_profile(target)`; insert: author + active + `can_view_profile(target)`; update: author; delete: author/admin (`:296-319`) |
| `compatibility_scores` | select: pair member or admin only. **No write policy** (`:328-330`) |
| `notifications` | select: own/admin; update: own; delete: own/admin. **No insert policy** (`:337-348`) |
| `chat_conversations` | select/insert/update/delete owner-scoped (`:358-373`) |
| `chat_messages` | select: own conversation or admin; insert: `role='user'` inside own conversation (`:377-395`) |
| `audit_logs` | select: admin only; no client write (`:402-404`) |
| `curated_videos` | select anon: `is_published`; select authenticated: `is_published or is_admin()`; all admin (`:415-426`) |
| `ml_artifacts` | select: `using (true)` for authenticated; no client write (`0009:53-55`) |

Two tables deliberately have no write policy: `compatibility_scores` (written only
by the definer `compatibility_for`) and `notifications` (written only by definer
triggers). `ml_artifacts` is written only by the service role.

`curated_videos` splits its read policy by role on purpose: a policy expression is
evaluated as the querying role, so an anon policy must not mention `is_admin()`
because anon lacks EXECUTE on it (`0004:411-414`).

`0004:435-446` grants `authenticated` EXECUTE on the helpers the policies call
(`is_admin`, `is_active_member`, `can_view_profile`, `can_view_photos`,
`try_uuid`); `0010` and `0011` grant their new helpers.

---

## 8. Storage

Two private buckets, created best-effort (a privilege failure downgrades to a
notice) (`0005:21-39`):

| Bucket | Size limit | Allowed MIME |
| --- | --- | --- |
| `profile-photos` | 5 242 880 bytes (5 MiB) | `image/jpeg`, `image/png`, `image/webp` |
| `profile-documents` | 10 485 760 bytes (10 MiB) | `application/pdf`, `image/jpeg`, `image/png` |

`storage.objects` policies (`0005:60-138`). Ownership is always
`(storage.foldername(name))[1] = auth.uid()::text`:

| Bucket | insert | select | update | delete |
| --- | --- | --- | --- | --- |
| `profile-photos` | own folder | own folder, or another's when `can_view_photos` | own | own |
| `profile-documents` | own folder | own folder only | own | own |

A document is never visible to another member, whatever the photo visibility
(`0005:99-103`).

---

## 9. Realtime

`supabase_realtime` publication, created if absent and extended idempotently
(`0006:24-53`). Published tables: `comments`, `interactions`, `ratings`,
`notifications`, `chat_messages`. `profiles` is deliberately **not** published.
`interactions` is set to `replica identity full` so an UPDATE carries the whole row
(`0006:60`). Full detail is in `docs/REALTIME.md`.

---

## 10. Seed data

`20260927000008_seed_reference_data.sql` is idempotent (`on conflict (slug) do
update`). It inserts:

| Table | Rows | Notes |
| --- | --- | --- |
| `education_levels` | 8 | tiers 0..7 |
| `professions` | 16 | tiers 0..5 |
| `interests` | 24 | no tier |

`curated_videos` is intentionally **not** seeded: inventing video ids would
fabricate content nobody reviewed (`0008:9-11`). The RLS suite asserts the counts
8/16/24 (`supabase/tests/rls_assertions.sql:26-33`).

---

## 11. `pg_graphql`

`0014` enables `pg_graphql` inside a guard: if the extension is available it is
created in `extensions`, otherwise a notice is raised and nothing is substituted
(`20260927000014_graphql.sql:23-33`). `pg_graphql` is a Supabase built-in and is
absent from a stock PostgreSQL, which is what the local test harness runs.

Status: the extension is NOT VERIFIED on a live project (no credentials here). See
`docs/API.md` §2.

---

## 12. Status summary

| Area | Status |
| --- | --- |
| Tables, enums, constraints, indexes, FKs, triggers | Written; applies to real PostgreSQL per `docs/SUPABASE_MIGRATION_FINAL_REPORT.md:52-72` (VERIFIED, not re-run here) |
| RLS policies | Same; 124/124 adversarial claims recorded |
| Storage buckets/policies | Written, NOT VERIFIED live (needs a project) |
| Realtime publication + replica identity | Written, asserted in the SQL suite; delivery NOT VERIFIED |
| `pg_graphql` | Enabled if available; live endpoint NOT VERIFIED |
| Seed data | Written; counts asserted in the SQL suite |
