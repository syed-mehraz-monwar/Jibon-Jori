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
    const email = input.email?.trim();
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

    // The identifier may be an email or a username, but the profiles table is not
    // readable before sign-in (RLS grants it only to authenticated), so a username
    // cannot be resolved to its email client-side. It is therefore passed as the
    // email: an email address works directly, and a username only works if it
    // happens to be the address. This is a documented limitation of the
    // pure-client architecture.
    const { data, error } = await getSupabase().auth.signInWithPassword({
      email: identifier,
      password: input.password,
    });
    if (error || !data.user || !data.session) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials.");
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
