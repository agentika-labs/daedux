/**
 * Tray menu formatting utilities.
 *
 * Provides Unicode-based visual elements for the system tray menu:
 * - Progress bars using thin block characters
 * - Status indicators for warning/critical thresholds
 * - Rate limit and extra usage formatters
 */

// Thin blocks - distinctive and readable at small sizes
const FILLED = "▰";
const EMPTY = "▱";

/**
 * Generate a Unicode progress bar.
 * @param percent - Percentage value (0-100)
 * @param width - Number of characters in the bar (default: 10)
 * @returns Progress bar string like "▰▰▰▰▰▰▰▰▱▱"
 */
export const progressBar = (percent: number, width = 10): string => {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return FILLED.repeat(filled) + EMPTY.repeat(empty);
};

/**
 * Get a status indicator symbol based on usage threshold.
 * @param percent - Percentage value (0-100)
 * @returns Status emoji: "" (normal), " ⚠" (warning >=70%), " ⛔" (critical >=90%)
 */
export const statusIndicator = (percent: number): string => {
  if (percent >= 90) return " ⛔";
  if (percent >= 70) return " ⚠";
  return "";
};

/**
 * Format a rate limit item with progress bar, label, and status.
 * @param label - Short label (e.g., "Session", "Weekly")
 * @param percent - Usage percentage (0-100)
 * @param windowHint - Optional time window hint (e.g., "5h", "7d")
 * @returns Formatted string like "▰▰▰▰▰▰▰▰▱▱  Session (5h)   78% ⚠"
 */
export const formatRateLimitItem = (
  label: string,
  percent: number,
  windowHint?: string
): string => {
  const bar = progressBar(percent);
  const status = statusIndicator(percent);
  const pctStr = `${percent.toFixed(0)}%`.padStart(4);
  const labelWithHint = windowHint ? `${label} (${windowHint})` : label;
  return `${bar}  ${labelWithHint.padEnd(14)}${pctStr}${status}`;
};

/**
 * Format extra usage (Max overage) with clear over/under indication.
 * @param spent - Amount spent in USD
 * @param limit - Spending limit in USD (null = no limit)
 * @returns Formatted string like "$40.42 spent (over $37.50 cap) ⚠"
 */
export const formatExtraUsage = (spent: number, limit: number | null): string => {
  const spentStr = `$${spent.toFixed(2)}`;

  if (limit === null) {
    return `${spentStr} spent (no cap)`;
  }

  if (spent > limit) {
    return `${spentStr} spent (over $${limit.toFixed(2)} cap) ⚠`;
  }

  return `${spentStr} / $${limit.toFixed(2)}`;
};

/**
 * Format subscription tier as a menu header.
 * @param subscriptionType - Raw subscription type from API
 * @returns Formatted header like "─── Claude Max ───"
 */
export const formatSubscriptionHeader = (subscriptionType: string): string => {
  const tierMap: Record<string, string> = {
    max: "Claude Max",
    pro: "Claude Pro",
    free: "Claude Free",
    team: "Claude Team",
    enterprise: "Claude Enterprise",
  };
  const tierName = tierMap[subscriptionType.toLowerCase()] ?? `Claude ${subscriptionType}`;
  return `─── ${tierName} ───`;
};

/**
 * Format daily stats line combining sessions and cost.
 * @param sessions - Number of sessions today
 * @param cost - Total cost today in USD
 * @returns Formatted string like "166 sessions  ·  $207.00 today"
 */
export const formatDailyStats = (sessions: number, cost: number): string => {
  const sessionsStr = sessions === 1 ? "session" : "sessions";
  return `${sessions} ${sessionsStr}  ·  $${cost.toFixed(2)} today`;
};
