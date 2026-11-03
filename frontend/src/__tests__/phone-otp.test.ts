/**
 * Phone number verification (SMS OTP) — application-level coverage.
 *
 * These tests exercise the JibonJori phone flow end to end at the API layer with
 * the in-memory Supabase fake: Bangladesh normalization, the native Supabase
 * SMS OTP send (`signInWithOtp`), verification (`verifyOtp` with type `sms`) and
 * resend, plus the unverified-phone sign-in mapping.
 *
 * They are explicitly MOCKED tests: they prove the client wiring, normalization,
 * error mapping and state handling. They do not prove that an SMS actually reached
 * a real phone — that requires the configured SMS provider and a live device,
 * and is tracked separately as BLOCKED / NOT RUN.
 */
import { describe, expect, it } from "vitest";
import { authApi, setPendingEmail, setPendingPhone } from "../api/auth.api";
import { ApiError } from "../lib/http";
import { fakeSupabase, seedAuth } from "./fake-supabase";
import { normalizePhoneNumber, phoneError } from "../lib/validation";

const BD_NUMBER = "+8801712345678";

describe("normalizePhoneNumber (Bangladesh)", () => {
  it("normalizes national, country-code and E.164 Bangladesh formats to +880 E.164", () => {
    expect(normalizePhoneNumber("01712345678")).toBe("+8801712345678");
    expect(normalizePhoneNumber("8801712345678")).toBe("+8801712345678");
    expect(normalizePhoneNumber("+8801712345678")).toBe("+8801712345678");
    expect(normalizePhoneNumber("+880 1712 345 678")).toBe("+8801712345678");
  });

  it("rejects numbers that are not valid Bangladeshi mobiles", () => {
    expect(normalizePhoneNumber("0171234567")).toBeNull();
    expect(normalizePhoneNumber("+0123456789")).toBeNull();
    expect(normalizePhoneNumber("12345")).toBeNull();
    expect(normalizePhoneNumber("not-a-phone")).toBeNull();
  });

  it("rejects invalid input without producing a partial normalization", () => {
    expect(phoneError("01712345678")).toBeNull();
    expect(phoneError("0171234567")).toMatch(/valid Bangladesh E\.164 mobile number/);
  });
});

describe("phone registration — SMS OTP send", () => {
  it("normalizes a national-format Bangladesh number and sends the Supabase SMS OTP", async () => {
    const result = await authApi.register({ username: "rabby", password: "correct-horse-1", phone: "01712345678" });

    expect(fakeSupabase.state.auth.lastOtpRequest).toEqual({
      phone: BD_NUMBER,
      options: { shouldCreateUser: true, data: { username: "rabby" } },
    });
    expect(result.channel).toBe("phone");
    expect(result.delivered).toBe(true);
    expect(result.deliveredTo).toBe("***78");
    expect(result.expiresInSeconds).toBe(600);
  });

  it("rejects an invalid phone number before any provider request is made", async () => {
    const failure = await authApi
      .register({ username: "rabby", password: "correct-horse-1", phone: "12345" })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("VALIDATION_ERROR");
    expect(fakeSupabase.state.auth.lastOtpRequest).toBeNull();
  });

  it("reports an undelivered challenge when the SMS provider is not configured", async () => {
    fakeSupabase.state.auth.otpError = { message: "SMS provider not configured", status: 500 };
    const result = await authApi.register({ username: "rabby", password: "correct-horse-1", phone: "+8801712345678" });

    expect(result.channel).toBe("phone");
    expect(result.delivered).toBe(false);
    expect(result.deliveryReason).toBe("NO_PROVIDER");
    expect(fakeSupabase.state.auth.lastOtpRequest?.phone).toBe(BD_NUMBER);
  });

  it("reports a delivery failure when the SMS provider rejects the message", async () => {
    fakeSupabase.state.auth.otpError = { message: "Twilio rejected the message", status: 500 };
    const result = await authApi.register({ username: "rabby", password: "correct-horse-1", phone: "+8801712345678" });

    expect(result.delivered).toBe(false);
    expect(result.deliveryReason).toBe("DELIVERY_FAILED");
  });
});

describe("phone verification — resend and verify", () => {
  it("resends the SMS OTP for a phone challenge", async () => {
    fakeSupabase.state.auth.otpError = null;
    const result = await authApi.requestOtp({ channel: "phone", phone: BD_NUMBER });

    expect(fakeSupabase.state.auth.lastOtpRequest).toEqual({ phone: BD_NUMBER, options: { shouldCreateUser: true } });
    expect(result.channel).toBe("phone");
    expect(result.delivered).toBe(true);
  });

  it("verifies an SMS OTP with the sms type against the normalized phone", async () => {
    seedAuth({ id: "u1", username: "rabby" });
    fakeSupabase.state.auth.session = { access_token: "test-access", refresh_token: "test-refresh", user: { id: "u1" } };
    fakeSupabase.state.auth.otpVerifyError = null;

    const result = await authApi.verifyOtp({ userId: "", purpose: "register", code: "123456", channel: "phone", phone: BD_NUMBER });

    expect(fakeSupabase.state.auth.lastOtpVerify).toEqual({ phone: BD_NUMBER, token: "123456", type: "sms" });
    expect(result.accessToken).toBe("test-access");
    expect(result.refreshToken).toBe("test-refresh");
    expect(result.user.phoneVerifiedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.user.status).toBe("active");
  });

  it("rejects an incorrect SMS OTP without creating a session", async () => {
    seedAuth({ id: "u1", username: "rabby" });
    fakeSupabase.state.auth.otpVerifyError = { message: "OTP invalid", status: 400, code: "otp_invalid" };

    const failure = await authApi
      .verifyOtp({ userId: "", purpose: "register", code: "000000", channel: "phone", phone: BD_NUMBER })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("INVALID_OTP");
  });

  it("keeps the email OTP verification path intact (regression)", async () => {
    seedAuth({ id: "u1", username: "rabby" });
    setPendingEmail("rabby@example.com");
    fakeSupabase.state.auth.otpVerifyError = null;

    const result = await authApi.verifyOtp({ userId: "u1", purpose: "register", code: "123456", channel: "email" });

    expect(fakeSupabase.state.auth.lastOtpVerify).toEqual({ email: "rabby@example.com", token: "123456", type: "signup" });
    expect(result.user.id).toBe("u1");
  });

  it("stores the pending phone for the verification step", () => {
    setPendingPhone(BD_NUMBER);
    expect(window.sessionStorage.getItem("jibonjori.pendingPhone")).toBe(BD_NUMBER);
  });
});
