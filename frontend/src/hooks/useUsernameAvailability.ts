import { useEffect, useState } from "react";
import { authApi } from "../api/auth.api";
import { USERNAME_PATTERN } from "../lib/validation";
import { useDebouncedValue } from "./useDebouncedValue";

export type UsernameCheckStatus =
  | "idle"
  | "checking"
  | "available"
  | "unavailable"
  | "invalid"
  | "rate_limited"
  | "error";

export type UsernameAvailabilityState = {
  status: UsernameCheckStatus;
  message: string;
  reason: string | null;
};

/**
 * Backend `reason` -> presentation. Every entry carries its own `reason` so the
 * locally detected problems (which never reach the server) expose the same shape
 * as the server answers instead of an object with a missing field.
 */
const REASON_MESSAGES: Record<string, UsernameAvailabilityState> = {
  ok: { status: "available", message: "This username is available.", reason: "ok" },
  taken: { status: "unavailable", message: "This username is already taken.", reason: "taken" },
  reserved: { status: "unavailable", message: "This username is reserved.", reason: "reserved" },
  too_short: {
    status: "invalid",
    message: "Username must be at least 3 characters.",
    reason: "too_short",
  },
  too_long: {
    status: "invalid",
    message: "Username must be at most 32 characters.",
    reason: "too_long",
  },
  invalid_format: {
    status: "invalid",
    message: "Use letters, numbers and underscores only.",
    reason: "invalid_format",
  },
  rate_limited: {
    status: "rate_limited",
    message: "Too many checks. Pause for a moment.",
    reason: "rate_limited",
  },
  invalid_payload: {
    status: "invalid",
    message: "Enter a valid username.",
    reason: "invalid_payload",
  },
  error: {
    status: "error",
    message: "Could not check availability right now.",
    reason: "error",
  },
};

/**
 * Live username availability, "while typing" (Spec §4 / R-021).
 *
 * There is no server push for this anymore: availability is resolved by the
 * `username_available` SQL function (the same rule the unique index enforces), so
 * the check is a single request per debounced value. The `username:available`
 * event name remains in `lib/realtime` for compatibility but is not emitted.
 *
 * The input is debounced, and a locally detectable format problem is reported
 * immediately without contacting the server at all.
 */
export function useUsernameAvailability(username: string): UsernameAvailabilityState {
  const debounced = useDebouncedValue(username, 300);
  const [state, setState] = useState<UsernameAvailabilityState>({
    status: "idle",
    message: "",
    reason: null,
  });

  useEffect(() => {
    const value = debounced.trim();

    if (!value) {
      setState({ status: "idle", message: "", reason: null });
      return;
    }

    // Local pre-check: same rules as the server, but instant and request-free.
    if (value.length < 3) {
      setState(REASON_MESSAGES.too_short);
      return;
    }
    if (value.length > 32) {
      setState(REASON_MESSAGES.too_long);
      return;
    }
    if (!USERNAME_PATTERN.test(value)) {
      setState(REASON_MESSAGES.invalid_format);
      return;
    }

    setState({ status: "checking", message: "Checking availability...", reason: null });

    const controller = new AbortController();
    authApi
      .usernameAvailability(value, controller.signal)
      .then((result) => {
        const mapped = REASON_MESSAGES[result.reason] ?? REASON_MESSAGES.error;
        setState({ ...mapped, reason: result.reason });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState(REASON_MESSAGES.error);
      });

    return () => controller.abort();
  }, [debounced]);

  return state;
}
