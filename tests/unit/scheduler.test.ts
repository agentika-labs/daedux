/**
 * SchedulerService Unit Tests
 *
 * Tests pure utility functions exported from the scheduler service.
 * These don't require database or external dependencies.
 */

import { describe, test, expect } from "bun:test";

import {
  calculateNextRunTime,
  isScheduleDue,
  parseDaysOfWeek,
} from "../../src/bun/services/scheduler";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Create a Date object for a specific day/time in local timezone.
 * Useful for creating predictable test fixtures.
 */
const createDate = (
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number
): Date => new Date(year, month - 1, day, hour, minute, 0, 0);

// ─── calculateNextRunTime Tests ──────────────────────────────────────────────

describe("calculateNextRunTime", () => {
  describe("basic scheduling", () => {
    test("returns null when daysOfWeek is empty", () => {
      const result = calculateNextRunTime(9, 0, []);
      expect(result).toBeNull();
    });

    test("schedules for later today if time hasn't passed", () => {
      // Monday at 8:00 AM
      const now = createDate(2025, 3, 10, 8, 0).getTime();
      // Schedule for 9:00 AM on Monday (day 1)
      const result = calculateNextRunTime(9, 0, [1], now);

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getHours()).toBe(9);
      expect(resultDate.getMinutes()).toBe(0);
      expect(resultDate.getDay()).toBe(1); // Monday
    });

    test("skips today if scheduled time has passed", () => {
      // Monday at 10:00 AM
      const now = createDate(2025, 3, 10, 10, 0).getTime();
      // Schedule for 9:00 AM on Monday (day 1)
      const result = calculateNextRunTime(9, 0, [1], now);

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      // Should be next Monday, not today
      expect(resultDate.getDay()).toBe(1);
      expect(resultDate.getDate()).toBe(17); // Next Monday
    });

    test("finds next valid day when today is not in schedule", () => {
      // Tuesday at 8:00 AM (day 2)
      const now = createDate(2025, 3, 11, 8, 0).getTime();
      // Schedule for Monday and Friday (days 1, 5)
      const result = calculateNextRunTime(9, 0, [1, 5], now);

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getDay()).toBe(5); // Friday
    });
  });

  describe("edge cases", () => {
    test("handles midnight (00:00)", () => {
      const now = createDate(2025, 3, 10, 23, 30).getTime();
      const result = calculateNextRunTime(0, 0, [2], now); // Tuesday

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getHours()).toBe(0);
      expect(resultDate.getMinutes()).toBe(0);
    });

    test("handles end of day (23:59)", () => {
      const now = createDate(2025, 3, 10, 8, 0).getTime();
      const result = calculateNextRunTime(23, 59, [1], now); // Monday

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getHours()).toBe(23);
      expect(resultDate.getMinutes()).toBe(59);
    });

    test("handles Sunday (day 0) correctly", () => {
      // Saturday at 8:00 AM (day 6)
      const now = createDate(2025, 3, 15, 8, 0).getTime();
      const result = calculateNextRunTime(9, 0, [0], now); // Sunday

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getDay()).toBe(0); // Sunday
    });

    test("handles all days of week", () => {
      const now = createDate(2025, 3, 10, 8, 0).getTime();
      const result = calculateNextRunTime(9, 0, [0, 1, 2, 3, 4, 5, 6], now);

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      // Should be today if today's time hasn't passed
      expect(resultDate.getDay()).toBe(1); // Monday
    });

    test("wraps around week boundary", () => {
      // Saturday at 10:00 AM (day 6), schedule already passed
      const now = createDate(2025, 3, 15, 10, 0).getTime();
      // Schedule for Saturday at 9:00 AM
      const result = calculateNextRunTime(9, 0, [6], now);

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getDay()).toBe(6); // Next Saturday
      expect(resultDate.getDate()).toBe(22); // One week later
    });

    test("returns result in future even when exact time matches now", () => {
      // Exactly 9:00 AM Monday
      const now = createDate(2025, 3, 10, 9, 0).getTime();
      const result = calculateNextRunTime(9, 0, [1], now);

      expect(result).not.toBeNull();
      // Should be next week since current time equals scheduled time
      expect(result!).toBeGreaterThan(now);
    });
  });

  describe("multiple days scheduling", () => {
    test("chooses nearest day in week", () => {
      // Wednesday at 8:00 AM (day 3)
      const now = createDate(2025, 3, 12, 8, 0).getTime();
      // Monday, Thursday (days 1, 4)
      const result = calculateNextRunTime(9, 0, [1, 4], now);

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getDay()).toBe(4); // Thursday is closer than next Monday
    });

    test("sorts days correctly regardless of input order", () => {
      const now = createDate(2025, 3, 10, 8, 0).getTime();
      // Days in random order: Friday, Monday, Wednesday
      const result = calculateNextRunTime(9, 0, [5, 1, 3], now);

      expect(result).not.toBeNull();
      const resultDate = new Date(result!);
      expect(resultDate.getDay()).toBe(1); // Monday (today)
    });
  });
});

// ─── isScheduleDue Tests ─────────────────────────────────────────────────────

describe("isScheduleDue", () => {
  test("returns false when nextRunAt is null", () => {
    expect(isScheduleDue(null)).toBe(false);
  });

  test("returns true when nextRunAt is in the past", () => {
    const now = Date.now();
    const pastTime = now - 60_000; // 1 minute ago
    expect(isScheduleDue(pastTime, now)).toBe(true);
  });

  test("returns true when nextRunAt equals now", () => {
    const now = Date.now();
    expect(isScheduleDue(now, now)).toBe(true);
  });

  test("returns false when nextRunAt is in the future", () => {
    const now = Date.now();
    const futureTime = now + 60_000; // 1 minute from now
    expect(isScheduleDue(futureTime, now)).toBe(false);
  });

  test("handles very old timestamps", () => {
    const now = Date.now();
    const veryOld = now - 365 * 24 * 60 * 60 * 1000; // 1 year ago
    expect(isScheduleDue(veryOld, now)).toBe(true);
  });

  test("handles very recent past", () => {
    const now = Date.now();
    const justPassed = now - 1; // 1ms ago
    expect(isScheduleDue(justPassed, now)).toBe(true);
  });
});

// ─── parseDaysOfWeek Tests ───────────────────────────────────────────────────

describe("parseDaysOfWeek", () => {
  describe("valid JSON arrays", () => {
    test("parses empty array", () => {
      expect(parseDaysOfWeek("[]")).toEqual([]);
    });

    test("parses single day", () => {
      expect(parseDaysOfWeek("[1]")).toEqual([1]);
    });

    test("parses multiple days", () => {
      expect(parseDaysOfWeek("[0,1,2,3,4,5,6]")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    test("parses days with spaces", () => {
      expect(parseDaysOfWeek("[ 1, 3, 5 ]")).toEqual([1, 3, 5]);
    });

    test("handles weekday schedule (Mon-Fri)", () => {
      expect(parseDaysOfWeek("[1,2,3,4,5]")).toEqual([1, 2, 3, 4, 5]);
    });

    test("handles weekend schedule", () => {
      expect(parseDaysOfWeek("[0,6]")).toEqual([0, 6]);
    });
  });

  describe("invalid inputs", () => {
    test("returns empty array for invalid JSON", () => {
      expect(parseDaysOfWeek("not json")).toEqual([]);
    });

    test("returns empty array for JSON object", () => {
      expect(parseDaysOfWeek('{"days": [1,2,3]}')).toEqual([]);
    });

    test("returns empty array for JSON string", () => {
      expect(parseDaysOfWeek('"monday"')).toEqual([]);
    });

    test("returns empty array for JSON number", () => {
      expect(parseDaysOfWeek("42")).toEqual([]);
    });

    test("returns empty array for null JSON", () => {
      expect(parseDaysOfWeek("null")).toEqual([]);
    });
  });

  describe("edge cases", () => {
    test("filters out invalid day numbers (< 0)", () => {
      expect(parseDaysOfWeek("[-1, 0, 1]")).toEqual([]);
    });

    test("filters out invalid day numbers (> 6)", () => {
      expect(parseDaysOfWeek("[5, 6, 7]")).toEqual([]);
    });

    test("accepts decimal numbers in valid range (implementation detail)", () => {
      // Note: The implementation only checks typeof === "number" and range 0-6
      // Decimals like 1.5 pass the check, though not semantically valid days
      expect(parseDaysOfWeek("[1.5, 2, 3]")).toEqual([1.5, 2, 3]);
    });

    test("filters out string values in array", () => {
      expect(parseDaysOfWeek('["monday", 1, 2]')).toEqual([]);
    });

    test("returns empty array for mixed valid/invalid", () => {
      // The function returns [] if any element is invalid
      expect(parseDaysOfWeek("[1, 2, 99]")).toEqual([]);
    });

    test("handles boundary values 0 and 6", () => {
      expect(parseDaysOfWeek("[0, 6]")).toEqual([0, 6]);
    });
  });
});
