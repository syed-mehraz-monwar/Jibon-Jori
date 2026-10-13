import { compatibilityApi } from "../../api/compatibility.api";
import { llmExplanationApi } from "../../api/llm-explanation.api";
import { mlPriorApi } from "../../api/ml-prior.api";
import { useAsync } from "../../hooks/useAsync";
import { useOnDevicePrediction } from "../../hooks/useOnDevicePrediction";
import { toPercent } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { ErrorState } from "../ui/ErrorState";
import { Spinner } from "../ui/Spinner";

const FACTOR_LABELS: Record<string, string> = {
  interests: "Interests",
  education: "Education",
  profession: "Profession",
  educationProfession: "Education & profession",
  location: "Location",
  lifestyle: "Lifestyle",
  partnerPreference: "Partner preference",
};

function FactorBars({
  factors,
  availability,
}: {
  factors: Record<string, number>;
  availability: Record<string, boolean>;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {Object.entries(FACTOR_LABELS).map(([key, label]) => {
        const available = availability[key] ?? false;
        const value = factors[key] ?? 0;
        return (
          <li key={key}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{label}</span>
              <span className={available ? "text-slate-600" : "text-xs text-slate-400"}>
                {available ? toPercent(value) : "not enough data"}
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={available ? "h-full rounded-full bg-brand-500" : "h-full rounded-full bg-slate-300"}
                style={{ width: `${Math.round((available ? value : 0) * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Compatibility, ML prior and LLM explanation for one target profile.
 *
 * The three panels are intentionally separate because they are three different
 * things (`AGENTS.md`): a deterministic score, an optional ML prior, and an
 * optional generated explanation. The ML prior and the explanation are
 * environment-gated on the backend, so when they are disabled this shows the
 * backend's own `fallback.reason` rather than hiding the panel or inventing a
 * value.
 */
export function CompatibilityPanel({ profileId }: { profileId: string }) {
  const compatibility = useAsync((signal) => compatibilityApi.get(profileId, signal), [profileId]);
  const prior = useAsync((signal) => mlPriorApi.get(profileId, signal), [profileId]);
  const explanation = useAsync((signal) => llmExplanationApi.get(profileId, signal), [profileId]);

  // A-12: the compatibility model runs on the device, on the feature vector the API
  // returns. This is computed locally - it never triggers a request of its own.
  const onDevice = useOnDevicePrediction(prior.data?.features);

  if (compatibility.status === "loading") {
    return (
      <Card title="Compatibility">
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      </Card>
    );
  }

  if (compatibility.status === "error") {
    return (
      <Card title="Compatibility">
        <ErrorState error={compatibility.error} onRetry={compatibility.reload} />
      </Card>
    );
  }

  const result = compatibility.data;
  if (!result) return null;

  if (!result.eligibility.eligible) {
    return (
      <Card title="Compatibility">
        <p className="text-sm text-slate-600">
          This pair is not eligible for scoring. Reasons:
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
          {result.eligibility.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </Card>
    );
  }

  const score = result.score;

  return (
    <Card
      title="Compatibility"
      actions={
        result.model.fromCache ? <Badge tone="info">served from cache</Badge> : <Badge tone="neutral">fresh</Badge>
      }
    >
      <div className="flex items-end gap-4">
        <p className="text-4xl font-bold text-brand-700">{toPercent(score?.overall ?? null)}</p>
        <p className="pb-1 text-xs text-slate-500">
          model {result.model.version}
          {result.model.computedAt ? ` · ${new Date(result.model.computedAt).toLocaleString()}` : ""}
        </p>
      </div>

      <div className="mt-5">{score ? <FactorBars factors={score.factors} availability={score.availability} /> : null}</div>

      <div className="mt-5 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">ML prior</h3>
          {prior.status === "loading" ? (
            <p className="text-sm text-slate-500">Checking...</p>
          ) : prior.status === "error" ? (
            <p className="text-sm text-amber-700">Unavailable.</p>
          ) : prior.data?.prior.available ? (
            <p className="text-sm text-slate-600">
              Score {toPercent(prior.data.prior.score)} ({prior.data.prior.modelVersion})
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Not available ({prior.data?.fallback.reason ?? "DISABLED"}). The deterministic score above is
              what the platform uses.
            </p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-800">AI explanation</h3>
          {explanation.status === "loading" ? (
            <p className="text-sm text-slate-500">Checking...</p>
          ) : explanation.status === "error" ? (
            <p className="text-sm text-amber-700">Unavailable.</p>
          ) : explanation.data?.explanation.available ? (
            <p className="whitespace-pre-line text-sm text-slate-600">{explanation.data.explanation.text}</p>
          ) : (
            <p className="text-sm text-slate-500">
              No generated explanation ({explanation.data?.fallback.reason ?? "DISABLED"}). The factor
              breakdown above is the explanation.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4" data-testid="on-device-prediction">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">On-device prediction</h3>
          <Badge tone="neutral">runs in your browser</Badge>
        </div>
        {onDevice.status === "loading" ? (
          <p className="mt-1 text-sm text-slate-500">Loading the model...</p>
        ) : onDevice.status === "unavailable" ? (
          <p className="mt-1 text-sm text-slate-500">
            Not available ({onDevice.reason}). The score above is computed by the server.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            {onDevice.score.toFixed(2)}% computed on this device by {onDevice.modelVersion}, with no
            additional request. The server score above remains the platform&apos;s authoritative value.
          </p>
        )}
      </div>
    </Card>
  );
}
