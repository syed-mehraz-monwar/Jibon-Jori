import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { SERVER_EVENTS } from "../../lib/realtime";
import { useRealtime } from "../../hooks/useRealtime";
import { useUnreadNotifications } from "../../hooks/useUnreadNotifications";
import { useAndroidBackButton } from "../../hooks/useAndroidBackButton";
import { pushBackHandler } from "../../lib/backstack";
import { developerCredit } from "../../lib/env";
import { cn } from "../../lib/cn";
import { Spinner } from "../ui/Spinner";
import { BrandLockup, BrandMark } from "./BrandMark";
import { Icon, type IconName } from "./Icon";
import { ReferenceDataBanner } from "./ReferenceDataBanner";

type NotificationPayload = {
  notification?: { type?: string; payload?: Record<string, unknown> };
};

type NavItem = { to: string; label: string; icon: IconName; end?: boolean; adminOnly?: boolean };

/** Destinations shown in the bottom bar: the five a member uses daily. */
const PRIMARY_NAV: NavItem[] = [
  { to: "/app", label: "Home", icon: "home", end: true },
  { to: "/app/search", label: "Search", icon: "search" },
  { to: "/app/recommendations", label: "Matches", icon: "heart" },
  { to: "/app/chat", label: "Assistant", icon: "sparkle" },
  { to: "/app/profile", label: "Profile", icon: "user" },
];

/** Everything else lives in the drawer so the bottom bar stays uncluttered. */
const SECONDARY_NAV: NavItem[] = [
  { to: "/app/notifications", label: "Notifications", icon: "bell" },
  { to: "/app/preferences", label: "Partner preferences", icon: "sliders" },
  { to: "/app/sessions", label: "Sessions and security", icon: "shield" },
  { to: "/app/reports", label: "Reports", icon: "chart", adminOnly: true },
  { to: "/app/about", label: "About", icon: "info" },
];

/**
 * Authenticated application shell.
 *
 * Everything under `/app` is protected here rather than per page, so a new page
 * cannot be added without inheriting the guard. While the session is being
 * rehydrated a spinner is shown instead of a redirect, which avoids a flash of
 * the login screen for an already-signed-in user.
 *
 * Layout: a compact header (brand, notifications, menu), a slide-in drawer for
 * secondary destinations, and a bottom bar for the five primary ones. The
 * bottom bar respects the Android safe area via `env(safe-area-inset-bottom)`.
 */
export function AppShell() {
  const { status, isAdmin, user, logout } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const { unread } = useUnreadNotifications();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useAndroidBackButton("/app");

  useEffect(() => {
    const onExitHint = () => toast.info("Press back again to exit.");
    window.addEventListener("jibonjori:exit-hint", onExitHint);
    return () => window.removeEventListener("jibonjori:exit-hint", onExitHint);
  }, [toast]);

  // The hardware back button closes the drawer before anything else happens.
  useEffect(() => {
    if (!drawerOpen) return;
    return pushBackHandler(() => {
      setDrawerOpen(false);
      return true;
    });
  }, [drawerOpen]);

  // A route change always closes the drawer, so it never floats over a new page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useRealtime(
    {
      [SERVER_EVENTS.notificationNew]: (payload) => {
        const type = (payload as NotificationPayload).notification?.type;
        toast.info(type ? `New ${type} notification.` : "You have a new notification.");
      },
    },
    status === "authenticated"
  );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Spinner className="h-8 w-8 text-brand-600" />
        <p className="text-sm text-slate-500">Restoring your session…</p>
        <p className="text-xs text-slate-400">{developerCredit()}</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const signedInNav = SECONDARY_NAV.filter((item) => !item.adminOnly || isAdmin);
  const currentTitle =
    [...PRIMARY_NAV, ...signedInNav].find((item) =>
      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
    )?.label ?? "JibonJori";

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="jj-tap -ml-1 rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <Icon name="menu" />
          </button>

          <NavLink to="/app" className="min-w-0" aria-label="JibonJori dashboard">
            <BrandLockup />
          </NavLink>

          <div className="ml-auto flex items-center gap-1">
            <NavLink
              to="/app/notifications"
              className="jj-tap relative rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            >
              <Icon name="bell" />
              {unread > 0 ? (
                <span className="absolute right-1 top-1 min-w-4 rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-4 text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </NavLink>
            <NavLink
              to="/app/profile"
              className="jj-tap rounded-xl p-1.5 transition hover:bg-slate-100"
              aria-label="My profile"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 ring-1 ring-brand-200">
                {(user?.username ?? "?").slice(0, 1).toUpperCase()}
              </span>
            </NavLink>
          </div>
        </div>

        {/* Desktop navigation: icon + label pairs, no text-only links. */}
        <nav aria-label="Main" className="mx-auto hidden w-full max-w-6xl gap-1 px-3 pb-2 sm:flex">
          {[...PRIMARY_NAV, ...signedInNav].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  isActive ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )
              }
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <ReferenceDataBanner />

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 sm:hidden" role="presentation">
          <div
            className="absolute inset-0 bg-slate-900/40"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <BrandLockup subtitle="Menu" />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="jj-tap rounded-xl p-2 text-slate-500 hover:bg-slate-100"
              >
                <Icon name="close" />
              </button>
            </div>

            <nav aria-label="All destinations" className="flex-1 overflow-y-auto px-2 py-3">
              {[...PRIMARY_NAV, ...signedInNav].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                      isActive ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100"
                    )
                  }
                >
                  <Icon name={item.icon} className="h-5 w-5" />
                  <span className="flex-1">{item.label}</span>
                  {item.to === "/app/notifications" && unread > 0 ? (
                    <span className="rounded-full bg-brand-600 px-2 text-xs font-semibold text-white">{unread}</span>
                  ) : null}
                </NavLink>
              ))}
            </nav>

            <div className="border-t border-slate-200 px-4 py-3">
              <p className="mb-2 truncate text-sm font-medium text-slate-800">{user?.username}</p>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <Icon name="logout" className="h-5 w-5" />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:pb-10">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-4 pb-24 text-center text-xs text-slate-500 sm:pb-4">
        <p>
          JibonJori &middot; {currentTitle} &middot;{" "}
          <NavLink to="/app/about" className="font-medium text-slate-600 underline-offset-2 hover:underline">
            About
          </NavLink>
        </p>
      </footer>

      {/* Bottom bar: primary destinations only, with real icons. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <ul className="flex items-stretch justify-between px-1">
          {PRIMARY_NAV.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "jj-tap flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition",
                    isActive ? "text-brand-700" : "text-slate-500"
                  )
                }
              >
                <Icon name={item.icon} className="h-5 w-5" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function BrandBadge() {
  return <BrandMark size="sm" />;
}
