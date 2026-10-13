// =============================================================================
// Access-token payload helpers shared by the Edge Functions.
// =============================================================================
// This module only DECODES a token. It is not a security check: the Supabase
// gateway has already verified the signature before a function is invoked, so
// nothing here decides whether a caller is legitimate. It exists to read claims
// that the gateway guarantees, such as `session_id`.
//
// The base64url decoding is the one part that must be exactly right. JWT
// payloads are base64url WITHOUT padding, and `atob` rejects unpadded input in
// most runtimes. A decoder that throws here does not "fail safe": the caller is
// treated as having no current session, and a "revoke other sessions" guard is
// dropped, which signs the member out. Both the alphabet and the padding are
// therefore restored explicitly, and every failure mode returns `null` rather
// than throwing so the caller can decide how to fail.
// =============================================================================

/** Reads the `session_id` claim from an already-verified access token. */
export function sessionIdFromToken(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const standard = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof decoded.session_id === "string" ? decoded.session_id : null;
  } catch {
    return null;
  }
}

/** Extracts the bearer token from an Authorization header, if there is one. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;

  // The Fetch API trims header values, so "Bearer   " arrives as "Bearer". A
  // header carrying only the scheme name is not a token, and returning the word
  // "Bearer" as if it were one would be misleading to a caller.
  if (/^Bearer$/i.test(header.trim())) return null;

  const token = header.replace(/^\s*Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

/** Reads the `session_id` claim from a request's Authorization header. */
export function sessionIdFromRequest(request: Request): string | null {
  const token = bearerToken(request);
  return token === null ? null : sessionIdFromToken(token);
}
