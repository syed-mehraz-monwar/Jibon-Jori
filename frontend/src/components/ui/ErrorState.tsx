import { ApiError } from "../../lib/http";
import { Button } from "./Button";

/**
 * Renders a failed view with a retry action.
 *
 * Validation issues are not this state's job (they belong on the field), so the
 * message here is the backend's human-readable message, which never contains
 * internal detail for 5xx (see `API_DOCUMENTATION.md` §20).
 */
export function ErrorState({
  error,
  onRetry,
  title = "Something went wrong",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "An unexpected error occurred.";

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4"
    >
      <div>
        <p className="text-sm font-semibold text-red-800">{title}</p>
        <p className="text-sm text-red-700">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
