import { useState } from "react";
import { authApi } from "../api/auth.api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../hooks/useAsync";
import { formatDateTime } from "../lib/format";
import { ApiError } from "../lib/http";
import { BackButton } from "../components/layout/BackButton";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";

/**
 * Session management (Spec §3).
 *
 * Lists the caller's active sessions and allows revoking one or all others. Every
 * action is scoped server-side to the caller, so a foreign session id is reported
 * as not found rather than forbidden.
 */
export function SessionsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const sessions = useAsync((signal) => authApi.sessions(signal), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await authApi.revokeSession(id);
      toast.success("Session revoked.");
      sessions.reload();
    } catch (caught) {
      toast.error("Could not revoke the session", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    setRevokingOthers(true);
    try {
      const result = await authApi.revokeOthers();
      toast.success(`${result.revoked} other session${result.revoked === 1 ? "" : "s"} revoked.`);
      sessions.reload();
    } catch (caught) {
      toast.error("Could not revoke sessions", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setRevokingOthers(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Active sessions"
        description="Signed-in devices for your account. Revoking a session signs that device out."
        actions={
          <div className="flex items-center gap-2">
            <BackButton />
            <Button variant="secondary" size="sm" loading={revokingOthers} onClick={() => void revokeOthers()}>
              Revoke all other sessions
            </Button>
          </div>
        }
      />

      <Card>
        {sessions.status === "loading" ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : sessions.status === "error" ? (
          <ErrorState error={sessions.error} onRetry={sessions.reload} />
        ) : (sessions.data?.sessions.length ?? 0) === 0 ? (
          <EmptyState title="No active sessions" />
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {sessions.data?.sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    {session.current ? "This device" : (session.userAgent ?? "Unknown device")}
                    {session.current ? <Badge tone="success">current</Badge> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    IP {session.ip ?? "unknown"} &middot; started {formatDateTime(session.createdAt)} &middot;
                    expires {formatDateTime(session.expiresAt)}
                  </p>
                </div>
                {!session.current ? (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busyId === session.id}
                    onClick={() => void revoke(session.id)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        Signed in as {user?.username}. Session listing is bounded to the most recent 100 sessions.
      </p>
    </>
  );
}
