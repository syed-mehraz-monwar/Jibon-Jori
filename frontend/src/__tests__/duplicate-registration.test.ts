/**
 * Duplicate-registration regression (never-arriving-OTP symptom).
 *
 * Verified against the live cloud project: re-signing-up an already confirmed
 * address returns HTTP 200 with a user, no session and `identities: []`, and
 * sends NO email — while a genuine signup returns one identity. `register`
 * must therefore refuse the empty-identities shape with USER_ALREADY_REGISTERED
 * instead of claiming "a code was sent".
 */
import { describe, expect, it } from "vitest";
import { authApi } from "../api/auth.api";
import { ApiError } from "../lib/http";
import { fakeSupabase } from "./fake-supabase";

function seedSignupUser(identities: unknown[]): void {
  fakeSupabase.state.auth.user = {
    id: "u9",
    email: "dup@example.com",
    email_confirmed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    user_metadata: { username: "dupuser" },
    identities,
  } as unknown as typeof fakeSupabase.state.auth.user;
}

describe("register duplicate detection", () => {
  it("rejects an already-registered email (empty identities) without claiming delivery", async () => {
    seedSignupUser([]);
    const failure = await authApi
      .register({ username: "dupuser", password: "correct-horse-1", email: "dup@example.com" })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("USER_ALREADY_REGISTERED");
    expect((failure as ApiError).message).toMatch(/already registered/i);
  });

  it("accepts a genuinely new signup (one identity) as needing confirmation", async () => {
    seedSignupUser([{ id: "id1", provider: "email" }]);
    const result = await authApi.register({
      username: "newuser",
      password: "correct-horse-1",
      email: "new@example.com",
    });
    expect(result.delivered).toBe(true);
    expect(result.channel).toBe("email");
  });

  it("keeps the old behaviour when the shape carries no identities field", async () => {
    fakeSupabase.state.auth.user = {
      id: "u9",
      email: "legacy@example.com",
      created_at: "2026-01-01T00:00:00.000Z",
      user_metadata: { username: "legacy" },
    };
    const result = await authApi.register({
      username: "legacy",
      password: "correct-horse-1",
      email: "legacy@example.com",
    });
    expect(result.delivered).toBe(true);
  });
});
