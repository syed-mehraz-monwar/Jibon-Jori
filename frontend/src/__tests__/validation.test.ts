import { describe, expect, it } from "vitest";
import {
  ageFromDob,
  dobError,
  emailError,
  firebasePathError,
  heightError,
  mediaBytesError,
  otpCodeError,
  passwordError,
  phoneError,
  requiredTextError,
  usernameError,
} from "../lib/validation";

describe("usernameError", () => {
  it("accepts letters, digits and underscores of legal length", () => {
    expect(usernameError("rabby_ahmed")).toBeNull();
    expect(usernameError("abc")).toBeNull();
    expect(usernameError("a".repeat(32))).toBeNull();
  });

  it("rejects too short, too long and malformed values", () => {
    expect(usernameError("ab")).toMatch(/at least 3/);
    expect(usernameError("a".repeat(33))).toMatch(/at most 32/);
    expect(usernameError("has space")).toMatch(/letters, numbers and underscores/);
    expect(usernameError("has-dash")).toMatch(/letters, numbers and underscores/);
  });
});

describe("passwordError", () => {
  it("enforces the documented 8..128 range", () => {
    expect(passwordError("1234567")).toMatch(/at least 8/);
    expect(passwordError("12345678")).toBeNull();
    expect(passwordError("x".repeat(129))).toMatch(/at most 128/);
  });
});

describe("emailError / phoneError", () => {
  it("accepts valid and rejects malformed values", () => {
    expect(emailError("user@example.com")).toBeNull();
    expect(emailError("")).toMatch(/Enter an email/);
    expect(emailError("user@example")).toMatch(/valid email/);
    expect(emailError("a b@example.com")).toMatch(/valid email/);
  });

  it("requires E.164 phone numbers", () => {
    expect(phoneError("+8801712345678")).toBeNull();
    expect(phoneError("01712345678")).toMatch(/E\.164/);
    expect(phoneError("+0123456789")).toMatch(/E\.164/);
    expect(phoneError("+1234567")).toMatch(/E\.164/);
  });
});

describe("otpCodeError", () => {
  it("requires exactly six digits", () => {
    expect(otpCodeError("123456")).toBeNull();
    expect(otpCodeError("12345")).toMatch(/6-digit/);
    expect(otpCodeError("1234567")).toMatch(/6-digit/);
    expect(otpCodeError("abcdef")).toMatch(/6-digit/);
  });
});

describe("date of birth", () => {
  it("computes age and enforces the adult-only rule", () => {
    const today = new Date();
    const eighteenYearsAgo = new Date(
      today.getFullYear() - 18,
      today.getMonth(),
      today.getDate()
    );
    const dob = `${eighteenYearsAgo.getFullYear()}-${String(eighteenYearsAgo.getMonth() + 1).padStart(2, "0")}-${String(
      eighteenYearsAgo.getDate()
    ).padStart(2, "0")}`;

    expect(ageFromDob(dob)).toBe(18);
    expect(dobError(dob)).toBeNull();
    expect(dobError("")).toMatch(/Select a date/);
    expect(dobError("not-a-date")).toMatch(/valid date/);
    expect(dobError("2020-01-01")).toMatch(/at least 18/);
    expect(dobError("1899-01-01")).toMatch(/realistic/);
  });

  it("treats a birthday later this year as not yet reached", () => {
    // Built from local date parts: slicing a UTC ISO string would shift the day
    // for timezones east or west of UTC and make this assertion locale-dependent.
    const now = new Date();
    const birthdayTomorrow = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate() + 1);
    const dob = `${birthdayTomorrow.getFullYear()}-${String(birthdayTomorrow.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(birthdayTomorrow.getDate()).padStart(2, "0")}`;

    expect(ageFromDob(dob)).toBe(17);
    expect(dobError(dob)).toMatch(/at least 18/);
  });
});

describe("heightError", () => {
  it("accepts null (not supplied) and the 100..250 range", () => {
    expect(heightError(null)).toBeNull();
    expect(heightError(175)).toBeNull();
    expect(heightError(99)).toMatch(/between 100 and 250/);
    expect(heightError(251)).toMatch(/between 100 and 250/);
    expect(heightError(175.5)).toMatch(/whole number/);
  });
});

describe("mediaBytesError", () => {
  it("enforces the positive-integer and 10 MB bounds", () => {
    expect(mediaBytesError(1024)).toBeNull();
    expect(mediaBytesError(10_000_000)).toBeNull();
    expect(mediaBytesError(0)).toMatch(/positive number/);
    expect(mediaBytesError(-1)).toMatch(/positive number/);
    expect(mediaBytesError(10_000_001)).toMatch(/10 MB/);
  });
});

describe("firebasePathError", () => {
  it("accepts canonical storage paths", () => {
    expect(firebasePathError("profiles/u1/photo.jpg")).toBeNull();
  });

  it("rejects traversal, empty segments and edge slashes", () => {
    expect(firebasePathError("")).toMatch(/Enter the storage path/);
    expect(firebasePathError("a/../b.jpg")).toMatch(/'\.\.'/);
    expect(firebasePathError("a//b.jpg")).toMatch(/empty segments/);
    expect(firebasePathError("/a.jpg")).toMatch(/start or end/);
    expect(firebasePathError("a.jpg/")).toMatch(/start or end/);
    expect(firebasePathError("a b.jpg")).toMatch(/letters, numbers, dot/);
  });
});

describe("requiredTextError", () => {
  it("requires non-blank text and enforces the maximum", () => {
    expect(requiredTextError("Dhaka", "City")).toBeNull();
    expect(requiredTextError("   ", "City")).toMatch(/City is required/);
    expect(requiredTextError("abcd", "About", 3)).toMatch(/at most 3/);
  });
});
