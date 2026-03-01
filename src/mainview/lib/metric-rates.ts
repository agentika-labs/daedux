/**
 * Rate-based metric calculations for time-range-agnostic thresholds.
 *
 * Instead of scaling absolute thresholds by date range (e.g., 30 actions in 7d vs 30d),
 * we normalize to daily rates. This provides consistent interpretation across all time periods.
 */

import type { FilterOption } from "@/queries/dashboard";

/**
 * VCS Activity daily rate thresholds:
 * - < 15/day = Low (default gray)
 * - 15-40/day = Moderate (warning yellow)
 * - > 40/day = Active (success green)
 */
export const VCS_DAILY_THRESHOLDS = {
  low: 15,
  moderate: 40,
} as const;

/**
 * Calculate the number of days in a given filter range.
 */
export function getDaysInRange(
  filter: FilterOption,
  dateRange?: { from: string; to: string }
): number {
  if (filter === "today") {
    return 1;
  }
  if (filter === "7d") {
    return 7;
  }
  if (filter === "30d") {
    return 30;
  }

  // For "all" filter, calculate from actual date range
  if (dateRange) {
    const fromDate = new Date(dateRange.from);
    const toDate = new Date(dateRange.to);
    const days = Math.ceil(
      (toDate.getTime() - fromDate.getTime()) / 86_400_000
    );
    return Math.max(days, 1);
  }

  // Fallback to 7 if no date range provided
  return 7;
}

/**
 * Calculate daily rate from total count and days.
 */
export function calculateDailyRate(count: number, days: number): number {
  return days > 0 ? count / days : 0;
}

/**
 * Get the variant (color) for VCS activity based on daily rate.
 */
export function getVcsRateVariant(
  rate: number
): "success" | "warning" | "default" {
  if (rate >= VCS_DAILY_THRESHOLDS.moderate) {
    return "success";
  }
  if (rate >= VCS_DAILY_THRESHOLDS.low) {
    return "warning";
  }
  return "default";
}

/**
 * Format a rate for display:
 * - >= 10: no decimal places (e.g., "42")
 * - < 10: one decimal place (e.g., "4.3")
 */
export function formatRate(rate: number): string {
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1);
}
