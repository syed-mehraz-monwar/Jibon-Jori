import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtime } from "../hooks/useRealtime";
import { useUsernameAvailability } from "../hooks/useUsernameAvailability";
import { fakeSupabase } from "./fake-supabase";

/**
 * A minimal stand-in for the realtime client: `useRealtime` only needs `on`/`off`
 * and a way for the test to deliver an event. The real client is the Supabase
 * adapter in `lib/realtime.ts`; its payload adaptation is covered separately.
 */
class RecorderSocket {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, listener: (payload: unknown) => void): this {
    const set = this.handlers.get(event) ?? new Set();
    set.add(listener);
    this.handlers.set(event, set);
    return this;
  }

  off(event: string, listener?: (payload: unknown) => void): this {
    const set = this.handlers.get(event);
    if (!set) return this;
    if (listener) set.delete(listener);
    else set.clear();
    return this;
  }

  emit(): this {
    return this;
  }

  trigger(event: string, payload?: unknown): void {
    for (const listener of [...(this.handlers.get(event) ?? [])]) listener(payload);
  }

  listenerEvents(): string[] {
    return [...this.handlers.entries()].filter(([, set]) => set.size > 0).map(([name]) => name);
  }
}

const socketState = vi.hoisted(() => ({
  value: { socket: null, connected: false } as { socket: unknown; connected: boolean },
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => socketState.value,
}));

function connectRecorder(): RecorderSocket {
  const socket = new RecorderSocket();
  socketState.value = { socket, connected: true };
  return socket;
}

beforeEach(() => {
  socketState.value = { socket: null, connected: false };
});

describe("useRealtime", () => {
  it("subscribes to every named event once a socket exists", () => {
    const socket = connectRecorder();
    const handler = vi.fn();

    renderHook(() => useRealtime({ "comment:new": handler, "like:new": vi.fn() }));

    expect(socket.listenerEvents().sort()).toEqual(["comment:new", "like:new"]);
  });

  it("delivers a server event to the matching handler only", () => {
    const socket = connectRecorder();
    const onComment = vi.fn();
    const onLike = vi.fn();

    renderHook(() => useRealtime({ "comment:new": onComment, "like:new": onLike }));

    act(() => socket.trigger("comment:new", { comment: { id: "c1" } }));

    expect(onComment).toHaveBeenCalledWith({ comment: { id: "c1" } });
    expect(onLike).not.toHaveBeenCalled();
  });

  it("does not subscribe while disabled", () => {
    const socket = connectRecorder();
    renderHook(() => useRealtime({ "comment:new": vi.fn() }, false));
    expect(socket.listenerEvents()).toEqual([]);
  });

  it("detaches its listeners on unmount so events cannot leak between views", () => {
    const socket = connectRecorder();
    const { unmount } = renderHook(() => useRealtime({ "notification:new": vi.fn() }));
    expect(socket.listenerEvents()).toContain("notification:new");

    unmount();
    expect(socket.listenerEvents()).not.toContain("notification:new");
  });

  it("keeps the latest handler without re-subscribing on re-render", () => {
    const socket = connectRecorder();
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ handler }: { handler: (payload: unknown) => void }) => useRealtime({ "like:new": handler }),
      { initialProps: { handler: first } }
    );

    rerender({ handler: second });
    act(() => socket.trigger("like:new", { value: 1 }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ value: 1 });
    expect(socket.listenerEvents()).toEqual(["like:new"]);
  });
});

describe("useUsernameAvailability", () => {
  /** The RPC answers with a bare boolean, matching `public.username_available`. */
  function seedAvailability(available: boolean): void {
    fakeSupabase.state.rpcs.username_available = () => available;
  }

  it("reports a locally detectable format problem without contacting the server", async () => {
    const rpc = vi.fn(() => true);
    fakeSupabase.state.rpcs.username_available = rpc;

    const { result } = renderHook(() => useUsernameAvailability("ab"));

    await waitFor(() => expect(result.current.status).toBe("invalid"));
    expect(result.current.reason).toBe("too_short");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports an available username from the RPC", async () => {
    seedAvailability(true);

    const { result } = renderHook(() => useUsernameAvailability("rabby_ahmed"));

    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(result.current.reason).toBe("ok");
    expect(result.current.message).toMatch(/available/i);
  });

  it("reports a taken username from the RPC", async () => {
    seedAvailability(false);

    const { result } = renderHook(() => useUsernameAvailability("taken_name"));

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.reason).toBe("taken");
    expect(result.current.message).toMatch(/already taken/i);
  });

  it("reports an RPC failure as a handled error state", async () => {
    fakeSupabase.state.rpcs.username_available = () => {
      throw new Error("offline");
    };

    const { result } = renderHook(() => useUsernameAvailability("offline_user"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.message).toMatch(/Could not check/i);
  });

  it("returns to idle when the field is emptied", async () => {
    seedAvailability(true);

    const { result, rerender } = renderHook(
      ({ username }: { username: string }) => useUsernameAvailability(username),
      { initialProps: { username: "ab" } }
    );

    await waitFor(() => expect(result.current.status).toBe("invalid"));
    rerender({ username: "" });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});
