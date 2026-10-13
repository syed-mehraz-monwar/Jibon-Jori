-- =============================================================================
-- JibonJori - 0009 on-device ML artifact
-- =============================================================================
-- The on-device compatibility model (TensorFlow.js-trained MLP, served to the
-- client which runs the forward pass locally) previously lived as a TypeScript
-- module compiled into the Express backend. With the backend gone, the artifact
-- needs a home that the client can fetch over PostgREST.
--
-- Shape: one row per trained artifact. `artifact` holds the JSON the training
-- pipeline emits, which the client validates structurally before use
-- (`frontend/src/lib/mlp.ts` - `validateArtifact`). Exactly one artifact per
-- model name may be active, enforced by a partial unique index rather than by
-- convention, so a publish cannot leave two candidates live.
--
-- Write access: none for clients. Publishing is an operator action performed
-- with the service role (see ml/publish.mjs). Clients only ever read.
-- =============================================================================

create table public.ml_artifacts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  version         text not null unique,
  feature_version text not null,
  artifact        jsonb not null,
  is_active       boolean not null default false,
  trained_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  constraint ml_artifacts_name_shape check (name ~ '^[a-z0-9-]{3,60}$'),
  constraint ml_artifacts_version_shape check (version ~ '^[a-z0-9.-]{3,80}$'),
  -- the client cannot do anything with an artifact that carries no layers
  constraint ml_artifacts_has_layers check (
    jsonb_typeof(artifact -> 'layers') = 'array'
    and jsonb_array_length(artifact -> 'layers') > 0
  ),
  constraint ml_artifacts_has_input_order check (
    jsonb_typeof(artifact -> 'inputOrder') = 'array'
  )
);

create unique index ml_artifacts_one_active_per_name_idx
  on public.ml_artifacts (name) where is_active;

create index ml_artifacts_active_idx
  on public.ml_artifacts (name, trained_at desc) where is_active;

-- ---------------------------------------------------------------------------
-- RLS: read-only for signed-in members, invisible to signed-out visitors.
-- There is deliberately no INSERT/UPDATE/DELETE policy for any client role.
-- ---------------------------------------------------------------------------
alter table public.ml_artifacts enable row level security;

create policy ml_artifacts_select_member on public.ml_artifacts
  for select to authenticated
  using (true);

-- 0003's `grant ... on all tables in schema public` ran before this table
-- existed, so the grants have to be repeated here or the policy above would be
-- unreachable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.ml_artifacts to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.ml_artifacts to service_role;
  end if;
end;
$$;
