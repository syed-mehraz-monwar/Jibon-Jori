import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { authApi } from "../api/auth.api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../lib/http";
import { deliveryNotice } from "../lib/otp";
import { otpCodeError } from "../lib/validation";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";

export function VerifyOtpPage() {
  const { verifyOtp, status } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [userId, setUserId] = useState("");
  const [channel, setChannel] = useState("email");
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [deliveredTo, setDeliveredTo] = useState("");
  const [deliveryReason, setDeliveryReason] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Registration writes the pending user id here, so a refresh on this page
  // still knows which account the code belongs to, plus whether a code was
  // actually delivered (R-012) so the copy below does not assert one is coming.
  useEffect(() => {
    setUserId(sessionStorage.getItem("jibonjori.pendingUserId") ?? "");
    setChannel(sessionStorage.getItem("jibonjori.pendingChannel") ?? "email");
    const stored = sessionStorage.getItem("jibonjori.pendingDelivered");
    setDelivered(stored === null ? null : stored === "true");
    setDeliveredTo(sessionStorage.getItem("jibonjori.pendingDeliveredTo") ?? "");
    setDeliveryReason(sessionStorage.getItem("jibonjori.pendingDeliveryReason") ?? "");
  }, []);

  if (status === "authenticated") {
    return <Navigate to="/app" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const codeProblem = otpCodeError(code);
    if (codeProblem) {
      setError(codeProblem);
      return;
    }
    if (!userId) {
      setError("We lost track of your registration. Please register again.");
      return;
    }

    setSubmitting(true);
    try {
      const user = await verifyOtp(userId, code.trim());
      sessionStorage.removeItem("jibonjori.pendingUserId");
      sessionStorage.removeItem("jibonjori.pendingChannel");
      sessionStorage.removeItem("jibonjori.pendingDelivered");
      sessionStorage.removeItem("jibonjori.pendingDeliveryReason");
      sessionStorage.removeItem("jibonjori.pendingDeliveredTo");
      toast.success(`Welcome, ${user.username}.`, "Your account is active.");
      navigate("/app", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!userId) {
      setError("We lost track of your registration. Please register again.");
      return;
    }
    setError(null);
    setResending(true);
    try {
      const result = await authApi.requestOtp(userId);
      sessionStorage.setItem("jibonjori.pendingDelivered", String(result.delivered));
      sessionStorage.setItem("jibonjori.pendingDeliveryReason", result.deliveryReason ?? "");
      sessionStorage.setItem("jibonjori.pendingDeliveredTo", result.deliveredTo);
      setDelivered(result.delivered);
      setDeliveredTo(result.deliveredTo);
      setDeliveryReason(result.deliveryReason ?? "");

      const copy = deliveryNotice(result, "resent");
      setNotice(copy.body);
      if (copy.tone === "success") toast.success(copy.title, copy.body);
      else toast.warning(copy.title, copy.body);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not resend the code.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <Link to="/" className="mb-6 text-center text-2xl font-bold">
        <span className="jj-gradient-text">JibonJori</span>
      </Link>

      <Card title="Verify your account">
        {delivered === false ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <p className="font-semibold">No verification code could be sent.</p>
            <p className="mt-1">
              {deliveryReason === "DELIVERY_FAILED"
                ? `The server tried to deliver a code to your ${
                    channel === "phone" ? "phone" : "email address"
                  } and the provider rejected it. Try resending in a moment.`
                : "This server has no email or SMS provider configured, so no code was sent and verification cannot be completed. Ask the administrator to configure one, or use the support channel."}
            </p>
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-600">
            {delivered === true && deliveredTo
              ? `Enter the 6-digit code sent to ${deliveredTo}.`
              : `Enter the 6-digit code sent to your ${
                  channel === "phone" ? "phone" : "email address"
                }.`}
          </p>
        )}

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label="Verification code" htmlFor="code" required hint="Exactly 6 digits.">
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="tracking-[0.5em]"
            />
          </Field>

          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              className={
                delivered === false
                  ? "rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  : "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              }
            >
              {notice}
            </p>
          ) : null}

          <Button type="submit" loading={submitting} className="w-full" size="lg">
            Verify and continue
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => void onResend()}
            disabled={resending || !userId}
            className="font-medium text-brand-700 hover:underline disabled:opacity-50"
          >
            {resending ? "Sending..." : "Resend code"}
          </button>
          <Link to="/login" className="text-slate-500 hover:underline">
            Back to sign in
          </Link>
        </div>
      </Card>
    </div>
  );
}
