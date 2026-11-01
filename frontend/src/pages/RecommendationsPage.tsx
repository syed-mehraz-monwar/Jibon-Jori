import { matchesApi } from "../api/matches.api";
import { referenceApi } from "../api/reference.api";
import { useAsync } from "../hooks/useAsync";
import { toPercent } from "../lib/format";
import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { ProfileCard } from "../components/discovery/ProfileCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";

const PAGE_SIZE = 5;

/**
 * AI-assisted recommendations (Spec §1).
 *
 * The recommendation endpoint returns ranked profile *ids* with the computed
 * score and model metadata, but no display fields. So the ranking is joined here
 * with a directory lookup (a no-filter search) to render names and photos. That
 * join is a client-side workaround for the current API shape and is noted in
 * `FRONTEND_DOCUMENTATION.md`; entries that fall outside the directory window are
 * still listed with their score and a link.
 */
export function RecommendationsPage() {
  const [page, setPage] = useState(1);

  const recommendations = useAsync(
    (signal) => matchesApi.recommendations({ page, limit: PAGE_SIZE }, signal),
    [page]
  );
  const directory = useAsync(
    (signal) => referenceApi.searchProfiles({ page: 1, limit: 50 }, signal),
    []
  );

  if (recommendations.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (recommendations.status === "error") {
    return (
      <>
        <PageHeader title="Recommended matches" />
        <ErrorState error={recommendations.error} onRetry={recommendations.reload} />
      </>
    );
  }

  const data = recommendations.data;
  const byId = new Map((directory.data?.searchProfiles.profiles ?? []).map((item) => [item.id, item]));

  return (
    <>
      <PageHeader
        title="Recommended matches"
        description="Ranked by the deterministic compatibility model. Each score is explainable factor by factor."
      />

      {data?.candidatePoolTruncated ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The candidate pool was capped, so this ranking covers a bounded pool rather than every member.
        </p>
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(data.weights).map(([factor, weight]) => (
              <Badge key={factor} tone="neutral">
                {factor}: {Math.round(weight * 100)}%
              </Badge>
            ))}
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((item) => {
              const profile = byId.get(item.profileId);
              return (
                <li key={item.profileId}>
                  {profile ? (
                    <ProfileCard profile={profile} score={item.score.overall} />
                  ) : (
                    <Card className="h-full">
                      <p className="text-sm font-medium text-slate-800">
                        Match score {toPercent(item.score.overall)}
                      </p>
                      <p className="mt-1 break-all text-xs text-slate-500">Profile {item.profileId}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        {item.model.fromCache ? "Cached score" : "Freshly computed"} &middot; model{" "}
                        {item.model.version}
                      </p>
                    </Card>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-6">
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              total={data.pagination.total}
              onChange={setPage}
            />
          </div>
        </>
      ) : (
        <EmptyState
          title="No recommendations yet"
          description="Complete your profile and partner preferences so compatibility can be computed."
          action={
            <Button variant="secondary" onClick={recommendations.reload}>
              Refresh
            </Button>
          }
        />
      )}
    </>
  );
}
