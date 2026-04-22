import { gte, lte, eq, and, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { UnixTimestampMs } from "../../shared/branded";
import { addMs, nowMs } from "../../shared/branded";
import * as schema from "../db/schema";
import type { HarnessId } from "../parsers/types";

/**
 * Date filter for server-side filtering of analytics queries.
 * Used by the dashboard to filter data by time range and optionally by harness.
 */
export interface DateFilter {
  startTime?: UnixTimestampMs;
  endTime?: UnixTimestampMs;
  harness?: HarnessId | HarnessId[];
}

export interface ComparisonWindows {
  readonly currentStart: UnixTimestampMs;
  readonly currentEnd: UnixTimestampMs;
  readonly previousStart: UnixTimestampMs;
  readonly previousEnd: UnixTimestampMs;
}

export const buildComparisonWindows = (
  dateFilter: DateFilter = {}
): ComparisonWindows => {
  const now = nowMs();
  const hasFilter =
    dateFilter.startTime !== undefined || dateFilter.endTime !== undefined;

  if (!hasFilter) {
    return {
      currentEnd: now,
      currentStart: addMs(now, -7 * DAY_MS),
      previousEnd: addMs(now, -7 * DAY_MS),
      previousStart: addMs(now, -14 * DAY_MS),
    };
  }

  const currentStart =
    dateFilter.startTime ?? addMs(dateFilter.endTime ?? now, -7 * DAY_MS);
  const currentEnd = dateFilter.endTime ?? now;
  const span = Math.max(1, currentEnd - currentStart);

  return {
    currentEnd,
    currentStart,
    previousEnd: currentStart,
    previousStart: addMs(currentStart, -span),
  };
};

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

export const buildFilterConditions = (dateFilter: DateFilter = {}): SQL[] => [
  ...buildDateConditions(dateFilter),
  ...buildHarnessConditions(dateFilter),
];

/** One day in milliseconds */
export const DAY_MS = 86_400_000;

/** One week in milliseconds */
export const WEEK_MS = 7 * DAY_MS;

// ─── Harness Filtering ───────────────────────────────────────────────────────

/**
 * Filter options for harness-based queries.
 */
export interface HarnessFilter {
  harness?: HarnessId | HarnessId[];
}

/**
 * Build SQL conditions for harness filtering on sessions table.
 * Returns an array of conditions that can be spread into `and(...)`.
 *
 * @param filter - The harness filter (single ID or array)
 * @param harnessColumn - The column to filter on (defaults to sessions.harness)
 * @returns Array of SQL conditions (empty if no filter specified)
 */
export const buildHarnessConditions = (
  filter: HarnessFilter,
  harnessColumn: typeof schema.sessions.harness = schema.sessions.harness
): SQL[] => {
  const conditions: SQL[] = [];
  if (filter.harness) {
    if (Array.isArray(filter.harness)) {
      if (filter.harness.length > 0) {
        conditions.push(inArray(harnessColumn, filter.harness));
      }
    } else {
      conditions.push(eq(harnessColumn, filter.harness));
    }
  }
  return conditions;
};

// ─── Child Table Helpers ─────────────────────────────────────────────────────

/**
 * Type representing child tables that have a sessionId column.
 * These tables need to join with sessions table for date filtering.
 */
export interface ChildTableWithSession {
  sessionId: { getSQL: () => unknown };
}

/**
 * Builds a session join expression for child tables.
 * Used when applying date filters to queries on child tables.
 *
 * @param childTable - The child table with sessionId column
 * @returns A join expression that can be passed to `.innerJoin()`
 */
export const sessionJoinOn = <T extends ChildTableWithSession>(childTable: T) =>
  eq(
    childTable.sessionId as unknown as typeof schema.sessions.sessionId,
    schema.sessions.sessionId
  );

/**
 * Gets the sessions table reference for date-filtered joins.
 * Returns the sessions table for use in innerJoin calls.
 */
export const sessionsTable = schema.sessions;

/**
 * Combines date conditions with optional additional conditions.
 * Returns undefined if no conditions (for queries without where clause).
 *
 * @param dateConditions - Array of SQL date conditions from buildDateConditions
 * @param extraConditions - Additional conditions to combine
 * @returns Combined SQL condition or undefined if empty
 */
export const combineConditions = (
  dateConditions: SQL[],
  ...extraConditions: (SQL | undefined)[]
) => {
  const allConditions = [
    ...dateConditions,
    ...extraConditions.filter((c): c is SQL => c !== undefined),
  ];
  return allConditions.length > 0 ? and(...allConditions) : undefined;
};

/**
 * Executes a query with optional date filtering.
 * When date conditions exist, executes the filtered version; otherwise the base version.
 *
 * This helper reduces the repetitive if/else pattern found throughout analytics services
 * where queries need to conditionally join with sessions table for date filtering.
 *
 * @example
 * ```typescript
 * const result = await withDateFilter(
 *   dateConditions,
 *   () => db.select({...}).from(toolUses).groupBy(...),
 *   () => db.select({...}).from(toolUses)
 *     .innerJoin(sessions, eq(toolUses.sessionId, sessions.sessionId))
 *     .where(and(...dateConditions))
 *     .groupBy(...)
 * );
 * ```
 *
 * @param dateConditions - Array of SQL conditions from buildDateConditions
 * @param baseQuery - Query factory for when no date filter is applied
 * @param filteredQuery - Query factory for when date filter should be applied
 * @returns Promise resolving to the query result
 */
export async function withDateFilter<T>(
  dateConditions: SQL[],
  baseQuery: () => Promise<T>,
  filteredQuery: () => Promise<T>
): Promise<T> {
  return dateConditions.length === 0 ? baseQuery() : filteredQuery();
}
