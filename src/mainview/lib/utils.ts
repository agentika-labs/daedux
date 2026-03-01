import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Number Formatting ───────────────────────────────────────────────────────

// Hoisted formatter - Intl.NumberFormat constructor is expensive (~0.1ms per call)
// Creating once avoids repeated allocation when formatCurrency is called in loops
const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatOccurrenceCount(count: number): string {
  return `${count}x`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  }
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

// ─── Path Formatting ──────────────────────────────────────────────────────────

/**
 * Decode Claude's hyphenated project path back to normal path.
 * "-Users-adam-Documents-git-project" → "/Users/adam/Documents/git/project"
 */
function decodeProjectPath(encoded: string): string {
  if (encoded.startsWith("-")) {
    // Claude-encoded path: convert leading hyphen and hyphen separators to slashes
    return "/" + encoded.slice(1).replaceAll("-", "/");
  }
  return encoded;
}

/**
 * Shorten home directory paths: /Users/adam/... → ~/...
 * Also handles Claude's hyphenated path encoding.
 */
export function shortenPath(path: string): string {
  const decoded = decodeProjectPath(path);
  const match = decoded.match(/^\/Users\/([^/]+)/);
  if (match) {
    return "~" + decoded.slice(match[0].length);
  }
  return decoded;
}

// ─── Automation Analytics Helpers ───────────────────────────────────────────

export interface ProductivityRating {
  stars: number;
  label: string;
  variant: "success" | "warning" | "destructive";
}

/**
 * Convert success rate and average actions to a productivity rating (for agents).
 * High success + high actions = excellent productivity.
 */
export function getProductivityRating(
  successRate: number,
  avgActions: number
): ProductivityRating {
  if (successRate >= 95 && avgActions >= 5) {
    return { label: "Excellent", stars: 5, variant: "success" };
  }
  if (successRate >= 85) {
    return { label: "Great", stars: 4, variant: "success" };
  }
  if (successRate >= 70) {
    return { label: "Good", stars: 3, variant: "success" };
  }
  if (successRate >= 50) {
    return { label: "Needs Work", stars: 2, variant: "warning" };
  }
  return { label: "High Friction", stars: 1, variant: "destructive" };
}

export interface ReliabilityStatus {
  label: string;
  icon: "check" | "warning" | "error";
  variant: "success" | "warning" | "destructive";
}

/**
 * Convert completion rate to reliability status (for skills).
 */
export function getReliabilityStatus(
  completionRate: number
): ReliabilityStatus {
  if (completionRate >= 0.95) {
    return { icon: "check", label: "Highly Reliable", variant: "success" };
  }
  if (completionRate >= 0.85) {
    return { icon: "check", label: "Reliable", variant: "success" };
  }
  if (completionRate >= 0.7) {
    return { icon: "warning", label: "Mostly Reliable", variant: "warning" };
  }
  if (completionRate >= 0.5) {
    return { icon: "warning", label: "Needs Attention", variant: "warning" };
  }
  return { icon: "error", label: "Unreliable", variant: "destructive" };
}

export interface HookHealth {
  label: string;
  icon: "check" | "warning" | "error";
  variant: "success" | "warning" | "destructive";
}

/**
 * Convert hook metrics to health status.
 * Considers both failure rate and latency.
 */
export function getHookHealth(
  failureRate: number,
  avgDurationMs: number
): HookHealth {
  const isSlow = avgDurationMs > 500; // > 500ms is slow
  const isHighFailure = failureRate > 0.2; // > 20% failure

  if (failureRate === 0 && !isSlow) {
    return { icon: "check", label: "Perfect", variant: "success" };
  }
  if (failureRate < 0.1 && !isSlow) {
    return { icon: "check", label: "Healthy", variant: "success" };
  }
  if (isHighFailure) {
    return { icon: "error", label: "High Friction", variant: "destructive" };
  }
  if (isSlow) {
    return { icon: "warning", label: "Slow", variant: "warning" };
  }
  return { icon: "warning", label: "Needs Review", variant: "warning" };
}

/**
 * Format a percentage change with direction indicator.
 * Positive values show improvement, negative show decline.
 */
export function formatImpactPercent(
  value: number,
  lowerIsBetter = false
): string {
  const absValue = Math.abs(value * 100);
  const isPositive = lowerIsBetter ? value > 0 : value > 0;
  const direction = isPositive ? "▼" : "▲";
  return `${direction} ${absValue.toFixed(0)}%`;
}

/**
 * Format average duration in human-readable form.
 */
export function formatAvgDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Smart project name with disambiguation context.
 * Uses cwd (actual filesystem path) when available, falls back to decoding hyphenated projectPath.
 * Shows last 2 segments for clarity, with full path for tooltips.
 */
export interface SmartProjectName {
  primary: string; // Main display name
  secondary: string; // Parent context (only if needed for disambiguation)
  full: string; // Full path for tooltip
}

/**
 * Options for getSmartProjectName.
 * When cwd is provided, it's used directly (accurate path with / separators).
 * Otherwise, falls back to decoding the hyphenated projectPath.
 */
export interface SmartProjectNameOptions {
  projectPath: string;
  cwd?: string;
}

/**
 * Pre-compute smart project names for all items in O(n) total time.
 * Returns a Map keyed by projectPath for O(1) lookup.
 *
 * This replaces the O(n²) approach where getSmartProjectName was called
 * for each item and internally looped through all items to detect duplicates.
 */
export function computeSmartProjectNames(
  items: (SmartProjectNameOptions | string)[]
): Map<string, SmartProjectName> {
  // Step 1: O(n) - extract path info and count occurrences of each last segment
  const segmentCounts = new Map<string, number>();
  const itemData: {
    key: string;
    fullPath: string;
    lastSegment: string;
    parentSegment: string;
  }[] = [];

  for (const item of items) {
    const opts =
      typeof item === "string" ? { cwd: undefined, projectPath: item } : item;
    const fullPath = opts.cwd ?? decodeProjectPath(opts.projectPath);
    const parts = fullPath.split("/").filter(Boolean);
    const lastSegment = parts.at(-1) || opts.projectPath;
    const parentSegment = parts.at(-2) || "";

    const key = opts.projectPath; // unique identifier
    itemData.push({ fullPath, key, lastSegment, parentSegment });
    segmentCounts.set(lastSegment, (segmentCounts.get(lastSegment) || 0) + 1);
  }

  // Step 2: O(n) - build results using pre-computed counts
  const results = new Map<string, SmartProjectName>();
  for (const { fullPath, key, lastSegment, parentSegment } of itemData) {
    const needsDisambiguation = (segmentCounts.get(lastSegment) || 0) > 1;
    results.set(key, {
      full: fullPath,
      primary: lastSegment,
      secondary: needsDisambiguation ? parentSegment : "",
    });
  }

  return results;
}

export function getSmartProjectName(
  opts: SmartProjectNameOptions | string,
  allItems: (SmartProjectNameOptions | string)[]
): SmartProjectName {
  // Normalize input to options object
  const { projectPath, cwd } =
    typeof opts === "string" ? { cwd: undefined, projectPath: opts } : opts;

  // Use cwd when available (accurate), fall back to decoding projectPath
  const fullPath = cwd ?? decodeProjectPath(projectPath);
  const parts = fullPath.split("/").filter(Boolean);

  // Get last 2 segments for display
  const lastSegment = parts.at(-1) || projectPath;
  const parentSegment = parts.at(-2) || "";

  // Check for duplicate last segments among all items
  const duplicates = allItems.filter((item) => {
    const itemOpts =
      typeof item === "string" ? { cwd: undefined, projectPath: item } : item;
    const itemPath = itemOpts.cwd ?? decodeProjectPath(itemOpts.projectPath);
    const otherParts = itemPath.split("/").filter(Boolean);
    return otherParts.at(-1) === lastSegment;
  });

  if (duplicates.length <= 1) {
    return { full: fullPath, primary: lastSegment, secondary: "" };
  }

  // Need disambiguation - use parent folder
  return { full: fullPath, primary: lastSegment, secondary: parentSegment };
}
