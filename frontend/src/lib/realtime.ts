import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * Supabase Realtime adapter that preserves the old Socket.IO surface.
 *
 * The Express/Socket.IO server is gone; live updates now arrive as Postgres change
 * events over Supabase Realtime. Components still register the same event names
 * and receive the same payload shape (the changed database row, i.e.
 * `payload.new`), so no component had to change. The `username:available` event
 * remains in the union for compatibility but has no server-side push anymore -
 * availability is checked with the `username_available` RPC.
 */

export type RealtimeEvent =
  | "notification:new"
  | "like:new"
  | "comment:new"
  | "rating:new"
  | "username:available"
  | "connect"
  | "disconnect";

export type RealtimeListener = (payload: unknown) => void;

type TableSpec = {
  table: string;
  /** The realtime filter that scopes rows to the current user. */
  filter?: (userId: string) => string;
  /** An additional in-handler guard (Postgres filters support a single column). */
  guard?: (row: Record<string, unknown>) => boolean;
  /** Adapts the changed row to the camelCase payload the components already read. */
  map: (row: Record<string, unknown>) => unknown;
};

/**
 * The components were written against the old Socket.IO payloads, which were
 * camelCase and sometimes nested (`{ notification }`). Postgres change events carry
 * the raw snake_case row, so each event name adapts its row back to that contract;
 * no component had to change.
 */
function adaptComment(row: Record<string, unknown>): unknown {
  return {
    commentId: row.id,
    authorProfileId: row.author_profile_id,
    targetProfileId: row.target_profile_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

const EVENT_TABLES: Record<string, TableSpec> = {
  "notification:new": {
    table: "notifications",
    filter: (id) => `profile_id=eq.${id}`,
    map: (row) => ({
      notification: {
        id: row.id,
        type: row.type,
        payload: row.payload ?? {},
        readAt: row.read_at,
        createdAt: row.created_at,
      },
    }),
  },
  "like:new": {
    table: "interactions",
    filter: (id) => `target_profile_id=eq.${id}`,
    // A realtime filter can only constrain one column, so the stance is checked here.
    guard: (row) => row.value === 1,
    map: (row) => ({
      value: row.value,
      removed: false,
      actorProfileId: row.actor_profile_id,
      targetProfileId: row.target_profile_id,
      createdAt: row.created_at,
    }),
  },
  "comment:new": {
    table: "comments",
    filter: (id) => `target_profile_id=eq.${id}`,
    map: adaptComment,
  },
  "rating:new": {
    table: "ratings",
    filter: (id) => `rated_profile_id=eq.${id}`,
    map: (row) => ({
      score: row.score,
      raterProfileId: row.rater_profile_id,
      ratedProfileId: row.rated_profile_id,
      createdAt: row.created_at,
    }),
  },
};

/** Client -> server events. Only profile room membership is meaningful now. */
export const CLIENT_EVENTS = {
  profileWatch: "profile:watch",
  profileUnwatch: "profile:unwatch",
} as const;

/** Server -> client event names, kept for the components that read them. */
export const SERVER_EVENTS = {
  notificationNew: "notification:new",
  likeNew: "like:new",
  commentNew: "comment:new",
  ratingNew: "rating:new",
  usernameAvailable: "username:available",
} as const;

export type UsernameAvailabilityEvent = {
  username: string;
  available: boolean;
  reason:
    | "ok"
    | "taken"
    | "reserved"
    | "too_long"
    | "too_short"
    | "invalid_format"
    | "rate_limited"
    | "invalid_payload"
    | "error";
};

export class RealtimeClient {
  connected = false;

  private userId: string | null = null;
  private channel: RealtimeChannel | null = null;
  private readonly listeners = new Map<string, Set<RealtimeListener>>();
  private readonly watchedProfiles = new Set<string>();

  on(event: string, listener: RealtimeListener): this {
    const set = this.listeners.get(event) ?? new Set<RealtimeListener>();
    set.add(listener);
    this.listeners.set(event, set);
    if (event !== "connect" && event !== "disconnect") this.rebuild();
    return this;
  }

  off(event: string, listener?: RealtimeListener): this {
    const set = this.listeners.get(event);
    if (!set) return this;
    if (listener) set.delete(listener);
    else set.clear();
    if (set.size === 0) this.listeners.delete(event);
    if (event !== "connect" && event !== "disconnect") this.rebuild();
    return this;
  }

  /** Only `profile:watch`/`profile:unwatch` do anything; the rest is a no-op. */
  emit(event: string, payload?: unknown): this {
    if (event === CLIENT_EVENTS.profileWatch) {
      const profileId = (payload as { profileId?: string } | undefined)?.profileId;
      if (profileId) {
        this.watchedProfiles.add(profileId);
        this.rebuild();
      }
    } else if (event === CLIENT_EVENTS.profileUnwatch) {
      const profileId = (payload as { profileId?: string } | undefined)?.profileId;
      if (profileId && this.watchedProfiles.delete(profileId)) this.rebuild();
    }
    return this;
  }

  setUser(userId: string | null): void {
    if (this.userId === userId) return;
    this.userId = userId;
    this.rebuild();
  }

  disconnect(): void {
    this.teardown();
    this.userId = null;
    if (this.connected) {
      this.connected = false;
      this.dispatch("disconnect", undefined);
    }
  }

  private hasListeners(event: string): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  private dispatch(event: string, payload: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(payload);
    }
  }

  private teardown(): void {
    if (this.channel) {
      void this.channel.unsubscribe();
      this.channel = null;
    }
  }

  private rebuild(): void {
    this.teardown();

    // Tests and unconfigured deployments must not attempt a connection.
    if (!this.userId || !isSupabaseConfigured()) return;

    const userId = this.userId;
    const channel = getSupabase().channel(`jj:${userId}`);

    for (const [event, spec] of Object.entries(EVENT_TABLES)) {
      if (!this.hasListeners(event)) continue;
      const filter = spec.filter?.(userId);
      channel.on(
        "postgres_changes",
        filter
          ? { event: "INSERT", schema: "public", table: spec.table, filter }
          : { event: "INSERT", schema: "public", table: spec.table },
        (payload) => {
          const row = (payload.new ?? {}) as Record<string, unknown>;
          if (spec.guard && !spec.guard(row)) return;
          this.dispatch(event, spec.map(row));
        }
      );
    }

    for (const profileId of this.watchedProfiles) {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `target_profile_id=eq.${profileId}` },
        (payload) => this.dispatch("comment:new", adaptComment((payload.new ?? {}) as Record<string, unknown>))
      );
    }

    this.channel = channel;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.connected = true;
        this.dispatch("connect", undefined);
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.connected = false;
        this.dispatch("disconnect", undefined);
      }
    });
  }
}

let singleton: RealtimeClient | null = null;

export function getRealtime(): RealtimeClient {
  if (!singleton) singleton = new RealtimeClient();
  return singleton;
}

export function disconnectRealtime(): void {
  if (singleton) {
    singleton.disconnect();
    singleton = null;
  }
}
