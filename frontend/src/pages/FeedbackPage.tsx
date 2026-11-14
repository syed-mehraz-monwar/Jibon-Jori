import { useEffect, useState } from "react";
import { feedbackApi } from "../api/feedback.api";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../hooks/useAsync";
import { formatDateTime } from "../lib/format";
import { ApiError } from "../lib/http";
import { BackButton } from "../components/layout/BackButton";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { ErrorState } from "../components/ui/ErrorState";
import { RatingStars } from "../components/ui/RatingStars";
import { Spinner } from "../components/ui/Spinner";
import { Textarea } from "../components/ui/Textarea";

const MAX_FEEDBACK_LENGTH = 2000;

/**
 * Teacher evaluation: app-experience star feedback (spec §4).
 *
 * Separate from the match-level `ratings` table: here the member rates the
 * JibonJori experience itself. The score is an integer 1..5 and the optional
 * written feedback is bounded. The backend owns the one-rating-per-member
 * upsert and the owner-only read/delete, so the UI only submits a valid score.
 */
export function FeedbackPage() {
  const toast = useToast();
  const { data: existing, status: loadStatus, error, reload } = useAsync(() => feedbackApi.getMine(), []);
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Adopt an existing rating once the owner-only read resolves.
  useEffect(() => {
    if (existing) {
      setScore(existing.score);
      setFeedback(existing.feedback ?? "");
      setJustSaved(false);
    }
  }, [existing]);

  async function submit(nextScore: number, nextFeedback: string) {
    setSaving(true);
    setJustSaved(false);
    try {
      const saved = await feedbackApi.submit({ score: nextScore, feedback: nextFeedback });
      setScore(saved.score);
      setFeedback(saved.feedback ?? "");
      setJustSaved(true);
      toast.success("Thanks! Your feedback was saved.");
      reload();
    } catch (caught) {
      toast.error("Could not save your feedback", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await feedbackApi.remove();
      setScore(null);
      setFeedback("");
      toast.success("Your feedback was removed.");
      reload();
    } catch (caught) {
      toast.error("Could not remove your feedback", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setDeleting(false);
    }
  }

  if (loadStatus === "loading") {
    return (
      <>
        <PageHeader title="Rate the app" />
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      </>
    );
  }

  if (loadStatus === "error") {
    return (
      <>
        <PageHeader title="Rate the app" />
        <ErrorState error={error} onRetry={reload} />
      </>
    );
  }

  const value = score ?? 0;
  const canSubmit = !saving && (score ?? 0) >= 1 && feedback.trim().length <= MAX_FEEDBACK_LENGTH;

  return (
    <>
      <PageHeader
        title="Rate the app"
        description="Your optional 1–5 star rating of the JibonJori experience, with a short private comment. It is stored against your own account only."
        actions={<BackButton to="/app" label="Back to home" />}
      />

      <div className="mx-auto max-w-2xl space-y-5">
        <Card title="Your rating">
          <div className="space-y-4">
            <RatingStars
              value={value}
              onChange={setScore}
              size="lg"
              label="App experience rating"
            />

            <Field
              label="Optional feedback"
              htmlFor="feedback-text"
              hint={`${feedback.trim().length}/${MAX_FEEDBACK_LENGTH} characters`}
              error={
                feedback.trim().length > MAX_FEEDBACK_LENGTH
                  ? "Feedback must be 2000 characters or fewer."
                  : null
              }
            >
              <Textarea
                id="feedback-text"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                maxLength={MAX_FEEDBACK_LENGTH}
                rows={4}
                placeholder="What worked well or could be better?"
                disabled={saving}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                loading={saving}
                disabled={!canSubmit}
                onClick={() => void submit(score ?? 1, feedback)}
              >
                {existing ? "Update rating" : "Submit rating"}
              </Button>
              {justSaved ? <span className="text-sm font-medium text-emerald-600">Saved.</span> : null}
            </div>
          </div>
        </Card>

        {existing ? (
          <Card title="Your submitted rating">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <RatingStars value={existing.score} readOnly size="lg" label="Your previous rating" />
                <span className="text-sm text-slate-500">
                  {existing.createdAt ? `Submitted ${formatDateTime(existing.createdAt)}` : ""}
                </span>
              </div>

              {existing.feedback ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {existing.feedback}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" onClick={() => setScore(existing.score)}>
                  Change rating
                </Button>
                <Button type="button" variant="danger" loading={deleting} onClick={() => void remove()}>
                  Delete feedback
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        <p className="text-xs leading-relaxed text-slate-500">
          Ratings are private to your account. They are not shown publicly and are never mixed with the
          match-level ratings members give one another.
        </p>
      </div>
    </>
  );
}
