// ─── Statistical Utilities ───────────────────────────────────────────────────

/**
 * Wilson Score Interval - provides confidence bounds for proportions.
 * Unlike naive p = successes/n, Wilson intervals handle small samples gracefully:
 * - 5/5 successes (100%) gets lower bound ~0.57, not 1.0
 * - 1000/1000 successes gets lower bound ~0.996
 *
 * @param successes - Number of successful outcomes
 * @param total - Total number of trials
 * @param confidence - Z-score (default 1.96 for 95% CI)
 * @returns Lower and upper bounds of the confidence interval
 */
export function wilsonScoreInterval(
  successes: number,
  total: number,
  z = 1.96
): { lower: number; upper: number } {
  if (total === 0) {
    return { lower: 0, upper: 1 };
  }

  const p = successes / total;
  const z2 = z * z;
  const n = total;

  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);

  return {
    lower: Math.max(0, (center - spread) / denom),
    upper: Math.min(1, (center + spread) / denom),
  };
}

/**
 * Calculate percentile of a numeric array using linear interpolation.
 * @param values - Array of numbers
 * @param p - Percentile (0-100)
 * @returns The value at the given percentile
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  if (values.length === 1) {
    return values[0]!;
  }

  const sorted = [...values].toSorted((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);

  if (lo === hi) {
    return sorted[lo]!;
  }
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Confidence level based on sample size.
 * - high: >=100 calls - statistically robust
 * - medium: >=20 calls - reasonable confidence
 * - low: <20 calls - interpret with caution
 */
export type ConfidenceLevel = "high" | "medium" | "low";

export function getConfidenceLevel(totalCalls: number): ConfidenceLevel {
  if (totalCalls >= 100) {
    return "high";
  }
  if (totalCalls >= 20) {
    return "medium";
  }
  return "low";
}
