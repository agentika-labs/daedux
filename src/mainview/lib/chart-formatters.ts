/**
 * Shared formatters for Recharts axis ticks and tooltips.
 * Hoisted as stable references to prevent re-creation on render.
 */

/** Format date for X-axis ticks */
export const formatDateTick = (value: string) => {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

/** Format currency for Y-axis ticks (2 decimal places) */
export const formatCurrencyAxisTick = (value: number) => `$${value.toFixed(2)}`;

/** Format currency for Y-axis ticks (0 decimal places) */
export const formatCurrencyAxisTickRounded = (value: number) =>
  `$${value.toFixed(0)}`;

/** Format percentage for Y-axis ticks */
export const formatPercentAxisTick = (value: number) => `${value.toFixed(0)}%`;
