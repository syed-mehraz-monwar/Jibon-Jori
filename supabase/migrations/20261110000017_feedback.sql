-- =============================================================================
-- JibonJori - 0017 feedback ratings (teacher evaluation: star rating)
-- =============================================================================
-- Teacher evaluation feature: an app-experience star rating.
--
-- `public.ratings` scores a *specific match* (the rater rates the person they
-- were matched with). The teacher requirement is different: members rate the
-- JibonJori experience itself, as a 1..5 star app feedback with optional free
-- text. Those two concepts must not be collapsed, so this is a separate table.
--
-- Shape:
--   * one row per rater (unique on rater_profile_id) - one active rating per
--     authenticated member;
--   * `score` is validated in the database (1..5);
--   * `feedback` is optional free text, bounded;
--   * the row lives next to the rater's `profiles` row, so RLS can bind the
--     write to the authenticated caller without trusting client input.
--
-- Privacy: feedback rows are private to the rater (select/update/delete are
-- owner-only). No public read policy is created, so another member cannot read
-- anyone else's feedback. An aggregate display would be possible through a
-- security-definer helper, but it is optional for the teacher requirement and is
-- therefore not added here to keep the surface minimal.
-- =============================================================================

create table if not exists public.feedback (
  id                uuid primary key default gen_random_uuid(),
  rater_profile_id uuid not null references public.profiles (id) on delete cascade,
  score             smallint not null check (score between 1 and 5),
  feedback          text check (char_length(feedback) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (rater_profile_id)
);

-- No separate index: the `unique (rater_profile_id)` constraint already creates
-- the backing index that backs both the one-rating-per-member upsert and the
-- owner lookup.

create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS: owner-only reads/writes for the rows; no public read policy so private
-- feedback never leaves the owner. Writes bind the caller through
-- `rater_profile_id = auth.uid()` (profiles.id is the auth user id).
-- =============================================================================
alter table public.feedback enable row level security;

drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own on public.feedback
  for select to authenticated
  using (rater_profile_id = auth.uid());

drop policy if exists feedback_insert_own on public.feedback
  for insert to authenticated
  with check (
    rater_profile_id = auth.uid()
    and public.is_active_member()
  );

drop policy if exists feedback_update_own on public.feedback
  for update to authenticated
  using (rater_profile_id = auth.uid())
  with check (rater_profile_id = auth.uid());

drop policy if exists feedback_delete_own on public.feedback
  for delete to authenticated
  using (rater_profile_id = auth.uid());

-- =============================================================================
-- Grants. Migrations 0003/0004 grant exactly what each role needs; on a hosted
-- Supabase project the platform default privileges also auto-grant ALL on new
-- tables, so the grants for this table are repeated here to keep the intent
-- explicit and durable rather than relying on default behaviour.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.feedback to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on all tables in schema public to service_role;
  end if;
end;
$$;
