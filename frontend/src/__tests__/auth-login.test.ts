/**
 * Login regression: logout -> login with the same credentials must work, and
 * failures must say what actually went wrong.
 *
 * Root cause of the reported "Invalid credentials" after logout: `login`
 * passed the identifier straight through as the Supabase email, so signing in
 * with a *username* always failed with Supabase's `invalid_credentials` while
 * the UI blamed the password. A bare username now resolves through the
 * `resolve-login-email` Edge Function when deployed, and otherwise fails with
 * an actionable USERNAME_LOGIN_UNAVAILABLE message instead of a wrong-password
 * error. Every Supabase sign-in failure is mapped by `mapSignInError` instead
 * of being collapsed into one string.
 */
import { describe, expect, it } from "vitest";
import { authApi, mapSignInError } from "../api/auth.api";
import { ApiError } from "../lib/http";
import { fakeSupabase, seedAuth } from "./fake-supabase";

const EMAIL = "rabby@example.com";
const PASSWORD = "correct-horse-1";

function seedLogin(): void {
  seedAuth({ id: "u1", username: "rabby" });
  fakeSupabase.state.auth.credentials = { email: EMAIL, password: PASSWORD };
}

async function loginError(identifier: string, password: string): Promise<ApiError> {
  const failure = await authApi.login({ identifier, password }).then(
    () => null,
    (error: unknown) => error
  );
  expect(failure).toBeInstanceOf(ApiError);
  return failure as ApiError;
}

describe("email login", () => {
  it("signs in with the registered email and password", async () => {
    seedLogin();
    const result = await authApi.login({ identifier: EMAIL, password: PASSWORD });
    expect(result.user.username).toBe("rabby");
    expect(result.accessToken).toBe("test-access");
    expect(result.refreshToken).toBe("test-refresh");
  });

  it("trims and lowercases the email identifier", async () => {
    seedLogin();
    const result = await authApi.login({ identifier: "  RABBY@Example.COM  ", password: PASSWORD });
    expect(result.user.id).toBe("u1");
  });

  it("never trims the password", async () => {
    seedLogin();
    const failure = await loginError(EMAIL, ` ${PASSWORD} `);
    expect(failure.code).toBe("INVALID_CREDENTIALS");
  });

  it("reports a wrong password without blaming an unrelated cause", async () => {
    seedLogin();
    const failure = await loginError(EMAIL, "wrong-password");
    expect(failure.status).toBe(401);
    expect(failure.code).toBe("INVALID_CREDENTIALS");
    expect(failure.message).toMatch(/do not match/);
  });

  it("treats a signed-in user without a session as unverified, not as a wrong password", async () => {
    seedLogin();
    fakeSupabase.state.auth.session = null;
    const failure = await loginError(EMAIL, PASSWORD);
    expect(failure.code).toBe("EMAIL_NOT_CONFIRMED");
  });
});

describe("logout/login cycle", () => {
  it("logs out without deleting the account and logs back in with the same credentials", async () => {
    seedLogin();
    const before = await authApi.login({ identifier: EMAIL, password: PASSWORD });

    await authApi.logout();
    // Logout clears the session, never the account: the profile row survives.
    expect(fakeSupabase.state.tables.profiles).toHaveLength(1);

    fakeSupabase.state.auth.session = {
      access_token: "test-access",
      refresh_token: "test-refresh",
      user: { id: "u1" },
    };
    const after = await authApi.login({ identifier: EMAIL, password: PASSWORD });
    expect(after.user.id).toBe(before.user.id);
    expect(after.user.username).toBe(before.user.username);
    expect(after.user.email).toBe(before.user.email);
  });
});

describe("username login", () => {
  it("explains email sign-in while the resolver function is not deployed", async () => {
    seedLogin();
    const failure = await loginError("rabby", PASSWORD);
    expect(failure.code).toBe("USERNAME_LOGIN_UNAVAILABLE");
    expect(failure.message).toMatch(/email address/);
  });

  it("resolves the username through the Edge Function once deployed", async () => {
    seedLogin();
    fakeSupabase.state.functions["resolve-login-email"] = () => ({ email: EMAIL });
    const result = await authApi.login({ identifier: "Rabby", password: PASSWORD });
    expect(result.user.username).toBe("rabby");
  });

  it("rejects a malformed identifier without calling the resolver", async () => {
    seedLogin();
    const failure = await loginError("not an identifier!", PASSWORD);
    expect(failure.code).toBe("VALIDATION_ERROR");
  });
});

describe("mapSignInError", () => {
  it("maps Supabase invalid_credentials (live-cloud shape) to 401 without enumeration", () => {
    const mapped = mapSignInError({ message: "Invalid login credentials", status: 400 });
    expect(mapped.status).toBe(401);
    expect(mapped.code).toBe("INVALID_CREDENTIALS");
    expect(mapped.message).not.toMatch(/Invalid credentials\./);
  });

  it("distinguishes an unverified address from a wrong password", () => {
    const mapped = mapSignInError({ message: "Email not confirmed", status: 400, code: "email_not_confirmed" });
    expect(mapped.code).toBe("EMAIL_NOT_CONFIRMED");
    expect(mapped.message).toMatch(/6-digit code/);
  });

  it("distinguishes rate limiting from a wrong password", () => {
    const mapped = mapSignInError({ message: "Too many requests", status: 429 });
    expect(mapped.status).toBe(429);
    expect(mapped.code).toBe("RATE_LIMITED");
  });

  it("distinguishes a network failure from a wrong password", () => {
    const mapped = mapSignInError(new TypeError("Failed to fetch"));
    expect(mapped.status).toBe(503);
    expect(mapped.code).toBe("NETWORK_UNAVAILABLE");
  });
});
