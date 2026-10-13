import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export type AsyncState<T> = {
  data: T | null;
  status: AsyncStatus;
  /** The thrown value (usually an `ApiError`), so callers can inspect the status. */
  error: unknown;
  reload: () => void;
  setData: (value: T | null) => void;
};

/**
 * Runs an async loader, exposing the four UI states (idle, loading, success,
 * error) that every data view must handle. The loader receives an
 * `AbortSignal`, so an in-flight request is cancelled when inputs change or the
 * component unmounts — important for the search field, which fires per keystroke.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean } = {}
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<AsyncStatus>(enabled ? "loading" : "idle");
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    let active = true;
    setStatus("loading");
    setError(null);

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setStatus("success");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught);
        setStatus("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, ...deps]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, status, error, reload, setData };
}
