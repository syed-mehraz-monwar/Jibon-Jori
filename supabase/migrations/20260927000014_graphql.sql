-- =============================================================================
-- JibonJori - 0014 GraphQL API (pg_graphql)
-- =============================================================================
-- The course specification requires both a REST API and a GraphQL API. On
-- Supabase these are native and share one source of truth:
--
--   * REST    -> PostgREST, derived from the tables and views automatically
--   * GraphQL -> `pg_graphql`, exposed at `/graphql/v1` on the same project
--
-- Enabling the extension is the whole GraphQL surface: `pg_graphql` introspects
-- the public schema and generates queries and mutations for every table the API
-- role can reach, and it enforces the same row level security policies as
-- PostgREST, because it runs as the same authenticated role. There is therefore no
-- second schema to maintain and no endpoint to duplicate.
--
-- `create extension` is guarded because `pg_graphql` ships with Supabase but not
-- with a stock PostgreSQL, which is what the local test harness runs. On Supabase
-- it is present (and usually already enabled), so this is a no-op there; on the
-- harness the guard keeps the migration applicable without inventing a substitute
-- GraphQL engine.
--
-- The extension MUST live in the `graphql` schema, not `extensions`: pg_graphql's
-- control file pins `schema = 'graphql'`, so `with schema extensions` fails with
-- SQLSTATE 0A000 ("extension \"pg_graphql\" must be installed in schema \"graphql\"").
-- That error is invisible on the stock-PostgreSQL harness, which never reaches this
-- branch, and only appeared on the first real `db push` to Supabase. The schema is
-- created first because the extension cannot create it implicitly.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_graphql') then
    create schema if not exists graphql;
    create extension if not exists pg_graphql with schema graphql;
    comment on extension pg_graphql is
      'GraphQL API over the public schema; enforces the same RLS policies as PostgREST.';
  else
    raise notice 'pg_graphql is not available on this server; the GraphQL API is a Supabase-hosted feature and is absent locally by design.';
  end if;
end;
$$;
