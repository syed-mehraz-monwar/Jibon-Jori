import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { authApi } from "../../api/auth.api";
import { ApiError } from "../../lib/http";
import { deliveryNotice } from "../../lib/otp";
import { normalizePhoneNumber, phoneError } from "../../lib/validation";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";

/**
 * Phone verification card on the profile screen.
 *
 * It owns the "change / add a phone number" step: the new number is validated and
 * normalized locally, an SMS OTP challenge is requested through Supabase Auth
 * (`updateUser({ phone })`), and the user is handed to the existing `/verify` screen
 * which verifies the code with the `phone_change` OTP type and applies the fresh
 * session.
 *
 * The currently confirmed number is never modified before that verification
 * succeeds, so cancelling simply leaves the auth state untouched.
 */
export function ProfilePhoneCard() {
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [phone, setPhone] = useState(user?.phone ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPhone(user?.phone ?? "");
  }, [user?.phone]);

  if (status !== "authenticated" || !user) {
    return null;
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    const normalized = normalizePhoneNumber(phone);
    const problem = normalized ? null : phoneError(phone);
    if (problem) {
      setError(problem);
      return;
    }
    if (!normalized) return;
    if (user.phone && normalized === user.phone) {
      setError("That is already the phone number on your account.");
      return;
    }

    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const result = await authApi.requestPhoneChangeOtp(normalized);
      const copy = deliveryNotice(result, "resent");
      setNotice(copy.body);
      if (copy.tone === "success") toast.success(copy.title, copy.body);
      else toast.warning(copy.title, copy.body);

      // The OTP screen reads these keys on mount, so the challenge follows the
      // same pending flow the registration screens use (R-012 delivery truth).
      sessionStorage.setItem("jibonjori.pendingUserId", user.id);
      sessionStorage.setItem("jibonjori.pendingPurpose", "phone_change");
      sessionStorage.setItem("jibonjori.pendingChannel", "phone");
      sessionStorage.setItem("jibonjori.pendingPhone", normalized);
      sessionStorage.setItem("jibonjori.pendingDelivered", String(result.delivered));
      sessionStorage.setItem("jibonjori.pendingDeliveryReason", result.deliveryReason ?? "");
      sessionStorage.setItem("jibonjori.pendingDeliveredTo", result.deliveredTo);

      navigate("/verify");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not send a verification code to the new number.");
    } finally {
      setSending(false);
    }
  }

  const verified = Boolean(user.phoneVerifiedAt);

  return (
    <Card title="Phone verification">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Current number</p>
          <p className="text-sm text-slate-600">{user.phone ?? "Not set"}</p>
        </div>
        <span
          className={
            verified
              ? "inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
              : "inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
          }
        >
          {verified ? "Verified" : user.phone ? "Pending verification" : "Not set"}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-600">
        {verified
          ? "Your phone number is verified. Change it below and confirm the new number with a code before it replaces the current one."
          : "Add or change your phone number. We send a six-digit SMS code; the new number is only marked verified after you enter the code correctly."}
      </p>

      <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void sendCode(event)} noValidate>
        <Field
          label="New phone number"
          htmlFor="phoneChange"
          required
          error={phone ? phoneError(phone) : null}
          hint="Bangladesh mobile number, for example 01712345678 or +8801712345678. We will send a six-digit SMS code."
        >
          <Input
            id="phoneChange"
            name="phoneChange"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+8801712345678"
          />
        </Field>

        <Button type="submit" loading={sending} className="w-full" size="lg">
          Send verification code
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}
