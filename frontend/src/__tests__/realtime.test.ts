import { afterEach, describe, expect, it, vi } from "vitest";
import { disconnectRealtime, getRealtime } from "../lib/realtime";
import { fakeSupabase } from "./fake-supabase";

/**
 * The Supabase Realtime adapter.
 *
 * The components were written against the old Socket.IO payloads (camelCase, and a
 * `{ notification }` wrapper). This suite drives a Postgres change event through the
 * adapter and asserts each event name is delivered in the shape the components read,
 * which is what makes the guarantee "no component had to change" true rather than
 * aspirational.
 */
function connect(): { deliver: (filter: Record<string, unknown>, row: Record<string, unknown>) => void } {
  getRealtime().setUser("u1");
  return {
    deliver(filter, row) {
      const match = fakeSupabase.realtimeHandlers.find(
        (entry) => JSON.stringify(entry.filter) === JSON.stringify(filter)
      );
      if (!match) throw new Error(`no realtime handler registered for ${JSON.stringify(filter)}`);
      match.handler({ new: row });
    },
  };
}

afterEach(() => {
  disconnectRealtime();
});

describe("realtime payload adaptation", () => {
  it("adapts a notification row into the nested payload the shell reads", () => {
    const listener = vi.fn();
    getRealtime().on("notification:new", listener);
    const { deliver } = connect();

    deliver(
      { event: "INSERT", schema: "public", table: "notifications", filter: "profile_id=eq.u1" },
      { id: "n1", type: "like", payload: { from: "p2" }, read_at: null, created_at: "2026-01-01T00:00:00.000Z" }
    );

    expect(listener).toHaveBeenCalledWith({
      notification: {
        id: "n1",
        type: "like",
        payload: { from: "p2" },
        readAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("adapts a comment row into the camelCase comment event", () => {
    const listener = vi.fn();
    getRealtime().on("comment:new", listener);
    const { deliver } = connect();

    deliver(
      { event: "INSERT", schema: "public", table: "comments", filter: "target_profile_id=eq.u1" },
      {
        id: "c1",
        author_profile_id: "p2",
        target_profile_id: "u1",
        body: "Great profile",
        created_at: "2026-01-02T00:00:00.000Z",
      }
    );

    expect(listener).toHaveBeenCalledWith({
      commentId: "c1",
      authorProfileId: "p2",
      targetProfileId: "u1",
      body: "Great profile",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("only delivers a like event for a like, not a dislike or favourite", () => {
    const listener = vi.fn();
    getRealtime().on("like:new", listener);
    const { deliver } = connect();

    const filter = { event: "INSERT", schema: "public", table: "interactions", filter: "target_profile_id=eq.u1" };
    deliver(filter, { actor_profile_id: "p2", target_profile_id: "u1", value: -1, created_at: "t" });
    expect(listener).not.toHaveBeenCalled();

    deliver(filter, { actor_profile_id: "p2", target_profile_id: "u1", value: 1, created_at: "t" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ value: 1, removed: false, actorProfileId: "p2" })
    );
  });

  it("does not subscribe a profile room before the client is authenticated", () => {
    getRealtime().on("comment:new", vi.fn());
    expect(fakeSupabase.realtimeHandlers).toHaveLength(0);
  });
});
