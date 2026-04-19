import { describe, expect, it } from "bun:test";

import {
  parseUsageOutput,
  parseResetTimeFromDate,
} from "../../src/bun/services/anthropic-usage/tui-parser";

describe("parseResetTimeFromDate", () => {
  const fixedNow = new Date("2026-03-15T10:00:00Z");

  describe("time-only formats", () => {
    it("parses '4am' format", () => {
      const result = parseResetTimeFromDate("4am (Europe/London)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getHours()).toBe(4);
      expect(resetDate.getMinutes()).toBe(0);
    });

    it("parses '3:59am' format", () => {
      const result = parseResetTimeFromDate("3:59am (Europe/London)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getHours()).toBe(3);
      expect(resetDate.getMinutes()).toBe(59);
    });

    it("parses '4pm' format", () => {
      const result = parseResetTimeFromDate("4pm (America/New_York)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getHours()).toBe(16);
    });

    it("handles 12am (midnight)", () => {
      const result = parseResetTimeFromDate("12am (UTC)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getHours()).toBe(0);
    });

    it("handles 12pm (noon)", () => {
      const result = parseResetTimeFromDate("12pm (UTC)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getHours()).toBe(12);
    });

    it("returns tomorrow if time has passed today", () => {
      const earlyNow = new Date("2026-03-15T15:00:00Z");
      const result = parseResetTimeFromDate("4am (Europe/London)", earlyNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getDate()).toBe(16);
    });
  });

  describe("date + time formats", () => {
    it("parses 'Mar 3 at 4pm' format", () => {
      const result = parseResetTimeFromDate("Mar 3 at 4pm (Europe/London)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getMonth()).toBe(2); // March = 2
      expect(resetDate.getDate()).toBe(3);
      expect(resetDate.getHours()).toBe(16);
    });

    it("parses 'Jan 15 at 8am' format", () => {
      const result = parseResetTimeFromDate("Jan 15 at 8am (UTC)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getMonth()).toBe(0); // January = 0
      expect(resetDate.getDate()).toBe(15);
      expect(resetDate.getHours()).toBe(8);
    });

    it("rolls to next year if date passed", () => {
      const result = parseResetTimeFromDate("Jan 1 at 12am (UTC)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getFullYear()).toBe(2027);
    });
  });

  describe("date-only formats", () => {
    it("parses 'Mar 1' format", () => {
      const result = parseResetTimeFromDate("Mar 1 (Europe/London)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getMonth()).toBe(2);
      expect(resetDate.getDate()).toBe(1);
      expect(resetDate.getHours()).toBe(0);
    });

    it("parses 'Dec 25' format", () => {
      const result = parseResetTimeFromDate("Dec 25 (UTC)", fixedNow);
      expect(result).not.toBeNull();
      const resetDate = new Date(result! * 1000);
      expect(resetDate.getMonth()).toBe(11);
      expect(resetDate.getDate()).toBe(25);
    });
  });

  describe("edge cases", () => {
    it("returns null for empty string", () => {
      expect(parseResetTimeFromDate("", fixedNow)).toBeNull();
    });

    it("returns null for invalid format", () => {
      expect(parseResetTimeFromDate("invalid", fixedNow)).toBeNull();
    });

    it("strips timezone suffix correctly", () => {
      const result = parseResetTimeFromDate("4am (Europe/London)", fixedNow);
      expect(result).not.toBeNull();
    });
  });
});

describe("parseUsageOutput", () => {
  it("parses complete TUI output with all sections", () => {
    const output = `
Current session
[████████░░░░░░░░░░░░]                          21% used
Resets 3:59am (Europe/London)

Current week (all models)
[██░░░░░░░░░░░░░░░░░░]                          2% used
Resets Mar 3 at 4pm (Europe/London)

Current week (Sonnet only)
[░░░░░░░░░░░░░░░░░░░░]                          0% used

Extra usage
[████████████████████]                          100% used
$40.42 / $37.50 spent · Resets Mar 1 (Europe/London)
`;

    const result = parseUsageOutput(output);

    expect(result.session.percentUsed).toBe(21);
    expect(result.weekly.percentUsed).toBe(2);
    expect(result.sonnet?.percentUsed).toBe(0);
    expect(result.extraUsage?.percentUsed).toBe(100);
    expect(result.extraUsage?.spentUsd).toBe(40.42);
    expect(result.extraUsage?.limitUsd).toBe(37.5);
    expect(result.source).toBe("cli");
  });

  it("handles ANSI escape codes", () => {
    const output = `\u001B[32mCurrent session\u001B[0m
\u001B[33m45% used\u001B[0m`;

    const result = parseUsageOutput(output);
    expect(result.session.percentUsed).toBe(45);
  });

  it("uses positional extraction when 4+ percentage patterns found", () => {
    const output = `
Current session 21% used
Current week (all models) 15% used
Sonnet only 8% used
Extra usage 50% used
`;

    const result = parseUsageOutput(output);
    expect(result.session.percentUsed).toBe(21);
    expect(result.weekly.percentUsed).toBe(15);
    expect(result.sonnet?.percentUsed).toBe(8);
    expect(result.extraUsage?.percentUsed).toBe(50);
  });

  it("falls back to label-based regex for incomplete output", () => {
    const output = `
Current session 30% used
`;

    const result = parseUsageOutput(output);
    expect(result.session.percentUsed).toBe(30);
    expect(result.weekly.percentUsed).toBe(0);
  });

  it("extracts spending pattern", () => {
    const output = `
Extra usage
$25.50 / $50.00 spent
`;

    const result = parseUsageOutput(output);
    expect(result.extraUsage?.spentUsd).toBe(25.5);
    expect(result.extraUsage?.limitUsd).toBe(50);
  });

  it("parses reset times from output", () => {
    const output = `
Current session 21% used Resets 4am (Europe/London)
Current week (all models) 2% used Resets Mar 3 at 4pm (Europe/London)
`;

    const result = parseUsageOutput(output);
    expect(result.session.resetAtRaw).toBe("4am (Europe/London)");
    expect(result.session.resetAt).not.toBeNull();
    expect(result.weekly.resetAt).not.toBeNull();
  });

  it("sets source to cli", () => {
    const result = parseUsageOutput("45% used");
    expect(result.source).toBe("cli");
  });

  it("sets fetchedAt timestamp", () => {
    const before = Date.now();
    const result = parseUsageOutput("45% used");
    const after = Date.now();
    expect(result.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(result.fetchedAt).toBeLessThanOrEqual(after);
  });
});
