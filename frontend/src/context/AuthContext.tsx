import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, type RegisterInput } from "../api/auth.api";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";
import { ApiError, onUnauthorized } from "../lib/http";
import { disconnectRealtime } from "../lib/realtime";
import type { LoginResult, RegisterResult, User } from "../lib/types";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  isAdmin: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<RegisterResult>;
  verifyOtp: (userId: string, code: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Owns the session by delegating to Supabase Auth.
 *
 * supabase-js persists the session (`persistSession`/`autoRefreshToken` in
 * `lib/supabase.ts`) and keeps it refreshed, so this provider no longer stores
 * tokens itself: it mirrors the auth state into React and rebuilds the app `User`
 * from the auth user plus its `profiles` row. `onAuthStateChange` covers refresh and
 * sign-out in other tabs; the explicit methods cover the app's own flows.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const applySession = useCallback((result: LoginResult) => {
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  const clearSession = useCallback(() => {
    disconnectRealtime();
    setUser(null);
    setStatus("anonymous");
  }, []);

  /** Rehydrate from the persisted Supabase session on first load. */
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!isSupabaseConfigured()) {
        setStatus("anonymous");
        return;
      }
      try {
        const { data } = await getSupabase().auth.getSession();
        if (!data.session) {
          if (!cancelled) setStatus("anonymous");
          return;
        }
        const { user: me } = await authApi.me();
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        clearSession();
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  /** Keep React state in step with Supabase's own session lifecycle. */
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") clearSession();
    });
    return () => data.subscription.unsubscribe();
  }, [clearSession]);

  /** The Supabase layer clears the session itself; keep React state in step. */
  useEffect(() => onUnauthorized(clearSession), [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAdmin: user?.role === "admin",
      login: async (identifier, password) => applySession(await authApi.login({ identifier, password })),
      register: (input) => authApi.register(input),
      verifyOtp: async (userId, code) =>
        applySession(await authApi.verifyOtp({ userId, purpose: "register", code })),
      logout: async () => {
        try {
          await authApi.logout();
        } catch (error) {
          // A failed logout must still drop local state; report only real errors.
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
        } finally {
          clearSession();
        }
      },
      refreshUser: async () => {
        const { user: me } = await authApi.me();
        setUser(me);
      },
    }),
    [user, status, applySession, clearSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
