import { useState } from "react";
import { curatedApi } from "../api/curated.api";
import { useAsync } from "../hooks/useAsync";
import { env } from "../lib/env";
import { PageHeader } from "../components/layout/PageHeader";
import { AudioVideoEmbed, type VideoEntry } from "../components/media/AudioVideoEmbed";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";
import { Reveal } from "../components/ui/Reveal";

/** YouTube's own public demo asset, used only to show the embed works. */
const DEMO_VIDEO: VideoEntry = {
  id: "M7lc1UVf-VE",
  title: "Embedded player demonstration",
  description:
    "A public demo clip. Administrators can curate real relationship, marriage and educational videos.",
};

const PAGE_SIZE = 12;

/**
 * Embedded audio/video (Spec 14).
 *
 * The catalogue comes from `/api/curated-videos`, i.e. from real application data, and
 * the player is the click-to-load `AudioVideoEmbed` - so the player is created only
 * after the user presses play and no third-party request happens on page load. No API
 * key or SDK is needed, which is what `architecture.txt` section 35 requires.
 *
 * `VITE_YOUTUBE_VIDEO_IDS` remains supported as a deployment-time supplement for
 * environments where the catalogue has not been populated yet. When neither source has
 * content the page shows one clearly-labelled demo embed rather than presenting
 * unrelated videos as curated matrimonial material.
 */
export function LearnPage() {
  const [page, setPage] = useState(1);
  const catalogue = useAsync(
    (signal) => curatedApi.list({ page, limit: PAGE_SIZE }, signal),
    [page]
  );

  const configured: VideoEntry[] = env.youtubeVideoIds.map((id) => ({
    id,
    title: `Video ${id}`,
  }));

  const curatedVideos: VideoEntry[] = (catalogue.data?.videos ?? []).map((video) => ({
    id: video.youtubeId,
    title: video.title,
    description: video.description ?? undefined,
  }));

  // Real catalogue first, then any deployment-configured ids that are not already in it.
  const seen = new Set(curatedVideos.map((video) => video.id));
  const videos = [
    ...curatedVideos,
    ...configured.filter((video) => !seen.has(video.id)),
  ];

  const total = catalogue.data?.pagination.total ?? videos.length;
  const totalPages = catalogue.data?.pagination.totalPages ?? 1;

  return (
    <>
      <PageHeader
        title="Learn and watch"
        description="Relationship, marriage and profile-building videos, embedded without leaving the app."
      />

      {catalogue.status === "loading" && videos.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : null}

      {catalogue.status === "error" ? (
        <ErrorState error={catalogue.error} onRetry={catalogue.reload} />
      ) : null}

      {videos.length === 0 ? (
        <EmptyState
          title="No videos yet"
          description="No curated videos have been published. An administrator can add them, or set VITE_YOUTUBE_VIDEO_IDS at deploy time. One demonstration embed is shown below so the player can be verified."
        />
      ) : null}

      {videos.length === 0 && catalogue.status !== "error" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Reveal>
            <Card>
              <AudioVideoEmbed video={DEMO_VIDEO} />
            </Card>
          </Reveal>
        </div>
      ) : null}

      {videos.length > 0 ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">
              {total} video{total === 1 ? "" : "s"} in the catalogue
            </span>
            {catalogue.status === "success" ? <Badge tone="success">Live catalogue</Badge> : null}
            {configured.length > 0 ? <Badge tone="neutral">Deployment list</Badge> : null}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {videos.map((video, index) => (
              <Reveal key={video.id} delay={index * 0.05}>
                <Card>
                  <AudioVideoEmbed video={video} />
                </Card>
              </Reveal>
            ))}
          </div>

          {totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="text-sm text-slate-600">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <Card className="mt-5" title="How the embeds behave">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>The player is created only after you press play, so no third-party request is made on page load.</li>
          <li><code className="rounded bg-slate-100 px-1">youtube-nocookie.com</code> is used to avoid tracking cookies.</li>
          <li>Each player has a text label, so the embed is usable with a screen reader.</li>
          <li>Only the video id is stored; the YouTube Data API is not required.</li>
        </ul>
      </Card>
    </>
  );
}
