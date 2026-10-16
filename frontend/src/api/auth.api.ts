import { getSupabase, callRpc, invokeFunction, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import { deriveUserStatus } from "../lib/mappers";
import type { LoginResult, OtpChallenge, RegisterResult, Role, SessionInfo, User } from "../lib/types";

export type RegisterInput = {
  username: string;
  password: string;
  email?: string;
  phone?: string;
};

export type LoginInput = { identifier: string; password: string };

export type UsernameAvailability = {
  username: string;
  available: boolean;
  reason: string;
};

/** The subset of a Supabase auth user the mapper reads. */
export type SupaUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  created_at?: string;
};

/** The subset of the `profiles` row the mapper reads. */
export type ProfileSnapshot = {
  username?: string | null;
  role?: Role | null;
  is_suspended?: boolean | null;
  deleted_at?: string | null;
  created_at?: string | null;
};

const PROFILE_SNAPSHOT = "username, role, is_suspended, deleted_at, created_at";

/** Projects a Supabase auth user + profile row onto the app's `User` contract. */
export function toUser(supaUser: SupaUser, profile: ProfileSnapshot | null): User {
  const metadataUsername = (supaUser as { user_metadata?: { username?: string } }).user_metadata?.username;
  return {
    id: supaUser.id,
    username: profile?.username ?? metadataUsername ?? (supaUser.email ?? "").split("@")[0] ?? "",
    email: supaUser.email ?? null,
    phone: supaUser.phone ?? null,
    role: profile?.role ?? "member",
    status: deriveUserStatus({
      isSuspended: profile?.is_suspended,
      deletedAt: profile?.deleted_at,
      emailConfirmedAt: supaUser.email_confirmed_at ?? null,
      phoneConfirmedAt: supaUser.phone_confirmed_at ?? null,
    }),
    emailVerifiedAt: supaUser.email_confirmed_at ?? null,
    phoneVerifiedAt: supaUser.phone_confirmed_at ?? null,
    createdAt: profile?.created_at ?? supaUser.created_at ?? new Date(0).toISOString(),
  };
}

async function loadProfileSnapshot(userId: string): Promise<ProfileSnapshot | null> {
  const { data } = await getSupabase()
    .from("profiles")
    .select(PROFILE_SNAPSHOT)
    .eq("id", userId)
    .maybeSingle();
  return (data as ProfileSnapshot | null) ?? null;
}

/** Reads the auth user + its profile row and builds the app `User`. */
async function loadUser(supaUser: SupaUser): Promise<User> {
  const profile = await loadProfileSnapshot(supaUser.id).catch(() => null);
  return toUser(supaUser, profile);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/**
 * Maps a Supabase `signInWithPassword` failure onto an actionable `ApiError`.
 *
 * Previously every failure surfaced as "Invalid credentials", which hid
 * unverified addresses, outages and rate limits behind a message that blamed
 * the password. Each branch below is matched on the error's code/message only;
 * nothing sensitive is ever logged or returned.
 */
export function mapSignInError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const record = (error ?? {}) as { code?: unknown; message?: unknown; status?: unknown; name?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  const code = typeof record.code === "string" ? record.code : "";
  const combined = `${code} ${message}`.toUpperCase();

  if (
    record.name === "TypeError" ||
    combined.includes("FAILED TO FETCH") ||
    combined.includes("NETWORKERROR") ||
    combined.includes("NETWORK REQUEST FAILED") ||
    combined.includes("LOAD FAILED")
  ) {
    return new ApiError(
      503,
      "NETWORK_UNAVAILABLE",
      "We could not reach the sign-in service. Check your connection and try again."
    );
  }
  if (combined.includes("EMAIL NOT CONFIRMED") || combined.includes("EMAIL_NOT_CONFIRMED")) {
    return new ApiError(
      400,
      "EMAIL_NOT_CONFIRMED",
      "Your email address is not verified yet. Enter the 6-digit code we sent you, then sign in."
    );
  }
  if (
    combined.includes("TOO MANY REQUESTS") ||
    combined.includes("RATE LIMIT") ||
    combined.includes("OVER_REQUEST") ||
    combined.includes("OVER_EMAIL")
  ) {
    return new ApiError(
      429,
      "RATE_LIMITED",
      "Too many sign-in attempts. Wait a few minutes and try again."
    );
  }
  if (combined.includes("INVALID LOGIN CREDENTIALS") || combined.includes("INVALID_CREDENTIALS")) {
    // Supabase deliberately does not say whether the address or the password
    // was wrong, so neither do we.
    return new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "That email and password do not match. Check them and try again."
    );
  }
  return toApiError(error, "Sign in failed. Please try again.");
}

/**
 * Resolves a bare username to its sign-in email address.
 *
 * `profiles` is not readable before sign-in (RLS grants it only to
 * `authenticated`), so the lookup goes through the `resolve-login-email` Edge
 * Function, which holds the service role server-side and rate-limits callers.
 * Until that function is deployed, username sign-in is unavailable and the
 * caller is told to use their email address instead of being shown a
 * misleading "Invalid credentials" error. The service-role key never enters
 * the client: the worst a caller learns is the email they already own.
 */
async function resolveEmailForUsername(username: string): Promise<string> {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Enter the email address you registered with."
    );
  }
  try {
    const { email } = await invokeFunction<{ email: string }>("resolve-login-email", {
      username: normalized,
    });
    if (typeof email !== "string" || !email.includes("@")) {
      throw new ApiError(500, "REQUEST_FAILED", "Sign in failed. Please try again.");
    }
    return email.trim().toLowerCase();
  } catch (caught) {
    if (caught instanceof ApiError) {
      // The function is not deployed yet (404/NOT_FOUND from the gateway) or
      // unreachable: report username sign-in as unavailable, not as a wrong
      // password. A genuine "unknown username" from the deployed function also
      // stays generic here to avoid enumerating accounts.
      if (caught.code === "USERNAME_NOT_FOUND") {
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "That email and password do not match. Check them and try again."
        );
      }
      if (caught.code === "RATE_LIMITED") throw caught;
      throw new ApiError(
        400,
        "USERNAME_LOGIN_UNAVAILABLE",
        "Username sign-in is not enabled yet — sign in with the email address you registered with."
      );
    }
    throw new ApiError(
      400,
      "USERNAME_LOGIN_UNAVAILABLE",
      "Username sign-in is not enabled yet — sign in with the email address you registered with."
    );
  }
}

type EdgeSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;
};

/**
 * Auth is Supabase Auth. The old Express `/api/auth` wrapper is gone, so login,
 * registration, OTP, refresh and session listing map to `supabase.auth` and the
 * `sessions` Edge Function.
 */
export const authApi = {
  register: async (input: RegisterInput): Promise<RegisterResult> => {
    const email = input.email?.trim().toLowerCase();
    if (!email) {
      throw new ApiError(400, "VALIDATION_ERROR", "An email address is required to register.");
    }
    if (input.phone) {
      throw new ApiError(400, "VALIDATION_ERROR", "Phone-number sign-up is not enabled on this deployment.");
    }

    const { data, error } = await getSupabase().auth.signUp({
      email,
      password: input.password,
      options: { data: { username: input.username.toLowerCase() } },
    });
    if (error) throw toApiError(error);
    if (!data.user) {
      throw new ApiError(500, "REGISTRATION_FAILED", "The account could not be created.");
    }
    // Supabase hides "email already registered" to prevent account enumeration:
    // re-signing-up a confirmed address returns 200 with a user, no session and
    // an EMPTY identities array — and sends no email. Without this check the app
    // would claim "a code was sent" while nothing is on its way (the exact
    // never-arriving-OTP symptom). A genuinely new signup carries one identity.
    // The field is read defensively: if a future shape omits it, fall through to
    // the previous behaviour rather than blocking registration.
    const identities = (data.user as { identities?: unknown }).identities;
    if (Array.isArray(identities) && identities.length === 0) {
      throw new ApiError(
        409,
        "USER_ALREADY_REGISTERED",
        "This email is already registered. Sign in instead — no new code was sent."
      );
    }
    // The confirmation step runs before a session exists, so the email is recorded
    // here for `verifyOtp`/`requestOtp` to read back.
    setPendingEmail(email);

    // When email confirmation is on, Supabase returns a user but no session and
    // sends the confirmation email. When it is off, a session is returned and the
    // auth state change authenticates the app.
    const needsConfirmation = !data.session;
    const user = toUser(data.user as SupaUser, await loadProfileSnapshot(data.user.id).catch(() => null));

    return {
      user,
      channel: "email",
      deliveredTo: maskEmail(email),
      expiresInSeconds: 0,
      delivered: needsConfirmation,
      deliveryProvider: "supabase-auth",
      deliveryReason: null,
    };
  },

  /** Resends the sign-up confirmation email. */
  requestOtp: async (_userId: string, _purpose: "register" = "register"): Promise<OtpChallenge> => {
    const email = readPendingEmail();
    if (!email) {
      throw new ApiError(400, "VALIDATION_ERROR", "Start registration again to request a new code.");
    }
    const { error } = await getSupabase().auth.resend({ type: "signup", email });
    if (error) throw toApiError(error);
    return {
      channel: "email",
      deliveredTo: maskEmail(email),
      expiresInSeconds: 0,
      delivered: true,
      deliveryProvider: "supabase-auth",
      deliveryReason: null,
    };
  },

  verifyOtp: async (input: { userId: string; purpose: "register"; code: string }): Promise<LoginResult> => {
    const email = readPendingEmail();
    if (!email) {
      throw new ApiError(400, "VALIDATION_ERROR", "Enter the email address you registered with, then the code.");
    }
    const { data, error } = await getSupabase().auth.verifyOtp({ email, token: input.code, type: "signup" });
    if (error || !data.user || !data.session) {
      throw new ApiError(400, "INVALID_OTP", "That code is not valid or has expired.");
    }
    const user = await loadUser(data.user as SupaUser);
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, user };
  },

  login: async (input: LoginInput): Promise<LoginResult> => {
    const identifier = input.identifier.trim();
    if (!identifier) throw new ApiError(400, "VALIDATION_ERROR", "Enter your email address.");
    // Passwords are never trimmed or case-folded: what the user typed is what
    // Supabase must verify. Only the identifier (email/username) is normalized.
    const password = input.password;
    if (!password) throw new ApiError(400, "VALIDATION_ERROR", "Enter your password.");

    // Supabase Auth signs in with email + password only. When the identifier
    // looks like an email address it is used directly (trimmed and lowercased,
    // matching the normalization applied at registration). A bare username is
    // resolved through the `resolve-login-email` Edge Function when it is
    // deployed; before that, the caller gets an actionable message instead of
    // a misleading "Invalid credentials".
    const email = identifier.includes("@")
      ? identifier.toLowerCase()
      : await resolveEmailForUsername(identifier);

    let data: { user: unknown; session: { access_token: string; refresh_token: string } | null };
    try {
      const result = await getSupabase().auth.signInWithPassword({ email, password });
      if (result.error) throw mapSignInError(result.error);
      data = result.data as typeof data;
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      throw mapSignInError(caught);
    }
    if (!data.user || !data.session) {
      // A user without a session means the address is still awaiting
      // verification (Supabase issues no session before confirmation).
      throw new ApiError(
        400,
        "EMAIL_NOT_CONFIRMED",
        "Your email address is not verified yet. Enter the 6-digit code we sent you, then sign in."
      );
    }
    const user = await loadUser(data.user as SupaUser);
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, user };
  },

  refresh: async (refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> => {
    const { data, error } = await getSupabase().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw toApiError(error, "Your session could not be refreshed.");
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
  },

  logout: async (): Promise<null> => {
    const { error } = await getSupabase().auth.signOut();
    if (error) throw toApiError(error);
    return null;
  },

  me: async (_signal?: AbortSignal): Promise<{ user: User }> => {
    const { data, error } = await getSupabase().auth.getUser();
    if (error || !data.user) {
      throw new ApiError(401, "UNAUTHENTICATED", "Your session has ended. Sign in again.");
    }
    return { user: await loadUser(data.user as SupaUser) };
  },

  usernameAvailability: async (username: string, _signal?: AbortSignal): Promise<UsernameAvailability> => {
    const available = await callRpc<boolean>("username_available", { p_username: username });
    return { username, available, reason: available ? "ok" : "taken" };
  },

  sessions: async (_signal?: AbortSignal): Promise<{ sessions: SessionInfo[] }> => {
    const { sessions } = await invokeFunction<{ sessions: EdgeSession[] }>("sessions", undefined, "", "GET");
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        // Supabase does not expose the session's absolute expiry through this
        // function; it is reported empty rather than guessed.
        expiresAt: "",
        ip: session.ip,
        userAgent: session.userAgent,
        current: session.isCurrent,
      })),
    };
  },

  revokeOthers: async (): Promise<{ revoked: number }> =>
    invokeFunction<{ revoked: number }>("sessions", { revokeOthers: true }),

  revokeSession: async (sessionId: string): Promise<null> => {
    await invokeFunction<{ revoked: number }>("sessions", { sessionId });
    return null;
  },
};

const PENDING_EMAIL_KEY = "jibonjori.pendingEmail";

function readPendingEmail(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

/** Records the email a registration was started with, for the OTP step. */
export function setPendingEmail(email: string): void {
  try {
    window.sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    /* sessionStorage may be unavailable; the OTP step then asks for the email */
  }
}
