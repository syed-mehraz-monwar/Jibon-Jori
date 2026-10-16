import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../lib/http";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";

type LocationState = { from?: string };

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = (location.state as LocationState | null)?.from ?? "/app";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (identifier.trim().length < 3) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      const user = await login(identifier.trim(), password);
      toast.success(`Welcome back, ${user.username}.`);
      navigate(redirectTo, { replace: true });
    } catch (caught) {
      // The backend deliberately does not distinguish unknown identifier from a
      // wrong password; show its message rather than guessing.
      setError(caught instanceof ApiError ? caught.message : "Sign in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <Link to="/" className="mb-6 text-center text-2xl font-bold">
        <span className="jj-gradient-text">JibonJori</span>
      </Link>

      <Card title="Sign in">
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field
            label="Email address"
            htmlFor="identifier"
            required
            hint="Sign in with the email address you registered with."
          >
            <Input
              id="identifier"
              name="identifier"
              autoComplete="email"
              inputMode="email"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="arif@example.com"
            />
          </Field>

          <Field label="Password" htmlFor="password" required>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={submitting} className="w-full" size="lg">
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          No account yet?{" "}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Create one
          </Link>
        </p>
      </Card>
    </div>
  );
}
