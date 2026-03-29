import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { Duration, Effect, Ref, Schedule, Schema } from "effect";

import type {
  AnthropicUsage,
  AnthropicUsageWindow,
} from "../../shared/rpc-types";
import { AnthropicUsageError } from "../errors";
import { stripAnsi } from "../utils/ansi";
import { debugLog, log } from "../utils/log";

// Tracks which method (OAuth API vs CLI) is currently working.
// This avoids wasting requests on OAuth when it consistently fails.

type UsageMethod = "oauth" | "cli" | "unknown";

interface MethodState {
  method: UsageMethod;
  /** When the method was determined (for periodic recheck) */
  determinedAt: number | null;
}

/** Recheck OAuth availability every 30 minutes */
const METHOD_RECHECK_MS = 30 * 60_000;

// ─── OAuth Response Schema ──────────────────────────────────────────────────

/**
 * Schema for the Anthropic OAuth usage API response.
 * The API returns usage windows with percent_used and reset_at timestamps.
 */
const OAuthUsageResponse = Schema.Struct({
  extra_usage: Schema.optional(
    Schema.Struct({
      limit_usd: Schema.NullOr(Schema.Number),
      spent_usd: Schema.Number,
    })
  ),
  five_hour: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day_opus: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
  seven_day_sonnet: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
});

// ─── Keychain Credential Schema ─────────────────────────────────────────────

/**
 * Schema for Claude Code credentials stored in macOS Keychain.
 * The keychain entry "Claude Code-credentials" contains OAuth tokens and metadata.
 */
const KeychainCredentials = Schema.Struct({
  claudeAiOauth: Schema.Struct({
    accessToken: Schema.String,
    expiresAt: Schema.optional(Schema.Number),
    rateLimitTier: Schema.optional(Schema.String),
    refreshToken: Schema.String,
    scopes: Schema.optional(Schema.Array(Schema.String)),
    subscriptionType: Schema.optional(Schema.String),
  }),
});

// ─── Cache Configuration ────────────────────────────────────────────────────

/** Cache duration for usage data (30 seconds) */
const CACHE_TTL = Duration.seconds(30);

// ─── Native PTY-Based CLI Probe ──────────────────────────────────────────────
//
// NOTE: The CLI probe is a best-effort fallback when the OAuth API is unavailable.
// It uses Bun's native PTY support to automate the Claude CLI's interactive TUI.
// This is more reliable than expect-based automation because it provides real
// terminal emulation. The parsing logic is unit tested separately in
// tests/unit/anthropic-usage-parser.test.ts.

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
const parseUsageOutput = (output: string): AnthropicUsage => {
  const clean = stripAnsi(output);

  // DEBUG: Find ALL percentage patterns in the output
  const allPercentages = clean.match(/\d+%/g) || [];
  const allUsedPatterns = clean.match(/\d+%\s*used/gi) || [];
  const allSpentPatterns =
    clean.match(/\$[\d.]+\s*\/\s*\$[\d.]+\s*spent/gi) || [];

  // Extract reset patterns with timezone - formats:
  // "Resets 4am (Europe/London)" - session
  // "Resets Mar 3 at 4pm (Europe/London)" - weekly
  // "Resets Mar 1 (Europe/London)" - extra usage
  //
  // NOTE: TUI cursor positioning fragments text, so "Resets" and the time may be separated.
  // Instead of relying on "Resets" label, we look for timezone patterns directly:
  // - Time only: "4am (Europe/London)", "3:59pm (America/New_York)"
  // - Date + time: "Mar 3 at 4pm (Europe/London)"
  // - Date only: "Mar 1 (Europe/London)"
  const timePatterns = clean.match(/\d+(?::\d+)?(?:am|pm)\s*\([^)]+\)/gi) || [];
  const dateTimePatterns =
    clean.match(
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+(?:\s+at\s+\d+(?:am|pm))?\s*\([^)]+\)/gi
    ) || [];

  // Combine and dedupe (dateTime patterns may overlap with time-only patterns)
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

  // Try the original regex approach first
  const sessionMatch = clean.match(/Current session[\s\S]*?(\d+)%\s*used/i);
  const weeklyMatch = clean.match(
    /Current week\s*\(all models\)[\s\S]*?(\d+)%\s*used/i
  );
  const sonnetMatch = clean.match(/Sonnet only[\s\S]*?(\d+)%\s*used/i);
  const extraUsageMatch = clean.match(/Extra usage[\s\S]*?(\d+)%\s*used/i);
  const extraSpendingMatch = clean.match(
    /\$([0-9.]+)\s*\/\s*\$([0-9.]+)\s*spent/i
  );

  // FALLBACK: Use positional extraction from "X% used" patterns
  // The usage panel renders in order: session, weekly (all models), sonnet, extra
  // This is more reliable than label-based regex since TUI cursor positioning
  // separates labels from values
  const extractPct = (s: string) =>
    Number.parseInt(s.match(/(\d+)%/)?.[1] || "0", 10);

  let sessionPct = 0;
  let weeklyPct = 0;
  let sonnetPct = 0;
  let extraPct = 0;

  if (allUsedPatterns.length >= 4) {
    // We have all 4 patterns - use positional extraction
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
    // Fallback to label-based regex (less reliable with TUI output)
    sessionPct = sessionMatch?.[1] ? Number.parseInt(sessionMatch[1], 10) : 0;
    weeklyPct = weeklyMatch?.[1] ? Number.parseInt(weeklyMatch[1], 10) : 0;
    sonnetPct = sonnetMatch?.[1] ? Number.parseInt(sonnetMatch[1], 10) : 0;
    extraPct = extraUsageMatch?.[1]
      ? Number.parseInt(extraUsageMatch[1], 10)
      : 0;
  }

  // Extract reset times with timezone by position
  // Order: session reset, weekly reset, extra usage reset (sonnet has no reset)
  // The patterns are already clean (e.g., "4am (Europe/London)") - no "Resets" prefix
  let sessionResetRaw: string | null = null;
  let weeklyResetRaw: string | null = null;
  let extraResetRaw: string | null = null;

  // Assign by position - time-only patterns typically come first (session),
  // date patterns come later (weekly, extra)
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
    // Always include sonnet if we have data (even 0% is valid)
    sonnet:
      allUsedPatterns.length >= 3
        ? {
            percentUsed: sonnetPct,
            resetAt: null,
            resetAtRaw: null, // Sonnet doesn't show reset time
            limit: "Sonnet 7-day",
          }
        : null,
    // Include extraUsage if we have percentage or spending data
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
const parseResetTimeFromDate = (dateStr: string): number | null => {
  const now = new Date();

  // Strip timezone suffix like "(Europe/London)" for parsing
  // We don't do timezone conversion - just parse the local time
  const cleanDate = dateStr.replace(/\s*\([^)]+\)\s*$/, "").trim();

  // Try to parse "3:59am" or "4am" format (time today)
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
    // If the time has passed today, it's tomorrow
    if (reset.getTime() < now.getTime()) {
      reset.setDate(reset.getDate() + 1);
    }
    return Math.floor(reset.getTime() / 1000);
  }

  // Try to parse "Mar 3 at 4pm" format
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
      // If the date has passed this year, it's next year
      if (reset.getTime() < now.getTime()) {
        reset.setFullYear(reset.getFullYear() + 1);
      }
      return Math.floor(reset.getTime() / 1000);
    }
  }

  // Try to parse "Mar 1" format (date only, assume midnight)
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
      // If the date has passed this year, it's next year
      if (reset.getTime() < now.getTime()) {
        reset.setFullYear(reset.getFullYear() + 1);
      }
      return Math.floor(reset.getTime() / 1000);
    }
  }

  return null;
};

/**
 * Check if a command exists on the system.
 */
const commandExists = async (cmd: string): Promise<boolean> => {
  const proc = Bun.spawn(["which", cmd], { stderr: "pipe", stdout: "pipe" });
  return (await proc.exited) === 0;
};

/**
 * Probe Claude CLI for /usage data using native Bun PTY.
 * Uses Bun's native PTY API for real terminal emulation.
 *
 * The CLI probe is disabled in test environments (BUN_TEST=1) because:
 * 1. It spawns real processes that are hard to clean up
 * 2. Tests should use the credentials-only fallback instead
 *
 * Key API notes:
 * - `terminal: { cols, rows, data() }` provides PTY emulation (not stdin/stdout pipes)
 * - Write via `proc.terminal.write()` (not proc.stdin)
 * - Use `\r` for line endings (not `\n`) in PTY mode
 * - Data callback receives Uint8Array, decode with TextDecoder
 */
const tryCliUsage = () =>
  Effect.tryPromise({
    catch: (e) =>
      new AnthropicUsageError({
        cause: e,
        message: `CLI probe failed: ${e}`,
        reason: "api_error",
      }),
    try: async () => {
      // Skip CLI probe in test environments to avoid dangling processes
      if (process.env.BUN_TEST === "1" || process.env.NODE_ENV === "test") {
        throw new Error("CLI probe disabled in test environment");
      }

      // Skip CLI probe in CLI server mode (Bun.serve context)
      // PTY spawning fails in request handlers even when terminal is TTY
      if (process.env.DAEDUX_CLI_SERVER === "1") {
        throw new Error("CLI probe disabled in CLI server mode");
      }

      // Check if claude is available before attempting to spawn
      if (!(await commandExists("claude"))) {
        debugLog(
          "anthropic-usage",
          "claude not in PATH. PATH:",
          process.env.PATH?.split(":").slice(0, 5).join(":"),
          "..."
        );
        throw new Error("claude binary not found in PATH");
      }

      // Create isolated sandbox directory to prevent MCP prompt issues.
      // The CLI searches parent directories for .mcp.json files - spawning in
      // an isolated temp directory prevents it from finding any project configs.
      const sandboxDir = mkdtempSync(`${tmpdir()}/claude-probe-`);
      debugLog("anthropic-usage", "Created sandbox directory:", sandboxDir);

      let output = "";
      let resolved = false;
      let usageCommandSent = false; // Track if we've sent /usage to the REPL
      let trustHandled = false; // Track if trust dialog was already dismissed
      let permissionsHandled = false; // Track if permissions dialog was already dismissed
      let dataCallbackCount = 0; // DEBUG: track callback invocations
      const decoder = new TextDecoder();

      // Helper to clean up sandbox directory
      const cleanupSandbox = () => {
        try {
          rmSync(sandboxDir, { force: true, recursive: true });
          debugLog("anthropic-usage", "Cleaned up sandbox directory");
        } catch (error) {
          debugLog("anthropic-usage", "Failed to cleanup sandbox:", error);
        }
      };

      return new Promise<AnthropicUsage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            proc.kill();
            cleanupSandbox();

            const cleanedForDebug = stripAnsi(output);

            // Log state at timeout so we can see what the PTY received
            log.info("usage", "CLI probe timeout debug:", {
              cleanedLength: cleanedForDebug.length,
              dataCallbackCount,
              hasCurrentSession: cleanedForDebug.includes("Current session"),
              hasCurrentWeek: cleanedForDebug.includes("Current week"),
              hasPercentUsed: cleanedForDebug.includes("% used"),
              hasTerminal: !!proc.terminal,
              outputLength: output.length,
              usageCommandSent,
            });
            // Log first 1000 chars of cleaned output to see actual content
            log.info(
              "usage",
              "CLI probe output:",
              cleanedForDebug.slice(0, 1000)
            );
            reject(new Error("CLI probe timed out after 8s"));
          }
        }, 8000);

        // Use Bun's native PTY API - this provides real terminal emulation
        // that the Claude CLI's TUI requires to render properly.
        // --dangerously-skip-permissions bypasses the workspace trust prompt
        // that would otherwise block the REPL from starting in the sandbox.
        const proc = Bun.spawn(["claude", "--dangerously-skip-permissions"], {
          cwd: sandboxDir, // Sandboxed directory prevents project .mcp.json discovery
          env: { ...process.env, CLAUDECODE: "" },
          terminal: {
            cols: 120,
            rows: 40,
            data(terminal, data) {
              dataCallbackCount++;
              const chunk = decoder.decode(data, { stream: true });
              output += chunk;

              // DEBUG: Log each chunk received (first 100 chars, newlines escaped)
              debugLog(
                "anthropic-usage",
                `PTY data #${dataCallbackCount}:`,
                chunk
                  .slice(0, 100)
                  .replaceAll("\n", "\\n")
                  .replaceAll("\r", "\\r")
              );

              const clean = stripAnsi(output);

              // Safety net: Detect MCP server prompt and bypass it.
              // Even with sandbox cwd, global MCP servers from ~/.claude/ could prompt.
              // We select option 3 "Continue without using this MCP server" to proceed.
              if (
                clean.includes("MCP server") &&
                clean.includes("found") &&
                (clean.includes("Continue without") ||
                  clean.includes("without using"))
              ) {
                log.info("usage", "MCP prompt detected, bypassing...");
                terminal.write("3\r"); // Select "Continue without using this MCP server"
                return; // Wait for next data callback
              }

              // Detect workspace trust prompt and bypass it.
              // Pattern: "Is this a project you created" with options "Yes, I trust this folder"
              // The TUI shows "❯ 1. Yes, I trust" where ❯ is the selection cursor (not input prompt).
              // Option 1 is pre-selected, so we just press Enter to confirm.
              //
              // IMPORTANT: Wait for the FULL dialog to render (indicated by "Entertoconfirm")
              // before pressing Enter. Note that ANSI stripping removes spaces, so we check for
              // text without spaces. Pressing too early while the dialog is still rendering
              // can cause unexpected behavior.
              //
              // Handler is idempotent - clearing output buffer prevents re-detection.
              if (
                !trustHandled &&
                clean.includes("trust") &&
                clean.includes("folder") &&
                clean.includes("Itrustthisfolder") && // "Yes, I trust this folder" without spaces
                clean.includes("Entertoconfirm") // "Enter to confirm" without spaces
              ) {
                log.info("usage", "Trust prompt detected, pressing Enter...");
                trustHandled = true;
                output = ""; // Clear output buffer to prevent re-detection
                terminal.write("\r"); // Press Enter to confirm pre-selected option 1
                return; // Wait for next data callback
              }

              // Detect permissions warning that may appear after accepting trust.
              // Shows "Bypass Permissions mode" with link to security docs.
              // This dialog may auto-dismiss or require Enter/Esc.
              //
              // Guard: Don't match if we see "Claude Code v" header (indicates REPL is ready).
              // Handler is idempotent - clearing output buffer prevents re-detection.
              if (
                !permissionsHandled &&
                (clean.includes("Bypasspermissions") ||
                  clean.includes("BypassPermissions") ||
                  clean.includes("code.claude.com/docs") ||
                  clean.includes("security")) &&
                !clean.includes("Claude Code v") // Not yet at REPL (no header)
              ) {
                log.info(
                  "usage",
                  "Permissions warning detected, selecting 'Yes, I accept'..."
                );
                permissionsHandled = true;
                output = ""; // Clear buffer to prevent re-detection
                // Use DOWN ARROW to select "Yes, I accept" (option 1 "No, exit" is pre-selected)
                // The menu uses arrow-key navigation, not numbered input
                // Send DOWN ARROW first, then Enter after a short delay to allow the menu to update
                terminal.write("\u001B[B"); // DOWN ARROW
                setTimeout(() => {
                  if (!resolved && proc.terminal) {
                    debugLog(
                      "anthropic-usage",
                      "Confirming permissions selection..."
                    );
                    proc.terminal.write("\r"); // Enter to confirm
                  }
                }, 100); // 100ms delay for menu to register selection
                return;
              }

              // Wait for REPL prompt before sending /usage command.
              // The REPL shows "❯" when ready for input, but several dialogs use "❯"
              // as a selection cursor or contain the character in ANSI sequences.
              //
              // Use NEGATIVE detection: check that we're NOT in any known dialog state.
              // Use flags for dialogs we've already handled (confirmation text lingers in output).
              const inTrustDialog =
                !trustHandled &&
                (clean.includes("Itrustthisfolder") ||
                  clean.includes("trust this folder"));
              const inPermissionsDialog =
                !permissionsHandled &&
                (clean.includes("Bypasspermissions") ||
                  clean.includes("BypassPermissions"));
              const inMcpPrompt =
                clean.includes("MCP server") && clean.includes("found");
              const inMenu = clean.includes("❯ 1.") || clean.includes("❯1.");

              if (
                !usageCommandSent &&
                clean.includes("❯") &&
                !inTrustDialog &&
                !inPermissionsDialog &&
                !inMcpPrompt &&
                !inMenu
              ) {
                log.info("usage", "REPL prompt detected, sending /usage...");
                usageCommandSent = true;
                terminal.write("/usage\r");
                // After a short delay, press Enter to select the menu item
                setTimeout(() => {
                  if (!resolved && proc.terminal) {
                    debugLog(
                      "anthropic-usage",
                      "Pressing Enter to select menu item..."
                    );
                    proc.terminal.write("\r");
                  }
                }, 300);
                return; // Wait for usage data
              }

              // Check for CLI-level errors (rate limits, API failures)
              // The CLI outputs "Error: Failed to load usage data" when rate limited
              const hasCliError =
                (clean.includes("Error:") &&
                  clean.includes("Failed to load")) ||
                clean.includes("Rate limit") ||
                clean.includes("rate limit");

              if (hasCliError && usageCommandSent) {
                debugLog(
                  "anthropic-usage",
                  "CLI error detected (rate limited), exiting probe early"
                );
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  terminal.write("/exit\r");
                  cleanupSandbox();
                  reject(
                    new Error("CLI rate limited - usage data unavailable")
                  );
                }
                return;
              }

              // Check if we have the usage output panel
              // The usage panel shows "Current session" and ends with "Esc" (to cancel)
              // We also look for "$X.XX" spending pattern or "Resets" text as confirmation
              const hasUsagePanel =
                clean.includes("Current session") &&
                (clean.includes("Esc") ||
                  clean.includes("Resets") ||
                  clean.includes("spent"));

              // Also check for percentage pattern with regex (handles ANSI-broken strings)
              // Look for patterns like "69% used" in the raw output
              const hasPercentPattern = /\d+%\s*used/i.test(clean);

              const hasUsageData = hasUsagePanel || hasPercentPattern;

              if (hasUsageData) {
                debugLog("anthropic-usage", "Usage data detected!", {
                  hasCurrentSession: clean.includes("Current session"),
                  hasEsc: clean.includes("Esc"),
                  hasPercentPattern,
                  hasResets: clean.includes("Resets"),
                  hasSpent: clean.includes("spent"),
                  hasUsagePanel,
                });
                setTimeout(() => {
                  if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);

                    // Send exit command via terminal (use \r for PTY)
                    terminal.write("/exit\r");

                    setTimeout(() => {
                      try {
                        const usage = parseUsageOutput(output);
                        cleanupSandbox();
                        resolve(usage);
                      } catch (error) {
                        cleanupSandbox();
                        reject(error);
                      }
                    }, 100);
                  }
                }, 300);
              }
            },
            // DEBUG: Add exit callback to detect unexpected exits
            exit(_terminal, exitCode, signal) {
              debugLog("anthropic-usage", "PTY exit:", { exitCode, signal });
            },
          },
        });

        // DEBUG: Check if terminal exists immediately after spawn
        debugLog(
          "anthropic-usage",
          "PTY spawned, terminal exists:",
          !!proc.terminal
        );

        // NOTE: We no longer use a fixed timeout here. Instead, we detect
        // the REPL prompt (❯) in the data callback and send /usage then.
        // This handles trust prompts and MCP prompts that may appear first.
      });
    },
  });

/**
 * CLI probe with retry logic.
 * Retries once with 500ms delay between attempts.
 * Budget: ~8s per attempt + 500ms delay = ~16.5s max, fits within 15s phase timeout.
 */
/** Retry schedule for CLI probe: jittered exponential backoff, max 2 retries.
 * Produces delays of ~30s, ~60s before giving up (vs. 500ms previously). */
const cliRetrySchedule = Schedule.intersect(
  Schedule.jittered(Schedule.exponential("30 seconds")),
  Schedule.recurs(2)
);

const tryCliUsageWithRetry = () =>
  tryCliUsage().pipe(
    Effect.retry(cliRetrySchedule),
    Effect.catchAll((err) => {
      log.info("usage", "CLI probe failed after retries:", err);
      return Effect.succeed(null);
    })
  );

/**
 * Try OAuth API with method preference tracking.
 * Updates the method ref based on success/failure.
 */
const tryOAuthAPIWithMethodTracking = (methodRef: Ref.Ref<MethodState>) =>
  Effect.gen(function* () {
    // Read credentials from Keychain
    log.info("usage", "Reading credentials from Keychain...");
    const credentials = yield* readKeychainCredentials().pipe(
      Effect.catchAll((err) => {
        log.info("usage", "Failed to read credentials:", err);
        return Effect.succeed(null);
      })
    );

    if (!credentials) {
      return null;
    }

    debugLog(
      "anthropic-usage",
      "Credentials found, subscription:",
      credentials.claudeAiOauth.subscriptionType
    );

    // Try to fetch usage from API
    log.info("usage", "Trying OAuth API...");
    const apiResult = yield* fetchUsageFromAPI(
      credentials.claudeAiOauth.accessToken
    ).pipe(
      Effect.catchTag("AnthropicUsageError", (error) => {
        log.info("usage", "OAuth API error:", error.reason, error.message);

        // If OAuth is not supported, switch to CLI mode
        if (error.reason === "not_supported") {
          debugLog(
            "anthropic-usage",
            "OAuth API not supported, switching to CLI-only mode"
          );
          return Ref.set(methodRef, {
            method: "cli" as const,
            determinedAt: Date.now(),
          }).pipe(Effect.as(null));
        }

        // If rate limited, propagate the error so fetchUsage can skip CLI
        // (CLI hits the same backend endpoint and will also be rate limited)
        if (error.message.includes("Rate limit")) {
          log.info("usage", "Rate limited by Anthropic, skipping CLI fallback");
          return Effect.fail(
            new AnthropicUsageError({
              message: "Rate limited",
              reason: "rate_limited",
            })
          );
        }

        // If token expired, try to refresh and retry
        if (error.reason === "token_expired") {
          return Effect.gen(function* () {
            debugLog("anthropic-usage", "Token expired, attempting refresh...");
            yield* refreshOAuthToken().pipe(Effect.catchAll(() => Effect.void));
            // Re-read credentials (token may have changed)
            const newCredentials = yield* readKeychainCredentials().pipe(
              Effect.catchAll(() => Effect.succeed(null))
            );
            if (!newCredentials) {
              return null;
            }
            return yield* fetchUsageFromAPI(
              newCredentials.claudeAiOauth.accessToken
            ).pipe(Effect.catchAll(() => Effect.succeed(null)));
          });
        }

        // For other API errors, return null to trigger CLI fallback
        return Effect.succeed(null);
      }),
      // Re-throw rate_limited errors so fetchUsage can skip CLI.
      // Catch all other failures as null (triggers CLI fallback).
      Effect.catchAll((err) => {
        if (
          err instanceof AnthropicUsageError &&
          err.reason === "rate_limited"
        ) {
          return Effect.fail(err);
        }
        return Effect.succeed(null);
      })
    );

    // If API succeeded, update method preference and return
    if (apiResult) {
      log.info("usage", "OAuth API succeeded!");
      yield* Ref.set(methodRef, {
        method: "oauth",
        determinedAt: Date.now(),
      });
      const usage = transformUsageResponse(apiResult);
      // Augment with subscription info from credentials
      return {
        ...usage,
        subscription: {
          expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier ?? "unknown",
          type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
        },
      };
    }

    return null;
  });

/**
 * Try CLI probe with method preference tracking.
 * Updates the method ref to CLI on success.
 */
const tryCliUsageWithMethodTracking = (methodRef: Ref.Ref<MethodState>) =>
  Effect.gen(function* () {
    // Read credentials for subscription info
    const credentials = yield* readKeychainCredentials().pipe(
      Effect.catchAll(() => Effect.succeed(null))
    );

    log.info("usage", "Trying CLI probe via native PTY...");
    const cliResult = yield* tryCliUsageWithRetry();

    if (cliResult) {
      log.info("usage", "CLI probe succeeded! Source:", cliResult.source);
      yield* Ref.set(methodRef, {
        method: "cli",
        determinedAt: Date.now(),
      });
      // Augment CLI result with subscription info from credentials
      return {
        ...cliResult,
        subscription: credentials
          ? {
              expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
              rateLimitTier:
                credentials.claudeAiOauth.rateLimitTier ?? "unknown",
              type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
            }
          : undefined,
      };
    }

    // Final fallback: credentials-only usage (no usage percentages, but subscription info)
    if (credentials) {
      log.info("usage", "Falling back to credentials-only (no percentages)");
      return createCredentialsOnlyUsage(credentials);
    }

    return createUnavailableUsage();
  });

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * AnthropicUsageService provides Anthropic API usage data.
 * Uses OAuth API with CLI fallback, caches results for 30s.
 *
 * Key behaviors:
 * - Learns which method works (OAuth vs CLI) and skips failing methods
 * - Periodically rechecks OAuth availability (every 30 minutes)
 * - Concurrent requests share the same computation (Effect's built-in cache)
 */
export class AnthropicUsageService extends Effect.Service<AnthropicUsageService>()(
  "AnthropicUsageService",
  {
    scoped: Effect.gen(function* () {
      // State: which method to use (oauth vs cli)
      const methodRef = yield* Ref.make<MethodState>({
        method: "unknown",
        determinedAt: null,
      });

      // Core fetch logic that respects method preference
      const fetchUsage = Effect.gen(function* () {
        const state = yield* Ref.get(methodRef);
        const now = Date.now();

        // Determine if we should try OAuth
        const shouldTryOAuth =
          state.method === "unknown" ||
          state.method === "oauth" ||
          (state.determinedAt !== null &&
            now - state.determinedAt > METHOD_RECHECK_MS);

        if (shouldTryOAuth) {
          const result = yield* tryOAuthAPIWithMethodTracking(methodRef).pipe(
            // Catch rate limit before timeout wraps the error type
            Effect.catchTag("AnthropicUsageError", (err) => {
              if (err.reason === "rate_limited") {
                // Rate limited — skip CLI fallback (same backend endpoint).
                // Return credentials-only so the UI shows subscription info.
                return readKeychainCredentials().pipe(
                  Effect.map(createCredentialsOnlyUsage),
                  Effect.catchAll(() =>
                    Effect.succeed(createUnavailableUsage())
                  )
                );
              }
              return Effect.succeed(null);
            }),
            Effect.timeout("12 seconds"),
            Effect.catchAll(() => Effect.succeed(null))
          );
          if (result) {
            return result;
          }
        } else {
          debugLog(
            "anthropic-usage",
            "Skipping OAuth (CLI preferred), using CLI directly"
          );
        }

        // CLI probe fallback
        return yield* tryCliUsageWithMethodTracking(methodRef).pipe(
          Effect.timeout("15 seconds"),
          Effect.catchAll(() => Effect.succeed(createUnavailableUsage()))
        );
      }).pipe(Effect.catchAll(() => Effect.succeed(createUnavailableUsage())));

      // Cached version with TTL and manual invalidation
      const [cachedFetch, invalidate] = yield* Effect.cachedInvalidateWithTTL(
        fetchUsage,
        CACHE_TTL
      );

      return {
        getUsage: () => cachedFetch,
        refreshUsage: () => invalidate.pipe(Effect.andThen(cachedFetch)),
        clearCache: () => invalidate,
      } as const;
    }),
  }
) {}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Create an "unavailable" usage object when we can't fetch real data.
 */
const createUnavailableUsage = (): AnthropicUsage => ({
  fetchedAt: Date.now(),
  opus: null,
  session: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
  sonnet: null,
  source: "unavailable",
  weekly: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
});

/**
 * Create a usage object from credentials metadata (when API is unavailable).
 * This at least shows subscription info even without usage percentages.
 */
const createCredentialsOnlyUsage = (
  creds: Schema.Schema.Type<typeof KeychainCredentials>
): AnthropicUsage => ({
  fetchedAt: Date.now(),
  opus: null,
  session: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
  sonnet: null,
  source: "credentials",
  subscription: {
    expiresAt: creds.claudeAiOauth.expiresAt ?? null,
    rateLimitTier: creds.claudeAiOauth.rateLimitTier ?? "unknown",
    type: creds.claudeAiOauth.subscriptionType ?? "unknown",
  },
  weekly: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
});

/**
 * Read Claude Code credentials from macOS Keychain.
 */
const readKeychainCredentials = () =>
  Effect.gen(function* readKeychainCredentials() {
    // Use macOS security command to read from Keychain
    const proc = Bun.spawn(
      [
        "security",
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-w",
      ],
      {
        stderr: "pipe",
        stdout: "pipe",
      }
    );

    const exitCode = yield* Effect.promise(() => proc.exited);

    if (exitCode !== 0) {
      return yield* new AnthropicUsageError({
        message: "No Claude Code credentials found in Keychain",
        reason: "no_credentials",
      });
    }

    const credentialsJson = yield* Effect.promise(() =>
      new Response(proc.stdout).text()
    );

    // Parse and validate the JSON
    const parseResult = yield* Effect.tryPromise({
      catch: () =>
        new AnthropicUsageError({
          message: "Failed to parse Keychain credentials JSON",
          reason: "parse_error",
        }),
      try: async () => JSON.parse(credentialsJson.trim()),
    });

    // Validate against schema
    const credentials = yield* Schema.decodeUnknown(KeychainCredentials)(
      parseResult
    ).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            cause: error,
            message: "Keychain credentials don't match expected schema",
            reason: "parse_error",
          })
      )
    );

    return credentials;
  }).pipe(Effect.timeout("5 seconds"));

/**
 * Call the Anthropic OAuth usage API.
 */
const fetchUsageFromAPI = (accessToken: string) =>
  Effect.gen(function* fetchUsageFromAPI() {
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new AnthropicUsageError({
          cause,
          message: "Failed to connect to Anthropic API",
          reason: "api_error",
        }),
      try: (signal) =>
        fetch("https://api.anthropic.com/api/oauth/usage", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          signal,
        }),
    });

    if (!response.ok) {
      // Try to parse error response for better error messages
      const errorResult = yield* Effect.tryPromise({
        catch: () => null,
        try: () => response.json() as Promise<{ error?: { message?: string } }>,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      let errorMessage = `Anthropic API returned status ${response.status}`;
      let reason: "token_expired" | "api_error" | "not_supported" = "api_error";

      if (errorResult?.error?.message) {
        errorMessage = errorResult.error.message;
        // Check if OAuth is not supported (different from token expiry)
        if (errorMessage.includes("not supported")) {
          reason = "not_supported";
          debugLog(
            "anthropic-usage",
            "OAuth API not supported by Anthropic yet"
          );
        } else if (response.status === 401) {
          reason = "token_expired";
        }
      } else if (response.status === 401) {
        reason = "token_expired";
        errorMessage = "OAuth access token has expired";
      }

      return yield* new AnthropicUsageError({
        message: errorMessage,
        reason,
      });
    }

    const data = yield* Effect.tryPromise({
      catch: (cause) =>
        new AnthropicUsageError({
          cause,
          message: "Failed to parse API response JSON",
          reason: "parse_error",
        }),
      try: () => response.json(),
    });

    // Validate against schema
    const usage = yield* Schema.decodeUnknown(OAuthUsageResponse)(data).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            cause: error,
            message: "API response doesn't match expected schema",
            reason: "parse_error",
          })
      )
    );

    return usage;
  });

/**
 * Transform API response to our internal AnthropicUsage type.
 */
const transformUsageResponse = (
  response: Schema.Schema.Type<typeof OAuthUsageResponse>
): AnthropicUsage => {
  const makeWindow = (
    data: { percent_used: number; reset_at: number | null },
    limitDesc: string
  ): AnthropicUsageWindow => ({
    percentUsed: data.percent_used,
    resetAt: data.reset_at,
    resetAtRaw: null, // OAuth API provides Unix timestamp, not raw string
    limit: limitDesc,
  });

  return {
    extraUsage: response.extra_usage
      ? {
          // Calculate percentUsed from spent/limit (caps at 100 when over limit)
          limitUsd: response.extra_usage.limit_usd,
          percentUsed: response.extra_usage.limit_usd
            ? Math.min(
                100,
                Math.round(
                  (response.extra_usage.spent_usd /
                    response.extra_usage.limit_usd) *
                    100
                )
              )
            : 0,
          resetAtRaw: null,
          spentUsd: response.extra_usage.spent_usd, // OAuth API doesn't provide this
        }
      : undefined,
    fetchedAt: Date.now(),
    opus: response.seven_day_opus
      ? makeWindow(response.seven_day_opus, "Opus 7-day")
      : null,
    session: makeWindow(response.five_hour, "5-hour window"),
    sonnet: response.seven_day_sonnet
      ? makeWindow(response.seven_day_sonnet, "Sonnet 7-day")
      : null,
    source: "oauth",
    weekly: makeWindow(response.seven_day, "7-day limit"),
  };
};

/**
 * Attempt to refresh OAuth token by running a simple Claude command.
 * The CLI should auto-refresh the token when making authenticated requests.
 *
 * NOTE: `claude auth refresh` doesn't exist, so we run `claude auth status`
 * which triggers the OAuth flow and may refresh the token automatically.
 */
const refreshOAuthToken = () =>
  Effect.gen(function* refreshOAuthToken() {
    // Run auth status which should trigger token refresh if needed
    const proc = Bun.spawn(["claude", "auth", "status"], {
      env: { ...process.env, CLAUDECODE: "" },
      stderr: "pipe",
      stdout: "pipe", // Avoid nested session check
    });

    const exitCode = yield* Effect.promise(() => proc.exited);

    if (exitCode !== 0) {
      const stderr = yield* Effect.promise(() =>
        new Response(proc.stderr).text()
      );
      return yield* new AnthropicUsageError({
        message: `Failed to refresh OAuth token: ${stderr.trim()}`,
        reason: "api_error",
      });
    }

    // Give a moment for keychain to update
    yield* Effect.sleep("500 millis");
  }).pipe(Effect.timeout("5 seconds"));

/** @deprecated Use AnthropicUsageService.Default instead */
export const AnthropicUsageServiceLive = AnthropicUsageService.Default;
