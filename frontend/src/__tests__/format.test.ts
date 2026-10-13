import { describe, expect, it } from "vitest";
import {
  fileNameFromPath,
  formatBytes,
  formatDate,
  formatDateTime,
  initials,
  paginationWindow,
  relativeTime,
  toDateInputValue,
  toPercent,
} from "../lib/format";

describe("date formatting", () => {
  it("returns a placeholder for missing or invalid input", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate("not-a-date")).toBe("-");
    expect(formatDateTime("")).toBe("-");
    expect(toDateInputValue("nonsense")).toBe("");
  });

  it("formats a real timestamp", () => {
    expect(formatDate("2026-01-15T10:00:00.000Z")).toMatch(/2026/);
    expect(formatDateTime("2026-01-15T10:00:00.000Z")).toMatch(/2026/);
  });

  it("produces an input value the native date control accepts", () => {
    expect(toDateInputValue("2026-03-04T00:00:00.000Z")).toMatch(/^2026-03-0[34]$/);
  });
});

describe("relativeTime", () => {
  it("describes recent timestamps", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toMatch(/min ago/);
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toMatch(/h ago/);
    expect(relativeTime(new Date(Date.now() - 4 * 86_400_000).toISOString())).toMatch(/d ago/);
  });

  it("falls back to an empty string for missing input", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime("nonsense")).toBe("");
  });
});

describe("initials", () => {
  it("takes at most the first two initials", () => {
    expect(initials("Rabby Ahmed Khan")).toBe("RA");
    expect(initials("Rabby")).toBe("R");
    expect(initials("   ")).toBe("");
  });
});

describe("formatBytes", () => {
  it("scales the unit and rejects nonsense", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
    expect(formatBytes(-1)).toBe("-");
    expect(formatBytes(Number.NaN)).toBe("-");
  });
});

describe("toPercent", () => {
  it("renders a 0..1 fraction as a percentage", () => {
    expect(toPercent(0.815)).toBe("82%");
    expect(toPercent(1)).toBe("100%");
    expect(toPercent(0)).toBe("0%");
    expect(toPercent(null)).toBe("-");
    expect(toPercent(Number.NaN)).toBe("-");
  });
});

describe("paginationWindow", () => {
  it("keeps the ends and the neighbourhood of the current page", () => {
    expect(paginationWindow(1, 5)).toEqual([1, 2, 3, "...", 5]);
    expect(paginationWindow(10, 20)).toEqual([1, "...", 8, 9, 10, 11, 12, "...", 20]);
  });

  it("returns nothing for an empty result set", () => {
    expect(paginationWindow(1, 0)).toEqual([]);
    expect(paginationWindow(1, -3)).toEqual([]);
  });
});

describe("fileNameFromPath", () => {
  it("returns the last path segment", () => {
    expect(fileNameFromPath("profiles/u1/photo.jpg")).toBe("photo.jpg");
    expect(fileNameFromPath("photo.jpg")).toBe("photo.jpg");
  });
});
