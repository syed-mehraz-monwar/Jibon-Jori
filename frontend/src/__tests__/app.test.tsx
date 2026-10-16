import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../components/layout/ErrorBoundary";
import { fakeSupabase, renderApp, seedAuth, seedReferenceData, type Row } from "./test-utils";

/**
 * The application tree, driven by the in-memory Supabase client.
 *
 * These are the route-guard, session and error-boundary behaviours that must not
 * change when the data layer moved from the Express API to Supabase. The data
 * layer itself is covered by the api/mapper/realtime suites.
 */

const profileRow: Row = {
  id: "u1",
  username: "rabby",
  display_name: "Rabby Ahmed",
  dob: "1995-04-04",
  gender: "male",
  marital_status: "never_married",
  city: "Dhaka",
  country: "Bangladesh",
  is_public: true,
  photo_visibility: "members",
  completeness: 62,
  role: "member",
  is_suspended: false,
  deleted_at: null,
  location_consent: false,
  show_exact_location: false,
  lifestyle: {},
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-03T00:00:00.000Z",
};

function seedAuthenticatedShell(): void {
  seedAuth(profileRow);
  seedReferenceData();
}

describe("public routes", () => {
  it("renders the landing page for an anonymous visitor", async () => {
    renderApp("/");

    expect(
      await screen.findByRole("heading", { name: /Find a partner with reasons/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create an account/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign in/ })).toBeInTheDocument();
  });

  it("renders the not-found page for an unknown route", async () => {
    renderApp("/nope");

    expect(await screen.findByText("This page does not exist")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to home/ })).toBeInTheDocument();
  });

  it("redirects a protected route to sign-in instead of rendering it", async () => {
    renderApp("/app/search");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("validates the sign-in form before calling the API", async () => {
    const signIn = vi.spyOn(fakeSupabase.auth, "signInWithPassword");
    const actor = userEvent.setup();
    renderApp("/login");

    await actor.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter your email address/);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows a rejected sign-in as an error message", async () => {
    fakeSupabase.state.auth.credentials = { email: "rabby@example.com", password: "correct" };
    const actor = userEvent.setup();
    renderApp("/login");

    await actor.type(await screen.findByLabelText(/Email address/), "rabby@example.com");
    await actor.type(screen.getByLabelText(/Password/), "wrong-password");
    await actor.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/);
  });
});

describe("authenticated application shell", () => {
  it("restores a persisted session and renders the dashboard", async () => {
    seedAuthenticatedShell();
    renderApp("/app");

    expect(await screen.findByRole("heading", { name: /Welcome, rabby/ })).toBeInTheDocument();
    expect(await screen.findByText("Rabby Ahmed")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("JibonJori");
  });

  it("shows a spinner while the session is being rehydrated rather than flashing sign-in", () => {
    seedAuthenticatedShell();
    renderApp("/app");

    expect(screen.getByText("Restoring your session")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("shows the sign-in screen when no session is stored", async () => {
    // No seedAuth: `getSession` reports nothing, so the shell stays anonymous.
    renderApp("/app");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("signs out and returns to the sign-in page", async () => {
    seedAuthenticatedShell();
    const actor = userEvent.setup();
    renderApp("/app");

    await actor.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument());
  });

  it("marks the profile as not yet created on a 404 rather than showing a broken card", async () => {
    seedAuthenticatedShell();
    // The account exists, but its profile row was never created.
    fakeSupabase.state.tables.profiles = [];
    renderApp("/app");

    expect(await screen.findByText("Your profile is not created yet")).toBeInTheDocument();
  });
});

describe("error boundary", () => {
  function Boom(): never {
    throw new Error("render exploded");
  }

  it("renders a recoverable screen instead of a blank page when a route crashes", () => {
    // React logs the caught error itself; the boundary reports it too.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to home" })).toBeInTheDocument();
    // The internal error must not be shown to the user.
    expect(screen.queryByText(/render exploded/)).toBeNull();

    spy.mockRestore();
  });
});
