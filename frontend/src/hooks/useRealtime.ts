import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";

/**
 * Subscribes to server → client Socket.IO events for the lifetime of the
 * component. Handlers are held in a ref so a re-render does not tear down and
 * rebuild every subscription, which would drop events emitted in the gap.
 *
 * Events come from `API_DOCUMENTATION.md` §19.2: `notification:new`, `like:new`,
 * `comment:new`, `rating:new`, `username:available`.
 */
export function useRealtime(
  handlers: Record<string, (payload: unknown) => void>,
  enabled = true
): void {
  const { socket } = useSocket();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const eventNames = Object.keys(handlers).sort().join("|");

  useEffect(() => {
    if (!socket || !enabled) return;

    const names = eventNames.split("|").filter(Boolean);
    const listeners = names.map((name) => {
      const listener = (payload: unknown) => handlersRef.current[name]?.(payload);
      socket.on(name, listener);
      return { name, listener };
    });

    return () => {
      for (const { name, listener } of listeners) socket.off(name, listener);
    };
  }, [socket, enabled, eventNames]);
}
