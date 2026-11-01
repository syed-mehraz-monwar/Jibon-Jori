import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useUsernameAvailability } from "../hooks/useUsernameAvailability";
import { ApiError } from "../lib/http";
import { deliveryNotice } from "../lib/otp";
import { emailError, passwordError, phoneError, usernameError } from "../lib/validation";
import { cn } from "../lib/cn";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { PasswordInput } from "../components/ui/PasswordInput";
import { Select } from "../components/ui/Select";

type Channel = "email" | "phone";

const AVAILABILITY_STYLES: Record<string, string> = {
  available: "text-emerald-600",
  unavailable: "text-red-600",
  invalid: "text-amber-600",
  checking: "text-slate-500",
  rate_limited: "text-amber-600",
  error: "text-red-600",
  idle: "text-slate-400",
};

export function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const availability = useUsernameAvailability(username);

  if (status === "authenticated") {
    return <Navigate to="/app" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const localErrors = [
      usernameError(username),
      passwordError(password),
      channel === "email" ? emailError(email) : phoneError(phone),
    ].filter((message): message is string => message !== null);

    if (localErrors.length > 0) {
      setFormError(localErrors[0]);
      return;
    }
    if (availability.status === "unavailable") {
      setFormError("That username is not available.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await register({
        username: username.trim(),
        password,
        ...(channel === "email" ? { email: email.trim() } : { phone: phone.trim() }),
      });

      sessionStorage.setItem("jibonjori.pendingUserId", result.user.id);
      sessionStorage.setItem("jibonjori.pendingChannel", result.channel);
      // R-012: carry the delivery truth across the navigation so the verification
      // screen can be honest instead of asserting a code is on its way.
      sessionStorage.setItem("jibonjori.pendingDelivered", String(result.delivered));
      sessionStorage.setItem("jibonjori.pendingDeliveryReason", result.deliveryReason ?? "");
      sessionStorage.setItem("jibonjori.pendingDeliveredTo", result.deliveredTo);

      const notice = deliveryNotice(result, "created");
      if (notice.tone === "success") toast.success(notice.title, notice.body);
      else toast.warning(notice.title, notice.body);
      navigate("/verify", { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.isValidation && caught.issues.length > 0) {
        setFormError(caught.issues[0].message);
      } else {
        setFormError(caught instanceof ApiError ? caught.message : "Registration failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="A few details first, then we verify your email with a six-digit code."
      footer={
        <>
          Already registered?{" "}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field
          label="Username"
          htmlFor="username"
          required
          hint="3-32 characters. Letters, numbers and underscores."
          error={username ? usernameError(username) : null}
        >
          <Input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="arif_hossain"
          />
        </Field>

        {/* Live availability while typing (Spec §4). Realtime over Supabase
            Realtime, falling back to the `username_available` RPC when the
            channel is not connected. */}
        {username.trim().length >= 3 ? (
          <p
            className={cn("-mt-2 text-sm", AVAILABILITY_STYLES[availability.status] ?? "text-slate-500")}
            aria-live="polite"
          >
            {availability.message}
          </p>
        ) : null}

        <Field
          label="Password"
          htmlFor="password"
          required
          hint="At least 8 characters."
          error={password ? passwordError(password) : null}
        >
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Field
          label="Verification channel"
          htmlFor="channel"
          required
          hint="We send a one-time code to the channel you choose."
        >
          <Select
            id="channel"
            name="channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value as Channel)}
            options={[
              { value: "email", label: "Email" },
              { value: "phone", label: "Phone (SMS)" },
            ]}
          />
        </Field>

        {channel === "email" ? (
          <Field
            label="Email address"
            htmlFor="email"
            required
            error={email ? emailError(email) : null}
          >
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="arif@example.com"
            />
          </Field>
        ) : (
          <Field
            label="Phone number"
            htmlFor="phone"
            required
            error={phone ? phoneError(phone) : null}
            hint="E.164 format, for example +8801712345678."
          >
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+8801712345678"
            />
          </Field>
        )}

        {formError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        ) : null}

        <Button type="submit" loading={submitting} className="w-full" size="lg">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
