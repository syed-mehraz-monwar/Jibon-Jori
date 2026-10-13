-- =============================================================================
-- JibonJori - 0006 Supabase Realtime
-- =============================================================================
-- Socket.IO is gone. Each former Socket.IO feature now maps to a table change
-- that Supabase Realtime broadcasts:
--
--   comment:new          -> `comments`      INSERT
--   like:new             -> `interactions`  INSERT/UPDATE
--   rating:new           -> `ratings`       INSERT/UPDATE
--   notification:new     -> `notifications` INSERT
--   chat message         -> `chat_messages` INSERT
--
-- `profiles` is deliberately NOT published. Realtime is not how username
-- availability is answered (that is the `username_available` RPC), and
-- publishing profile rows would broadcast a stream of other people's edits for
-- no feature that needs it.
--
-- Realtime enforces RLS for `postgres_changes` on an authenticated connection,
-- so a subscriber only receives rows the SELECT policies already let them read.
-- The publication is therefore not a security boundary on its own - the
-- policies in 0004 are.
-- =============================================================================

do $$
declare
  target text;
  published text[] := array[
    'comments',
    'interactions',
    'ratings',
    'notifications',
    'chat_messages'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
    raise notice 'JibonJori: created the supabase_realtime publication.';
  end if;

  foreach target in array published loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;

  raise notice 'JibonJori: realtime publication covers % tables.', array_length(published, 1);
end;
$$;

-- An UPDATE/DELETE payload only carries the changed columns unless the replica
-- identity is FULL. A client that changes its stance on a like needs to see the
-- previous value to render the transition, so `interactions` keeps full rows in
-- the WAL. This costs write amplification, so it is applied here and nowhere
-- else: every other published table is insert-only from the client's side.
alter table public.interactions replica identity full;
