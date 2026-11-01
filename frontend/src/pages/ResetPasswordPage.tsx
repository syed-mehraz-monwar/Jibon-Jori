import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/auth.api";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../lib/http";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";
import { isRecoveryLocation } from "../lib/recovery";
import { passwordError } from "../lib/validation";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { PasswordInput } from "../components/ui/PasswordInput";

type LinkState = "checking" | "ready" | "expired";

/**
 * Completes a password recovery.
 *
 * supabase-js has already exchanged the recovery fragment for a short-lived
 * session by the time this page mounts (`detectSessionInUrl`). The page only
 * needs to confirm that a session exists, then set the new password and sign
 * the recovery session out so the member signs in with the new credentials.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [state, setState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!isSupabaseConfigured()) {
        if (!cancelled) setState("expired");
        return;
      }
      // An explicit error in the fragment means the link is already dead.
      if (window.location.hash.includes("error_code") || !isRecoveryLocation(window.location.hash)) {
        const hasSession = await authApi.hasSession().catch(() => false);
        if (!cancelled) setState(hasSession ? "ready" : "expired");
        return;
      }
      // Give supabase-js a moment to consume the fragment, then read the session.
      window.setTimeout(() => {
        void authApi
          .hasSession()
          .catch(() => false)
          .then((hasSession) => {
            if (!cancelled) setState(hasSession ? "ready" : "expired");
          });
      }, 350);
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const strength = passwordError(password);
    if (strength) {
      setError(strength);
      return;
    }
    if (password !== confirm) {
      setError("Both passwords must match.");
      return;
    }

    setSubmitting(true);
    try {
      await authApi.updatePassword(password);
      // Drop the recovery session: the member signs in deliberately with the
      // password they just chose, which also proves it works.
      await getSupabase().auth.signOut().catch(() => undefined);
      toast.success("Password updated.", "Sign in with your new password.");
      navigate("/login", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The password could not be changed.");
      if (caught instanceof ApiError && caught.code === "RECOVERY_EXPIRED") setState("expired");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={state === "ready" ? "Use at least 8 characters." : undefined}
      footer={
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {state === "checking" ? (
        <p role="status" className="text-sm text-slate-600">
          Checking your reset link…
        </p>
      ) : state === "expired" ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This reset link is invalid or has expired. Request a new one and use it promptly.
          </p>
          <Link to="/forgot-password">
            <Button className="w-full">Request a new link</Button>
          </Link>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field
            label="New password"
            htmlFor="new-password"
            required
            error={password ? passwordError(password) : null}
          >
            <PasswordInput
              id="new-password"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Field label="Confirm new password" htmlFor="confirm-password" required>
            <PasswordInput
              id="confirm-password"
              name="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>

          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={submitting} className="w-full" size="lg">
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
