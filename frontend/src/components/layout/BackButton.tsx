import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { Icon } from "./Icon";

/**
 * Explicit "back" control for pages reached from the drawer.
 *
 * The bottom navigation only covers the five primary destinations, so a member
 * who opens a secondary page (preferences, sessions, about) otherwise has to
 * guess that the hardware back button or the brand link is the way out. This
 * always goes one step back in history, and falls back to the dashboard when the
 * page was opened directly (history index 0).
 */
export function BackButton({ to = "/app", label = "Back" }: { to?: string; label?: string }) {
  const navigate = useNavigate();

  function goBack() {
    const state = window.history.state as { idx?: number } | null;
    const index = typeof state?.idx === "number" ? state.idx : 0;
    if (index > 0) navigate(-1);
    else navigate(to, { replace: true });
  }

  return (
    <Button variant="ghost" size="sm" onClick={goBack} icon={<Icon name="back" className="h-4 w-4" />}>
      {label}
    </Button>
  );
}
