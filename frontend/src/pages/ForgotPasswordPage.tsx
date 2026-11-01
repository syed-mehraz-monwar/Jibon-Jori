import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../api/auth.api";
import { ApiError } from "../lib/http";
import { emailError } from "../lib/validation";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";

/**
 * Requests a password-recovery email.
 *
 * The success message is deliberately non-committal ("If an account exists…"):
 * Supabase answers 200 for unknown addresses too, so this screen cannot be used
 * to discover which addresses are registered.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const problem = emailError(email);
    if (problem) {
      setError(problem);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(email);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The reset email could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sent ? undefined : "We will email you a secure link to choose a new password."}
      footer={
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            If an account exists for <span className="font-medium">{email.trim()}</span>, a reset link is on its way.
            The link expires shortly after it is sent.
          </p>
          <Button variant="secondary" className="w-full" onClick={() => setSent(false)}>
            Use a different address
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label="Email address" htmlFor="reset-email" required>
            <Input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </Field>

          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={submitting} className="w-full" size="lg">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
