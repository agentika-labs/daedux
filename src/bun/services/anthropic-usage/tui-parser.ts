import type { AnthropicUsage } from "../../../shared/rpc-types";
import { stripAnsi } from "../../utils/ansi";
import { debugLog } from "../../utils/log";

/**
 * Parse TUI output to extract usage percentages.
 * Strips ANSI escape codes and extracts numbers.
 *
 * Expected output format from /usage (as of 2026):
 * ```
 * Current session
 * [progress bar]                          21% used
 * Resets 3:59am (Europe/London)
 *
 * Current week (all models)
 * [progress bar]                          2% used
 * Resets Mar 3 at 4pm (Europe/London)
 *
 * Current week (Sonnet only)
 * [progress bar]                          0% used
 *
 * Extra usage
 * [progress bar]                          100% used
 * $40.42 / $37.50 spent · Resets Mar 1 (Europe/London)
 * ```
 */
export const parseUsageOutput = (output: string): AnthropicUsage => {
  const clean = stripAnsi(output);

  const allPercentages = clean.match(/\d+%/g) ?? [];
  const allUsedPatterns = clean.match(/\d+%\s*used/gi) ?? [];
  const allSpentPatterns =
    clean.match(/\$[\d.]+\s*\/\s*\$[\d.]+\s*spent/gi) ?? [];

  const timePatterns = clean.match(/\d+(?::\d+)?(?:am|pm)\s*\([^)]+\)/gi) ?? [];
  const dateTimePatterns =
    clean.match(
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+(?:\s+at\s+\d+(?:am|pm))?\s*\([^)]+\)/gi
    ) ?? [];

  const allResetPatterns = [...new Set([...timePatterns, ...dateTimePatterns])];

  debugLog("anthropic-usage", "All patterns found:", {
    dateTimePatterns,
    hasCurrentSession: clean.includes("Current session"),
    hasCurrentWeek: clean.includes("Current week"),
    hasExtraUsage: clean.includes("Extra usage"),
    hasSonnet: clean.includes("Sonnet"),
    percentages: allPercentages,
    resetPatterns: allResetPatterns,
    spentPatterns: allSpentPatterns,
    timePatterns,
    usedPatterns: allUsedPatterns,
  });

  const sessionMatch = clean.match(/Current session[\s\S]*?(\d+)%\s*used/i);
  const weeklyMatch = clean.match(
    /Current week\s*\(all models\)[\s\S]*?(\d+)%\s*used/i
  );
  const sonnetMatch = clean.match(/Sonnet only[\s\S]*?(\d+)%\s*used/i);
  const extraUsageMatch = clean.match(/Extra usage[\s\S]*?(\d+)%\s*used/i);
  const extraSpendingMatch = clean.match(
    /\$([0-9.]+)\s*\/\s*\$([0-9.]+)\s*spent/i
  );

  const extractPct = (s: string) =>
    Number.parseInt(s.match(/(\d+)%/)?.[1] ?? "0", 10);

  let sessionPct = 0;
  let weeklyPct = 0;
  let sonnetPct = 0;
  let extraPct = 0;

  if (allUsedPatterns.length >= 4) {
    debugLog(
      "anthropic-usage",
      "Using positional extraction from:",
      allUsedPatterns
    );
    sessionPct = extractPct(allUsedPatterns[0]!);
    weeklyPct = extractPct(allUsedPatterns[1]!);
    sonnetPct = extractPct(allUsedPatterns[2]!);
    extraPct = extractPct(allUsedPatterns[3]!);
  } else {
    sessionPct = sessionMatch?.[1] ? Number.parseInt(sessionMatch[1], 10) : 0;
    weeklyPct = weeklyMatch?.[1] ? Number.parseInt(weeklyMatch[1], 10) : 0;
    sonnetPct = sonnetMatch?.[1] ? Number.parseInt(sonnetMatch[1], 10) : 0;
    extraPct = extraUsageMatch?.[1]
      ? Number.parseInt(extraUsageMatch[1], 10)
      : 0;
  }

  let sessionResetRaw: string | null = null;
  let weeklyResetRaw: string | null = null;
  let extraResetRaw: string | null = null;

  if (allResetPatterns.length >= 1) {
    sessionResetRaw = allResetPatterns[0]!.trim();
  }
  if (allResetPatterns.length >= 2) {
    weeklyResetRaw = allResetPatterns[1]!.trim();
  }
  if (allResetPatterns.length >= 3) {
    extraResetRaw = allResetPatterns[2]!.trim();
  }

  const result: AnthropicUsage = {
    session: {
      limit: "5-hour window",
      percentUsed: sessionPct,
      resetAt: sessionResetRaw ? parseResetTimeFromDate(sessionResetRaw) : null,
      resetAtRaw: sessionResetRaw,
    },
    weekly: {
      limit: "7-day limit",
      percentUsed: weeklyPct,
      resetAt: weeklyResetRaw ? parseResetTimeFromDate(weeklyResetRaw) : null,
      resetAtRaw: weeklyResetRaw,
    },
    opus: null,
    sonnet:
      allUsedPatterns.length >= 3
        ? {
            percentUsed: sonnetPct,
            resetAt: null,
            resetAtRaw: null,
            limit: "Sonnet 7-day",
          }
        : null,
    extraUsage:
      allUsedPatterns.length >= 4 || extraSpendingMatch
        ? {
            limitUsd: extraSpendingMatch?.[2]
              ? Number.parseFloat(extraSpendingMatch[2])
              : null,
            percentUsed: extraPct,
            resetAtRaw: extraResetRaw,
            spentUsd: extraSpendingMatch?.[1]
              ? Number.parseFloat(extraSpendingMatch[1])
              : 0,
          }
        : undefined,
    fetchedAt: Date.now(),
    source: "cli",
  };

  debugLog("anthropic-usage", "Parsed result:", {
    extraSpending: extraSpendingMatch
      ? `$${extraSpendingMatch[1]}/$${extraSpendingMatch[2]}`
      : null,
    extraUsage: `${extraPct}% (resets: ${extraResetRaw})`,
    session: `${result.session.percentUsed}% (resets: ${sessionResetRaw})`,
    sonnet: result.sonnet ? `${result.sonnet.percentUsed}%` : null,
    weekly: `${result.weekly.percentUsed}% (resets: ${weeklyResetRaw})`,
  });

  return result;
};

/**
 * Parse reset time from date string like "3:59am", "4am", "Mar 3 at 4pm", or "Mar 1".
 * Handles timezone suffix like "(Europe/London)" by stripping it.
 * Returns Unix timestamp in seconds.
 */
export const parseResetTimeFromDate = (
  dateStr: string,
  now: Date = new Date()
): number | null => {
  const cleanDate = dateStr.replace(/\s*\([^)]+\)\s*$/, "").trim();

  const timeMatch = cleanDate.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (timeMatch && timeMatch[1] && timeMatch[3]) {
    let hours = Number.parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
    const isPM = timeMatch[3].toLowerCase() === "pm";

    if (isPM && hours !== 12) {
      hours += 12;
    }
    if (!isPM && hours === 12) {
      hours = 0;
    }

    const reset = new Date(now);
    reset.setHours(hours, minutes, 0, 0);
    if (reset.getTime() < now.getTime()) {
      reset.setDate(reset.getDate() + 1);
    }
    return Math.floor(reset.getTime() / 1000);
  }

  const dateTimeMatch = cleanDate.match(
    /^(\w+)\s+(\d{1,2})\s+at\s+(\d{1,2})(am|pm)$/i
  );
  if (
    dateTimeMatch &&
    dateTimeMatch[1] &&
    dateTimeMatch[2] &&
    dateTimeMatch[3] &&
    dateTimeMatch[4]
  ) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const monthIndex = monthNames.indexOf(
      dateTimeMatch[1].toLowerCase().slice(0, 3)
    );
    const day = Number.parseInt(dateTimeMatch[2], 10);
    let hours = Number.parseInt(dateTimeMatch[3], 10);
    const isPM = dateTimeMatch[4].toLowerCase() === "pm";

    if (isPM && hours !== 12) {
      hours += 12;
    }
    if (!isPM && hours === 12) {
      hours = 0;
    }

    if (monthIndex !== -1) {
      const reset = new Date(now.getFullYear(), monthIndex, day, hours, 0, 0);
      if (reset.getTime() < now.getTime()) {
        reset.setFullYear(reset.getFullYear() + 1);
      }
      return Math.floor(reset.getTime() / 1000);
    }
  }

  const dateOnlyMatch = cleanDate.match(/^(\w+)\s+(\d{1,2})$/i);
  if (dateOnlyMatch && dateOnlyMatch[1] && dateOnlyMatch[2]) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const monthIndex = monthNames.indexOf(
      dateOnlyMatch[1].toLowerCase().slice(0, 3)
    );
    const day = Number.parseInt(dateOnlyMatch[2], 10);

    if (monthIndex !== -1) {
      const reset = new Date(now.getFullYear(), monthIndex, day, 0, 0, 0);
      if (reset.getTime() < now.getTime()) {
        reset.setFullYear(reset.getFullYear() + 1);
      }
      return Math.floor(reset.getTime() / 1000);
    }
  }

  return null;
};
