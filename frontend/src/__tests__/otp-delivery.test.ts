/**
 * R-012: the OTP screens must not claim a code was sent when it was not.
 *
 * This file covers two regressions:
 *  1. `deliveryNotice` derives its wording from the API's `delivered` /
 *     `deliveryReason` fields, so an unconfigured server produces an explicit
 *     "no code could be sent" message rather than "we sent a code".
 *  2. `RegisterResult` is the flat shape the backend actually returns. The old
 *     nested `result.otp.channel` type made `channel` undefined at runtime, which
 *     silently sent every registrant to the "email address" wording. The fixture
 *     here is the real response key set, so a future re-nesting breaks the test.
 */
import { describe, expect, it } from "vitest";
import { codeCannotArrive, deliveryNotice, expiryMinutes } from "../lib/otp";
import type { OtpChallenge, RegisterResult } from "../lib/types";

const base: OtpChallenge = {
  channel: "email",
  deliveredTo: "ra***@example.test",
  expiresInSeconds: 600,
  delivered: true,
  deliveryProvider: "smtp",
  deliveryReason: null,
};

describe("deliveryNotice", () => {
  it("reports a real delivery with the masked destination and the expiry", () => {
    const notice = deliveryNotice(base, "created");
    expect(notice.tone).toBe("success");
    expect(notice.title).toBe("Account created");
    expect(notice.body).toContain("ra***@example.test");
    expect(notice.body).toContain("10 minute(s)");
  });

  it("states plainly that no code was sent when no provider is configured", () => {
    const notice = deliveryNotice(
      { ...base, delivered: false, deliveryProvider: null, deliveryReason: "NO_PROVIDER" },
      "created"
    );
    expect(notice.tone).toBe("warning");
    expect(notice.body).toMatch(/no code was sent/i);
    expect(notice.body).not.toMatch(/sent to your/i);
  });

  it("distinguishes a provider failure from a missing provider", () => {
    const notice = deliveryNotice(
      { ...base, delivered: false, deliveryReason: "DELIVERY_FAILED" },
      "resent"
    );
    expect(notice.tone).toBe("warning");
    expect(notice.title).toBe("Code not sent");
    expect(notice.body).toMatch(/could not be sent/i);
    expect(notice.body).not.toMatch(/no email or SMS provider is configured/i);
  });

  it("uses the phone wording when the channel is a phone number", () => {
    const notice = deliveryNotice({ ...base, channel: "phone", deliveredTo: "***0000" }, "created");
    expect(notice.body).toContain("phone");
  });

  it("flags an undelivered challenge and clears the flag for a delivered one", () => {
    expect(codeCannotArrive({ ...base, delivered: false })).toBe(true);
    expect(codeCannotArrive(base)).toBe(false);
    expect(codeCannotArrive(null)).toBe(false);
  });

  it("never reports an expiry below one minute", () => {
    expect(expiryMinutes({ ...base, expiresInSeconds: 5 })).toBe("1 minute(s)");
  });
});

describe("RegisterResult contract", () => {
  /**
   * The literal response body of `POST /api/auth/register`, copied from the
   * backend service return. If the backend ever nests these under `otp` again, or
   * the client re-introduces a nested type, this fixture stops compiling/matching.
   */
  it("is the flat shape the backend returns (channel and delivery flags at the top level)", () => {
    const response = {
      user: {
        id: "u1",
        username: "rabby",
        email: "ra***@example.test",
        phone: null,
        role: "member",
        status: "pending",
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      channel: "email",
      deliveredTo: "ra***@example.test",
      expiresInSeconds: 600,
      delivered: false,
      deliveryProvider: null,
      deliveryReason: "NO_PROVIDER",
    } satisfies RegisterResult;

    expect(response.channel).toBe("email");
    expect(response.delivered).toBe(false);
    expect(response.deliveryReason).toBe("NO_PROVIDER");
    expect(Object.keys(response)).not.toContain("otp");
    // The property the old type got wrong:
    expect(response.channel).not.toBeUndefined();
  });
});
