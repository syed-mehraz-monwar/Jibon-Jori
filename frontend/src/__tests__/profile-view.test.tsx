import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeSupabase, renderApp, seedAuth, type Row } from "./test-utils";
import type { SearchProfile } from "../lib/types";

/**
 * The discovery -> profile-view handoff.
 *
 * `ProfileViewPage` has no "profile by id" read: the display fields arrive through
 * router state set by the search/recommendation card, and everything addressable by
 * id (compatibility, ratings, comments) is loaded from its own source. Both paths are
 * asserted here, because the page is the place where a missing id-read could
 * otherwise silently degrade to an empty shell.
 */
const viewer: Row = {
  id: "u1",
  username: "rabby",
  display_name: "Rabby Ahmed",
  gender: "male",
  is_public: true,
  completeness: 50,
  role: "member",
  is_suspended: false,
  deleted_at: null,
  lifestyle: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const searchProfile: SearchProfile = {
  id: "p2",
  displayName: "Nusrat Jahan",
  gender: "female",
  age: 27,
  maritalStatus: "never_married",
  city: "Dhaka",
  district: "Dhaka",
  country: "Bangladesh",
  education: { slug: "msc", label: "MSc" },
  profession: { slug: "doctor", label: "Doctor" },
  incomeBand: null,
  about: "Paediatrician.",
  interests: [{ slug: "music", label: "Music" }],
  primaryPhoto: null,
  completeness: 80,
  createdAt: "2026-01-04T00:00:00.000Z",
};

/** The deterministic scorer's row for the pair, keyed on the two profile factors. */
function seedBackendForPair(): void {
  fakeSupabase.state.rpcs.compatibility_for = () => ({
    profile_a_id: "u1",
    profile_b_id: "p2",
    eligible: true,
    eligibility_reasons: [],
    interests_score: 90,
    education_score: 50,
    profession_score: 50,
    education_profession_score: 50,
    location_score: 50,
    lifestyle_score: 50,
    preference_score: 50,
    interests_available: true,
    education_available: true,
    profession_available: true,
    education_profession_available: true,
    location_available: true,
    lifestyle_available: true,
    preference_available: true,
    overall_score: 74,
    model_version: "deterministic-v1",
    inputs_hash: "hash",
    from_cache: false,
    computed_at: "2026-01-05T00:00:00.000Z",
  });
  fakeSupabase.state.rpcs.compat_canonical_input = () => ({ gender: "female", age: 27, preferences: null });
  fakeSupabase.state.rpcs.rating_summary = () => ({ average: 0, rating_count: 0, distribution: {} });
  fakeSupabase.state.functions["ai-explanation"] = () => ({
    targetProfileId: "p2",
    compatibility: { overall_score: 74, interests_score: 90, education_score: 50, profession_score: 50, location_score: 50, preference_score: 50 },
    explanation: "A strong shared-interests match.",
    model: null,
    fallback: true,
  });
  fakeSupabase.state.tables.comments = [];
  fakeSupabase.state.tables.ml_artifacts = [];
  fakeSupabase.state.tables.ratings = [];
}

describe("discovery to profile-view handoff", () => {
  it("renders the opened profile from router state, with its compatibility", async () => {
    seedAuth(viewer);
    seedBackendForPair();

    renderApp("/app/profiles/p2", { state: { profile: searchProfile } });

    expect(await screen.findByRole("heading", { name: "Nusrat Jahan" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText("Open this profile from a list")).toBeNull();
    expect(await screen.findByText("Interact", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Paediatrician.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Favourite/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText("74%", undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it("explains how to reach a profile when the view is opened directly", async () => {
    seedAuth(viewer);
    seedBackendForPair();

    renderApp("/app/profiles/p2");

    expect(await screen.findByText("Open this profile from a list", undefined, { timeout: 5000 })).toBeInTheDocument();
    // Everything addressable by id is still loaded without the router state.
    expect(await screen.findByText("74%", undefined, { timeout: 5000 })).toBeInTheDocument();
  });
});
