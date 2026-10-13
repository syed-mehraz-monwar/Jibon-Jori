import { getSupabase, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { mapNotification, paginationFor, rangeFor, type NotificationRow } from "../lib/mappers";
import type { AppNotification, NotificationType, Pagination } from "../lib/types";

export type NotificationListResult = {
  notifications: AppNotification[];
  pagination: Pagination;
  unreadCount: number;
};

export type NotificationFilters = {
  page?: number;
  limit?: number;
  type?: NotificationType | "";
  unread?: boolean;
};

const SELECT = "id, type, payload, read_at, created_at";

/** `/api/notifications` — §11. */
export const notificationsApi = {
  listMine: async (
    filters: NotificationFilters = {},
    _signal?: AbortSignal
  ): Promise<NotificationListResult> => {
    const userId = await requireUserId();
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const [from, to] = rangeFor(page, limit);

    let query = getSupabase()
      .from("notifications")
      .select(SELECT, { count: "exact" })
      .eq("profile_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.unread) query = query.is("read_at", null);

    const { data, error, count } = await query;
    if (error) throw toApiError(error);

    // A second, head-only count keeps the unread badge exact without fetching rows.
    const unread = await getSupabase()
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", userId)
      .is("read_at", null);
    if (unread.error) throw toApiError(unread.error);

    return {
      notifications: ((data ?? []) as NotificationRow[]).map(mapNotification),
      pagination: paginationFor(page, limit, count ?? 0),
      unreadCount: unread.count ?? 0,
    };
  },

  markRead: async (notificationId: string): Promise<{ notification: AppNotification }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .eq("profile_id", userId)
      .select(SELECT)
      .maybeSingle();
    if (error) throw toApiError(error);
    if (!data) {
      throw new ApiError(404, "NOT_FOUND", "That notification does not exist.");
    }
    return { notification: mapNotification(data as NotificationRow) };
  },

  markAllRead: async (): Promise<{ updated: number }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("profile_id", userId)
      .is("read_at", null)
      .select("id");
    if (error) throw toApiError(error);
    return { updated: (data ?? []).length };
  },
};
