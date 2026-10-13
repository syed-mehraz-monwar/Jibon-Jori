import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LearnPage } from "../pages/LearnPage";

/**
 * Spec section 14: the curated YouTube catalogue page.
 *
 * The page must render real catalogue data from `/api/curated-videos`, fall back to a
 * labelled demo embed when the catalogue is empty, and surface a failed request rather
 * than silently rendering nothing.
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

beforeEach(() => {
  apiMocks.list.mockReset();
});

describe("LearnPage", () => {
  it("renders the curated catalogue returned by the API", async () => {
    apiMocks.list.mockResolvedValue({
      videos: [video("dQw4w9WgXcQ", "Marriage preparation"), video("aqz-KE-bpKQ", "Building trust")],
      pagination: { page: 1, limit: 12, total: 2, totalPages: 1 },
    });

    render(<LearnPage />);

    await waitFor(() => {
      expect(screen.getByText("Marriage preparation")).toBeInTheDocument();
    });
    expect(screen.getByText("Building trust")).toBeInTheDocument();
    expect(screen.getByText("Live catalogue")).toBeInTheDocument();
    expect(screen.getByText("2 videos in the catalogue")).toBeInTheDocument();
    // No third-party frame is created before the user presses play.
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("shows the labelled demo embed when the catalogue is empty", async () => {
    apiMocks.list.mockResolvedValue({
      videos: [],
      pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
    });

    render(<LearnPage />);

    await waitFor(() => {
      expect(screen.getByText("No videos yet")).toBeInTheDocument();
    });
    expect(screen.getByText("Embedded player demonstration")).toBeInTheDocument();
  });

  it("surfaces a failed catalogue request instead of rendering nothing", async () => {
    apiMocks.list.mockRejectedValue(new Error("network down"));

    render(<LearnPage />);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });
});
