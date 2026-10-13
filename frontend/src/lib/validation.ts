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

export function dobError(dob: string): string | null {
  if (!dob) return "Select a date of birth.";
  const age = ageFromDob(dob);
  if (age === null) return "Enter a valid date.";
  if (age < 18) return "You must be at least 18 years old.";
  if (age > 100) return "Enter a realistic date of birth.";
  return null;
}

export function heightError(heightCm: number | null): string | null {
  if (heightCm === null) return null;
  if (!Number.isInteger(heightCm)) return "Height must be a whole number of centimetres.";
  if (heightCm < 100 || heightCm > 250) return "Height must be between 100 and 250 cm.";
  return null;
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
