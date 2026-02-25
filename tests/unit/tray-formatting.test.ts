import { describe, expect, it } from "bun:test";
import {
  progressBar,
  statusIndicator,
  formatRateLimitItem,
  formatExtraUsage,
  formatSubscriptionHeader,
  formatDailyStats,
} from "../../src/bun/utils/tray-formatting";

describe("progressBar", () => {
  it("renders empty bar at 0%", () => {
    expect(progressBar(0)).toBe("▱▱▱▱▱▱▱▱▱▱");
  });

  it("renders full bar at 100%", () => {
    expect(progressBar(100)).toBe("▰▰▰▰▰▰▰▰▰▰");
  });

  it("renders half-filled bar at 50%", () => {
    expect(progressBar(50)).toBe("▰▰▰▰▰▱▱▱▱▱");
  });

  it("renders 78% correctly (8 filled)", () => {
    expect(progressBar(78)).toBe("▰▰▰▰▰▰▰▰▱▱");
  });

  it("clamps values above 100", () => {
    expect(progressBar(150)).toBe("▰▰▰▰▰▰▰▰▰▰");
  });

  it("clamps values below 0", () => {
    expect(progressBar(-10)).toBe("▱▱▱▱▱▱▱▱▱▱");
  });

  it("respects custom width", () => {
    expect(progressBar(50, 4)).toBe("▰▰▱▱");
  });
});

describe("statusIndicator", () => {
  it("returns empty string for normal usage (<70%)", () => {
    expect(statusIndicator(0)).toBe("");
    expect(statusIndicator(50)).toBe("");
    expect(statusIndicator(69)).toBe("");
  });

  it("returns warning indicator at 70%", () => {
    expect(statusIndicator(70)).toBe(" ⚠");
  });

  it("returns warning indicator between 70-89%", () => {
    expect(statusIndicator(78)).toBe(" ⚠");
    expect(statusIndicator(89)).toBe(" ⚠");
  });

  it("returns critical indicator at 90%", () => {
    expect(statusIndicator(90)).toBe(" ⛔");
  });

  it("returns critical indicator above 90%", () => {
    expect(statusIndicator(95)).toBe(" ⛔");
    expect(statusIndicator(100)).toBe(" ⛔");
  });
});

describe("formatRateLimitItem", () => {
  it("formats with window hint", () => {
    const result = formatRateLimitItem("Session", 78, "5h");
    expect(result).toContain("▰▰▰▰▰▰▰▰▱▱");
    expect(result).toContain("Session (5h)");
    expect(result).toContain("78%");
    expect(result).toContain("⚠");
  });

  it("formats without window hint", () => {
    const result = formatRateLimitItem("Opus", 25);
    expect(result).toContain("▰▰▰▱▱▱▱▱▱▱");
    expect(result).toContain("Opus");
    expect(result).toContain("25%");
    expect(result).not.toContain("⚠");
    expect(result).not.toContain("⛔");
  });

  it("shows critical indicator at 90%+", () => {
    const result = formatRateLimitItem("Weekly", 95, "7d");
    expect(result).toContain("⛔");
  });
});

describe("formatExtraUsage", () => {
  it("formats under limit", () => {
    const result = formatExtraUsage(20.5, 50);
    expect(result).toBe("$20.50 / $50.00");
  });

  it("formats over limit with warning", () => {
    const result = formatExtraUsage(40.42, 37.5);
    expect(result).toBe("$40.42 spent (over $37.50 cap) ⚠");
  });

  it("formats with no cap", () => {
    const result = formatExtraUsage(100, null);
    expect(result).toBe("$100.00 spent (no cap)");
  });
});

describe("formatSubscriptionHeader", () => {
  it("formats known tiers", () => {
    expect(formatSubscriptionHeader("max")).toBe("─── Claude Max ───");
    expect(formatSubscriptionHeader("pro")).toBe("─── Claude Pro ───");
    expect(formatSubscriptionHeader("free")).toBe("─── Claude Free ───");
    expect(formatSubscriptionHeader("team")).toBe("─── Claude Team ───");
    expect(formatSubscriptionHeader("enterprise")).toBe("─── Claude Enterprise ───");
  });

  it("handles case insensitivity", () => {
    expect(formatSubscriptionHeader("MAX")).toBe("─── Claude Max ───");
    expect(formatSubscriptionHeader("Pro")).toBe("─── Claude Pro ───");
  });

  it("handles unknown tiers", () => {
    expect(formatSubscriptionHeader("custom")).toBe("─── Claude custom ───");
  });
});

describe("formatDailyStats", () => {
  it("formats single session correctly", () => {
    expect(formatDailyStats(1, 5.5)).toBe("1 session  ·  $5.50 today");
  });

  it("formats multiple sessions correctly", () => {
    expect(formatDailyStats(166, 207)).toBe("166 sessions  ·  $207.00 today");
  });

  it("formats zero sessions", () => {
    expect(formatDailyStats(0, 0)).toBe("0 sessions  ·  $0.00 today");
  });
});
