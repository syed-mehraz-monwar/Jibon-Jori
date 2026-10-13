import type { OtpChallenge } from "./types";

/**
 * R-012: the wording a screen may use after an OTP challenge, derived from what the
 * API actually reported rather than from the assumption that a code was sent.
 *
 * Before this existed, registration answered `deliveredTo` (a masked destination)
 * and every screen said "we sent a code", which was false whenever no email/SMS
 * provider was configured. The backend now reports `delivered` and
 * `deliveryReason`, and these strings are the only place the client turns that into
 * user-facing prose, so the two registration screens cannot drift apart.
 */
export type DeliveryNotice = {
  tone: "success" | "warning";
  title: string;
  body: string;
};

export function deliveryNotice(challenge: OtpChallenge, context: "created" | "resent"): DeliveryNotice {
  const channelLabel = challenge.channel === "phone" ? "phone" : "email address";

  if (challenge.delivered) {
    return {
      tone: "success",
      title: context === "created" ? "Account created" : "Code sent",
      body: `Enter the 6-digit code sent to your ${channelLabel} (${challenge.deliveredTo}). It expires in ${expiryMinutes(challenge)}.`,
    };
  }

  if (challenge.deliveryReason === "DELIVERY_FAILED") {
    return {
      tone: "warning",
      title: context === "created" ? "Account created" : "Code not sent",
      body: `Your account is created, but the code could not be sent to your ${channelLabel} just now. Request a new one in a moment.`,
    };
  }

  return {
    tone: "warning",
    title: context === "created" ? "Account created" : "Code not sent",
    body: `Your account is created, but no email or SMS provider is configured on this server, so no code was sent. Verification cannot be completed until one is.`,
  };
}

export function expiryMinutes(challenge: OtpChallenge): string {
  return `${Math.max(1, Math.round(challenge.expiresInSeconds / 60))} minute(s)`;
}

/** True when a verification screen should explain that no code can arrive. */
export function codeCannotArrive(challenge: OtpChallenge | null): boolean {
  return challenge !== null && !challenge.delivered;
}
