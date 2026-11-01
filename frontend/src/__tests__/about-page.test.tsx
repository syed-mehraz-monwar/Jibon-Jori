import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AboutPage } from "../pages/AboutPage";

/**
 * The About page now owns the embedded audio/video requirement (formerly the
 * "Learn" screen). It must render *real* curated rows, say honestly that
 * nothing has been published when the catalogue is empty (no demo clip), and
 * surface a failed request instead of rendering a blank page.
 *
 * The page uses the shared `BackButton`, which needs a router, so every render
 * is wrapped in a `MemoryRouter`.
 */
const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("../api/curated.api", () => ({
  curatedApi: { list: apiMocks.list },
}));

function video(id: string, title: string, description: string | null = null) {
  return {
    id: `uuid-${id}`,
    youtubeId: id,
    title,
    description,
    category: "marriage",
    createdAt: "2026-09-26T00:00:00.000Z",
  };
}

function renderAbout() {
  return render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  apiMocks.list.mockReset();
});

describe("AboutPage", () => {
  it("renders the curated catalogue returned by the API", async () => {
    apiMocks.list.mockResolvedValue({
      videos: [video("dQw4w9WgXcQ", "Marriage preparation"), video("aqz-KE-bpKQ", "Building trust")],
      pagination: { page: 1, limit: 5, total: 2, totalPages: 1 },
    });

    renderAbout();

    await waitFor(() => {
      expect(screen.getByText("Marriage preparation")).toBeInTheDocument();
    });
    expect(screen.getByText("Building trust")).toBeInTheDocument();
    expect(screen.getByText("Live catalogue")).toBeInTheDocument();
    // No third-party frame is created before the user presses play.
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("says nothing is published instead of showing a demo clip", async () => {
    apiMocks.list.mockResolvedValue({
      videos: [],
      pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
    });

    renderAbout();

    await waitFor(() => {
      expect(screen.getByText("No videos published yet")).toBeInTheDocument();
    });
    expect(screen.queryByText("Embedded player demonstration")).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("surfaces a failed catalogue request instead of rendering nothing", async () => {
    apiMocks.list.mockRejectedValue(new Error("network down"));

    renderAbout();

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  it("falls back to a neutral team line when no attribution is configured", () => {
    apiMocks.list.mockResolvedValue({
      videos: [],
      pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
    });

    renderAbout();

    expect(screen.getByText(/Built as a course project by the JibonJori team/i)).toBeInTheDocument();
  });
});
