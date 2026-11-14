import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { authApi, readPendingPhone } from "../api/auth.api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../lib/http";
import { deliveryNotice, resendCooldownSecondsLeft } from "../lib/otp";
import { otpCodeError } from "../lib/validation";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";

export function VerifyOtpPage() {
  const { verifyOtp, status } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [userId, setUserId] = useState("");
  const [purpose, setPurpose] = useState<"register" | "phone_change">("register");
  const [channel, setChannel] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [deliveredTo, setDeliveredTo] = useState("");
  const [deliveryReason, setDeliveryReason] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Registration writes the pending user id / channel / phone here, so a refresh
  // on this page still knows which account the code belongs to, plus whether a
  // code was actually delivered (R-012) so the copy below does not assert one is
  // coming. A phone *change* (profile editing) writes the same keys for the signed-in
  // user and the NEW number it is verifying.
  useEffect(() => {
    setUserId(sessionStorage.getItem("jibonjori.pendingUserId") ?? "");
    setPurpose((sessionStorage.getItem("jibonjori.pendingPurpose") ?? "register") as "register" | "phone_change");
    setChannel((sessionStorage.getItem("jibonjori.pendingChannel") ?? "email") as "email" | "phone");
    setPhone(readPendingPhone() ?? "");
    const stored = sessionStorage.getItem("jibonjori.pendingDelivered");
    setDelivered(stored === null ? null : stored === "true");
    setDeliveredTo(sessionStorage.getItem("jibonjori.pendingDeliveredTo") ?? "");
    setDeliveryReason(sessionStorage.getItem("jibonjori.pendingDeliveryReason") ?? "");
  }, []);

  // Client-side resend cooldown (seconds) after a code was sent or after a
  // successful verification cleared it.
  useEffect(() => {
    if (resendAt === null) {
      setCooldownSeconds(0);
      return;
    }
    const tick = () => setCooldownSeconds(resendCooldownSecondsLeft(resendAt, Date.now()));
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [resendAt]);

  // A registration challenge only applies while the visitor is anonymous; a phone
  // *change* (profile editing) applies to a signed-in member and must NOT be
  // abandoned by this redirect, or the freshly verified new number could never be
  // applied.
  if (status === "authenticated" && purpose !== "phone_change") {
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
    // Phone challenges are keyed by the phone number, not a pre-existing user id:
    // the OTP send creates the account, so an empty user id is expected there. A phone
    // *change* is always tied to the signed-in user, so its user id is present.
    if (purpose === "register" && !userId && channel !== "phone") {
      setError("We lost track of your registration. Please register again.");
      return;
    }

    setSubmitting(true);
    try {
      const user = await verifyOtp(userId, code.trim(), {
        purpose,
        channel: channel === "phone" ? "phone" : "email",
        ...(channel === "phone" ? { phone } : {}),
      });
      setResendAt(null);
      setCooldownSeconds(0);
      sessionStorage.removeItem("jibonjori.pendingUserId");
      sessionStorage.removeItem("jibonjori.pendingChannel");
      sessionStorage.removeItem("jibonjori.pendingPurpose");
      sessionStorage.removeItem("jibonjori.pendingDelivered");
      sessionStorage.removeItem("jibonjori.pendingDeliveryReason");
      sessionStorage.removeItem("jibonjori.pendingDeliveredTo");
      if (channel === "phone") sessionStorage.removeItem("jibonjori.pendingPhone");
      toast.success(`Welcome, ${user.username}.`, channel === "phone" ? "Your phone number is now verified." : "Your account is active.");
      navigate("/app", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (purpose === "register" && !userId && channel !== "phone") {
      setError("We lost track of your registration. Please register again.");
      return;
    }
    setError(null);
    setResending(true);
    try {
      const result =
        purpose === "phone_change"
          ? await authApi.resendPhoneChangeOtp(phone)
          : await authApi.requestOtp({ userId, channel, phone });
      sessionStorage.setItem("jibonjori.pendingDelivered", String(result.delivered));
      sessionStorage.setItem("jibonjori.pendingDeliveryReason", result.deliveryReason ?? "");
      sessionStorage.setItem("jibonjori.pendingDeliveredTo", result.deliveredTo);
      setDelivered(result.delivered);
      setDeliveredTo(result.deliveredTo);
      setDeliveryReason(result.deliveryReason ?? "");
      setResendAt(Date.now());
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
    <AuthLayout
      title="Verify your account"
      subtitle={
        delivered === false
          ? undefined
          : delivered === true && deliveredTo
            ? `Enter the 6-digit code sent to ${deliveredTo}.`
            : `Enter the 6-digit code sent to your ${
                channel === "phone" ? "phone" : "email address"
              }.`
      }
      footer={
        <>
          Wrong account?{" "}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
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
      ) : null}

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
            className="text-center text-lg tracking-[0.5em]"
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

      <button
        type="button"
        onClick={() => void onResend()}
        disabled={resending || cooldownSeconds > 0 || (purpose === "register" && channel === "email" && !userId)}
        className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-brand-700 transition hover:underline disabled:opacity-50"
      >
        {resending
          ? "Sending…"
          : cooldownSeconds > 0
            ? `Resend code (${cooldownSeconds}s)`
            : "Resend code"}
      </button>
    </AuthLayout>
  );
}
