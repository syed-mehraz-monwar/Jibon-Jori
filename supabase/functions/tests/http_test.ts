// =============================================================================
// Behavioural tests for the shared HTTP layer.
// =============================================================================
// These run without a Supabase project: `_shared/http.ts` is pure request/response
// logic. They pin the contract the client depends on, and in particular the two
// rules the module's own comment promises:
//   * an HttpError becomes exactly its intended status and code;
//   * anything else becomes a generic 500 whose body does NOT leak the message.
// The second is a security property, so it is asserted on the body text.
// =============================================================================

import { assertEquals, assertNotMatch, assertStringIncludes } from "jsr:@std/assert@1";
import { HttpError, corsHeaders, handler, json, preflight, readJson } from "../_shared/http.ts";

function req(init: RequestInit = {}): Request {
  return new Request("https://example.test/fn", init);
}

Deno.test("http: json() returns a JSON body with the given status", async () => {
  const response = json(req(), { ok: true }, 201);
  assertEquals(response.status, 201);
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals(await response.json(), { ok: true });
});

Deno.test("http: preflight returns 204 for OPTIONS and null otherwise", () => {
  const options = preflight(req({ method: "OPTIONS" }));
  assertEquals(options?.status, 204);
  assertEquals(preflight(req({ method: "POST" })), null);
});

Deno.test("http: corsHeaders allows the Capacitor application origins", () => {
  for (const origin of ["https://localhost", "http://localhost", "capacitor://localhost"]) {
    const headers = corsHeaders(req({ headers: { Origin: origin } }));
    assertEquals(headers["Access-Control-Allow-Origin"], origin, `origin ${origin} should be allowed`);
    assertEquals(headers["Vary"], "Origin");
  }
});

Deno.test("http: corsHeaders refuses an origin that is not on the allowlist", () => {
  const headers = corsHeaders(req({ headers: { Origin: "https://evil.example.com" } }));
  assertEquals(headers, {});
});

Deno.test("http: an unconfigured allowlist refuses every non-Capacitor origin", () => {
  // CORS_ALLOWED_ORIGINS is not set in this test process, so the configured list
  // is empty. Random origins must therefore be refused outright.
  for (const origin of ["https://random.example", "null", "https://localhost.evil.example"]) {
    assertEquals(corsHeaders(req({ headers: { Origin: origin } })), {}, `origin ${origin} should be refused`);
  }
});

Deno.test("http: handler maps an HttpError to its exact status and code", async () => {
  const wrapped = handler(() =>
    Promise.reject(new HttpError(409, "CURRENT_SESSION_UNKNOWN", "Cannot identify the current session. Please sign in again."))
  );
  const response = await wrapped(req({ method: "POST" }));
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: "CURRENT_SESSION_UNKNOWN",
    message: "Cannot identify the current session. Please sign in again.",
  });
});

Deno.test("http: handler converts an unexpected error into a 500 that leaks nothing", async () => {
  const secret = "postgres://user:supersecret@db.internal:5432/postgres";
  const wrapped = handler(() => Promise.reject(new Error(`connection failed: ${secret}`)));
  const response = await wrapped(req({ method: "POST" }));
  assertEquals(response.status, 500);

  const text = await response.text();
  assertEquals(JSON.parse(text), {
    error: "INTERNAL",
    message: "The request could not be completed.",
  });
  assertNotMatch(text, /supersecret/);
  assertNotMatch(text, /db\.internal/);
  assertNotMatch(text, /postgres:\/\//);
});

Deno.test("http: handler answers OPTIONS before running the body", async () => {
  let ran = false;
  const wrapped = handler(() => {
    ran = true;
    return Promise.resolve(json(req(), {}));
  });
  const response = await wrapped(req({ method: "OPTIONS" }));
  assertEquals(response.status, 204);
  assertEquals(ran, false);
});

Deno.test("http: readJson returns the parsed body", async () => {
  const body = await readJson<{ a: number }>(
    req({ method: "POST", body: JSON.stringify({ a: 1 }), headers: { "Content-Type": "application/json" } }),
  );
  assertEquals(body, { a: 1 });
});

Deno.test("http: readJson turns malformed JSON into a 400 HttpError", async () => {
  let caught: unknown;
  try {
    await readJson(req({ method: "POST", body: "{not json" }));
  } catch (error) {
    caught = error;
  }
  assertEquals(caught instanceof HttpError, true);
  const httpError = caught as HttpError;
  assertEquals(httpError.status, 400);
  assertEquals(httpError.code, "INVALID_JSON");
  assertStringIncludes(httpError.message, "valid JSON");
});
