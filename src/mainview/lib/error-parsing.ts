/**
 * Error parsing utilities for transforming raw error messages into
 * scannable, actionable insights.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | "user_rejection"
  | "exit_code"
  | "file_not_found"
  | "permission_denied"
  | "stack_trace"
  | "network_error"
  | "generic";

export interface ParsedError {
  category: ErrorCategory;
  summary: string;
  originalMessage: string;
  /** For stack traces: first N lines to show collapsed */
  truncatedMessage: string;
  /** Whether this error has additional content that can be expanded */
  isExpandable: boolean;
  /** Extracted file path, if any */
  filePath?: string;
  /** Extracted exit code, if any */
  exitCode?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COLLAPSED_LINES = 3;

// ─── Pattern Definitions ─────────────────────────────────────────────────────

interface ErrorPattern {
  pattern: RegExp;
  category: ErrorCategory;
  getSummary: (match: RegExpMatchArray, message: string) => string;
  getFilePath?: (match: RegExpMatchArray) => string | undefined;
  getExitCode?: (match: RegExpMatchArray) => number | undefined;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // User rejection
  {
    pattern: /The user doesn't want to proceed|user (declined|rejected|denied|cancelled)/i,
    category: "user_rejection",
    getSummary: () => "User declined this action",
  },
  // Exit code errors
  {
    pattern: /Exit code (\d+)/i,
    category: "exit_code",
    getSummary: (m) => `Command failed (exit ${m[1] ?? "?"})`,
    getExitCode: (m) => m[1] ? parseInt(m[1], 10) : undefined,
  },
  // Git file not found
  {
    pattern: /pathspec '([^']+)' did not match/i,
    category: "file_not_found",
    getSummary: (m) => `File not found: ${truncatePath(m[1] ?? "")}`,
    getFilePath: (m) => m[1],
  },
  // General file not found (ENOENT)
  {
    pattern: /ENOENT[:\s]+.*?['"]?([^'":\s]+)['"]?/i,
    category: "file_not_found",
    getSummary: (m) => `File not found: ${truncatePath(m[1] ?? "")}`,
    getFilePath: (m) => m[1],
  },
  {
    pattern: /no such file or directory[:\s]*['"]?([^'"]+)['"]?/i,
    category: "file_not_found",
    getSummary: (m) => `File not found: ${truncatePath(m[1] ?? "")}`,
    getFilePath: (m) => m[1],
  },
  // Permission denied
  {
    pattern: /EACCES|permission denied/i,
    category: "permission_denied",
    getSummary: () => "Permission denied",
  },
  // Network errors
  {
    pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network error/i,
    category: "network_error",
    getSummary: () => "Network connection failed",
  },
  // Python stack trace
  {
    pattern: /Traceback \(most recent call last\)/i,
    category: "stack_trace",
    getSummary: (_, msg) => extractPythonError(msg),
  },
  // JavaScript/TypeScript stack trace
  {
    pattern: /^\s*at\s+.+\(.+:\d+:\d+\)/m,
    category: "stack_trace",
    getSummary: (_, msg) => extractJsError(msg),
  },
];

// ─── Helper Functions ────────────────────────────────────────────────────────

/** Truncate a file path for display, keeping the filename and immediate parent */
function truncatePath(path: string, maxLength = 40): string {
  if (path.length <= maxLength) return path;

  const parts = path.split("/");
  if (parts.length <= 2) return path.slice(-maxLength);

  // Show last 2 segments
  const last = parts.slice(-2).join("/");
  if (last.length <= maxLength) return "…/" + last;

  return "…" + path.slice(-maxLength);
}

/** Extract the actual error message from a Python traceback */
function extractPythonError(message: string): string {
  const lines = message.split("\n");
  // Look for the last line that doesn't start with whitespace and contains an error
  for (let i = lines.length - 1; i >= 0; i--) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line = rawLine.trim();
    if (line && !line.startsWith("File ") && !line.startsWith("^")) {
      // Common Python error patterns
      if (line.match(/^(\w+Error|\w+Exception):/)) {
        return truncateString(line, 60);
      }
    }
  }
  return "Python error";
}

/** Extract the error message from a JS/TS stack trace */
function extractJsError(message: string): string {
  const lines = message.split("\n");
  // First line is usually the error message
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip stack trace lines
    if (trimmed.startsWith("at ")) continue;
    // Skip empty lines
    if (!trimmed) continue;
    // This is likely the error message
    return truncateString(trimmed, 60);
  }
  return "JavaScript error";
}

/** Truncate a string with ellipsis */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

/** Truncate a multi-line message to N lines */
export function truncateStackTrace(message: string, maxLines: number = COLLAPSED_LINES): string {
  const lines = message.split("\n");
  if (lines.length <= maxLines) return message;
  return lines.slice(0, maxLines).join("\n");
}

/** Check if a message looks like a stack trace or multi-line error */
function isMultiLineError(message: string): boolean {
  const lines = message.split("\n").filter(l => l.trim());
  return lines.length > COLLAPSED_LINES;
}

// ─── Main Parse Function ─────────────────────────────────────────────────────

/**
 * Parse an error message into a structured, categorized format
 */
export function parseError(message: string): ParsedError {
  // Try each pattern in order
  for (const pattern of ERROR_PATTERNS) {
    const match = message.match(pattern.pattern);
    if (match) {
      return {
        category: pattern.category,
        summary: pattern.getSummary(match, message),
        originalMessage: message,
        truncatedMessage: truncateStackTrace(message),
        isExpandable: isMultiLineError(message),
        filePath: pattern.getFilePath?.(match),
        exitCode: pattern.getExitCode?.(match),
      };
    }
  }

  // Generic fallback
  const firstLine = message.split("\n")[0] || message;
  return {
    category: "generic",
    summary: truncateString(firstLine, 60),
    originalMessage: message,
    truncatedMessage: truncateStackTrace(message),
    isExpandable: isMultiLineError(message),
  };
}

// ─── XML Stripping ───────────────────────────────────────────────────────────

/**
 * Strip XML/HTML tags from error messages (e.g., `<tool_use_error>...`)
 */
export function stripXmlTags(message: string): string {
  return message.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ─── Severity Tiers ──────────────────────────────────────────────────────────

export type SeverityTier = "critical" | "severe" | "moderate" | "minor";

export interface SeverityStyle {
  tier: SeverityTier;
  bgClass: string;
  borderClass: string;
  badgeBgClass: string;
  badgeTextClass: string;
  label: string;
}

const SEVERITY_STYLES: Record<SeverityTier, SeverityStyle> = {
  critical: {
    tier: "critical",
    bgClass: "bg-destructive/10",
    borderClass: "border-destructive/40",
    badgeBgClass: "bg-destructive/20",
    badgeTextClass: "text-destructive",
    label: "Critical - needs immediate attention",
  },
  severe: {
    tier: "severe",
    bgClass: "bg-destructive/5",
    borderClass: "border-destructive/25",
    badgeBgClass: "bg-destructive/15",
    badgeTextClass: "text-destructive/90",
    label: "High error rate",
  },
  moderate: {
    tier: "moderate",
    bgClass: "bg-warning/5",
    borderClass: "border-warning/25",
    badgeBgClass: "bg-warning/15",
    badgeTextClass: "text-warning",
    label: "Moderate error rate",
  },
  minor: {
    tier: "minor",
    bgClass: "bg-muted/50",
    borderClass: "border-border/50",
    badgeBgClass: "bg-muted",
    badgeTextClass: "text-muted-foreground",
    label: "Occasional errors",
  },
};

/**
 * Get severity styling based on error rate.
 * - >= 50% = critical (intense red)
 * - >= 25% = severe (softer red)
 * - >= 10% = moderate (amber/warning)
 * - < 10% = minor (muted gray)
 */
export function getSeverityFromErrorRate(errorRate: number): SeverityStyle {
  if (errorRate >= 0.5) return SEVERITY_STYLES.critical;
  if (errorRate >= 0.25) return SEVERITY_STYLES.severe;
  if (errorRate >= 0.1) return SEVERITY_STYLES.moderate;
  return SEVERITY_STYLES.minor;
}

// ─── Category Styling ────────────────────────────────────────────────────────

export interface CategoryStyle {
  iconName: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
}

export const CATEGORY_STYLES: Record<ErrorCategory, CategoryStyle> = {
  user_rejection: {
    iconName: "Cancel01Icon",
    bgClass: "bg-muted/50",
    borderClass: "border-border/50",
    textClass: "text-muted-foreground",
  },
  exit_code: {
    iconName: "AlertDiamondIcon",
    bgClass: "bg-destructive/5",
    borderClass: "border-destructive/20",
    textClass: "text-destructive",
  },
  file_not_found: {
    iconName: "Search01Icon",
    bgClass: "bg-warning/5",
    borderClass: "border-warning/20",
    textClass: "text-warning",
  },
  permission_denied: {
    iconName: "LockIcon",
    bgClass: "bg-destructive/5",
    borderClass: "border-destructive/20",
    textClass: "text-destructive",
  },
  network_error: {
    iconName: "Wifi02Icon",
    bgClass: "bg-warning/5",
    borderClass: "border-warning/20",
    textClass: "text-warning",
  },
  stack_trace: {
    iconName: "CodeIcon",
    bgClass: "bg-destructive/5",
    borderClass: "border-destructive/20",
    textClass: "text-destructive",
  },
  generic: {
    iconName: "AlertCircleIcon",
    bgClass: "bg-muted/50",
    borderClass: "border-border/50",
    textClass: "text-muted-foreground",
  },
};

/**
 * Format a recommendation string by parsing any embedded error messages.
 * Replaces quoted error text (e.g., `Common error: "<raw error>"`) with
 * a human-readable summary.
 */
export function formatRecommendation(recommendation: string): string {
  // Match quoted error messages in the recommendation
  // Pattern: Common error: "..."
  return recommendation.replace(
    /Common error: "([^"]+)"/g,
    (_, errorMsg) => `Common error: "${parseError(errorMsg).summary}"`
  );
}

/**
 * Match a fix suggestion to an error message.
 * Returns the suggestion if it seems relevant, undefined otherwise.
 */
export function matchSuggestionToError(
  error: ParsedError,
  suggestions: string[]
): string | undefined {
  if (suggestions.length === 0) return undefined;

  // For exit code errors, look for command suggestions
  if (error.category === "exit_code") {
    // Return first suggestion that mentions a command (contains backticks or common commands)
    return suggestions.find(s =>
      s.includes("`") ||
      /\b(run|try|check|install|update)\b/i.test(s)
    );
  }

  // For file not found, look for path-related suggestions
  if (error.category === "file_not_found" && error.filePath) {
    return suggestions.find(s =>
      s.toLowerCase().includes("file") ||
      s.toLowerCase().includes("path") ||
      s.toLowerCase().includes("create")
    );
  }

  // For permission errors, look for permission-related suggestions
  if (error.category === "permission_denied") {
    return suggestions.find(s =>
      s.toLowerCase().includes("permission") ||
      s.toLowerCase().includes("sudo") ||
      s.toLowerCase().includes("chmod")
    );
  }

  // Default: return first suggestion if we have one
  return suggestions[0];
}
