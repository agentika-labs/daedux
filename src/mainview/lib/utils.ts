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
