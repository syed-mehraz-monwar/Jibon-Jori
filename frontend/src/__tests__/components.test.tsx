import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AudioVideoEmbed } from "../components/media/AudioVideoEmbed";
import { CompatibilityPanel } from "../components/discovery/CompatibilityPanel";
import { RatingStars } from "../components/ui/RatingStars";
import type { CompatibilityResult, ExplanationResult, MlPriorResult } from "../lib/types";

const compatibility: CompatibilityResult = {
  targetProfileId: "p2",
  eligibility: { eligible: true, reasons: [] },
  weights: { interests: 0.2 },
  model: { version: "deterministic-v1", inputsHash: "abc", fromCache: false, computedAt: null },
  score: {
    overall: 0.815,
    factors: {
      interests: 0.9,
      education: 0.5,
      profession: 0,
      educationProfession: 0,
      location: 0,
      lifestyle: 0,
      partnerPreference: 0,
    },
    availability: {
      interests: true,
      education: false,
      profession: false,
      educationProfession: false,
      location: false,
      lifestyle: false,
      partnerPreference: false,
    },
  },
};

const prior: MlPriorResult = {
  targetProfileId: "p2",
  eligibility: { eligible: true, reasons: [] },
  prior: { available: false, modelVersion: null, featureVersion: "v1", score: null },
  features: {},
  fallback: { used: true, reason: "ML_PRIOR_DISABLED" },
};

const explanation: ExplanationResult = {
  targetProfileId: "p2",
  eligibility: { eligible: true, reasons: [] },
  compatibility: { overall: 0.815, factors: {}, availability: {} },
  model: { version: "deterministic-v1", inputsHash: "abc", fromCache: false, computedAt: null },
  mlPrior: { available: false, modelVersion: null, featureVersion: "v1", score: null },
  explanation: { available: false, text: null, providerVersion: null, promptVersion: "v1", generatedAt: null },
  fallback: { used: true, reason: "LLM_EXPLANATION_DISABLED" },
};

const apiMocks = vi.hoisted(() => ({
  compatibilityGet: vi.fn(),
  mlPriorGet: vi.fn(),
  explanationGet: vi.fn(),
}));

vi.mock("../api/compatibility.api", () => ({
  compatibilityApi: { get: apiMocks.compatibilityGet },
}));
vi.mock("../api/ml-prior.api", () => ({
  mlPriorApi: { get: apiMocks.mlPriorGet },
}));
vi.mock("../api/llm-explanation.api", () => ({
  llmExplanationApi: { get: apiMocks.explanationGet },
}));

describe("AudioVideoEmbed", () => {
  it("renders a labelled play control and does not load a third-party frame up front", () => {
    render(<AudioVideoEmbed video={{ id: "dQw4w9WgXcQ", title: "Marriage guidance" }} />);

    expect(screen.getByRole("button", { name: /Play video: Marriage guidance/ })).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText("Marriage guidance")).toBeInTheDocument();
  });

  it("loads the privacy-preserving YouTube embed only after play", async () => {
    const user = userEvent.setup();
    render(
      <AudioVideoEmbed
        video={{ id: "dQw4w9WgXcQ", title: "Marriage guidance", description: "Episode 1" }}
      />
    );

    await user.click(screen.getByRole("button", { name: /Play video/ }));

    const frame = await screen.findByTitle("Marriage guidance");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(frame.getAttribute("allow")).toContain("autoplay");
    expect(screen.getByText("Episode 1")).toBeInTheDocument();
  });

  it("encodes a hostile-looking id instead of interpolating it into the URL", async () => {
    const user = userEvent.setup();
    render(<AudioVideoEmbed video={{ id: 'x" onload="alert(1)', title: "Odd" }} />);

    await user.click(screen.getByRole("button", { name: /Play video/ }));

    const frame = await screen.findByTitle("Odd");
    expect(frame.getAttribute("src")).toContain("x%22%20onload%3D%22");
    expect(frame.getAttribute("src")).not.toContain('onload="');
    expect(frame.getAttribute("onload")).toBeNull();
  });
});

describe("RatingStars", () => {
  it("exposes the value as a radiogroup and reports a selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RatingStars value={0} onChange={onChange} label="Rate this profile" />);

    expect(screen.getByRole("radiogroup", { name: "Rate this profile" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "4 of 5" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("supports arrow-key adjustment", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RatingStars value={3} onChange={onChange} />);

    await user.type(screen.getByRole("radio", { name: "3 of 5" }), "{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("renders a read-only rating as an image with a text alternative", () => {
    render(<RatingStars value={4.6} readOnly label="Average rating 4.6 out of 5" />);
    expect(screen.getByRole("img", { name: "Average rating 4.6 out of 5" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("CompatibilityPanel", () => {
  it("shows the deterministic score, factor bars and the disabled-provider reasons", async () => {
    apiMocks.compatibilityGet.mockResolvedValue(compatibility);
    apiMocks.mlPriorGet.mockResolvedValue(prior);
    apiMocks.explanationGet.mockResolvedValue(explanation);

    render(<CompatibilityPanel profileId="p2" />);

    expect(await screen.findByText("82%")).toBeInTheDocument();
    expect(screen.getByText(/model deterministic-v1/)).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getAllByText("not enough data").length).toBeGreaterThan(0);
    expect(screen.getByText(/Not available \(ML_PRIOR_DISABLED\)/)).toBeInTheDocument();
    expect(screen.getByText(/No generated explanation \(LLM_EXPLANATION_DISABLED\)/)).toBeInTheDocument();
  });

  it("marks a cached score instead of claiming a fresh computation", async () => {
    apiMocks.compatibilityGet.mockResolvedValue({
      ...compatibility,
      model: { ...compatibility.model, fromCache: true, computedAt: "2026-02-01T00:00:00.000Z" },
    });
    apiMocks.mlPriorGet.mockResolvedValue(prior);
    apiMocks.explanationGet.mockResolvedValue(explanation);

    render(<CompatibilityPanel profileId="p2" />);
    expect(await screen.findByText("served from cache")).toBeInTheDocument();
  });

  it("explains an ineligible pair rather than showing a score", async () => {
    apiMocks.compatibilityGet.mockResolvedValue({
      ...compatibility,
      eligibility: { eligible: false, reasons: ["SAME_GENDER", "SELF"] },
      score: null,
    });
    apiMocks.mlPriorGet.mockResolvedValue(prior);
    apiMocks.explanationGet.mockResolvedValue(explanation);

    render(<CompatibilityPanel profileId="p2" />);

    expect(await screen.findByText(/not eligible for scoring/)).toBeInTheDocument();
    expect(screen.getByText("SAME_GENDER")).toBeInTheDocument();
    expect(screen.getByText("SELF")).toBeInTheDocument();
  });

  it("renders a real ML prior and generated explanation when the providers are enabled", async () => {
    apiMocks.compatibilityGet.mockResolvedValue(compatibility);
    apiMocks.mlPriorGet.mockResolvedValue({
      ...prior,
      prior: { available: true, modelVersion: "prior-v1", featureVersion: "v1", score: 0.71 },
      fallback: { used: false, reason: "OK" },
    });
    apiMocks.explanationGet.mockResolvedValue({
      ...explanation,
      explanation: {
        available: true,
        text: "You share an interest in classical music.",
        providerVersion: "stub-v1",
        promptVersion: "v1",
        generatedAt: "2026-02-01T00:00:00.000Z",
      },
      fallback: { used: false, reason: "OK" },
    });

    render(<CompatibilityPanel profileId="p2" />);

    expect(await screen.findByText(/Score 71% \(prior-v1\)/)).toBeInTheDocument();
    expect(screen.getByText("You share an interest in classical music.")).toBeInTheDocument();
  });

  it("shows a retryable error instead of an empty panel when scoring fails", async () => {
    apiMocks.compatibilityGet.mockRejectedValue(new Error("scoring unavailable"));
    apiMocks.mlPriorGet.mockResolvedValue(prior);
    apiMocks.explanationGet.mockResolvedValue(explanation);

    render(<CompatibilityPanel profileId="p2" />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument());
  });
});
