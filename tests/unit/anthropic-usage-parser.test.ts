import { describe, expect, it } from "bun:test";

/**
 * These functions are tested as reimplementations since they're module-private.
 * In production, they're used internally by tryCliUsage().
 */

/** Parse "2h 30m" or "4d 12h" duration string to Unix timestamp */
const parseResetTime = (timeStr: string): number | null => {
  const now = Date.now();
  let ms = 0;

  const days = timeStr.match(/(\d+)d/);
  const hours = timeStr.match(/(\d+)h/);
  const mins = timeStr.match(/(\d+)m/);

  if (days?.[1]) ms += parseInt(days[1], 10) * 24 * 60 * 60 * 1000;
  if (hours?.[1]) ms += parseInt(hours[1], 10) * 60 * 60 * 1000;
  if (mins?.[1]) ms += parseInt(mins[1], 10) * 60 * 1000;

  return ms > 0 ? Math.floor((now + ms) / 1000) : null;
};

interface UsageWindow {
  percentUsed: number;
  resetAt: number | null;
  limit: string | null;
}

interface ParsedUsage {
  session: UsageWindow;
  weekly: UsageWindow;
  opus: UsageWindow | null;
  sonnet: UsageWindow | null;
}

/** Parse TUI output to extract usage percentages */
const parseUsageOutput = (output: string): ParsedUsage => {
  // Strip ANSI escape codes
  const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

  // Extract percentages using regex
  const sessionMatch = clean.match(/Session.*?(\d+)%/i);
  const weeklyMatch = clean.match(/Weekly.*?(\d+)%/i);
  const opusMatch = clean.match(/Opus.*?(\d+)%/i);
  const sonnetMatch = clean.match(/Sonnet.*?(\d+)%/i);

  // Extract reset times (e.g., "resets in 2h 30m")
  const sessionResetMatch = clean.match(/Session.*?resets in ([^)]+)/i);
  const weeklyResetMatch = clean.match(/Weekly.*?resets in ([^)]+)/i);

  return {
    session: {
      percentUsed: sessionMatch?.[1] ? parseInt(sessionMatch[1], 10) : 0,
      resetAt: sessionResetMatch?.[1] ? parseResetTime(sessionResetMatch[1]) : null,
      limit: "5-hour window",
    },
    weekly: {
      percentUsed: weeklyMatch?.[1] ? parseInt(weeklyMatch[1], 10) : 0,
      resetAt: weeklyResetMatch?.[1] ? parseResetTime(weeklyResetMatch[1]) : null,
      limit: "7-day limit",
    },
    opus: opusMatch?.[1]
      ? {
          percentUsed: parseInt(opusMatch[1], 10),
          resetAt: null,
          limit: "Opus 7-day",
        }
      : null,
    sonnet: sonnetMatch?.[1]
      ? {
          percentUsed: parseInt(sonnetMatch[1], 10),
          resetAt: null,
          limit: "Sonnet 7-day",
        }
      : null,
  };
};

describe("parseResetTime", () => {
  it("parses hours only", () => {
    const result = parseResetTime("2h");
    const expectedMs = 2 * 60 * 60 * 1000;
    const now = Date.now();

    expect(result).toBeGreaterThan(Math.floor(now / 1000));
    expect(result).toBeLessThanOrEqual(Math.floor((now + expectedMs) / 1000) + 1);
  });

  it("parses minutes only", () => {
    const result = parseResetTime("30m");
    const expectedMs = 30 * 60 * 1000;
    const now = Date.now();

    expect(result).toBeGreaterThan(Math.floor(now / 1000));
    expect(result).toBeLessThanOrEqual(Math.floor((now + expectedMs) / 1000) + 1);
  });

  it("parses days only", () => {
    const result = parseResetTime("4d");
    const expectedMs = 4 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    expect(result).toBeGreaterThan(Math.floor(now / 1000));
    expect(result).toBeLessThanOrEqual(Math.floor((now + expectedMs) / 1000) + 1);
  });

  it("parses combined hours and minutes", () => {
    const result = parseResetTime("2h 30m");
    const expectedMs = (2 * 60 + 30) * 60 * 1000;
    const now = Date.now();

    expect(result).toBeGreaterThan(Math.floor(now / 1000));
    expect(result).toBeLessThanOrEqual(Math.floor((now + expectedMs) / 1000) + 1);
  });

  it("parses combined days and hours", () => {
    const result = parseResetTime("4d 12h");
    const expectedMs = (4 * 24 + 12) * 60 * 60 * 1000;
    const now = Date.now();

    expect(result).toBeGreaterThan(Math.floor(now / 1000));
    expect(result).toBeLessThanOrEqual(Math.floor((now + expectedMs) / 1000) + 1);
  });

  it("returns null for empty string", () => {
    expect(parseResetTime("")).toBeNull();
  });

  it("returns null for invalid format", () => {
    expect(parseResetTime("invalid")).toBeNull();
  });
});

describe("parseUsageOutput", () => {
  it("parses complete usage output", () => {
    const output = `
      Session usage: 45% (resets in 2h 30m)
      Weekly usage: 62% (resets in 4d 12h)
      Opus: 78% (resets in 4d 12h)
      Sonnet: 35% (resets in 4d 12h)
    `;

    const result = parseUsageOutput(output);

    expect(result.session.percentUsed).toBe(45);
    expect(result.session.resetAt).not.toBeNull();
    expect(result.weekly.percentUsed).toBe(62);
    expect(result.weekly.resetAt).not.toBeNull();
    expect(result.opus?.percentUsed).toBe(78);
    expect(result.sonnet?.percentUsed).toBe(35);
  });

  it("handles output with ANSI escape codes", () => {
    // Simulated TUI output with ANSI color codes
    const output = `\x1b[32mSession usage: 45%\x1b[0m (resets in 2h)
      \x1b[33mWeekly usage: 62%\x1b[0m (resets in 4d)`;

    const result = parseUsageOutput(output);

    expect(result.session.percentUsed).toBe(45);
    expect(result.weekly.percentUsed).toBe(62);
  });

  it("handles missing model-specific limits", () => {
    const output = `
      Session usage: 30% (resets in 1h)
      Weekly usage: 50% (resets in 3d)
    `;

    const result = parseUsageOutput(output);

    expect(result.session.percentUsed).toBe(30);
    expect(result.weekly.percentUsed).toBe(50);
    expect(result.opus).toBeNull();
    expect(result.sonnet).toBeNull();
  });

  it("returns zeros for no match", () => {
    const output = "No usage data available";

    const result = parseUsageOutput(output);

    expect(result.session.percentUsed).toBe(0);
    expect(result.session.resetAt).toBeNull();
    expect(result.weekly.percentUsed).toBe(0);
    expect(result.weekly.resetAt).toBeNull();
  });

  it("handles case-insensitive matching", () => {
    const output = `
      SESSION USAGE: 25% (resets in 3h)
      WEEKLY USAGE: 75% (resets in 5d)
    `;

    const result = parseUsageOutput(output);

    expect(result.session.percentUsed).toBe(25);
    expect(result.weekly.percentUsed).toBe(75);
  });
});
