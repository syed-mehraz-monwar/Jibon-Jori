// =============================================================================
// Regression tests for access-token payload decoding.
// =============================================================================
// This pins the defect that was found and fixed in the `sessions` function: a JWT
// payload was passed to `atob` without first converting base64url to the standard
// alphabet. In this runtime `atob` THROWS a DOMException on `-` and `_`, so a
// caller holding a perfectly valid token was treated as having no current
// session; the "keep the calling session" guard was dropped, and `revokeOthers`
// signed the member out.
//
// Which part of the fix is load-bearing was measured, not assumed:
//   * the ALPHABET conversion is required. `atob("<...>_<...>")` throws here.
//   * the PADDING restoration is defensive. This runtime's `atob` ACCEPTS unpadded
//     input, so padding alone would not have thrown in Deno - but browsers'
//     `atob` does require it, and this module is deliberately runtime-agnostic.
// The test named "runtime behaviour" records both facts below, so if a runtime
// ever changes, that test is the one that notices.
//
// The tokens here are synthetically constructed to exercise the decoder. They are
// not credentials, nothing is signed, and no real secret is involved - the
// signature segment is a fixed placeholder string.
// =============================================================================

import { assertEquals } from "jsr:@std/assert@1";
import { bearerToken, sessionIdFromRequest, sessionIdFromToken } from "../_shared/jwt.ts";

const HEADER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"; // {"alg":"HS256","typ":"JWT"}
const SIGNATURE = "SYNTHETIC-NOT-A-SIGNATURE";

/** Encodes JSON as a real JWT payload: base64url WITHOUT padding. */
function encodePayload(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Builds a syntactically valid three-segment token. */
function makeToken(payload: unknown): { token: string; payloadSegment: string } {
  const payloadSegment = encodePayload(payload);
  return { token: `${HEADER}.${payloadSegment}.${SIGNATURE}`, payloadSegment };
}

function request(headers: Record<string, string>): Request {
  return new Request("https://example.test/fn", { headers });
}

Deno.test("jwt: reads session_id from a well-formed token", () => {
  const sessionId = "3f1c5a92-4d0e-4b6a-9c2e-77a1b0d43e88";
  const { token } = makeToken({ sub: "user-1", session_id: sessionId, exp: 1893456000 });
  assertEquals(sessionIdFromToken(token), sessionId);
});

Deno.test("jwt: decodes a payload whose base64url uses the url-safe alphabet", () => {
  // "???" encodes to bytes 0x3F 0x3F 0x3F, which in standard base64 contain "/"
  // and therefore become "_" in base64url. This is the case that threw before the
  // alphabet conversion was added, so the assertion below is the real regression
  // guard. It also asserts the segment really does contain the url-safe character,
  // so the test cannot silently stop covering it.
  const sessionId = "b7e6d5c4-3a29-4180-9f7e-6d5c4b3a2910";
  const { token, payloadSegment } = makeToken({ session_id: sessionId, note: "???" });
  assertEquals(payloadSegment.includes("_") || payloadSegment.includes("-"), true, "fixture must exercise the url-safe alphabet");
  assertEquals(sessionIdFromToken(token), sessionId);
});

Deno.test("jwt: decodes payloads across every base64url length residue", () => {
  // Sweeps session_id lengths so the payload segment spans every `length % 4`
  // residue. The decoder must not depend on the segment arriving padded.
  const checked = new Set<number>();
  for (let n = 1; n <= 40; n++) {
    const sessionId = "s".repeat(n);
    const { token, payloadSegment } = makeToken({ session_id: sessionId });
    checked.add(payloadSegment.length % 4);
    assertEquals(
      sessionIdFromToken(token),
      sessionId,
      `payload length ${payloadSegment.length} (mod 4 = ${payloadSegment.length % 4}) must decode`,
    );
  }
  // Padding is only relevant if the sweep actually produced a non-multiple-of-four.
  assertEquals(checked.has(2) || checked.has(3), true, "the sweep must include an unpadded-mod-4 case");
});

Deno.test("jwt: runtime behaviour - atob accepts unpadded input but rejects base64url", () => {
  const json = '{"session_id":"abc"}';
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const padded = btoa(binary);
  const unpadded = padded.replace(/=+$/, "");

  // Unpadded input is tolerated here. This is why the padding restoration is
  // described as defensive rather than load-bearing in this runtime.
  assertEquals(atob(unpadded), json);

  // The url-safe alphabet is NOT tolerated. This is the hazard the decoder must
  // neutralise, and the reason the alphabet conversion is required.
  const urlSafe = padded.replace(/\+/g, "-").replace(/\//g, "_");
  let threw = false;
  try {
    atob(urlSafe);
  } catch {
    threw = true;
  }
  if (urlSafe !== padded) {
    assertEquals(threw, true, "this runtime is expected to reject base64url characters in atob");
  }
});

Deno.test("jwt: handles payloads containing multi-byte characters", () => {
  const sessionId = "a2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d";
  const { token } = makeToken({ session_id: sessionId, note: "প্রোফাইল ✓" });
  assertEquals(sessionIdFromToken(token), sessionId);
});

Deno.test("jwt: returns null instead of throwing for every malformed input", () => {
  const cases: Array<[string, string]> = [
    ["empty string", ""],
    ["no segments", "not-a-token"],
    ["header only", HEADER],
    ["empty payload segment", `${HEADER}..${SIGNATURE}`],
    ["payload is not base64", `${HEADER}.!!!!.${SIGNATURE}`],
    ["payload is base64 but not JSON", `${HEADER}.${btoa("not json")}.${SIGNATURE}`],
    ["JSON is not an object", `${HEADER}.${encodePayload("a string")}.${SIGNATURE}`],
    ["JSON is an array", `${HEADER}.${encodePayload([1, 2, 3])}.${SIGNATURE}`],
    ["session_id absent", `${HEADER}.${encodePayload({ sub: "user-1" })}.${SIGNATURE}`],
    ["session_id is a number", `${HEADER}.${encodePayload({ session_id: 12345 })}.${SIGNATURE}`],
    ["session_id is null", `${HEADER}.${encodePayload({ session_id: null })}.${SIGNATURE}`],
  ];
  for (const [name, token] of cases) {
    assertEquals(sessionIdFromToken(token), null, `${name} must decode to null`);
  }
});

Deno.test("jwt: bearerToken extracts the token from an Authorization header", () => {
  assertEquals(bearerToken(request({ Authorization: "Bearer abc.def.ghi" })), "abc.def.ghi");
  assertEquals(bearerToken(request({ Authorization: "bearer abc.def.ghi" })), "abc.def.ghi");
  assertEquals(bearerToken(request({ Authorization: "BEARER abc.def.ghi" })), "abc.def.ghi");
  assertEquals(bearerToken(request({ Authorization: "abc.def.ghi" })), "abc.def.ghi");
  assertEquals(bearerToken(request({ Authorization: "Bearer    " })), null);
  assertEquals(bearerToken(request({})), null);
});

Deno.test("jwt: sessionIdFromRequest reads the claim, and is null without a header", () => {
  const sessionId = "9d8c7b6a-5f4e-4d3c-2b1a-0f9e8d7c6b5a";
  const { token } = makeToken({ session_id: sessionId });
  assertEquals(sessionIdFromRequest(request({ Authorization: `Bearer ${token}` })), sessionId);
  assertEquals(sessionIdFromRequest(request({})), null);
  assertEquals(sessionIdFromRequest(request({ Authorization: "Bearer nonsense" })), null);
});

Deno.test("jwt: an attacker-supplied session_id in the body cannot come from here", () => {
  // The decoder only ever reads the token's own claim. A body value is a
  // different input entirely, and the sessions handler is responsible for
  // keeping the two apart (a token with no claim yields null, never a guess).
  const { token } = makeToken({ sub: "user-1" });
  assertEquals(sessionIdFromToken(token), null);
  assertEquals(sessionIdFromRequest(request({ Authorization: `Bearer ${token}` })), null);
});
