import { useState } from "react";
import { ratingsApi } from "../../api/ratings.api";
import { useToast } from "../../context/ToastContext";
import { ApiError } from "../../lib/http";
import { useAsync } from "../../hooks/useAsync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { RatingStars } from "../ui/RatingStars";

/**
 * Profile rating (Spec §8).
 *
 * Shows the aggregate summary (count, average, distribution) computed by the
 * server and lets the caller submit 1-5. The summary is reloaded after a
 * submission so the displayed statistics always come from the database rather
 * than being recomputed on the client.
 */
export function RatingPanel({ profileId }: { profileId: string }) {
  const toast = useToast();
  const summary = useAsync((signal) => ratingsApi.summary(profileId, signal), [profileId]);
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (score < 1) {
      toast.info("Choose a score from 1 to 5 first.");
      return;
    }
    setBusy(true);
    try {
      await ratingsApi.set(profileId, score);
      toast.success(`Rated ${score}/5.`);
      summary.reload();
    } catch (caught) {
      toast.error("Could not save the rating", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await ratingsApi.remove(profileId);
      setScore(0);
      toast.info("Your rating was removed.");
      summary.reload();
    } catch (caught) {
      toast.error("Could not remove the rating", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const data = summary.data?.summary;

  return (
    <Card title="Rating">
      {summary.status === "loading" ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5 text-brand-600" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <RatingStars value={data?.average ?? 0} readOnly size="lg" label="Average rating" />
            <div className="text-sm text-slate-600">
              <p className="font-semibold text-slate-800">
                {data?.average !== null && data?.average !== undefined ? data.average.toFixed(2) : "No ratings yet"}
              </p>
              <p>{data?.count ?? 0} rating{(data?.count ?? 0) === 1 ? "" : "s"}</p>
            </div>
          </div>

          {data && data.count > 0 ? (
            <ul className="flex flex-col gap-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = data.distribution[String(star)] ?? 0;
                const percent = data.count > 0 ? Math.round((count / data.count) * 100) : 0;
                return (
                  <li key={star} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-8">{star}★</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <span className="block h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="w-8 text-right">{count}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="border-t border-slate-200 pt-4">
            <p className="mb-2 text-sm text-slate-600">Your rating</p>
            <div className="flex flex-wrap items-center gap-3">
              <RatingStars value={score} onChange={setScore} label="Your rating" />
              <Button size="sm" loading={busy} onClick={() => void submit()}>
                Save rating
              </Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void clear()}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
