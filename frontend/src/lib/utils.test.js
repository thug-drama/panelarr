import { describe, expect, it } from "vitest";

import { cn, formatBytes, formatDate, formatSize } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("dedupes conflicting Tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("handles falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });
});

describe("formatSize", () => {
  it("returns em-dash for falsy input", () => {
    expect(formatSize(0)).toBe(", ");
    expect(formatSize(null)).toBe(", ");
  });

  it("formats GB for values >= 1 GB", () => {
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("formats MB for values < 1 GB", () => {
    expect(formatSize(500 * 1024 * 1024)).toBe("500 MB");
  });
});

describe("formatBytes", () => {
  it("returns 0 B for falsy", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("scales through unit ladder", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});

describe("formatDate", () => {
  it("returns em-dash for empty input", () => {
    expect(formatDate(null)).toBe(", ");
    expect(formatDate("")).toBe(", ");
  });

  it("formats ISO dates as Mon DD, YYYY", () => {
    // Use UTC noon to dodge timezone rollover for the assertion
    expect(formatDate("2026-04-07T12:00:00Z")).toMatch(/Apr 7, 2026/);
  });
});
