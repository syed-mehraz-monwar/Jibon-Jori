import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";
import { useUnreadNotifications } from "../../hooks/useUnreadNotifications";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";

const NAV_ITEMS = [
  { to: "/app", label: "Dashboard", end: true },
  { to: "/app/search", label: "Search" },
  { to: "/app/recommendations", label: "Matches" },
  { to: "/app/chat", label: "Assistant" },
  { to: "/app/learn", label: "Learn" },
  { to: "/app/profile", label: "My profile" },
];

export function NavBar() {
  const { user, isAdmin, logout } = useAuth();
  const { connected } = useSocket();
  const { unread } = useUnreadNotifications();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <NavLink to="/app" className="text-lg font-bold tracking-tight">
            <span className="jj-gradient-text">JibonJori</span>
          </NavLink>
          <span
            title={connected ? "Realtime connected" : "Realtime disconnected"}
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              connected ? "bg-emerald-500" : "bg-slate-300"
            )}
          />
        </div>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="jj-nav-link text-sm"
            >
              {item.label}
            </NavLink>
          ))}

          <NavLink to="/app/notifications" className="jj-nav-link text-sm">
            Notifications
            {unread > 0 ? (
              <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </NavLink>

          {isAdmin ? (
            <NavLink to="/app/reports" className="jj-nav-link text-sm">
              Reports
            </NavLink>
          ) : null}

          <NavLink to="/app/sessions" className="jj-nav-link text-sm">
            Sessions
          </NavLink>
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-slate-500 sm:inline">{user?.username}</span>
          <Button variant="secondary" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
