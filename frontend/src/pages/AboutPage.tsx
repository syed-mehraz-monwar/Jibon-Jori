import { useState } from "react";
import { curatedApi } from "../api/curated.api";
import { useAsync } from "../hooks/useAsync";
import { env } from "../lib/env";
import { PageHeader } from "../components/layout/PageHeader";
import { BackButton } from "../components/layout/BackButton";
import { AudioVideoEmbed, type VideoEntry } from "../components/media/AudioVideoEmbed";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";

const PAGE_SIZE = 5;

/**
 * About the platform.
 *
 * Replaces the old "Learn" screen, which presented a hard-coded YouTube demo
 * clip as if it were curated content. This page states plainly what the
 * application does, how matches are produced, who built it, and how data is
 * protected — and it still satisfies the embedded audio/video requirement by
 * playing *real* curated rows from `curated_videos`, with an honest empty state
 * when an administrator has not published anything.
 */
export function AboutPage() {
  const [page, setPage] = useState(1);
  const catalogue = useAsync(
    (signal) => curatedApi.list({ page, limit: PAGE_SIZE }, signal),
    [page]
  );

  const configured: VideoEntry[] = env.youtubeVideoIds.map((id) => ({
    id,
    title: `Video ${id}`,
  }));

  const curated: VideoEntry[] = (catalogue.data?.videos ?? []).map((video) => ({
    id: video.youtubeId,
    title: video.title,
    description: video.description ?? undefined,
  }));

  const seen = new Set(curated.map((video) => video.id));
  const videos = [...curated, ...configured.filter((video) => !seen.has(video.id))];

  const totalPages = catalogue.data?.pagination.totalPages ?? 1;
  const attribution = [env.developerName, env.developerId, env.institution, env.courseName].filter(
    (value) => value.length > 0
  );

  return (
    <>
      <PageHeader
        title="About JibonJori"
        description="An AI-assisted matrimony platform for building an honest profile and finding compatible partners."
        actions={<BackButton />}
      />

      <div className="grid gap-4">
        <Card title="What this app does">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            <li>Create a matrimonial profile with verified email or phone ownership.</li>
            <li>Search and filter discoverable members, then view a compatibility breakdown.</li>
            <li>Like, favourite, rate and comment on profiles in real time.</li>
            <li>Receive rule-based match suggestions with a written explanation from the assistant.</li>
            <li>Control exactly who sees each sensitive field: photo, biodata, blood group and social links.</li>
          </ul>
        </Card>

        <Card title="How matching works">
          <p className="text-sm leading-relaxed text-slate-600">
            Compatibility is calculated on the server from the preferences and profile data you
            actually entered — age, gender, education, profession, location and interests. The score
            is deterministic: the same two profiles always produce the same number, and every
            component is shown so you can see why a match scored the way it did. The language model
            writes the explanation of that score; it never invents the score itself and never reads
            the database directly.
          </p>
        </Card>

        <Card title="Your privacy">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            <li>Row level security in PostgreSQL decides which rows you may read or write.</li>
            <li>Private fields are masked in the database before they reach another member.</li>
            <li>Exact location is only shared when you tick the consent box in your profile.</li>
            <li>Passwords are stored only as hashes; sessions can be reviewed and revoked.</li>
          </ul>
        </Card>

        <Card title="Developed by">
          {attribution.length > 0 ? (
            <dl className="grid gap-2 text-sm">
              {env.developerName ? (
                <div className="flex flex-wrap gap-1">
                  <dt className="font-medium text-slate-800">Developer:</dt>
                  <dd className="text-slate-600">{env.developerName}</dd>
                </div>
              ) : null}
              {env.developerId ? (
                <div className="flex flex-wrap gap-1">
                  <dt className="font-medium text-slate-800">Student ID:</dt>
                  <dd className="text-slate-600">{env.developerId}</dd>
                </div>
              ) : null}
              {env.institution ? (
                <div className="flex flex-wrap gap-1">
                  <dt className="font-medium text-slate-800">Institution:</dt>
                  <dd className="text-slate-600">{env.institution}</dd>
                </div>
              ) : null}
              {env.courseName ? (
                <div className="flex flex-wrap gap-1">
                  <dt className="font-medium text-slate-800">Course:</dt>
                  <dd className="text-slate-600">{env.courseName}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-slate-600">
              Built as a course project by the JibonJori team. Developer, student ID, institution and
              course are configured at deploy time and are not committed to the repository.
            </p>
          )}
        </Card>

        <Card title="Watch and learn">
          <p className="mb-3 text-sm text-slate-600">
            Relationship, marriage and profile-building videos curated by the administrators. The
            player is created only after you press play, and it uses{" "}
            <code className="rounded bg-slate-100 px-1">youtube-nocookie.com</code> so no tracking
            cookie is set before you choose to watch.
          </p>

          {catalogue.status === "loading" && videos.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-7 w-7 text-brand-600" />
            </div>
          ) : null}

          {catalogue.status === "error" ? (
            <ErrorState error={catalogue.error} onRetry={catalogue.reload} />
          ) : null}

          {catalogue.status !== "loading" && videos.length === 0 ? (
            <EmptyState
              title="No videos published yet"
              description="Nothing has been curated for this deployment yet, so there is nothing to play. An administrator can publish videos from the curated_videos table."
            />
          ) : null}

          {videos.length > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone={catalogue.status === "success" ? "success" : "neutral"}>
                  {catalogue.status === "success" ? "Live catalogue" : "Deployment list"}
                </Badge>
                <span className="text-xs text-slate-500">
                  Page {page} of {Math.max(totalPages, 1)}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {videos.map((video) => (
                  <AudioVideoEmbed key={video.id} video={video} height={200} />
                ))}
              </div>

              {totalPages > 1 ? (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-slate-600">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
