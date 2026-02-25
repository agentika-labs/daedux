/**
 * Shared formatting utilities for consistent output across the backend.
 */

/**
 * Format a ratio (0-1) as a percentage string.
 * @param ratio - Value between 0 and 1
 * @param decimals - Number of decimal places (default: 0)
 */
export const formatPercentFromRatio = (ratio: number, decimals = 0): string => {
  return `${(ratio * 100).toFixed(decimals)}%`;
};

/**
 * Format a percentage value as a string.
 * @param percent - Percentage value (already multiplied by 100)
 * @param decimals - Number of decimal places (default: 0)
 */
export const formatPercent = (percent: number, decimals = 0): string => {
  return `${percent.toFixed(decimals)}%`;
};

/**
 * Format a cost value in USD.
 * @param cost - Cost in dollars
 * @param decimals - Number of decimal places (default: 2)
 */
export const formatCost = (cost: number, decimals = 2): string => {
  return `$${cost.toFixed(decimals)}`;
};

/**
 * Convert timestamp (ms) to YYYY-MM-DD string in local timezone.
 * @param timestamp - Unix timestamp in milliseconds
 */
export const toDateString = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
