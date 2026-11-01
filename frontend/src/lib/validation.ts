/**
 * Client-side validation that mirrors the backend Zod rules.
 *
 * This is UX only. The backend validates independently and is authoritative;
 * nothing here is treated as a security boundary.
 */

export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
export const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const COMMENT_MAX = 1000;
export const ABOUT_MAX = 2000;
export const BIODATA_MAX = 4000;
export const SOCIAL_URL_MAX = 300;
export const MEDIA_BYTES_MAX = 10_000_000;
export const ALLOWED_MEDIA_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export const FIREBASE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function usernameError(username: string): string | null {
  const value = username.trim();
  if (value.length < 3) return "Username must be at least 3 characters.";
  if (value.length > 32) return "Username must be at most 32 characters.";
  if (!USERNAME_PATTERN.test(value)) return "Use letters, numbers and underscores only.";
  return null;
}

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function emailError(email: string): string | null {
  if (!email.trim()) return "Enter an email address.";
  if (!EMAIL_PATTERN.test(email.trim())) return "Enter a valid email address.";
  return null;
}

export function phoneError(phone: string): string | null {
  if (!phone.trim()) return "Enter a phone number.";
  if (!PHONE_PATTERN.test(phone.trim())) return "Use E.164 format, for example +8801712345678.";
  return null;
}

export function otpCodeError(code: string): string | null {
  if (!/^\d{6}$/.test(code.trim())) return "Enter the 6-digit code.";
  return null;
}

export function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

/**
 * Earliest selectable birth date.
 *
 * The old picker derived its `min` from `today - 18 years`, which presented that
 * date as the *earliest* allowed value and made every older birth date
 * unselectable. The floor is now a fixed, meaningful lower bound and the
 * adult-eligibility rule is applied as the *upper* bound instead.
 */
export const DOB_EARLIEST = "1950-01-01";

/** Oldest age the profile form accepts; guards against typos like year 1050. */
export const DOB_MAX_AGE = 100;

/** `yyyy-mm-dd` for the latest date that still satisfies the 18-year rule. */
export function latestAdultDob(now: Date = new Date()): string {
  const date = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dobError(dob: string, now: Date = new Date()): string | null {
  if (!dob) return "Select a date of birth.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return "Enter a valid date.";
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "Enter a valid date.";
  // Reject impossible calendar dates such as 2001-02-30, which Date rolls over.
  if (toIsoDate(birth) !== dob) return "Enter a valid date.";
  // The "realistic" rule is checked before the lower bound so an obviously
  // impossible year (for example 1899) is reported as unrealistic rather than as
  // a formatting problem. Dates between `DOB_MAX_AGE` and the floor are then
  // reported against the floor itself.
  const age = ageFromDob(dob);
  if (age !== null && age > DOB_MAX_AGE) return "Enter a realistic date of birth.";
  if (dob < DOB_EARLIEST) return `Enter a date on or after ${DOB_EARLIEST}.`;
  const latest = latestAdultDob(now);
  if (dob > latest) return "You must be at least 18 years old.";
  return null;
}

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Combined height bounds. They match the `profiles_height_range` CHECK. */
export const HEIGHT_CM_MIN = 100;
export const HEIGHT_CM_MAX = 250;

export function feetInchesToCm(feet: number, inches: number): number {
  return Math.round((feet * 12 + inches) * 2.54);
}

/**
 * Centimetres to whole feet/inches.
 *
 * The database stores whole centimetres, so a repeated round trip can move by
 * ~1 cm. The form only recomputes the centimetre value when a selector is
 * actually touched, which keeps an untouched height byte-identical on save.
 */
export function cmToFeetInches(heightCm: number): { feet: number; inches: number } {
  const totalInches = Math.round(heightCm / 2.54);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export function heightError(heightCm: number | null): string | null {
  if (heightCm === null) return null;
  if (!Number.isInteger(heightCm)) return "Height must be a whole number of centimetres.";
  if (heightCm < HEIGHT_CM_MIN || heightCm > HEIGHT_CM_MAX) {
    return `Height must be between ${HEIGHT_CM_MIN} and ${HEIGHT_CM_MAX} cm.`;
  }
  return null;
}

export function feetInchesError(feet: number | null, inches: number | null): string | null {
  if (feet === null && inches === null) return null;
  if (feet === null || inches === null) return "Choose both feet and inches.";
  if (!Number.isInteger(feet) || !Number.isInteger(inches)) return "Height must be a whole number of feet and inches.";
  if (inches < 0 || inches > 11) return "Inches must be between 0 and 11.";
  return heightError(feetInchesToCm(feet, inches));
}

/**
 * Social/profile URL validation.
 *
 * Only absolute `https://` URLs with a dot in the host are accepted. That rules
 * out `javascript:`, `data:` and `vbscript:` by construction, and plain `http:`
 * as well because a public profile must not downgrade the transport.
 */
export function socialUrlError(value: string): string | null {
  const url = value.trim();
  if (!url) return null;
  if (url.length > SOCIAL_URL_MAX) return `Links must be at most ${SOCIAL_URL_MAX} characters.`;
  if (!/^https:\/\//i.test(url)) return "Use a full https:// address.";
  if (/\s/.test(url)) return "A link cannot contain spaces.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Enter a valid link.";
  }
  if (parsed.protocol !== "https:") return "Use a full https:// address.";
  if (!parsed.hostname.includes(".")) return "Enter a valid link.";
  return null;
}

/** Normalizes a social link for storage: trimmed, no trailing slash duplication. */
export function normalizeSocialUrl(value: string): string {
  return value.trim();
}

export function mediaBytesError(bytes: number): string | null {
  if (!Number.isInteger(bytes) || bytes <= 0) return "File size must be a positive number of bytes.";
  if (bytes > MEDIA_BYTES_MAX) return "File is larger than the 10 MB limit.";
  return null;
}

export function firebasePathError(path: string): string | null {
  const value = path.trim();
  if (!value) return "Enter the storage path of the uploaded file.";
  if (value.length > 1024) return "Path is too long.";
  if (!FIREBASE_PATH_PATTERN.test(value)) return "Path may contain letters, numbers, dot, underscore, dash and slash only.";
  if (value.includes("..")) return "Path may not contain '..'.";
  if (value.startsWith("/") || value.endsWith("/")) return "Path may not start or end with '/'.";
  if (value.includes("//")) return "Path may not contain empty segments.";
  return null;
}

export function requiredTextError(value: string, label: string, max?: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  if (max !== undefined && trimmed.length > max) return `${label} must be at most ${max} characters.`;
  return null;
}
