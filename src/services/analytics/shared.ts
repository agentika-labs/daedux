import { gte, lte, type SQL } from "drizzle-orm";
import * as schema from "../../db/schema";

// Re-export shared utilities from metrics
export { cacheHitRatio, totalInputWithCache } from "../metrics";
export type { TokenInputBreakdown, TokenBreakdown } from "../metrics";

// ─── Date Filter Types ───────────────────────────────────────────────────────

/**
 * Date filter for server-side filtering of analytics queries.
 * Used by the dashboard to filter data by time range.
 */
export interface DateFilter {
  startTime?: number; // Unix ms - sessions starting on or after this time
  endTime?: number; // Unix ms - sessions starting on or before this time
}

// ─── Comparison Windows ──────────────────────────────────────────────────────

export interface ComparisonWindows {
  readonly currentStart: number;
  readonly currentEnd: number;
  readonly previousStart: number;
  readonly previousEnd: number;
}

/** Build comparable current/previous windows, honoring explicit date filters when present. */
export const buildComparisonWindows = (dateFilter: DateFilter = {}): ComparisonWindows => {
  const now = Date.now();
  const hasFilter = dateFilter.startTime !== undefined || dateFilter.endTime !== undefined;

  if (!hasFilter) {
    return {
      currentStart: now - 7 * 86400000,
      currentEnd: now,
      previousStart: now - 14 * 86400000,
      previousEnd: now - 7 * 86400000,
    };
  }

  const currentStart = dateFilter.startTime ?? (dateFilter.endTime ?? now) - 7 * 86400000;
  const currentEnd = dateFilter.endTime ?? now;
  const span = Math.max(1, currentEnd - currentStart);

  return {
    currentStart,
    currentEnd,
    previousStart: currentStart - span,
    previousEnd: currentStart,
  };
};

// ─── Date Condition Builder ──────────────────────────────────────────────────

/**
 * Build SQL conditions for date filtering on session startTime.
 * Returns an array of conditions that can be spread into `and(...)`.
 *
 * @param dateFilter - The date filter containing optional startTime and endTime
 * @param timeColumn - The column to filter on (defaults to sessions.startTime)
 * @returns Array of SQL conditions (empty if no filter specified)
 */
export const buildDateConditions = (
  dateFilter: DateFilter,
  timeColumn: typeof schema.sessions.startTime = schema.sessions.startTime
): SQL[] => {
  const conditions: SQL[] = [];
  if (dateFilter.startTime) {
    conditions.push(gte(timeColumn, dateFilter.startTime));
  }
  if (dateFilter.endTime) {
    conditions.push(lte(timeColumn, dateFilter.endTime));
  }
  return conditions;
};

// ─── Common Constants ────────────────────────────────────────────────────────

/** One day in milliseconds */
export const DAY_MS = 86400000;

/** One week in milliseconds */
export const WEEK_MS = 7 * DAY_MS;
