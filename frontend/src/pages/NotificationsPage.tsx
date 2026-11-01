import { useState } from "react";
import { notificationsApi } from "../api/notifications.api";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../hooks/useAsync";
import { useRealtime } from "../hooks/useRealtime";
import { NOTIFICATION_TYPE_LABELS, relativeTime } from "../lib/format";
import { ApiError } from "../lib/http";
import type { AppNotification, NotificationType } from "../lib/types";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Checkbox } from "../components/ui/Checkbox";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Pagination } from "../components/ui/Pagination";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";

const TYPE_OPTIONS = Object.entries(NOTIFICATION_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export function NotificationsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [type, setType] = useState<NotificationType | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [live, setLive] = useState<AppNotification[]>([]);
  const [busy, setBusy] = useState(false);

  const notifications = useAsync(
    (signal) =>
      notificationsApi.listMine({ page, limit: 5, type, unread: unreadOnly ? true : undefined }, signal),
    [page, type, unreadOnly]
  );

  useRealtime({
    "notification:new": (payload) => {
      const incoming = (payload as { notification?: AppNotification }).notification;
      if (incoming) setLive((current) => [incoming, ...current]);
    },
  });

  async function markRead(id: string) {
    try {
      await notificationsApi.markRead(id);
      setLive((current) => current.filter((item) => item.id !== id));
      notifications.reload();
    } catch (caught) {
      toast.error("Could not mark as read", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      const result = await notificationsApi.markAllRead();
      setLive([]);
      notifications.reload();
      toast.success(`${result.updated} notification${result.updated === 1 ? "" : "s"} marked as read.`);
    } catch (caught) {
      toast.error("Could not mark all as read", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const list = [...live, ...(notifications.data?.notifications ?? [])];
  const pagination = notifications.data?.pagination;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Likes, comments, ratings and system messages. New ones arrive live."
        actions={
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void markAllRead()}>
            Mark all as read
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-52">
            <Select
              aria-label="Filter by type"
              value={type}
              placeholder="All types"
              options={TYPE_OPTIONS}
              onChange={(event) => {
                setType(event.target.value as NotificationType | "");
                setPage(1);
              }}
            />
          </div>
          <Checkbox
            label="Unread only"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
          />
          {notifications.data ? (
            <Badge tone="brand">{notifications.data.unreadCount} unread</Badge>
          ) : null}
        </div>
      </Card>

      {notifications.status === "loading" ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : notifications.status === "error" ? (
        <ErrorState error={notifications.error} onRetry={notifications.reload} />
      ) : list.length === 0 ? (
        <EmptyState title="Nothing here" description="When someone interacts with your profile, it shows up here." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {list.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {NOTIFICATION_TYPE_LABELS[item.type] ?? item.type}
                    {item.readAt === null ? <span className="ml-2 text-xs text-brand-600">unread</span> : null}
                  </p>
                  <p className="text-xs text-slate-400">{relativeTime(item.createdAt)}</p>
                </div>
                {item.readAt === null ? (
                  <Button size="sm" variant="ghost" onClick={() => void markRead(item.id)}>
                    Mark as read
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {pagination ? (
            <div className="mt-6">
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                onChange={setPage}
              />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
