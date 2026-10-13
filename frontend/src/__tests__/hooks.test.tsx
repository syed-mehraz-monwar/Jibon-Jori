import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsync } from "../hooks/useAsync";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

describe("useAsync", () => {
  it("moves from loading to success and exposes the data", async () => {
    const loader = vi.fn(async () => "payload");
    const { result } = renderHook(() => useAsync(loader, []));

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toBe("payload");
    expect(result.current.error).toBeNull();
  });

  it("captures a thrown error instead of leaving an unhandled rejection", async () => {
    const failure = new Error("service unavailable");
    const { result } = renderHook(() => useAsync(async () => {
      throw failure;
    }, []));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeNull();
  });

  it("stays idle while disabled and loads when it is enabled", async () => {
    const loader = vi.fn(async () => 42);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAsync(loader, [], { enabled }),
      { initialProps: { enabled: false } }
    );

    expect(result.current.status).toBe("idle");
    expect(loader).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toBe(42);
  });

  it("reloads on demand", async () => {
    let value = 1;
    const loader = vi.fn(async () => value);
    const { result } = renderHook(() => useAsync(loader, []));

    await waitFor(() => expect(result.current.data).toBe(1));
    value = 2;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("passes an AbortSignal and ignores the abort as an error", async () => {
    const seen: AbortSignal[] = [];
    const loader = (signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        seen.push(signal);
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        setTimeout(() => resolve("late"), 50);
      });

    const { result, unmount } = renderHook(() => useAsync(loader, []));
    expect(result.current.status).toBe("loading");
    unmount();

    expect(seen[0]?.aborted).toBe(true);
    // The rejection is swallowed: an abort is a cancellation, not a failure.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.status).toBe("loading");
  });

  it("re-runs when an input dependency changes", async () => {
    const loader = vi.fn(async (signal: AbortSignal) => String(signal.aborted));
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useAsync((signal) => loader(signal), [page]),
      { initialProps: { page: 1 } }
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(loader).toHaveBeenCalledTimes(1);

    rerender({ page: 2 });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });
});

describe("useDebouncedValue", () => {
  it("returns the initial value and then the settled value", async () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 50),
      { initialProps: { value: "a" } }
    );

    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    rerender({ value: "abc" });
    // Still the previous settled value while the input keeps changing.
    expect(result.current).toBe("a");

    await waitFor(() => expect(result.current).toBe("abc"));
  });
});
