import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { runBackHandlers } from "../lib/backstack";

/**
 * Android hardware back button.
 *
 * Order of precedence, which is what a native Android app does:
 *   1. An open overlay (modal, drawer) closes itself — it pushes a handler onto
 *      the back stack while it is open.
 *   2. There is web history to go back to, so go back.
 *   3. We are already at the shell root, so the second press within two seconds
 *      exits; the first press explains that.
 *
 * Without a listener Capacitor treats every back press at the root as "exit",
 * which is exactly the reported bug (back left the app from any nested page).
 */
export function useAndroidBackButton(rootPath = "/app"): void {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;
  const lastPressedRef = useRef(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;

    void CapacitorApp.addListener("backButton", () => {
      if (runBackHandlers()) return;

      const state = window.history.state as { idx?: number } | null;
      const index = typeof state?.idx === "number" ? state.idx : 0;
      if (index > 0) {
        navigate(-1);
        return;
      }

      if (locationRef.current !== rootPath) {
        navigate(rootPath, { replace: true });
        return;
      }

      const now = Date.now();
      if (now - lastPressedRef.current < 2000) {
        void CapacitorApp.exitApp();
        return;
      }
      lastPressedRef.current = now;
      window.dispatchEvent(new CustomEvent("jibonjori:exit-hint"));
    }).then((handle) => {
      if (cancelled) void handle.remove();
      else remove = () => void handle.remove();
    });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [navigate, rootPath]);
}
