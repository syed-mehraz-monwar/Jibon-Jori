// =============================================================================
// Shared HTTP helpers for JibonJori Edge Functions.
// =============================================================================
// Every response is JSON, every error is sanitised, and CORS is restricted to an
// explicit allowlist. Nothing here ever echoes an internal message, a stack
// trace, or a provider response body back to the caller: those go to the
// function log instead, which is server-side only.
// =============================================================================

const ALLOWED_ORIGINS = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter((origin) => origin.length > 0);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = (request.headers.get("Origin") ?? "").replace(/\/$/, "");

  // Capacitor serves the Android build from these origins. They are application
  // origins, not user input, so they are always allowed.
  const capacitorOrigins = ["https://localhost", "http://localhost", "capacitor://localhost"];
  const allowed = ALLOWED_ORIGINS.includes(origin) || capacitorOrigins.includes(origin);

  if (!allowed) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * Wraps a handler so that every thrown HttpError becomes its intended status and
 * anything else becomes a generic 500. The real message is logged, never
 * returned, because an unexpected error can carry database or provider detail.
 */
export function handler(
  fn: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const options = preflight(request);
    if (options) return options;

    try {
      return await fn(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: error.code, message: error.message }, error.status);
      }
      console.error("unhandled error:", error instanceof Error ? error.message : error);
      return json(request, { error: "INTERNAL", message: "The request could not be completed." }, 500);
    }
  };
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
}
