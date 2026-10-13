-- =============================================================================
-- JibonJori - 0005 Supabase Storage
-- =============================================================================
-- Two buckets, both PRIVATE. Nothing is world-readable: every read goes through
-- a signed URL, and whether one may be minted is decided by the policies below.
--
-- Ownership rule: an object may only live under a path whose first folder is the
-- uploader's own user id, i.e. `<auth.uid()>/<file>`. The client never chooses
-- the folder, and `public.media` carries the same rule as a CHECK constraint, so
-- a forged path cannot be registered even if storage were misconfigured.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Buckets.
--
-- Creating buckets from a migration is convenient but needs table privileges on
-- `storage.buckets` that some projects do not grant to the migration role, so a
-- failure here is downgraded to a notice instead of blocking the migration. The
-- dashboard equivalent is documented in SUPABASE_SETUP.md.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('profile-photos', 'profile-photos', false, 5242880,
     array['image/jpeg', 'image/png', 'image/webp']),
    ('profile-documents', 'profile-documents', false, 10485760,
     array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice 'JibonJori: storage buckets profile-photos and profile-documents are present and private.';
exception
  when insufficient_privilege then
    raise notice 'JibonJori: could not create buckets (insufficient privilege). Create them manually in the Supabase dashboard as PRIVATE buckets: profile-photos (5 MB, image/jpeg,image/png,image/webp) and profile-documents (10 MB, application/pdf,image/jpeg,image/png).';
end;
$$;

-- Supabase already has RLS enabled on storage.objects, and that table is owned
-- by the storage admin role; on some projects the migration role may not be
-- allowed to alter it. Enabling it is therefore best-effort.
do $$
begin
  alter table storage.objects enable row level security;
exception
  when insufficient_privilege then
    raise notice 'JibonJori: cannot alter storage.objects (insufficient privilege); it is already RLS-enabled on Supabase. The policies below still apply.';
end;
$$;

-- ---------------------------------------------------------------------------
-- profile-photos
--   INSERT : only into your own folder
--   SELECT : your own files, or someone else's whose photo visibility permits it
--   UPDATE : only your own
--   DELETE : only your own
-- ---------------------------------------------------------------------------
drop policy if exists jibonjori_photos_insert_own on storage.objects;
create policy jibonjori_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists jibonjori_photos_select on storage.objects;
create policy jibonjori_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_view_photos(public.try_uuid((storage.foldername(name))[1]))
    )
  );

drop policy if exists jibonjori_photos_update_own on storage.objects;
create policy jibonjori_photos_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists jibonjori_photos_delete_own on storage.objects;
create policy jibonjori_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- profile-documents
--   Owner only, for every verb. A supporting document is never visible to
--   another member, not even to a member who may see the owner's photos.
-- ---------------------------------------------------------------------------
drop policy if exists jibonjori_documents_insert_own on storage.objects;
create policy jibonjori_documents_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists jibonjori_documents_select_own on storage.objects;
create policy jibonjori_documents_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists jibonjori_documents_update_own on storage.objects;
create policy jibonjori_documents_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists jibonjori_documents_delete_own on storage.objects;
create policy jibonjori_documents_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
