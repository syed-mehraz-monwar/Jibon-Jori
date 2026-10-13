-- =============================================================================
-- LOCAL RLS ASSERTIONS - NEVER APPLIED TO SUPABASE
-- =============================================================================
-- Run after bootstrap.sql, every migration and fixtures.sql, through a real
-- `psql` connection as a superuser. RLS is only exercised when the session is
-- NOT the table owner, so each section switches identity with SET ROLE plus a
-- JWT claim, which is exactly how PostgREST presents a request to PostgreSQL.
--
-- Every row appended to t.results is a claim about the security model; the
-- runner fails the build if any of them is false.
-- =============================================================================

reset role;
select t.forget();

-- =============================================================================
-- A. ANONYMOUS (not signed in)
-- =============================================================================
set role anon;
select set_config('request.jwt.claim.role', 'anon', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare n bigint;
begin
  select count(*) into n from public.education_levels;
  perform t.eq('anon reads education_levels', n, 8);

  select count(*) into n from public.professions;
  perform t.eq('anon reads professions', n, 16);

  select count(*) into n from public.interests;
  perform t.eq('anon reads interests', n, 24);

  -- the unpublished draft must not leak to a signed-out visitor
  select count(*) into n from public.curated_videos;
  perform t.eq('anon sees only published curated videos', n, 1);
end;
$$;

-- A signed-out visitor must not be able to read a single row of user data.
-- The mechanism differs by deployment (no grant vs no policy), so the invariant
-- is asserted rather than the mechanism - see t.denied_or_empty.
select t.denied_or_empty('anon cannot read any profile', 'select count(*) from public.profiles');
select t.denied_or_empty('anon cannot read any media row', 'select count(*) from public.media');
select t.denied_or_empty('anon cannot read any notification', 'select count(*) from public.notifications');
select t.denied_or_empty('anon cannot read any preference row', 'select count(*) from public.partner_preferences');
select t.denied_or_empty('anon cannot read the ML artifact', 'select count(*) from public.ml_artifacts');

-- storage.objects is granted to anon in the harness, so the denial here is the
-- policy, not a missing privilege: there is no policy for anon at all.
do $$
declare n bigint;
begin
  select count(*) into n from storage.objects;
  perform t.eq('anon sees no storage objects', n, 0);
end;
$$;

do $$
declare free boolean; taken boolean;
begin
  select public.username_available('brand_new_handle') into free;
  select public.username_available('bob') into taken;
  perform t.ok('anon can check a free username', free, 'free=' || coalesce(free::text, 'null'));
  perform t.ok('anon sees a taken username as taken', not taken, 'available=' || coalesce(taken::text, 'null'));
end;
$$;

do $$
declare shaped boolean;
begin
  select public.username_available('Not Valid!') into shaped;
  perform t.ok('anon cannot probe with an invalid shape', not shaped, 'available=' || coalesce(shaped::text, 'null'));
end;
$$;

-- Reserved handles (R-055) must be reported as unavailable by the pre-signup
-- check, including case and separator variants.
do $$
declare free boolean;
begin
  select public.username_available('admin') into free;
  perform t.ok('reserved handle "admin" is unavailable', not free, null);

  select public.username_available('Admin') into free;
  perform t.ok('reserved handle "Admin" (case) is unavailable', not free, null);

  select public.username_available('a_d_m_i_n') into free;
  perform t.ok('reserved handle "a_d_m_i_n" (separators) is unavailable', not free, null);

  select public.username_available('jibon-jori') into free;
  perform t.ok('reserved handle "jibon-jori" is unavailable', not free, null);

  select public.username_available('brand_new_handle') into free;
  perform t.ok('a genuinely free handle is available', free, null);
end;
$$;

reset role;

-- =============================================================================
-- B. AN AUTHENTICATED MEMBER (alice)
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
declare n bigint;
begin
  -- alice her own row, bob (published), admin (published).
  -- carol is unpublished, dave is suspended: neither may appear.
  select count(*) into n from public.profiles;
  perform t.eq('alice sees own + published profiles only', n, 3);

  select count(*) into n from public.profiles where id = '33333333-3333-3333-3333-333333333333';
  perform t.eq('alice cannot see carol (unpublished)', n, 0);

  select count(*) into n from public.profiles where id = '44444444-4444-4444-4444-444444444444';
  perform t.eq('alice cannot see dave (suspended)', n, 0);

  select count(*) into n from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  perform t.eq('alice sees her own profile', n, 1);
end;
$$;

-- --- profile writes
do $$
declare n integer;
begin
  update public.profiles set display_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform t.eq('alice cannot update bob''s profile', n, 0);

  update public.profiles set display_name = 'Alice Updated' where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  perform t.eq('alice can update her own profile', n, 1);

  delete from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform t.eq('alice cannot delete a profile', n, 0);
end;
$$;

select t.raises('alice cannot promote herself to admin',
  'update public.profiles set role = ''admin'' where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('alice cannot suspend herself',
  'update public.profiles set is_suspended = true where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('alice cannot soft-delete herself directly',
  'update public.profiles set deleted_at = now() where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('alice cannot create a profile for somebody else',
  'insert into public.profiles (id, username) values (''22222222-2222-2222-2222-222222222222'', ''bob_twin'')');

-- --- private matchmaking inputs
do $$
declare n bigint;
begin
  select count(*) into n from public.partner_preferences;
  perform t.eq('alice reads only her own preferences', n, 1);

  select count(*) into n from public.partner_preferences where profile_id = '22222222-2222-2222-2222-222222222222';
  perform t.eq('alice cannot read bob''s preferences', n, 0);
end;
$$;

select t.raises('alice cannot write preferences for bob',
  'insert into public.partner_preferences (profile_id, age_min) values (''22222222-2222-2222-2222-222222222222'', 25)');

-- --- media metadata: photos follow visibility, documents never
do $$
declare n bigint;
begin
  select count(*) into n from public.media;
  perform t.eq('alice sees own photo + bob''s visible photo', n, 2);

  select count(*) into n from public.media where kind = 'document';
  perform t.eq('alice cannot see bob''s document', n, 0);

  select count(*) into n from public.media where profile_id = '22222222-2222-2222-2222-222222222222';
  perform t.eq('alice sees only bob''s photo', n, 1);
end;
$$;

select t.raises('alice cannot register media under bob''s folder',
  'insert into public.media (profile_id, storage_path, kind, mime, bytes) values (''11111111-1111-1111-1111-111111111111'', ''22222222-2222-2222-2222-222222222222/stolen.jpg'', ''photo'', ''image/jpeg'', 1024)');

-- --- storage objects
do $$
declare n bigint;
begin
  select count(*) into n from storage.objects where bucket_id = 'profile-photos';
  perform t.eq('alice sees own photo object + bob''s', n, 2);

  select count(*) into n from storage.objects where bucket_id = 'profile-documents';
  perform t.eq('alice sees no document objects', n, 0);

  perform t.ok('alice cannot reach carol''s photo object', not exists (
    select 1 from storage.objects where name like '33333333%'
  ), null);
end;
$$;

select t.raises('alice cannot upload into bob''s storage folder',
  'insert into storage.objects (bucket_id, name, owner) values (''profile-photos'', ''22222222-2222-2222-2222-222222222222/evil.jpg'', ''11111111-1111-1111-1111-111111111111'')');

do $$
declare n integer;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('profile-photos', '11111111-1111-1111-1111-111111111111/mine.jpg', '11111111-1111-1111-1111-111111111111');

  delete from storage.objects where name = '22222222-2222-2222-2222-222222222222/cover.jpg';
  get diagnostics n = row_count;
  perform t.eq('alice cannot delete bob''s storage object', n, 0);
end;
$$;

-- --- notifications must be read before the like below adds a match notice
do $$
declare n bigint;
begin
  select count(*) into n from public.notifications;
  perform t.eq('alice sees her own 3 notifications', n, 3);

  select count(*) into n from public.notifications where profile_id = '22222222-2222-2222-2222-222222222222';
  perform t.eq('alice cannot read bob''s notifications', n, 0);
end;
$$;

select t.raises('alice cannot fabricate a notification',
  'insert into public.notifications (profile_id, type) values (''11111111-1111-1111-1111-111111111111'', ''system'')');

do $$
declare n integer;
begin
  update public.notifications set read_at = now() where profile_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  perform t.eq('alice can mark her own notifications read', n, 3);
end;
$$;

-- --- interactions
do $$
declare n integer;
begin
  insert into public.interactions (actor_profile_id, target_profile_id, value)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 1);

  delete from public.interactions where actor_profile_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform t.eq('alice cannot delete bob''s like', n, 0);
end;
$$;

select t.raises('alice cannot record an interaction as bob',
  'insert into public.interactions (actor_profile_id, target_profile_id, value) values (''22222222-2222-2222-2222-222222222222'', ''55555555-5555-5555-5555-555555555555'', 1)');

select t.raises('alice cannot like an unpublished profile',
  'insert into public.interactions (actor_profile_id, target_profile_id, value) values (''11111111-1111-1111-1111-111111111111'', ''33333333-3333-3333-3333-333333333333'', 1)');

-- the mutual like must have produced match notifications for both sides
do $$
declare n bigint;
begin
  select count(*) into n from public.notifications where profile_id = '11111111-1111-1111-1111-111111111111';
  perform t.eq('mutual like gives alice a match notice', n, 4);
end;
$$;

-- --- comments and ratings are moderated by ownership
do $$
declare n integer;
begin
  update public.comments set body = 'edited by someone else' where author_profile_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform t.eq('alice cannot edit bob''s comment', n, 0);

  delete from public.comments where author_profile_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform t.eq('alice cannot delete bob''s comment', n, 0);

  update public.ratings set score = 1 where rater_profile_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform t.eq('alice cannot change bob''s rating', n, 0);
end;
$$;

-- --- compatibility: readable for own pairs, writable only through the scorer
do $$
declare n bigint;
begin
  select count(*) into n from public.compatibility_scores;
  perform t.eq('alice sees only her own compatibility pair', n, 0);
end;
$$;

select t.raises('alice cannot insert a compatibility score',
  'insert into public.compatibility_scores (profile_a_id, profile_b_id, overall_score, interests_score, education_score, profession_score, location_score, preference_score, model_version, inputs_hash) values (''11111111-1111-1111-1111-111111111111'', ''22222222-2222-2222-2222-222222222222'', 100, 100, 100, 100, 100, 100, ''forged'', ''forged'')');

do $$
declare lo uuid; hi uuid; overall smallint; n bigint;
begin
  select c.profile_a_id, c.profile_b_id, c.overall_score into lo, hi, overall
    from public.compatibility_for('22222222-2222-2222-2222-222222222222') c;

  perform t.ok('compatibility_for stores the canonical (least, greatest) pair',
    lo = '11111111-1111-1111-1111-111111111111' and hi = '22222222-2222-2222-2222-222222222222',
    'a=' || lo::text || ' b=' || hi::text);

  perform t.ok('compatibility_for produces a meaningful score', overall between 0 and 100,
    'overall=' || overall::text);

  select count(*) into n from public.compatibility_scores;
  perform t.eq('alice now sees exactly her own pair', n, 1);

  select count(*) into n from public.compatibility_scores where profile_a_id = '22222222-2222-2222-2222-222222222222';
  perform t.eq('alice cannot see the bob/carol pair', n, 0);
end;
$$;

select t.raises('alice cannot score a profile she cannot see',
  'select * from public.compatibility_for(''33333333-3333-3333-3333-333333333333'')');

-- --- the deterministic scoring contract (weights, zero-contribution, version)
do $$
declare
  r record;
  w jsonb;
begin
  select * into r from public.compatibility_for('22222222-2222-2222-2222-222222222222');
  select public.compat_weights() into w;

  perform t.ok('weights match the documented contract',
    w = '{"interests":0.25,"educationProfession":0.20,"location":0.15,"lifestyle":0.15,"partnerPreference":0.25}'::jsonb,
    w::text);

  perform t.ok('the model version is deterministic-v1',
    r.model_version = 'deterministic-v1', r.model_version);

  -- alice/bob share 2 of 4 interests -> 50. Neither lists education, profession,
  -- coordinates or lifestyle, so those contributions are ZERO, not a neutral 50.
  -- Both preference sides are fully satisfied -> 100.
  -- overall = round(.25*50 + .20*0 + .15*0 + .15*0 + .25*100) = 38
  perform t.eq('interests factor is the Jaccard overlap', r.interests_score, 50);
  perform t.ok('unavailable education/profession contributes zero',
    not r.education_profession_available and r.education_profession_score = 0, null);
  perform t.ok('unavailable location contributes zero',
    not r.location_available and r.location_score = 0, null);
  perform t.ok('unavailable lifestyle contributes zero',
    not r.lifestyle_available and r.lifestyle_score = 0, null);
  perform t.eq('partner preference is the mean of both sides', r.preference_score, 100);
  perform t.eq('overall is the weighted sum, unavailable factors as zero', r.overall_score, 38);
  perform t.ok('a compatible pair is eligible', r.eligible, null);
end;
$$;

-- --- an ineligible pair must produce no score and must not be cached
do $$
declare
  r record;
  n bigint;
begin
  select * into r from public.compatibility_for('55555555-5555-5555-5555-555555555555');
  perform t.ok('an out-of-age-range pair is ineligible', not r.eligible, null);
  perform t.ok('an ineligible pair reports its reason',
    'AGE_NOT_IN_RANGE' = any (r.eligibility_reasons), coalesce(r.eligibility_reasons::text, 'null'));
  perform t.ok('an ineligible pair has no overall score', r.overall_score is null, null);

  select count(*) into n from public.compatibility_scores
   where (profile_a_id = '11111111-1111-1111-1111-111111111111' and profile_b_id = '55555555-5555-5555-5555-555555555555')
      or (profile_a_id = '55555555-5555-5555-5555-555555555555' and profile_b_id = '11111111-1111-1111-1111-111111111111');
  perform t.eq('an ineligible pair is never cached', n, 0);
end;
$$;

-- --- aggregates
do $$
declare avg_score numeric; cnt integer; likes integer;
begin
  select r.average, r.rating_count into avg_score, cnt from public.rating_summary('11111111-1111-1111-1111-111111111111') r;
  perform t.ok('rating_summary computes the average', avg_score = 5.00, 'average=' || avg_score::text);
  perform t.eq('rating_summary counts the ratings', cnt, 1);

  select i.likes into likes from public.interaction_summary('11111111-1111-1111-1111-111111111111') i;
  perform t.eq('interaction_summary counts likes on alice', likes, 1);
end;
$$;

-- --- discovery RPCs must respect the same visibility as SELECT
do $$
declare n bigint;
begin
  select count(*) into n from public.search_profiles();
  perform t.eq('search_profiles returns only visible profiles', n, 2);

  select count(*) into n from public.recommendations();
  perform t.eq('recommendations returns only visible profiles', n, 2);
end;
$$;

-- --- chat transcript: user turns only, own conversations only
do $$
declare n bigint;
begin
  select count(*) into n from public.chat_conversations;
  perform t.eq('alice sees only her own conversation', n, 1);

  select count(*) into n from public.chat_messages;
  perform t.eq('alice sees no messages from bob''s conversation', n, 0);

  insert into public.chat_messages (conversation_id, role, content)
  values ('66666666-6666-6666-6666-666666666666', 'user', 'Hello assistant');
end;
$$;

select t.raises('alice cannot write an assistant turn',
  'insert into public.chat_messages (conversation_id, role, content) values (''66666666-6666-6666-6666-666666666666'', ''assistant'', ''I am the model'')');

select t.raises('alice cannot write into bob''s conversation',
  'insert into public.chat_messages (conversation_id, role, content) values (''77777777-7777-7777-7777-777777777777'', ''user'', ''intruder'')');

select t.raises('alice cannot call an admin report',
  'select count(*) from public.report_users()');

-- audit_logs is granted to authenticated, so the denial here is the policy
-- returning no rows rather than a missing privilege.
do $$
declare n bigint;
begin
  select count(*) into n from public.audit_logs;
  perform t.eq('alice cannot read the audit log', n, 0);
end;
$$;

-- --- on-device ML artifact: readable by members, writable by nobody
do $$
declare n bigint;
begin
  select count(*) into n from public.ml_artifacts;
  perform t.eq('alice can read the on-device model artifact', n, 1);
end;
$$;

select t.raises('alice cannot publish a model artifact',
  'insert into public.ml_artifacts (name, version, feature_version, artifact, is_active) values (''forged'', ''forged-v1'', ''v1'', ''{"layers":[{"units":1}],"inputOrder":[]}''::jsonb, true)');

reset role;

-- =============================================================================
-- B2. A PENDING ACCOUNT (eve: signed up, never verified)
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

do $$
declare n bigint; can_see boolean;
begin
  -- she can read her own row (onboarding is allowed) but nobody else's
  select count(*) into n from public.profiles;
  perform t.eq('a pending member sees only their own profile', n, 1);

  select public.can_view_profile('22222222-2222-2222-2222-222222222222') into can_see;
  perform t.ok('a pending member cannot view another public profile', not can_see, null);

  select count(*) into n from public.search_profiles();
  perform t.eq('a pending member discovers nobody', n, 0);

  perform t.ok('is_active_member is false while unverified', not public.is_active_member(), null);
  perform t.ok('has_verified_contact is false while unverified',
    not public.has_verified_contact(auth.uid()), null);
  perform t.ok('account_state reports "pending"',
    public.account_state(auth.uid()) = 'pending', public.account_state(auth.uid()));
end;
$$;

-- ... and a pending profile must not be discoverable by an established member
reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
declare n bigint; can_see boolean;
begin
  select public.can_view_profile('99999999-9999-9999-9999-999999999999') into can_see;
  perform t.ok('a pending profile is not discoverable by a member', not can_see, null);

  select count(*) into n from public.search_profiles();
  perform t.eq('search excludes the pending profile', n, 2);
end;
$$;

reset role;

-- =============================================================================
-- C. AN ADMINISTRATOR
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);

do $$
declare n bigint;
begin
  select count(*) into n from public.profiles;
  perform t.eq('admin sees every profile', n, 6);

  select count(*) into n from public.audit_logs;
  perform t.eq('admin can read the audit log', n, 0);

  select count(*) into n from public.report_users();
  perform t.eq('admin users report lists every account', n, 6);

  select count(*) into n from public.report_matchmaking();
  perform t.ok('admin can run the matchmaking report', n >= 0, 'rows=' || n::text);

  select count(*) into n from public.report_ratings();
  perform t.ok('admin can run the ratings report', n >= 0, 'rows=' || n::text);

  select count(*) into n from public.report_admin();
  perform t.eq('admin report emits 13 metrics', n, 13);

  select count(*) into n from public.report_compatibility('22222222-2222-2222-2222-222222222222');
  perform t.eq('compatibility report is a single row', n, 1);

  select count(*) into n from public.report_ratings_summary('11111111-1111-1111-1111-111111111111');
  perform t.eq('ratings-summary report is a single row', n, 1);
end;
$$;

do $$
declare n integer;
begin
  update public.profiles set display_name = 'Bob (moderated)' where id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform t.eq('admin can update any profile', n, 1);

  select count(*) into n from public.media where kind = 'document';
  perform t.eq('admin can see supporting documents', n, 1);
end;
$$;

reset role;

-- =============================================================================
-- D. SCHEMA INTEGRITY (as the owner, independent of RLS)
-- =============================================================================
do $$
declare n bigint;
begin
  select count(*) into n from public.notifications where profile_id = '22222222-2222-2222-2222-222222222222';
  perform t.eq('bob received like + match notifications', n, 2);

  perform t.ok('realtime publishes the five activity tables',
    (select count(*) from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('comments','interactions','ratings','notifications','chat_messages')) = 5,
    null);

  perform t.ok('realtime does not publish profiles',
    not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'profiles'), null);

  perform t.ok('interactions keeps full rows for realtime updates',
    (select relreplident from pg_class where oid = 'public.interactions'::regclass) = 'f', null);
end;
$$;

select t.raises('cannot publish a profile without the required fields',
  'update public.profiles set is_public = true, display_name = null where id = ''33333333-3333-3333-3333-333333333333''');

select t.raises('cannot expose an exact location without consent',
  'update public.profiles set show_exact_location = true, location_consent = false where id = ''33333333-3333-3333-3333-333333333333''');

select t.raises('cannot register media outside the owner''s folder',
  'insert into public.media (profile_id, storage_path, kind, mime, bytes) values (''11111111-1111-1111-1111-111111111111'', ''someone-else/x.jpg'', ''photo'', ''image/jpeg'', 10)');

select t.raises('cannot store a non-canonical compatibility pair',
  'insert into public.compatibility_scores (profile_a_id, profile_b_id, overall_score, interests_score, education_score, profession_score, location_score, preference_score, model_version, inputs_hash) values (''22222222-2222-2222-2222-222222222222'', ''11111111-1111-1111-1111-111111111111'', 1,1,1,1,1,1,''x'',''y'')');

select t.raises('cannot interact with oneself',
  'insert into public.interactions (actor_profile_id, target_profile_id, value) values (''11111111-1111-1111-1111-111111111111'', ''11111111-1111-1111-1111-111111111111'', 1)');

select t.raises('cannot rate outside 1..5',
  'insert into public.ratings (rater_profile_id, rated_profile_id, score) values (''11111111-1111-1111-1111-111111111111'', ''33333333-3333-3333-3333-333333333333'', 9)');

select t.raises('cannot use a malformed username',
  'insert into public.profiles (id, username) values (''88888888-8888-8888-8888-888888888888'', ''Bad Handle!'')');

select t.raises('usernames are unique case-insensitively',
  'insert into public.profiles (id, username) values (''88888888-8888-8888-8888-888888888888'', ''ALICE'')');

select t.raises('cannot register media larger than the byte ceiling',
  'insert into public.media (profile_id, storage_path, kind, mime, bytes) values (''11111111-1111-1111-1111-111111111111'', ''11111111-1111-1111-1111-111111111111/big.jpg'', ''photo'', ''image/jpeg'', 999999999)');

-- --- specification parity: reserved names, field bounds, cardinalities
select t.raises('signup cannot take a reserved username',
  'insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values (''aa111111-1111-1111-1111-111111111111'', ''reserved@example.test'', ''{"username":"administrator"}'', now())');

select t.raises('signup cannot take a reserved username with separators',
  'insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values (''aa111111-1111-1111-1111-111111111111'', ''reserved2@example.test'', ''{"username":"jibon_jori"}'', now())');

select t.raises('display_name is bounded to 80 characters',
  'update public.profiles set display_name = repeat(''x'', 81) where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('about is bounded to 2000 characters',
  'update public.profiles set about = repeat(''x'', 2001) where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('a minor cannot be stored on a profile',
  'update public.profiles set dob = (current_date - interval ''17 years'')::date where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('latitude without longitude is rejected',
  'update public.profiles set lat = 23.8, lng = null where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('lifestyle accepts only the documented answers',
  'update public.profiles set lifestyle = ''{"smoking":"sometimes"}''::jsonb where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('lifestyle rejects unknown keys',
  'update public.profiles set lifestyle = ''{"hobby":"chess"}''::jsonb where id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('comment body is bounded to 1000 characters',
  'insert into public.comments (author_profile_id, target_profile_id, body) values (''11111111-1111-1111-1111-111111111111'', ''22222222-2222-2222-2222-222222222222'', repeat(''x'', 1001))');

select t.raises('gender preference is capped at three values',
  'insert into public.partner_preferences (profile_id, genders) values (''33333333-3333-3333-3333-333333333333'', array[''male'',''female'',''other'',''male''])');

select t.raises('age_min above 100 is rejected',
  'update public.partner_preferences set age_min = 101 where profile_id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('a decreasing age range is rejected',
  'update public.partner_preferences set age_min = 40, age_max = 20 where profile_id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('preference rules reject unknown keys',
  'update public.partner_preferences set must_have = ''{"height":180}''::jsonb where profile_id = ''11111111-1111-1111-1111-111111111111''');

select t.raises('more than twenty interests per profile is rejected',
  'insert into public.profile_interests (profile_id, interest_id) select ''11111111-1111-1111-1111-111111111111'', id from public.interests where slug not in (''reading'',''music'',''traveling'')');

-- --- the full factor formula on a controlled pair (owner, no RLS involved)
do $$
declare
  lo uuid := 'bb111111-1111-1111-1111-111111111111';
  hi uuid := 'bb222222-2222-2222-2222-222222222222';
  f record;
begin
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
    (lo, 'formula.a@example.test', '{"username":"formula_a"}', now()),
    (hi, 'formula.b@example.test', '{"username":"formula_b"}', now());

  update public.profiles set
    display_name = 'Formula A', dob = '1994-01-01', gender = 'female',
    city = 'Dhaka', lifestyle = '{"smoking":"never"}'::jsonb,
    education_id = (select id from public.education_levels where tier = 3)
  where id = lo;

  update public.profiles set
    display_name = 'Formula B', dob = '1993-01-01', gender = 'male',
    city = 'Dhaka', lifestyle = '{"smoking":"never"}'::jsonb,
    education_id = (select id from public.education_levels where tier = 5)
  where id = hi;

  -- one shared interest out of one -> 100
  insert into public.profile_interests (profile_id, interest_id)
  select lo, id from public.interests where slug = 'reading';
  insert into public.profile_interests (profile_id, interest_id)
  select hi, id from public.interests where slug = 'reading';

  select * into f from public.compute_compatibility(lo, hi);

  -- education tier gap 2 -> max(0, 100 - 20*2) = 60; profession unavailable so the
  -- combined factor is the mean of the available tiers = 60
  perform t.eq('tier proximity uses a 20-point step', f.education_score, 60);
  perform t.eq('education/profession is the mean of available tiers', f.education_profession_score, 60);
  perform t.eq('location is 100 for a matching city', f.location_score, 100);
  perform t.eq('lifestyle is 100 for a shared equal answer', f.lifestyle_score, 100);
  perform t.eq('interests is 100 for identical interest sets', f.interests_score, 100);
  -- overall = round(.25*100 + .20*60 + .15*100 + .15*100 + .25*0) = 67
  perform t.eq('overall combines the five documented factors', f.overall_score, 67);
end;
$$;

-- =============================================================================
-- D2. ANONYMOUS GRANT POSTURE (catalog, not behaviour)
-- =============================================================================
-- A hosted Supabase project auto-grants new objects to `anon` through default
-- privileges (simulated in bootstrap.sql). The row-level assertions above still pass in
-- that case, because RLS denies the rows - so the excess GRANT is invisible behaviourally
-- and was only caught by `verify-cloud.sql` against the real project. It is still a real
-- defense-in-depth gap, so the grant posture is asserted directly here. Migration 0015
-- removes the excess; these claims keep it removed.
reset role;

do $$
declare n integer;
begin
  select count(*) into n
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT';
  perform t.eq('anon holds SELECT on exactly the 4 reference tables', n, 4);

  select count(distinct p.proname) into n
    from information_schema.routine_privileges g
    join pg_proc p on p.proname = g.routine_name
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
   where g.routine_schema = 'public' and g.grantee = 'anon';
  perform t.eq('anon may execute exactly one function', n, 1);
end;
$$;

-- =============================================================================
-- E. VERDICT
-- =============================================================================
select
  count(*) filter (where passed)  as passed,
  count(*) filter (where not passed) as failed
from t.results;

select label, detail
  from t.results
 where not passed
 order by id;

do $$
declare failures integer;
begin
  select count(*) into failures from t.results where not passed;
  if failures > 0 then
    raise exception 'RLS ASSERTIONS FAILED: % claim(s) were false', failures;
  end if;
  raise notice 'RLS ASSERTIONS PASSED: all % claims held.', (select count(*) from t.results);
end;
$$;
