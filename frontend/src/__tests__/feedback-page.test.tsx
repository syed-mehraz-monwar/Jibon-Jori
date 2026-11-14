import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase, renderApp, seedAuth, seedReferenceData, type Row } from "./test-utils";

const feedbackApi = vi.hoisted(() => ({
  getMine: vi.fn(),
  submit: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../api/feedback.api", () => ({
  feedbackApi: {
    getMine: feedbackApi.getMine,
    submit: feedbackApi.submit,
    remove: feedbackApi.remove,
  },
}));

const existingFeedbackRow: Row = {
  id: "f1",
  rater_profile_id: "u1",
  score: 4,
  feedback: "Great experience so far.",
  created_at: "2026-01-05T00:00:00.000Z",
  updated_at: "2026-01-05T00:00:00.000Z",
};

function seedNoFeedback(): void {
  fakeSupabase.state.tables.feedback = [];
}

describe("FeedbackPage", () => {
  it("redirects an anonymous visitor away from the feedback route", async () => {
    renderApp("/app/feedback");

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("renders the star rating for a member with no prior feedback and submits one", async () => {
    seedAuth();
    seedReferenceData();
    seedNoFeedback();
    feedbackApi.getMine.mockResolvedValue(null);
    feedbackApi.submit.mockResolvedValue({
      id: "f2",
      raterProfileId: "u1",
      score: 5,
      feedback: null,
      createdAt: "2026-01-06T00:00:00.000Z",
      updatedAt: "2026-01-06T00:00:00.000Z",
    });
    const actor = userEvent.setup();
    renderApp("/app/feedback");

    const stars = await screen.findByRole("radiogroup", { name: "App experience rating" });
    expect(stars).toBeInTheDocument();

    await actor.click(screen.getByRole("radio", { name: "5 of 5" }));
    await actor.click(screen.getByRole("button", { name: "Submit rating" }));

    await waitFor(() => expect(feedbackApi.submit).toHaveBeenCalledTimes(1));
    expect(feedbackApi.submit).toHaveBeenCalledWith({ score: 5, feedback: "" });
  });

  it("shows the member's own rating and allows updating it", async () => {
    seedAuth();
    seedReferenceData();
    fakeSupabase.state.tables.feedback = [existingFeedbackRow];
    feedbackApi.getMine.mockResolvedValue({
      id: "f1",
      raterProfileId: "u1",
      score: 4,
      feedback: "Great experience so far.",
      createdAt: "2026-01-05T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
    const actor = userEvent.setup();
    renderApp("/app/feedback");

    expect(await screen.findByText("Great experience so far.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change rating" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete feedback" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Change rating" }));
    await actor.click(screen.getByRole("radio", { name: "2 of 5" }));
    await actor.click(screen.getByRole("button", { name: "Update rating" }));

    await waitFor(() => expect(feedbackApi.submit).toHaveBeenCalledTimes(1));
    expect(feedbackApi.submit).toHaveBeenCalledWith({ score: 2, feedback: "Great experience so far." });
  });

  it("asks for a score before submitting and disables the submit action without one", async () => {
    seedAuth();
    seedReferenceData();
    seedNoFeedback();
    feedbackApi.getMine.mockResolvedValue(null);
    renderApp("/app/feedback");

    expect(await screen.findByRole("radiogroup", { name: "App experience rating" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit rating" })).toBeDisabled();
  });

  it("deletes the member's own feedback", async () => {
    seedAuth();
    seedReferenceData();
    fakeSupabase.state.tables.feedback = [existingFeedbackRow];
    feedbackApi.getMine.mockResolvedValue({
      id: "f1",
      raterProfileId: "u1",
      score: 4,
      feedback: "Great experience so far.",
      createdAt: "2026-01-05T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
    feedbackApi.remove.mockResolvedValue(undefined);
    const actor = userEvent.setup();
    renderApp("/app/feedback");

    expect(await screen.findByRole("button", { name: "Delete feedback" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Delete feedback" }));

    await waitFor(() => expect(feedbackApi.remove).toHaveBeenCalledTimes(1));
  });
});
