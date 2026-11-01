/** Where the new-password form lives. */
export const RECOVERY_PATH = "/reset-password";

/**
 * Recognises a Supabase password-recovery URL.
 *
 * Supabase puts the recovery result in the URL fragment, for example
 * `#access_token=...&type=recovery` on success or
 * `#error=access_denied&error_code=otp_expired` on an expired link.
 */
export function isRecoveryLocation(hash: string): boolean {
  if (!hash) return false;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("type") === "recovery" || params.has("error_code");
}

/**
 * Moves a recovery landing page onto the reset route *before* React Router
 * mounts, so a link that points at the Site URL root still opens the form
 * rather than the dashboard. The fragment is preserved: supabase-js reads it to
 * establish the short-lived recovery session.
 */
export function routeRecoveryFragment(): void {
  if (typeof window === "undefined") return;
  if (!isRecoveryLocation(window.location.hash)) return;
  if (window.location.pathname === RECOVERY_PATH) return;
  window.history.replaceState(null, "", `${RECOVERY_PATH}${window.location.hash}`);
}
