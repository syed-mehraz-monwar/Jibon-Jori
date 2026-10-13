# Realtime

Live updates use Supabase Realtime (`postgres_changes`) instead of the removed
Socket.IO server. Components still register the same event names and receive the
same payload shapes as before, through an adapter that preserves the old surface
(`frontend/src/lib/realtime.ts:4-13`).

Status vocabulary: VERIFIED, PARTIAL, ENVIRONMENT-GATED, BLOCKED, NOT VERIFIED,
NOT APPLICABLE.

> Evidence note: the publication and replica-identity settings are asserted by the
> SQL suite as recorded in the existing migration documents. Live delivery was never
> observed here (no hosted project). This document ran no gate.

---

## 1. Server side — the publication (migration 0006)

`supabase_realtime` is created if absent and extended idempotently
(`20260927000006_realtime.sql:24-53`). Five tables are published:

| Event (old Socket.IO name) | Table | Change kind |
| --- | --- | --- |
| `comment:new` | `comments` | INSERT |
| `like:new` | `interactions` | INSERT/UPDATE |
| `rating:new` | `ratings` | INSERT/UPDATE |
| `notification:new` | `notifications` | INSERT |
| chat message | `chat_messages` | INSERT |

Source: `0006:5-16`.

`interactions` is set to `replica identity full` (`0006:55-60`) so an UPDATE payload
carries the whole row, because a client that changes its stance on a like needs the
previous value to render the transition. No other published table gets this, to
avoid write amplification.

RLS is not bypassed by Realtime: for `postgres_changes` on an authenticated
connection, a subscriber receives only rows the SELECT policies already allow. The
publication is therefore not itself a security boundary — the policies in 0004/0011
are (`0006:18-21`).

### 1.1 Deliberately not broadcast

`profiles` is **not** in the publication. Realtime is not how username availability
is answered (that is the `username_available` RPC), and publishing profile rows would
broadcast a stream of other members' edits for no feature that needs it
(`0006:13-16`). The SQL suite asserts both that the five tables are published and
that `profiles` is not (`supabase/tests/rls_assertions.sql:559-567`).

---

## 2. Client side — the adapter (`frontend/src/lib/realtime.ts`)

The old Socket.IO client is gone; `RealtimeClient` wraps one Supabase Realtime
channel and exposes the same `on`/`off`/`emit` surface, so `useRealtime` and
`useProfileRoom` need no changes (`realtime.ts:4-13`).

### 2.1 Event → table mapping

`EVENT_TABLES` (`realtime.ts:52-94`):

| Event name | Table | Filter | Additional guard | Payload adaptation |
| --- | --- | --- | --- | --- |
| `notification:new` | `notifications` | `profile_id=eq.<userId>` | — | `{ notification: { id, type, payload, readAt, createdAt } }` |
| `like:new` | `interactions` | `target_profile_id=eq.<userId>` | `row.value === 1` | `{ value, removed:false, actorProfileId, targetProfileId, createdAt }` |
| `comment:new` | `comments` | `target_profile_id=eq.<userId>` | — | `adaptComment` → `{ commentId, authorProfileId, targetProfileId, body, createdAt }` |
| `rating:new` | `ratings` | `rated_profile_id=eq.<userId>` | — | `{ score, raterProfileId, ratedProfileId, createdAt }` |

The filter can constrain only one column, so the like stance is additionally checked
in the handler (`realtime.ts:66-78`).

### 2.2 `payload.new` → old payload shape

Postgres change events carry the raw snake_case row in `payload.new`. Each event
adapts it back to the camelCase contract the components already read
(`realtime.ts:36-50`, `:56-93`). `notification:new` wraps the row in a `notification`
object, matching the old nested shape. No component had to change.

`username:available` remains in the event-name union for compatibility but has no
server-side push; availability is checked with the `username_available` RPC
(`realtime.ts:10-13`, `:103-109`).

### 2.3 `profile:watch` / `profile:unwatch`

`CLIENT_EVENTS` (`realtime.ts:96-100`). Only these two client events do anything
(`realtime.ts:152-165`):

- `profile:watch` adds the `profileId` to `watchedProfiles` and rebuilds the
  channel.
- `profile:unwatch` removes it if present and rebuilds.

During `rebuild`, for each watched profile the client adds an extra `comments`
INSERT subscription filtered by `target_profile_id=eq.<profileId>` and dispatches
`comment:new` (`realtime.ts:224-230`). This is how a comment posted by another
member reaches every viewer of the profile, not only its owner.
`useProfileRoom` emits `profile:watch` on mount and `profile:unwatch` on unmount
(`frontend/src/hooks/useProfileRoom.ts:15-26`).

### 2.4 Connect / disconnect lifecycle

- `setUser(userId)` stores the user and rebuilds; `rebuild` first tears down any
  existing channel (`realtime.ts:167-171`, `:192-201`).
- `rebuild` returns without connecting when there is no user or Supabase is not
  configured, so tests and unconfigured deployments never attempt a connection
  (`realtime.ts:202-204`).
- One channel is created per user: `getSupabase().channel('jj:<userId>')`
  (`realtime.ts:206`).
- `channel.subscribe` dispatches `connect` on `SUBSCRIBED`, and `disconnect` on
  `CLOSED` / `CHANNEL_ERROR` / `TIMED_OUT` (`realtime.ts:233-241`).
- `disconnect()` tears down, clears the user, and emits `disconnect` once
  (`realtime.ts:173-180`).

`SocketContext` opens the connection once the session is authenticated and tears it
down when the user is absent (`frontend/src/context/SocketContext.tsx:26-48`).
`AuthContext.clearSession` calls `disconnectRealtime()`, so sign-out closes the
channel (`frontend/src/context/AuthContext.tsx:50-54`). `useRealtime` subscribes
listeners for the lifetime of a component and holds handlers in a ref so a re-render
does not drop events in the gap (`frontend/src/hooks/useRealtime.ts:12-36`).

---

## 3. Limitation — INSERT only

Every `channel.on` call in the adapter is registered for `event: "INSERT"`
(`realtime.ts:211-221`, `:225-229`). Consequences:

- A **delete** (unlike / unrate / comment removed) does not push to clients.
- An **update** to an existing interaction's stance (for example dislike → like,
  which the migration intends to be broadcast, `0006:8`) does not push either,
  because the client never subscribes to UPDATE. The `like:new` guard only sees
  INSERT rows.
- The `replica identity full` capability on `interactions` is therefore currently
  unused by the client.

As a result, live inserts arrive but removals/edits do not; the affected screens
still reflect them on the next read/refresh. This is a current limitation of the
client adapter, not of the publication.

---

## 4. Status

| Claim | Status |
| --- | --- |
| Five activity tables in `supabase_realtime` | VERIFIED (SQL) — `rls_assertions.sql:559-563` |
| `profiles` not published | VERIFIED (SQL) — `rls_assertions.sql:565-567` |
| `interactions` replica identity = full | VERIFIED (SQL) — `rls_assertions.sql:569-570` |
| Adapter event mapping / payload adaptation | Unit-covered (`frontend/src/__tests__/realtime.test.ts`, `realtime-hooks.test.tsx`) |
| Live delivery of events to a signed-in browser | **NOT VERIFIED** — needs a hosted Supabase project |
| DELETE/UPDATE pushes | NOT IMPLEMENTED in the client (see §3) |
