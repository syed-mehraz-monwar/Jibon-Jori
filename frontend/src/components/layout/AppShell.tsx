import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { SERVER_EVENTS } from "../../lib/realtime";
import { useRealtime } from "../../hooks/useRealtime";
import { Spinner } from "../ui/Spinner";
import { NavBar } from "./NavBar";

type NotificationPayload = {
  notification?: { type?: string; payload?: Record<string, unknown> };
};

/**
 * Authenticated application shell.
 *
 * Everything under `/app` is protected here rather than per page, so a new page
 * cannot be added without inheriting the guard. While the session is being
 * rehydrated a spinner is shown instead of a redirect, which avoids a flash of
 * the login screen for an already-signed-in user.
 */
export function AppShell() {
  const { status, isAdmin } = useAuth();
  const location = useLocation();
  const toast = useToast();

  useRealtime(
    {
      [SERVER_EVENTS.notificationNew]: (payload) => {
        const type = (payload as NotificationPayload).notification?.type ?? "update";
        toast.info("New activity", `You have a new ${type} notification.`);
      },
    },
    status === "authenticated"
  );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
        <span className="sr-only">Restoring your session</span>
      </div>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500">
          <span>JibonJori - AI-assisted matrimony platform</span>
          <span>{isAdmin ? "Signed in as administrator" : "Signed in as member"}</span>
        </div>
      </footer>
    </div>
  );
}
