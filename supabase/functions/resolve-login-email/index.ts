// =============================================================================
// resolve-login-email - maps a username to its sign-in email address.
//
// PREPARED, NOT DEPLOYED. Deploying this creates a username -> email oracle, so
// it requires the project owner's explicit approval first (see §5 below).
// Until it is deployed, the app's login treats a bare username as
// USERNAME_LOGIN_UNAVAILABLE and tells the user to sign in with email.
//
// Contract: POST { username } -> { email }
//
// Why this function exists: `profiles` is readable only by `authenticated`
// callers, so an anonymous client cannot resolve a username itself. This
// function performs the lookup with the service role, server-side, and returns
// ONLY the email string - never a profile row. The client then runs the normal
// `signInWithPassword({ email, password })`, so password verification stays in
// Supabase Auth and this function never sees a password.
//
// 1. Input: `{ username }`, normalized to lower-case, `^[a-z0-9_]{3,32}$`.
// 2. Rate limiting: a best-effort per-IP sliding window (10 lookups / 5 min)
//    plus the gateway's own limits. Rejected callers get 429 RATE_LIMITED.
//    (Module memory is per-isolate, so this is approximate - it raises the
//    cost of enumeration, it does not eliminate it.)
// 3. Lookup: `profiles` by username (service role) -> `auth.admin.getUserById`
//    -> the auth email. Unknown usernames get 404 USERNAME_NOT_FOUND with a
//    generic message; the client maps that to INVALID_CREDENTIALS.
// 4. The email is returned unwrapped: `{ email }`. No profile data, no ids.
// 5. Enumeration note: `username_available` and duplicate-signup detection
//    already reveal whether a username exists, so this oracle adds the email
//    mapping only. If that trade-off is unacceptable, do NOT deploy this and
//    keep the login form email-only.
// =============================================================================

import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";

const WINDOW_MS = 5 * 60 * 1000;
const MAX_LOOKUPS_PER_WINDOW = 10;

// Best-effort per-isolate rate-limit buckets. See §2 above.
const buckets = new Map<string, number[]>();

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "unknown"
  );
}

function checkRateLimit(request: Request): void {
  const key = clientIp(request);
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= MAX_LOOKUPS_PER_WINDOW) {
    throw new HttpError(429, "RATE_LIMITED", "Too many username lookups. Wait a few minutes and try again.");
  }
  recent.push(now);
  buckets.set(key, recent);
}

Deno.serve(
  handler(async (request) => {
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    }
    checkRateLimit(request);

    const { username } = await readJson<{ username?: unknown }>(request);
    const normalized = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,32}$/.test(normalized)) {
      throw new HttpError(400, "VALIDATION_ERROR", "Enter a valid username.");
    }

    const service = serviceClient();
    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("id")
      .eq("username", normalized)
      .maybeSingle();

    if (profileError) {
      console.error(`resolve-login-email: profile lookup failed: ${profileError.message}`);
      throw new HttpError(500, "LOOKUP_FAILED", "The username could not be resolved. Please try again.");
    }
    if (!profile) {
      throw new HttpError(404, "USERNAME_NOT_FOUND", "That username and password do not match.");
    }

    const { data: authUser, error: authError } = await service.auth.admin.getUserById(
      (profile as { id: string }).id,
    );
    if (authError || !authUser?.user?.email) {
      console.error(
        `resolve-login-email: auth lookup failed: ${authError?.message ?? "no email on auth user"}`,
      );
      throw new HttpError(500, "LOOKUP_FAILED", "The username could not be resolved. Please try again.");
    }

    return json(request, { email: authUser.user.email });
  }),
);
