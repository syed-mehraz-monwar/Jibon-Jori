import { useReferenceData } from "../../context/ReferenceDataContext";
import { Button } from "../ui/Button";

/**
 * Global reference-data failure banner.
 *
 * Shown once the shell learns that the dropdown option sets (education levels,
 * professions, interests, ...) failed to load. The provider owns the retry state
 * and keeps the last good or empty data, so the retry simply re-runs the load;
 * individual pages that have their own field-level fallbacks keep working off the
 * empty state until the retry succeeds.
 */
export function ReferenceDataBanner() {
  const { status, error, reload } = useReferenceData();

  if (status !== "error") return null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        Some dropdown options could not be loaded{error ? `: ${error}` : "."} Your existing selections
        are kept; forms may show incomplete choices until the next load succeeds.
      </span>
      <Button variant="secondary" size="sm" onClick={reload}>
        Retry
      </Button>
    </div>
  );
}
