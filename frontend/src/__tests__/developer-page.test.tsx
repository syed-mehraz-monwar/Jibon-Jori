import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, renderApp, seedAuth, seedReferenceData, type Row } from "./test-utils";

const usernameAvailability = vi.hoisted(() => vi.fn());

vi.mock("../api/auth.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth.api")>();
  return { ...actual, authApi: { ...actual.authApi, usernameAvailability } };
});

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

describe("DeveloperPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSupabase.state.tables.feedback = [];
  });

  it("redirects an anonymous visitor to the sign-in screen", async () => {
    renderApp("/app/developer");

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("renders one card per teacher requirement with its honest status", async () => {
    seedAuth(profileRow);
    seedReferenceData();
    renderApp("/app/developer");

    expect(await screen.findByRole("heading", { name: "Teacher evaluation hub" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(14);
    expect(screen.getAllByText("Implemented · automated tests passed")).toHaveLength(14);
  });

  it("links each contextual demonstration into the real feature screen", async () => {
    seedAuth(profileRow);
    seedReferenceData();
    renderApp("/app/developer");

    expect(await screen.findByRole("link", { name: /Open the GraphQL lab/ })).toHaveAttribute(
      "href",
      "/app/developer/graphql"
    );
    expect(screen.getByRole("link", { name: /Open the rating screen/ })).toHaveAttribute("href", "/app/feedback");
    expect(screen.getByRole("link", { name: /Open the About page/ })).toHaveAttribute("href", "/app/about");
  });

  it("runs the live username availability check and reports the result", async () => {
    seedAuth(profileRow);
    seedReferenceData();
    usernameAvailability.mockResolvedValue({ username: "rabby_demo", available: true, reason: "ok" });
    const actor = userEvent.setup();
    renderApp("/app/developer");

    const input = await screen.findByLabelText("Username to check");
    await actor.type(input, "rabby_demo");
    await actor.click(screen.getByRole("button", { name: "Check availability" }));

    await waitFor(() => expect(usernameAvailability).toHaveBeenLastCalledWith("rabby_demo"));
    expect(await screen.findByText("Available")).toBeInTheDocument();
  });

  it("shows the live session posture instead of assuming a session", async () => {
    seedAuth(profileRow);
    seedReferenceData();
    renderApp("/app/developer");

    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    expect(screen.getByText("rabby")).toBeInTheDocument();
  });
});
