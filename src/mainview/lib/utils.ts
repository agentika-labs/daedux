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

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

// ─── Path Formatting ──────────────────────────────────────────────────────────

/**
 * Shorten home directory paths: /Users/adam/... → ~/...
 */
export function shortenPath(path: string): string {
  const match = path.match(/^\/Users\/([^/]+)/);
  if (match) {
    return "~" + path.slice(match[0].length);
  }
  return path;
}

/**
 * Smart project name with disambiguation context.
 * Only adds parent folder context when multiple projects share the same name.
 */
export interface SmartProjectName {
  primary: string;    // Main display name
  secondary: string;  // Parent context (only if needed for disambiguation)
  full: string;       // Full path for tooltip
}

export function getSmartProjectName(path: string, allPaths: string[]): SmartProjectName {
  const parts = path.split("/").filter(Boolean);
  const lastSegment = parts[parts.length - 1] || path;

  // Check for duplicate names
  const duplicates = allPaths.filter(p =>
    p.split("/").filter(Boolean).slice(-1)[0] === lastSegment
  );

  if (duplicates.length <= 1) {
    return { primary: lastSegment, secondary: "", full: path };
  }

  // Need disambiguation - use parent folder
  const parent = parts[parts.length - 2] || "";
  return { primary: lastSegment, secondary: parent, full: path };
}
