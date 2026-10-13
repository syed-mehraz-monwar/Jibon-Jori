import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { disconnectRealtime, getRealtime, type RealtimeClient } from "../lib/realtime";

type SocketContextValue = {
  socket: RealtimeClient | null;
  connected: boolean;
};

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

/**
 * Owns the single realtime connection for signed-in users.
 *
 * The old Socket.IO client is gone; `RealtimeClient` wraps a Supabase Realtime
 * channel but exposes the same `on`/`off`/`emit` surface, so `useRealtime` and
 * `useProfileRoom` are unchanged. The channel is opened lazily once the session is
 * authenticated and torn down on logout, so an anonymous visitor never connects.
 * Authentication is carried by the Supabase session, not a handshake token.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [socket, setSocket] = useState<RealtimeClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      disconnectRealtime();
      setSocket(null);
      setConnected(false);
      return;
    }

    const client = getRealtime();
    client.setUser(user.id);
    setSocket(client);
    setConnected(client.connected);

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    client.on("connect", handleConnect);
    client.on("disconnect", handleDisconnect);

    return () => {
      client.off("connect", handleConnect);
      client.off("disconnect", handleDisconnect);
    };
  }, [status, user]);

  const value = useMemo<SocketContextValue>(() => ({ socket, connected }), [socket, connected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
