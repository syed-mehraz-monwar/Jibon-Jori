import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { ApiError, notifyUnauthorized } from "./http";

/**
 * The single Supabase client the application talks to.
 *
 * The client is created lazily, never at module import time: unit tests import
 * the api modules with no Supabase env configured, and a throwing import would
 * break every one of them. `getSupabase()` is the only place the client is built,
 * and it fails with an explicit 503 rather than a stack trace.
 *
 * `persistSession`/`autoRefreshToken` let supabase-js own token storage and the
 * refresh cycle, replacing the removed bespoke token store. `storageKey` keeps the
 * session under a project-namespaced key.
 */
let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new ApiError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "This deployment is not connected to Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "jibonjori.auth",
      },
    });
  }
  return client;
}

/**
 * Resolves the signed-in Supabase user id, which is also `profiles.id`.
 *
 * Every write that must be attributed to the caller uses this rather than a
 * client-supplied id, so a forged actor/target can never be written.
 */
export async function requireUserId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error) {
    // An expired/invalid session is an authentication failure, not a server error.
    notifyUnauthorized();
    throw new ApiError(401, "UNAUTHENTICATED", "Your session has ended. Sign in again.");
  }
  if (!data.user) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  return data.user.id;
}

type ErrorRecord = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  error?: unknown;
};

/**
 * Maps the several error shapes supabase-js can raise (PostgREST, Storage, Auth,
 * Edge Function) onto the `ApiError` contract the UI already branches on.
 */
export function toApiError(error: unknown, fallbackMessage?: string): ApiError {
  if (error instanceof ApiError) return error;

  const fallback = fallbackMessage ?? "The request could not be completed.";
  if (error === null || error === undefined || typeof error !== "object") {
    return new ApiError(500, "REQUEST_FAILED", fallback);
  }

  const record = error as ErrorRecord;
  const rawMessage = typeof record.message === "string" ? record.message : "";
  const rawCode =
    typeof record.code === "string" ? record.code : typeof record.error === "string" ? record.error : "";
  const status = typeof record.status === "number" ? record.status : undefined;

  // An Edge Function error arrives as a JSON body in `message`:
  //   { "error": "FORBIDDEN", "message": "..." }
  let code = rawCode;
  let message = rawMessage;
  const trimmed = rawMessage.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; code?: unknown; message?: unknown };
      if (typeof parsed.error === "string") code = parsed.error;
      else if (typeof parsed.code === "string") code = parsed.code;
      if (typeof parsed.message === "string") message = parsed.message;
    } catch {
      /* not a JSON envelope; keep the raw message */
    }
  }

  const combined = `${code} ${message}`.toUpperCase();

  if (code === "23505") {
    return new ApiError(409, "DUPLICATE", message || "That value is already in use.");
  }
  if (code === "23514" || code === "23503") {
    return new ApiError(400, "VALIDATION_ERROR", message || "The submitted data is not valid.");
  }
  if (code === "PGRST116") {
    return new ApiError(404, "NOT_FOUND", message || "The requested record was not found.");
  }
  if (combined.includes("FORBIDDEN") || combined.includes("INSUFFICIENT_PRIVILEGE")) {
    return new ApiError(403, "FORBIDDEN", message || "You do not have permission to do that.");
  }
  if (combined.includes("PROFILE_NOT_VISIBLE") || combined.includes("NOT_VISIBLE")) {
    return new ApiError(403, "FORBIDDEN", message || "That profile is not visible to you.");
  }
  if (combined.includes("PROFILE_NOT_AVAILABLE") || combined.includes("PROFILE_NOT_FOUND")) {
    return new ApiError(404, "NOT_FOUND", message || "The requested profile was not found.");
  }
  if (combined.includes("UNAUTHENTICATED") || status === 401) {
    return new ApiError(401, "UNAUTHENTICATED", message || "Your session has ended. Sign in again.");
  }
  if (combined.includes("INVALID_TARGET") || combined.includes("INVALID_") || combined.includes("VALIDATION")) {
    return new ApiError(400, "VALIDATION_ERROR", message || "The submitted data is not valid.");
  }
  if (/^22\d{3}$/.test(code)) {
    return new ApiError(400, "VALIDATION_ERROR", message || "The submitted data is not valid.");
  }

  return new ApiError(status && status >= 400 ? status : 500, code || "REQUEST_FAILED", message || fallback);
}

/** Throws on a PostgREST/Storage error and otherwise returns the data. */
export function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw toApiError(error);
  return data as T;
}

/** Calls a Postgres RPC and unwraps the single envelope supabase-js returns. */
export async function callRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  return unwrap<T>({ data: (data ?? null) as T | null, error });
}

/**
 * Invokes an Edge Function.
 *
 * `ai-chat`, `ai-explanation` and `account-delete` are POST endpoints and go
 * through `functions.invoke` (which attaches the session automatically).
 * `reports` and `sessions` are GET endpoints, so they are called with `fetch`
 * directly, with the anon key as `apikey` and the current access token as the
 * bearer. `sessions` revoke operations are POST and use `functions.invoke`.
 */
export async function invokeFunction<T>(
  name: string,
  body?: unknown,
  path = "",
  method: "GET" | "POST" = path ? "GET" : "POST"
): Promise<T> {
  const supabase = getSupabase();

  if (method === "GET") {
    let token = env.supabaseAnonKey;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) token = data.session.access_token;
    } catch {
      /* fall back to the anon key; the gateway will 401 if a token is required */
    }

    let response: Response;
    try {
      response = await fetch(`${env.supabaseUrl}/functions/v1/${name}${path}`, {
        method: "GET",
        headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new ApiError(500, "REQUEST_FAILED", "The request could not be completed.");
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw toApiError({ message: text, status: response.status });
    }
    return (await response.json()) as T;
  }

  const options =
    body === undefined || body === null
      ? undefined
      : { body: body as Record<string, unknown> };
  const { data, error } = await supabase.functions.invoke<T>(name, options);
  if (error) throw toApiError(error);
  return data as T;
}
