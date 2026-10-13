import { describe, expect, it, vi } from "vitest";
import { ApiError, notifyUnauthorized, onUnauthorized } from "../lib/http";

/**
 * The transport that used to live in `lib/http.ts` is gone - the application talks to
 * Supabase through `lib/supabase.ts`. What remains is the error contract the UI
 * branches on (`ApiError.isValidation`, `issueFor`) and the unauthorized callback
 * that lets React state be dropped when a session dies. Those are what is tested.
 */
describe("ApiError", () => {
  it("carries a status, a code and structured issues", () => {
    const error = new ApiError(422, "VALIDATION_ERROR", "Invalid request.", [
      { path: "username", message: "Username is already taken." },
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(422);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.isValidation).toBe(true);
    expect(error.issueFor("username")).toBe("Username is already taken.");
    expect(error.issueFor("email")).toBeUndefined();
  });

  it("defaults the issues to an empty array and is not a validation error otherwise", () => {
    const error = new ApiError(404, "NOT_FOUND", "No such profile.");
    expect(error.issues).toEqual([]);
    expect(error.isValidation).toBe(false);
  });
});

describe("unauthorized notifications", () => {
  it("invokes every subscribed handler and supports disposal", () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = onUnauthorized(first);
    const disposeSecond = onUnauthorized(second);

    notifyUnauthorized();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    disposeFirst();
    disposeSecond();
    notifyUnauthorized();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
