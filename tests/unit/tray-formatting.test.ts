import { describe, expect, it } from "bun:test";
import {
  statusIndicator,
  formatRateLimitItem,
  formatExtraUsage,
  formatSubscriptionHeader,
  formatDailyStats,
} from "../../src/bun/utils/tray-formatting";

describe("statusIndicator", () => {
  it("returns empty string for normal usage (<70%)", () => {
    expect(statusIndicator(0)).toBe("");
    expect(statusIndicator(50)).toBe("");
    expect(statusIndicator(69)).toBe("");
  });

  it("returns warning indicator at 70%", () => {
    expect(statusIndicator(70)).toBe("⚠");
  });

  it("returns warning indicator at 70%+", () => {
    expect(statusIndicator(78)).toBe("⚠");
    expect(statusIndicator(89)).toBe("⚠");
    expect(statusIndicator(90)).toBe("⚠");
    expect(statusIndicator(95)).toBe("⚠");
    expect(statusIndicator(100)).toBe("⚠");
  });
});

describe("formatRateLimitItem", () => {
  it("formats with window hint in two-column layout", () => {
    const result = formatRateLimitItem("Session", 78, "5h");
    // Label left-aligned, percentage right-aligned with warning
    expect(result).toBe("Session (5h)       78%⚠");
  });

  it("formats without window hint", () => {
    const result = formatRateLimitItem("Opus", 25);
    expect(result).toBe("Opus               25%");
  });

  it("shows warning indicator at 70%+", () => {
    const result = formatRateLimitItem("Weekly", 70, "7d");
    expect(result).toContain("⚠");
  });

  it("aligns percentages correctly for various values", () => {
    // Single digit
    expect(formatRateLimitItem("Sonnet", 0)).toBe("Sonnet              0%");
    // Double digit
    expect(formatRateLimitItem("Weekly", 9, "7d")).toBe("Weekly (7d)         9%");
    // Triple digit
    expect(formatRateLimitItem("Session", 100, "5h")).toBe("Session (5h)      100%⚠");
  });
});

describe("formatExtraUsage", () => {
  it("formats under limit", () => {
    const result = formatExtraUsage(20.5, 50);
    expect(result).toBe("$20.50 / $50.00");
  });

  it("formats over limit with warning", () => {
    const result = formatExtraUsage(40.42, 37.5);
    expect(result).toBe("$40.42 over cap ⚠");
  });

  it("formats with no cap", () => {
    const result = formatExtraUsage(100, null);
    expect(result).toBe("$100.00 (no cap)");
  });
});

describe("formatSubscriptionHeader", () => {
  it("formats known tiers", () => {
    expect(formatSubscriptionHeader("max")).toBe("◉ Claude Max");
    expect(formatSubscriptionHeader("pro")).toBe("◉ Claude Pro");
    expect(formatSubscriptionHeader("free")).toBe("◉ Claude Free");
    expect(formatSubscriptionHeader("team")).toBe("◉ Claude Team");
    expect(formatSubscriptionHeader("enterprise")).toBe("◉ Claude Enterprise");
  });

  it("handles case insensitivity", () => {
    expect(formatSubscriptionHeader("MAX")).toBe("◉ Claude Max");
    expect(formatSubscriptionHeader("Pro")).toBe("◉ Claude Pro");
  });

  it("handles unknown tiers", () => {
    expect(formatSubscriptionHeader("custom")).toBe("◉ Claude custom");
  });
});

describe("formatDailyStats", () => {
  it("formats single session correctly", () => {
    expect(formatDailyStats(1, 5.5)).toBe("1 session · $5.50 today");
  });

  it("formats multiple sessions with large cost (rounds to whole number)", () => {
    expect(formatDailyStats(166, 207)).toBe("166 sessions · $207 today");
  });

  it("formats multiple sessions with small cost (keeps decimals)", () => {
    expect(formatDailyStats(10, 45.67)).toBe("10 sessions · $45.67 today");
  });

  it("formats zero sessions", () => {
    expect(formatDailyStats(0, 0)).toBe("0 sessions · $0.00 today");
  });

  it("formats cost at boundary (100 rounds)", () => {
    expect(formatDailyStats(50, 100)).toBe("50 sessions · $100 today");
    expect(formatDailyStats(50, 99.99)).toBe("50 sessions · $99.99 today");
  });
});
