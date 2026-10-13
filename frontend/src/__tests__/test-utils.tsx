import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { AuthProvider } from "../context/AuthContext";
import { ReferenceDataProvider } from "../context/ReferenceDataContext";
import { SocketProvider } from "../context/SocketContext";
import { ToastProvider } from "../context/ToastContext";
import { fakeSupabase, seedAuth, type Row } from "./fake-supabase";

/**
 * Renders the real application tree (same provider order as `src/main.tsx`) at a
 * route, so a test exercises the actual routing, guards and contexts rather than
 * a simplified harness.
 */
export function renderApp(
  initialPath = "/",
  options: { state?: unknown } = {}
): RenderResult {
  const entry = options.state ? { pathname: initialPath, state: options.state } : initialPath;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <ReferenceDataProvider>
              <App />
            </ReferenceDataProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

export { fakeSupabase, seedAuth };
export type { Row };

/** Seeds the reference tables every authenticated page reads. */
export function seedReferenceData(): void {
  fakeSupabase.state.tables.education_levels = [
    { id: "e1", slug: "bsc", label: "BSc", tier: 3 },
  ];
  fakeSupabase.state.tables.professions = [
    { id: "pr1", slug: "engineer", label: "Engineer", tier: 3 },
  ];
  fakeSupabase.state.tables.interests = [{ id: "i1", slug: "music", label: "Music" }];
  fakeSupabase.state.tables.notifications = [];
}
