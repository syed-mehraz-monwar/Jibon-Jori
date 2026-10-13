import { useEffect } from "react";
import { useSocket } from "../context/SocketContext";
import { CLIENT_EVENTS } from "../lib/realtime";

/**
 * A-02 / B-27: joins the viewed profile's Socket.IO room while the component is mounted, so
 * profile-scoped events (a comment posted by another member) are pushed to every viewer
 * rather than only to the profile owner. The room is left on unmount so a long session does
 * not accumulate subscriptions.
 *
 * The server decides whether the join is allowed - it re-checks that the profile is public
 * with an active owner and that the socket is not watching too many profiles - so a refusal
 * here is not an error the UI has to surface; the page still renders over HTTP.
 */
export function useProfileRoom(profileId: string | undefined, enabled = true): void {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !enabled || !profileId) return;

    socket.emit(CLIENT_EVENTS.profileWatch, { profileId });
    return () => {
      socket.emit(CLIENT_EVENTS.profileUnwatch, { profileId });
    };
  }, [socket, enabled, profileId]);
}
