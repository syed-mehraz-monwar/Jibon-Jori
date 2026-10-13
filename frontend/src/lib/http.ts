/**
 * The client's error contract.
 *
 * The transport that used to live here (fetch, bearer headers, token refresh) is
 * gone: the application talks directly to Supabase through `getSupabase()`
 * (`src/lib/supabase.ts`), which owns the session. What remains is the shape the
 * UI depends on - `ApiError`, its `isValidation`/`issueFor` helpers, and the
 * unauthorized callback so React state can be dropped when a session dies.
 */

/** A structured error carrying the transport/database `code` and a safe message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: { path: string; message: string }[];

  constructor(
    status: number,
    code: string,
    message: string,
    issues: { path: string; message: string }[] = []
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }

  /** True when the caller can fix the problem by changing their input. */
  get isValidation(): boolean {
    return this.code === "VALIDATION_ERROR";
  }

  issueFor(path: string): string | undefined {
    return this.issues.find((issue) => issue.path === path)?.message;
  }
}

const unauthorizedHandlers = new Set<() => void>();

/** Called when a session is no longer usable and local state must be cleared. */
export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

/** Lets the Supabase layer tell the app that the current session has ended. */
export function notifyUnauthorized(): void {
  for (const handler of unauthorizedHandlers) handler();
}
