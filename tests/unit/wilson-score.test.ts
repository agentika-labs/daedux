/**
 * Unit tests for Wilson Score Interval statistical utilities.
 * These functions provide confidence bounds for proportion estimates.
 */
import { describe, expect, it } from "bun:test";

import {
  wilsonScoreInterval,
  percentile,
  getConfidenceLevel,
} from "../../src/bun/analytics/tool-analytics";

describe("wilsonScoreInterval", () => {
  it("returns [0, 1] for zero total", () => {
    const result = wilsonScoreInterval(0, 0);
    expect(result.lower).toBe(0);
    expect(result.upper).toBe(1);
  });

  it("gives conservative lower bound for small perfect sample", () => {
    // 5/5 successes should NOT give 1.0 lower bound
    const result = wilsonScoreInterval(5, 5);
    expect(result.lower).toBeLessThan(0.7); // Wilson lower ~0.57
    expect(result.upper).toBe(1); // Upper can be 1
  });

  it("gives tight lower bound for large perfect sample", () => {
    // 1000/1000 successes should give high lower bound
    const result = wilsonScoreInterval(1000, 1000);
    expect(result.lower).toBeGreaterThan(0.99); // Wilson lower ~0.996
    expect(result.upper).toBe(1);
  });

  it("handles single success correctly", () => {
    const result = wilsonScoreInterval(1, 1);
    expect(result.lower).toBeLessThan(0.3); // Very uncertain
    expect(result.upper).toBe(1);
  });

  it("handles single failure correctly", () => {
    const result = wilsonScoreInterval(0, 1);
    expect(result.lower).toBe(0);
    expect(result.upper).toBeGreaterThan(0.7); // Very uncertain
  });

  it("bounds are symmetric for 50% rate", () => {
    const result = wilsonScoreInterval(50, 100);
    const lowerDiff = 0.5 - result.lower;
    const upperDiff = result.upper - 0.5;
    expect(lowerDiff).toBeCloseTo(upperDiff, 2);
  });

  it("tighter bounds with larger sample", () => {
    const small = wilsonScoreInterval(5, 10); // 50%
    const large = wilsonScoreInterval(500, 1000); // 50%

    const smallSpread = small.upper - small.lower;
    const largeSpread = large.upper - large.lower;

    expect(largeSpread).toBeLessThan(smallSpread);
  });

  it("respects custom z-score", () => {
    const z95 = wilsonScoreInterval(50, 100, 1.96); // 95% CI
    const z99 = wilsonScoreInterval(50, 100, 2.576); // 99% CI

    // 99% CI should be wider
    expect(z99.upper - z99.lower).toBeGreaterThan(z95.upper - z95.lower);
  });
});

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns single value for single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it("returns min for 0th percentile", () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  it("returns max for 100th percentile", () => {
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it("returns median for 50th percentile", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("interpolates between values", () => {
    // [10, 20, 30, 40] - 25th percentile should be between 10 and 20
    const result = percentile([10, 20, 30, 40], 25);
    expect(result).toBeGreaterThan(10);
    expect(result).toBeLessThan(20);
  });

  it("handles unsorted input", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  });

  it("calculates 80th percentile correctly", () => {
    // For [0, 25, 50, 75, 100], 80th percentile should be near 80
    const result = percentile([0, 25, 50, 75, 100], 80);
    expect(result).toBeGreaterThan(75);
    expect(result).toBeLessThan(100);
  });
});

describe("getConfidenceLevel", () => {
  it("returns high for 100+ calls", () => {
    expect(getConfidenceLevel(100)).toBe("high");
    expect(getConfidenceLevel(1000)).toBe("high");
  });

  it("returns medium for 20-99 calls", () => {
    expect(getConfidenceLevel(20)).toBe("medium");
    expect(getConfidenceLevel(50)).toBe("medium");
    expect(getConfidenceLevel(99)).toBe("medium");
  });

  it("returns low for <20 calls", () => {
    expect(getConfidenceLevel(0)).toBe("low");
    expect(getConfidenceLevel(1)).toBe("low");
    expect(getConfidenceLevel(19)).toBe("low");
  });
});
