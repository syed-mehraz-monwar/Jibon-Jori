-- =============================================================================
-- LOCAL TEST FIXTURES - NEVER APPLIED TO SUPABASE
-- =============================================================================
-- Built directly by the superuser so the fixture setup itself is not subject to
-- RLS. Every subsequent assertion switches to `anon` or `authenticated` via
-- SET ROLE, which is what makes RLS actually apply.
--
-- Five identities cover the interesting cases:
--   alice  published, photos public
--   bob    published, photos visible to members only, has a private document
--   carol  NOT published (private profile)
--   dave   published but suspended
--   admin  published, role = admin
--   eve    published but NOT verified (no email/phone confirmation) -> pending
-- =============================================================================

create schema if not exists t;

create table t.results (
  id     bigserial primary key,
  label  text not null,
  passed boolean not null,
  detail text
);

grant usage on schema t to anon, authenticated;
grant insert, select on t.results to anon, authenticated;
grant usage, select on sequence t.results_id_seq to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assertion helpers.
--
-- These are deliberately NOT SECURITY DEFINER: `t.raises` has to execute the
-- statement under test as the *current* role, otherwise a definer function
-- would run it as the owner and silently bypass RLS - which is exactly the trap
-- this harness exists to catch. The caller already holds INSERT on t.results.
-- ---------------------------------------------------------------------------
create or replace function t.ok(p_label text, p_passed boolean, p_detail text default null)
returns void
language plpgsql
as $$
begin
  insert into t.results (label, passed, detail)
  values (p_label, coalesce(p_passed, false), p_detail);
end;
$$;

create or replace function t.eq(p_label text, p_actual bigint, p_expected bigint)
returns void
language plpgsql
as $$
begin
  insert into t.results (label, passed, detail)
  values (
    p_label,
    p_actual is not distinct from p_expected,
    'actual=' || coalesce(p_actual::text, 'null') || ' expected=' || coalesce(p_expected::text, 'null')
  );
end;
$$;

create or replace function t.raises(p_label text, p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
    insert into t.results (label, passed, detail)
    values (p_label, false, 'no error raised, but the operation should have been denied');
  exception
    when others then
      insert into t.results (label, passed, detail)
      values (p_label, true, sqlstate || ' ' || sqlerrm);
  end;
end;
$$;

/**
 * Asserts that a caller cannot read the rows a query would return, accepting
 * EITHER mechanism:
 *
 *   * no table privilege at all  -> the statement errors, or
 *   * privilege granted, no policy -> the statement returns zero rows.
 *
 * Both are correct denials, and which one occurs depends on the deployment:
 * Supabase grants the API roles broad table privileges and relies on RLS, while
 * the bare-PostgreSQL harness relies on the absence of a grant. Asserting a
 * specific mechanism would make this suite pass locally and fail on the real
 * project while the actual security property - no rows are readable - holds in
 * both. So the invariant is what gets asserted.
 */
create or replace function t.denied_or_empty(p_label text, p_sql text)
returns void
language plpgsql
as $$
declare
  n bigint;
begin
  begin
    execute p_sql into n;
    perform t.ok(p_label, coalesce(n, 0) = 0, 'returned ' || coalesce(n::text, 'null') || ' row(s)');
  exception
    when others then
      insert into t.results (label, passed, detail)
      values (p_label, true, 'denied: ' || sqlstate);
  end;
end;
$$;

create or replace function t.forget()
returns void
language sql
security definer
set search_path = t
as $$
  delete from t.results;
$$;

grant execute on function t.forget() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Identities. The signup trigger creates the profile row from the metadata.
--
-- `email_confirmed_at` is set for the five active accounts because verification
-- is what makes an account an active member (the pending gate in migration
-- 0011). `eve` is deliberately left unconfirmed: she models a signed-up but
-- unverified account, which must neither participate in discovery nor be
-- discoverable.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test', '{"username":"alice"}', now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test',   '{"username":"bob"}', now()),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test', '{"username":"carol"}', now()),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.test',  '{"username":"dave"}', now()),
  ('55555555-5555-5555-5555-555555555555', 'admin@example.test', '{"username":"adminjj"}', now()),
  ('99999999-9999-9999-9999-999999999999', 'eve@example.test',   '{"username":"eve"}', null);

update public.profiles set
  display_name = 'Alice', dob = '1995-04-02', gender = 'female', city = 'Dhaka',
  district = 'Dhaka', country = 'Bangladesh', about = 'Loves books and long walks.',
  is_public = true, photo_visibility = 'public', location_consent = true
where id = '11111111-1111-1111-1111-111111111111';

update public.profiles set
  display_name = 'Bob', dob = '1992-08-11', gender = 'male', city = 'Chattogram',
  district = 'Chattogram', country = 'Bangladesh', about = 'Engineer who cooks.',
  is_public = true, photo_visibility = 'members'
where id = '22222222-2222-2222-2222-222222222222';

update public.profiles set
  display_name = 'Carol', dob = '1990-01-20', gender = 'female', city = 'Khulna',
  country = 'Bangladesh', about = 'Private person.'
where id = '33333333-3333-3333-3333-333333333333';

update public.profiles set
  display_name = 'Dave', dob = '1988-12-01', gender = 'male', city = 'Sylhet',
  country = 'Bangladesh', about = 'Suspended account.',
  is_public = true, is_suspended = true
where id = '44444444-4444-4444-4444-444444444444';

update public.profiles set
  display_name = 'Admin', dob = '1985-06-15', gender = 'other', city = 'Dhaka',
  country = 'Bangladesh', about = 'Platform administrator.',
  is_public = true, role = 'admin'
where id = '55555555-5555-5555-5555-555555555555';

update public.profiles set
  display_name = 'Eve', dob = '1993-03-03', gender = 'female', city = 'Rajshahi',
  country = 'Bangladesh', about = 'Signed up but has not verified yet.',
  is_public = true
where id = '99999999-9999-9999-9999-999999999999';

-- ---------------------------------------------------------------------------
-- Interests, preferences, media and storage objects
-- ---------------------------------------------------------------------------
insert into public.profile_interests (profile_id, interest_id)
select '11111111-1111-1111-1111-111111111111', id from public.interests where slug in ('reading','music','traveling');
insert into public.profile_interests (profile_id, interest_id)
select '22222222-2222-2222-2222-222222222222', id from public.interests where slug in ('reading','cooking','music');

insert into public.partner_preferences (profile_id, age_min, age_max, locations)
values ('22222222-2222-2222-2222-222222222222', 24, 34, array['dhaka']),
       ('11111111-1111-1111-1111-111111111111', 28, 40, array['chattogram']);

insert into public.media (profile_id, storage_path, kind, mime, bytes, is_primary) values
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111/cover.jpg',  'photo',    'image/jpeg', 204800, true),
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222/cover.jpg',  'photo',    'image/jpeg', 409600, true),
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222/nid.pdf',    'document', 'application/pdf', 81920, false);

insert into storage.objects (bucket_id, name, owner) values
  ('profile-photos',    '11111111-1111-1111-1111-111111111111/cover.jpg', '11111111-1111-1111-1111-111111111111'),
  ('profile-photos',    '22222222-2222-2222-2222-222222222222/cover.jpg', '22222222-2222-2222-2222-222222222222'),
  ('profile-photos',    '33333333-3333-3333-3333-333333333333/cover.jpg', '33333333-3333-3333-3333-333333333333'),
  ('profile-documents', '22222222-2222-2222-2222-222222222222/nid.pdf',   '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------------
-- Pre-existing activity, written by the superuser so the notification triggers
-- run (they are SECURITY DEFINER, exactly as they are on Supabase).
--   bob likes alice      -> alice must end up with a 'like' notification
--   bob comments alice   -> alice must end up with a 'comment' notification
--   bob rates alice      -> alice must end up with a 'rating' notification
-- ---------------------------------------------------------------------------
insert into public.interactions (actor_profile_id, target_profile_id, value)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 1);

insert into public.comments (author_profile_id, target_profile_id, body)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Nice profile!');

insert into public.ratings (rater_profile_id, rated_profile_id, score)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 5);

insert into public.curated_videos (youtube_id, title, category, is_published)
values ('dQw4w9WgXcQ', 'Marriage guidance session one', 'marriage', true),
       ('aaaaaaaaaaa', 'Unpublished draft', 'general', false);

-- ---------------------------------------------------------------------------
-- AI chat conversations, so the transcript policies have something to bind to.
-- ---------------------------------------------------------------------------
insert into public.chat_conversations (id, profile_id, title) values
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Alice and the assistant'),
  ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', 'Bob and the assistant');

insert into public.chat_messages (conversation_id, role, content) values
  ('77777777-7777-7777-7777-777777777777', 'user', 'This message belongs to Bob.');

-- ---------------------------------------------------------------------------
-- A compatibility pair that does not involve alice, to prove the read policy
-- filters on membership of the pair rather than on "is authenticated".
-- ---------------------------------------------------------------------------
insert into public.compatibility_scores (
  profile_a_id, profile_b_id, overall_score, interests_score, education_score,
  profession_score, location_score, preference_score, model_version, inputs_hash
) values (
  '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
  42, 50, 50, 50, 50, 50, 'test-fixture', 'fixture-hash'
);

-- ---------------------------------------------------------------------------
-- A structurally well-formed on-device model artifact (8 -> 16 -> 8 -> 1).
--
-- The weights are all zero: this is a shape fixture for the constraints and the
-- read policy, NOT a trained model and not anything the client should infer
-- with. Its name carries "fixture" so it can never be confused with a real
-- published artifact.
-- ---------------------------------------------------------------------------
do $$
declare
  layers jsonb;
begin
  layers := jsonb_build_array(
    jsonb_build_object(
      'units', 16, 'activation', 'relu',
      'kernel', (select jsonb_agg(jsonb_build_array(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0) order by i)
                   from generate_series(1, 8) i),
      'bias', (select jsonb_agg(0 order by i) from generate_series(1, 16) i)
    ),
    jsonb_build_object(
      'units', 8, 'activation', 'relu',
      'kernel', (select jsonb_agg(jsonb_build_array(0,0,0,0,0,0,0,0) order by i)
                   from generate_series(1, 16) i),
      'bias', (select jsonb_agg(0 order by i) from generate_series(1, 8) i)
    ),
    jsonb_build_object(
      'units', 1, 'activation', 'linear',
      'kernel', (select jsonb_agg(jsonb_build_array(0) order by i) from generate_series(1, 8) i),
      'bias', jsonb_build_array(0)
    )
  );

  insert into public.ml_artifacts (name, version, feature_version, artifact, is_active)
  values (
    'compatibility-prior-fixture',
    'compatibility-mlp-v1-fixture',
    'ml-prior-features-v1',
    jsonb_build_object(
      'name', 'compatibility-prior-fixture',
      'version', 'compatibility-mlp-v1-fixture',
      'featureVersion', 'ml-prior-features-v1',
      'inputOrder', jsonb_build_array(
        'interests', 'educationProfession', 'location', 'lifestyle',
        'partnerPreference', 'ageGapNormalized', 'gendersCompatible', 'dataCoverage'
      ),
      'outputRange', jsonb_build_array(0, 1),
      'provenance', jsonb_build_object(
        'kind', 'test-fixture',
        'teacher', 'none',
        'description', 'Structural fixture only. Not a trained model.'
      ),
      'layers', layers,
      'goldenVectors', jsonb_build_array()
    ),
    true
  );
end;
$$;
