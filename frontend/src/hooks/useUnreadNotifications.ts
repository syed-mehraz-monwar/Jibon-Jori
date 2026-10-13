import { useCallback, useEffect, useState } from "react";
import { notificationsApi } from "../api/notifications.api";
import { useAuth } from "../context/AuthContext";
import { SERVER_EVENTS } from "../lib/realtime";
import { useRealtime } from "./useRealtime";

/**
 * Unread notification count for the navigation badge.
 *
 * The initial value comes from `GET /api/notifications/me?unread=true`, where the
 * backend reports `unreadCount` without a second aggregate (R-034). A live
 * `notification:new` event increments it without a refetch.
 */
export function useUnreadNotifications(): { unread: number; refresh: () => void } {
  const { status } = useAuth();
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await notificationsApi.listMine({ limit: 1, unread: true });
      setUnread(result.unreadCount);
    } catch {
      /* the badge is cosmetic; a failure must not break the shell */
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") void load();
    else setUnread(0);
  }, [status, load]);

  useRealtime(
    { [SERVER_EVENTS.notificationNew]: () => setUnread((current) => current + 1) },
    status === "authenticated"
  );

  return { unread, refresh: load };
}
