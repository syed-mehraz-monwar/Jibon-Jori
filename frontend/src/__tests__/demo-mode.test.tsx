import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, renderApp, seedAuth, seedReferenceData, type Row } from "./test-utils";

const planMock = vi.hoisted(() => vi.fn());
const resetMock = vi.hoisted(() => vi.fn());

vi.mock("../api/demo.api", () => ({
  demoApi: { plan: planMock, reset: resetMock },
}));

const memberRow: Row = {
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

const adminRow: Row = { ...memberRow, role: "admin" };

describe("DemoModePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSupabase.state.tables.feedback = [];
  });

  it("redirects an anonymous visitor to the sign-in screen", async () => {
    renderApp("/app/demo");

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("lists the walkthrough checklist for a signed-in member", async () => {
    seedAuth(memberRow);
    seedReferenceData();
    renderApp("/app/demo");

    expect(await screen.findByRole("heading", { name: "Demo mode" })).toBeInTheDocument();
    expect(screen.getByText("Realtime comments")).toBeInTheDocument();
    expect(screen.getByText("Fictional demo personas")).toBeInTheDocument();
    expect(screen.getByText("Fictional · not real members")).toBeInTheDocument();
    expect(screen.getByText("Arif Rahman")).toBeInTheDocument();
    expect(screen.getByText("Mithila Barua")).toBeInTheDocument();
  });

  it("keeps the demo reset administrator-only and never deletes on a single press", async () => {
    seedAuth(memberRow);
    seedReferenceData();
    renderApp("/app/demo");

    expect(await screen.findByText("Administrator only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset demo content|Press again to confirm/ })).toBeNull();
  });

  it("arms, confirms and runs the marker-scoped demo reset for an administrator", async () => {
    seedAuth(adminRow);
    seedReferenceData();
    planMock.mockResolvedValue([
      { id: "11111111-1111-1111-1111-111111111111", username: "demo_arif", displayName: "Arif Rahman", city: "Dhaka", country: "Bangladesh" },
    ]);
    resetMock.mockResolvedValue({
      deleted: { comments: 2, interactions: 1, ratings: 0, feedback: 0, notifications: 0, chat_conversations: 0 },
    });
    const actor = userEvent.setup();
    renderApp("/app/demo");

    expect(await screen.findByText("Administrator")).toBeInTheDocument();
    expect(await screen.findByText("Arif Rahman")).toBeInTheDocument();

    const resetButton = screen.getByRole("button", { name: "Reset demo content" });
    await actor.click(resetButton);
    expect(await screen.findByRole("button", { name: /Press again to confirm the demo reset/ })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /Press again to confirm the demo reset/ }));

    await waitFor(() => expect(resetMock).toHaveBeenCalled());
  });
});
