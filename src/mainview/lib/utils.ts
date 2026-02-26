import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Number Formatting ───────────────────────────────────────────────────────

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
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
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
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
    return "/" + encoded.slice(1).replace(/-/g, "/");
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

export type ProductivityRating = {
  stars: number;
  label: string;
  variant: "success" | "warning" | "destructive";
};

/**
 * Convert success rate and average actions to a productivity rating (for agents).
 * High success + high actions = excellent productivity.
 */
export function getProductivityRating(successRate: number, avgActions: number): ProductivityRating {
  if (successRate >= 95 && avgActions >= 5) return { stars: 5, label: "Excellent", variant: "success" };
  if (successRate >= 85) return { stars: 4, label: "Great", variant: "success" };
  if (successRate >= 70) return { stars: 3, label: "Good", variant: "success" };
  if (successRate >= 50) return { stars: 2, label: "Needs Work", variant: "warning" };
  return { stars: 1, label: "High Friction", variant: "destructive" };
}

export type ReliabilityStatus = {
  label: string;
  icon: "check" | "warning" | "error";
  variant: "success" | "warning" | "destructive";
};

/**
 * Convert completion rate to reliability status (for skills).
 */
export function getReliabilityStatus(completionRate: number): ReliabilityStatus {
  if (completionRate >= 0.95) return { label: "Highly Reliable", icon: "check", variant: "success" };
  if (completionRate >= 0.85) return { label: "Reliable", icon: "check", variant: "success" };
  if (completionRate >= 0.70) return { label: "Mostly Reliable", icon: "warning", variant: "warning" };
  if (completionRate >= 0.50) return { label: "Needs Attention", icon: "warning", variant: "warning" };
  return { label: "Unreliable", icon: "error", variant: "destructive" };
}

export type HookHealth = {
  label: string;
  icon: "check" | "warning" | "error";
  variant: "success" | "warning" | "destructive";
};

/**
 * Convert hook metrics to health status.
 * Considers both failure rate and latency.
 */
export function getHookHealth(failureRate: number, avgDurationMs: number): HookHealth {
  const isSlow = avgDurationMs > 500; // > 500ms is slow
  const isHighFailure = failureRate > 0.2; // > 20% failure

  if (failureRate === 0 && !isSlow) return { label: "Perfect", icon: "check", variant: "success" };
  if (failureRate < 0.1 && !isSlow) return { label: "Healthy", icon: "check", variant: "success" };
  if (isHighFailure) return { label: "High Friction", icon: "error", variant: "destructive" };
  if (isSlow) return { label: "Slow", icon: "warning", variant: "warning" };
  return { label: "Needs Review", icon: "warning", variant: "warning" };
}

/**
 * Format a percentage change with direction indicator.
 * Positive values show improvement, negative show decline.
 */
export function formatImpactPercent(value: number, lowerIsBetter = false): string {
  const absValue = Math.abs(value * 100);
  const isPositive = lowerIsBetter ? value > 0 : value > 0;
  const direction = isPositive ? "▼" : "▲";
  return `${direction} ${absValue.toFixed(0)}%`;
}

/**
 * Format average duration in human-readable form.
 */
export function formatAvgDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Smart project name with disambiguation context.
 * Uses cwd (actual filesystem path) when available, falls back to decoding hyphenated projectPath.
 * Shows last 2 segments for clarity, with full path for tooltips.
 */
export interface SmartProjectName {
  primary: string;    // Main display name
  secondary: string;  // Parent context (only if needed for disambiguation)
  full: string;       // Full path for tooltip
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

export function getSmartProjectName(
  opts: SmartProjectNameOptions | string,
  allItems: Array<SmartProjectNameOptions | string>
): SmartProjectName {
  // Normalize input to options object
  const { projectPath, cwd } = typeof opts === "string"
    ? { projectPath: opts, cwd: undefined }
    : opts;

  // Use cwd when available (accurate), fall back to decoding projectPath
  const fullPath = cwd ?? decodeProjectPath(projectPath);
  const parts = fullPath.split("/").filter(Boolean);

  // Get last 2 segments for display
  const lastSegment = parts[parts.length - 1] || projectPath;
  const parentSegment = parts[parts.length - 2] || "";

  // Check for duplicate last segments among all items
  const duplicates = allItems.filter(item => {
    const itemOpts = typeof item === "string" ? { projectPath: item, cwd: undefined } : item;
    const itemPath = itemOpts.cwd ?? decodeProjectPath(itemOpts.projectPath);
    const otherParts = itemPath.split("/").filter(Boolean);
    return otherParts[otherParts.length - 1] === lastSegment;
  });

  if (duplicates.length <= 1) {
    return { primary: lastSegment, secondary: "", full: fullPath };
  }

  // Need disambiguation - use parent folder
  return { primary: lastSegment, secondary: parentSegment, full: fullPath };
}
