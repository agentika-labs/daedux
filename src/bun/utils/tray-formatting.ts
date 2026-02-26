/**
 * Tray menu formatting utilities.
 *
 * Provides formatting functions for the system tray menu:
 * - Status indicators for warning/critical thresholds
 * - Rate limit and extra usage formatters
 * - Subscription and daily stats formatters
 */

/**
 * Get a status indicator symbol based on usage threshold.
 * @param percent - Percentage value (0-100)
 * @returns Status emoji: "" (normal), "⚠" (warning >=70%)
 */
export const statusIndicator = (percent: number): string => {
  if (percent >= 70) {
    return " ⚠";
  }
  return "";
};

/**
 * Format a rate limit item with label and percentage separated by em-dash.
 * Uses em-dash for separation since macOS menus use proportional fonts
 * where tab characters render as small spaces (no tab stop support).
 * @param label - Short label (e.g., "Session", "Weekly")
 * @param percent - Usage percentage (0-100)
 * @param windowHint - Optional time window hint (e.g., "5h", "7d")
 * @returns Formatted string like "Session (5h) — 40%"
 */
export const formatRateLimitItem = (
  label: string,
  percent: number,
  windowHint?: string
): string => {
  const status = statusIndicator(percent);
  const pctStr = `${percent.toFixed(0)}%`;
  const labelWithHint = windowHint ? `${label} (${windowHint})` : label;
  return `${labelWithHint} — ${pctStr}${status}`;
};

/**
 * Format extra usage (Max overage) with clear over/under indication.
 * @param spent - Amount spent in USD
 * @param limit - Spending limit in USD (null = no limit)
 * @returns Formatted string like "$40.42 / $37.50 extra ⚠"
 */
export const formatExtraUsage = (
  spent: number,
  limit: number | null
): string => {
  const spentStr = `$${spent.toFixed(2)}`;

  if (limit === null) {
    return `${spentStr} extra`;
  }

  const limitStr = `$${limit.toFixed(2)}`;
  const warning = spent > limit ? " ⚠" : "";
  return `${spentStr} / ${limitStr} extra${warning}`;
};

/**
 * Format subscription tier as a menu header.
 * @param subscriptionType - Raw subscription type from API
 * @returns Formatted header like "◉ Claude Max"
 */
export const formatSubscriptionHeader = (subscriptionType: string): string => {
  const tierMap: Record<string, string> = {
    enterprise: "Claude Enterprise",
    free: "Claude Free",
    max: "Claude Max",
    pro: "Claude Pro",
    team: "Claude Team",
  };
  const tierName =
    tierMap[subscriptionType.toLowerCase()] ?? `Claude ${subscriptionType}`;
  return `◉ ${tierName}`;
};

/**
 * Format daily stats line combining sessions and cost.
 * @param sessions - Number of sessions today
 * @param cost - Total cost today in USD
 * @returns Formatted string like "166 sessions · $207 today"
 */
export const formatDailyStats = (sessions: number, cost: number): string => {
  const sessionsStr = sessions === 1 ? "session" : "sessions";
  // Round large amounts (>=100) to reduce visual noise
  const costStr = cost >= 100 ? `$${Math.round(cost)}` : `$${cost.toFixed(2)}`;
  return `${sessions} ${sessionsStr} · ${costStr} today`;
};
