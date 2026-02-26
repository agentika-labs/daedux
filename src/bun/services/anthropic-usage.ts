import { Context, Duration, Effect, Layer, Schedule, Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { AnthropicUsageError } from "../errors";
import type { AnthropicUsage, AnthropicUsageWindow } from "../../shared/rpc-types";

// ─── Concurrency Control ────────────────────────────────────────────────────
//
// Mutex to prevent concurrent CLI probes. Multiple getUsage() calls at startup
// can race and overwrite the cache with stale/fallback data. Using a semaphore
// with 1 permit ensures only one probe runs at a time - others wait and get
// cached data.
//
// Created synchronously at module load - Effect.runSync is safe here since
// makeSemaphore has no requirements (returns Effect<Semaphore, never, never>).

const cliProbeMutex = Effect.runSync(Effect.makeSemaphore(1));

// ─── OAuth Response Schema ──────────────────────────────────────────────────

/**
 * Schema for the Anthropic OAuth usage API response.
 * The API returns usage windows with percent_used and reset_at timestamps.
 */
const OAuthUsageResponse = Schema.Struct({
  five_hour: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day_sonnet: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
  seven_day_opus: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
  extra_usage: Schema.optional(
    Schema.Struct({
      spent_usd: Schema.Number,
      limit_usd: Schema.NullOr(Schema.Number),
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
    refreshToken: Schema.String,
    expiresAt: Schema.optional(Schema.Number),
    subscriptionType: Schema.optional(Schema.String),
    rateLimitTier: Schema.optional(Schema.String),
    scopes: Schema.optional(Schema.Array(Schema.String)),
  }),
});

// ─── Cache Configuration ────────────────────────────────────────────────────

/** Cache duration in milliseconds (30 seconds for API) */
const CACHE_TTL_MS = 30_000;

/** Cached usage data with timestamp */
interface CachedUsage {
  data: AnthropicUsage;
  cachedAt: number;
}

let usageCache: CachedUsage | null = null;

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
  // Strip all ANSI escape sequences comprehensively
  const clean = output
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "") // CSI sequences (colors, cursor)
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences (title, etc)
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "") // DCS/PM/APC sequences
    .replace(/\x1b[()][AB012]/g, "") // Character set selection
    .replace(/\x1b[=>]/g, "") // Keypad mode
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a]/g, ""); // Control chars except \t\n\r

  // DEBUG: Find ALL percentage patterns in the output
  const allPercentages = clean.match(/\d+%/g) || [];
  const allUsedPatterns = clean.match(/\d+%\s*used/gi) || [];
  const allSpentPatterns = clean.match(/\$[\d.]+\s*\/\s*\$[\d.]+\s*spent/gi) || [];

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
  const dateTimePatterns = clean.match(
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+(?:\s+at\s+\d+(?:am|pm))?\s*\([^)]+\)/gi
  ) || [];

  // Combine and dedupe (dateTime patterns may overlap with time-only patterns)
  const allResetPatterns = [...new Set([...timePatterns, ...dateTimePatterns])];

  console.log("[anthropic-usage] DEBUG - All patterns found:", {
    percentages: allPercentages,
    usedPatterns: allUsedPatterns,
    spentPatterns: allSpentPatterns,
    timePatterns,
    dateTimePatterns,
    resetPatterns: allResetPatterns,
    hasCurrentSession: clean.includes("Current session"),
    hasCurrentWeek: clean.includes("Current week"),
    hasSonnet: clean.includes("Sonnet"),
    hasExtraUsage: clean.includes("Extra usage"),
  });

  // Try the original regex approach first
  const sessionMatch = clean.match(/Current session[\s\S]*?(\d+)%\s*used/i);
  const weeklyMatch = clean.match(/Current week\s*\(all models\)[\s\S]*?(\d+)%\s*used/i);
  const sonnetMatch = clean.match(/Sonnet only[\s\S]*?(\d+)%\s*used/i);
  const extraUsageMatch = clean.match(/Extra usage[\s\S]*?(\d+)%\s*used/i);
  const extraSpendingMatch = clean.match(/\$([0-9.]+)\s*\/\s*\$([0-9.]+)\s*spent/i);

  // FALLBACK: Use positional extraction from "X% used" patterns
  // The usage panel renders in order: session, weekly (all models), sonnet, extra
  // This is more reliable than label-based regex since TUI cursor positioning
  // separates labels from values
  const extractPct = (s: string) => parseInt(s.match(/(\d+)%/)?.[1] || "0", 10);

  let sessionPct = 0;
  let weeklyPct = 0;
  let sonnetPct = 0;
  let extraPct = 0;

  if (allUsedPatterns.length >= 4) {
    // We have all 4 patterns - use positional extraction
    console.log("[anthropic-usage] Using positional extraction from:", allUsedPatterns);
    sessionPct = extractPct(allUsedPatterns[0]!);
    weeklyPct = extractPct(allUsedPatterns[1]!);
    sonnetPct = extractPct(allUsedPatterns[2]!);
    extraPct = extractPct(allUsedPatterns[3]!);
  } else {
    // Fallback to label-based regex (less reliable with TUI output)
    sessionPct = sessionMatch?.[1] ? parseInt(sessionMatch[1], 10) : 0;
    weeklyPct = weeklyMatch?.[1] ? parseInt(weeklyMatch[1], 10) : 0;
    sonnetPct = sonnetMatch?.[1] ? parseInt(sonnetMatch[1], 10) : 0;
    extraPct = extraUsageMatch?.[1] ? parseInt(extraUsageMatch[1], 10) : 0;
  }

  // Extract reset times with timezone by position
  // Order: session reset, weekly reset, extra usage reset (sonnet has no reset)
  // The patterns are already clean (e.g., "4am (Europe/London)") - no "Resets" prefix
  let sessionResetRaw: string | null = null;
  let weeklyResetRaw: string | null = null;
  let extraResetRaw: string | null = null;

  // Assign by position - time-only patterns typically come first (session),
  // date patterns come later (weekly, extra)
  if (allResetPatterns.length >= 1) sessionResetRaw = allResetPatterns[0]!.trim();
  if (allResetPatterns.length >= 2) weeklyResetRaw = allResetPatterns[1]!.trim();
  if (allResetPatterns.length >= 3) extraResetRaw = allResetPatterns[2]!.trim();

  const result: AnthropicUsage = {
    session: {
      percentUsed: sessionPct,
      resetAt: sessionResetRaw ? parseResetTimeFromDate(sessionResetRaw) : null,
      resetAtRaw: sessionResetRaw,
      limit: "5-hour window",
    },
    weekly: {
      percentUsed: weeklyPct,
      resetAt: weeklyResetRaw ? parseResetTimeFromDate(weeklyResetRaw) : null,
      resetAtRaw: weeklyResetRaw,
      limit: "7-day limit",
    },
    opus: null,
    // Always include sonnet if we have data (even 0% is valid)
    sonnet: allUsedPatterns.length >= 3
      ? {
          percentUsed: sonnetPct,
          resetAt: null,
          resetAtRaw: null, // Sonnet doesn't show reset time
          limit: "Sonnet 7-day",
        }
      : null,
    // Include extraUsage if we have percentage or spending data
    extraUsage: allUsedPatterns.length >= 4 || extraSpendingMatch
      ? {
          percentUsed: extraPct,
          spentUsd: extraSpendingMatch?.[1] ? parseFloat(extraSpendingMatch[1]) : 0,
          limitUsd: extraSpendingMatch?.[2] ? parseFloat(extraSpendingMatch[2]) : null,
          resetAtRaw: extraResetRaw,
        }
      : undefined,
    fetchedAt: Date.now(),
    source: "cli",
  };

  console.log("[anthropic-usage] Parsed result:", {
    session: `${result.session.percentUsed}% (resets: ${sessionResetRaw})`,
    weekly: `${result.weekly.percentUsed}% (resets: ${weeklyResetRaw})`,
    sonnet: result.sonnet ? `${result.sonnet.percentUsed}%` : null,
    extraUsage: `${extraPct}% (resets: ${extraResetRaw})`,
    extraSpending: extraSpendingMatch ? `$${extraSpendingMatch[1]}/$${extraSpendingMatch[2]}` : null,
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
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const isPM = timeMatch[3].toLowerCase() === "pm";

    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;

    const reset = new Date(now);
    reset.setHours(hours, minutes, 0, 0);
    // If the time has passed today, it's tomorrow
    if (reset.getTime() < now.getTime()) {
      reset.setDate(reset.getDate() + 1);
    }
    return Math.floor(reset.getTime() / 1000);
  }

  // Try to parse "Mar 3 at 4pm" format
  const dateTimeMatch = cleanDate.match(/^(\w+)\s+(\d{1,2})\s+at\s+(\d{1,2})(am|pm)$/i);
  if (dateTimeMatch && dateTimeMatch[1] && dateTimeMatch[2] && dateTimeMatch[3] && dateTimeMatch[4]) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = monthNames.indexOf(dateTimeMatch[1].toLowerCase().slice(0, 3));
    const day = parseInt(dateTimeMatch[2], 10);
    let hours = parseInt(dateTimeMatch[3], 10);
    const isPM = dateTimeMatch[4].toLowerCase() === "pm";

    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;

    if (monthIndex >= 0) {
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
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = monthNames.indexOf(dateOnlyMatch[1].toLowerCase().slice(0, 3));
    const day = parseInt(dateOnlyMatch[2], 10);

    if (monthIndex >= 0) {
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
  const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
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
    try: async () => {
      // Skip CLI probe in test environments to avoid dangling processes
      if (process.env.BUN_TEST === "1" || process.env.NODE_ENV === "test") {
        throw new Error("CLI probe disabled in test environment");
      }

      // Check if claude is available before attempting to spawn
      if (!(await commandExists("claude"))) {
        console.log(
          "[anthropic-usage] claude not in PATH. PATH:",
          process.env.PATH?.split(":").slice(0, 5).join(":"),
          "..."
        );
        throw new Error("claude binary not found in PATH");
      }

      // Create isolated sandbox directory to prevent MCP prompt issues.
      // The CLI searches parent directories for .mcp.json files - spawning in
      // an isolated temp directory prevents it from finding any project configs.
      const sandboxDir = mkdtempSync(`${tmpdir()}/claude-probe-`);
      console.log("[anthropic-usage] Created sandbox directory:", sandboxDir);

      let output = "";
      let resolved = false;
      let dataCallbackCount = 0; // DEBUG: track callback invocations
      const decoder = new TextDecoder();

      // Helper to clean up sandbox directory
      const cleanupSandbox = () => {
        try {
          rmSync(sandboxDir, { recursive: true, force: true });
          console.log("[anthropic-usage] Cleaned up sandbox directory");
        } catch (e) {
          console.log("[anthropic-usage] Failed to cleanup sandbox:", e);
        }
      };

      return new Promise<AnthropicUsage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            proc.kill();
            cleanupSandbox();

            // Strip ANSI for debug display
            const cleanedForDebug = output
              .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
              .replace(/\x1b\][^\x07]*\x07/g, "")
              .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")
              .replace(/\x1b[()][AB012]/g, "")
              .replace(/\x1b[=>]/g, "")
              .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a]/g, "");

            // DEBUG: Log state at timeout with CLEANED output
            console.log("[anthropic-usage] TIMEOUT DEBUG:", {
              dataCallbackCount,
              outputLength: output.length,
              cleanedLength: cleanedForDebug.length,
              hasPercentUsed: cleanedForDebug.includes("% used"),
              hasCurrentSession: cleanedForDebug.includes("Current session"),
              hasCurrentWeek: cleanedForDebug.includes("Current week"),
              hasTerminal: !!proc.terminal,
            });
            // Log first 1000 chars of cleaned output to see actual content
            console.log("[anthropic-usage] CLEANED OUTPUT:", cleanedForDebug.slice(0, 1000));
            reject(new Error("CLI probe timed out after 10s"));
          }
        }, 10_000);

        // Use Bun's native PTY API - this provides real terminal emulation
        // that the Claude CLI's TUI requires to render properly
        const proc = Bun.spawn(["claude"], {
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
              console.log(
                `[anthropic-usage] PTY data #${dataCallbackCount}:`,
                chunk.slice(0, 100).replace(/\n/g, "\\n").replace(/\r/g, "\\r")
              );

              // Strip ANSI codes before pattern matching (same logic as parseUsageOutput)
              const clean = output
                .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "") // CSI sequences
                .replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences
                .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "") // DCS/PM/APC
                .replace(/\x1b[()][AB012]/g, "") // Character set
                .replace(/\x1b[=>]/g, ""); // Keypad mode

              // Detect workspace trust prompt and auto-confirm.
              // This appears when entering an unfamiliar directory (like our temp sandbox).
              // The prompt asks "Is this a project you created or one you trust?" with options:
              // 1. Yes, I trust this folder
              // 2. No, exit
              if (
                (clean.includes("trust this folder") || clean.includes("safety check")) &&
                (clean.includes("Yes") || clean.includes("1."))
              ) {
                console.log("[anthropic-usage] Workspace trust prompt detected, confirming...");
                terminal.write("1\r"); // Select "Yes, I trust this folder"
                return; // Wait for next data callback
              }

              // Safety net: Detect MCP server prompt and bypass it.
              // Even with sandbox cwd, global MCP servers from ~/.claude/ could prompt.
              // We select option 3 "Continue without using this MCP server" to proceed.
              if (
                clean.includes("MCP server") &&
                clean.includes("found") &&
                (clean.includes("Continue without") || clean.includes("without using"))
              ) {
                console.log("[anthropic-usage] MCP prompt detected, bypassing...");
                terminal.write("3\r"); // Select "Continue without using this MCP server"
                return; // Wait for next data callback
              }

              // Check if we have the usage output panel
              // The usage panel shows "Current session" and ends with "Esc" (to cancel)
              // We also look for "$X.XX" spending pattern or "Resets" text as confirmation
              const hasUsagePanel =
                clean.includes("Current session") &&
                (clean.includes("Esc") || clean.includes("Resets") || clean.includes("spent"));

              // Also check for percentage pattern with regex (handles ANSI-broken strings)
              // Look for patterns like "69% used" in the raw output
              const hasPercentPattern = /\d+%\s*used/i.test(clean);

              const hasUsageData = hasUsagePanel || hasPercentPattern;

              if (hasUsageData) {
                console.log("[anthropic-usage] Usage data detected!", {
                  hasUsagePanel,
                  hasPercentPattern,
                  hasCurrentSession: clean.includes("Current session"),
                  hasEsc: clean.includes("Esc"),
                  hasResets: clean.includes("Resets"),
                  hasSpent: clean.includes("spent"),
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
                      } catch (e) {
                        cleanupSandbox();
                        reject(e);
                      }
                    }, 100);
                  }
                }, 300);
              }
            },
            // DEBUG: Add exit callback to detect unexpected exits
            exit(_terminal, exitCode, signal) {
              console.log("[anthropic-usage] PTY exit:", { exitCode, signal });
            },
          },
        });

        // DEBUG: Check if terminal exists immediately after spawn
        console.log("[anthropic-usage] PTY spawned, terminal exists:", !!proc.terminal);

        // Wait for prompt, then send /usage command (use \r for PTY)
        // NOTE: /usage opens a command palette menu, so we need to:
        // 1. Send "/usage\r" to type the command and open the menu
        // 2. Wait for menu to render
        // 3. Send "\r" again to select the first menu item
        setTimeout(() => {
          if (!resolved && proc.terminal) {
            console.log("[anthropic-usage] Sending /usage command...");
            proc.terminal.write("/usage\r");

            // After a short delay, press Enter to select the menu item
            setTimeout(() => {
              if (!resolved && proc.terminal) {
                console.log("[anthropic-usage] Pressing Enter to select menu item...");
                proc.terminal.write("\r");
              }
            }, 300);
          } else if (!proc.terminal) {
            console.log("[anthropic-usage] ERROR: proc.terminal is undefined!");
          }
        }, 500);
      });
    },
    catch: (e) =>
      new AnthropicUsageError({
        reason: "api_error",
        message: `CLI probe failed: ${e}`,
        cause: e,
      }),
  });

/**
 * CLI probe with retry logic.
 * Retries up to 2 times with 500ms delay between attempts.
 */
const tryCliUsageWithRetry = () =>
  tryCliUsage().pipe(
    Effect.retry(Schedule.recurs(2).pipe(Schedule.addDelay(() => Duration.millis(500)))),
    Effect.catchAll((err) => {
      console.log("[anthropic-usage] CLI probe failed after retries:", err);
      return Effect.succeed(null);
    })
  );

// ─── Service Interface ──────────────────────────────────────────────────────

export class AnthropicUsageService extends Context.Tag("AnthropicUsageService")<
  AnthropicUsageService,
  {
    /** Get current Anthropic usage (cached for 30s) */
    readonly getUsage: () => Effect.Effect<AnthropicUsage, AnthropicUsageError>;

    /** Force refresh usage data, bypassing cache */
    readonly refreshUsage: () => Effect.Effect<AnthropicUsage, AnthropicUsageError>;

    /** Clear the usage cache */
    readonly clearCache: () => Effect.Effect<void, never>;
  }
>() {}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Create an "unavailable" usage object when we can't fetch real data.
 */
const createUnavailableUsage = (): AnthropicUsage => ({
  session: { percentUsed: 0, resetAt: null, resetAtRaw: null, limit: null },
  weekly: { percentUsed: 0, resetAt: null, resetAtRaw: null, limit: null },
  sonnet: null,
  opus: null,
  fetchedAt: Date.now(),
  source: "unavailable",
});

/**
 * Create a usage object from credentials metadata (when API is unavailable).
 * This at least shows subscription info even without usage percentages.
 */
const createCredentialsOnlyUsage = (
  creds: Schema.Schema.Type<typeof KeychainCredentials>
): AnthropicUsage => ({
  session: { percentUsed: 0, resetAt: null, resetAtRaw: null, limit: null },
  weekly: { percentUsed: 0, resetAt: null, resetAtRaw: null, limit: null },
  sonnet: null,
  opus: null,
  subscription: {
    type: creds.claudeAiOauth.subscriptionType ?? "unknown",
    rateLimitTier: creds.claudeAiOauth.rateLimitTier ?? "unknown",
    expiresAt: creds.claudeAiOauth.expiresAt ?? null,
  },
  fetchedAt: Date.now(),
  source: "credentials",
});

/**
 * Read Claude Code credentials from macOS Keychain.
 */
const readKeychainCredentials = () =>
  Effect.gen(function* () {
    // Use macOS security command to read from Keychain
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const exitCode = yield* Effect.promise(() => proc.exited);

    if (exitCode !== 0) {
      return yield* new AnthropicUsageError({
        reason: "no_credentials",
        message: "No Claude Code credentials found in Keychain",
      });
    }

    const credentialsJson = yield* Effect.promise(() => new Response(proc.stdout).text());

    // Parse and validate the JSON
    const parseResult = yield* Effect.tryPromise({
      try: async () => JSON.parse(credentialsJson.trim()),
      catch: () =>
        new AnthropicUsageError({
          reason: "parse_error",
          message: "Failed to parse Keychain credentials JSON",
        }),
    });

    // Validate against schema
    const credentials = yield* Schema.decodeUnknown(KeychainCredentials)(parseResult).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            reason: "parse_error",
            message: "Keychain credentials don't match expected schema",
            cause: error,
          })
      )
    );

    return credentials;
  });

/**
 * Call the Anthropic OAuth usage API.
 */
const fetchUsageFromAPI = (accessToken: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://api.anthropic.com/api/oauth/usage", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }),
      catch: (cause) =>
        new AnthropicUsageError({
          reason: "api_error",
          message: "Failed to connect to Anthropic API",
          cause,
        }),
    });

    if (!response.ok) {
      // Try to parse error response for better error messages
      const errorResult = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error?: { message?: string } }>,
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      let errorMessage = `Anthropic API returned status ${response.status}`;
      let reason: "token_expired" | "api_error" | "not_supported" = "api_error";

      if (errorResult?.error?.message) {
        errorMessage = errorResult.error.message;
        // Check if OAuth is not supported (different from token expiry)
        if (errorMessage.includes("not supported")) {
          reason = "not_supported";
          console.log("[anthropic-usage] OAuth API not supported by Anthropic yet");
        } else if (response.status === 401) {
          reason = "token_expired";
        }
      } else if (response.status === 401) {
        reason = "token_expired";
        errorMessage = "OAuth access token has expired";
      }

      return yield* new AnthropicUsageError({
        reason,
        message: errorMessage,
      });
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new AnthropicUsageError({
          reason: "parse_error",
          message: "Failed to parse API response JSON",
          cause,
        }),
    });

    // Validate against schema
    const usage = yield* Schema.decodeUnknown(OAuthUsageResponse)(data).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            reason: "parse_error",
            message: "API response doesn't match expected schema",
            cause: error,
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
    session: makeWindow(response.five_hour, "5-hour window"),
    weekly: makeWindow(response.seven_day, "7-day limit"),
    sonnet: response.seven_day_sonnet
      ? makeWindow(response.seven_day_sonnet, "Sonnet 7-day")
      : null,
    opus: response.seven_day_opus ? makeWindow(response.seven_day_opus, "Opus 7-day") : null,
    extraUsage: response.extra_usage
      ? {
          // Calculate percentUsed from spent/limit (caps at 100 when over limit)
          percentUsed: response.extra_usage.limit_usd
            ? Math.min(100, Math.round((response.extra_usage.spent_usd / response.extra_usage.limit_usd) * 100))
            : 0,
          spentUsd: response.extra_usage.spent_usd,
          limitUsd: response.extra_usage.limit_usd,
          resetAtRaw: null, // OAuth API doesn't provide this
        }
      : undefined,
    fetchedAt: Date.now(),
    source: "oauth",
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
  Effect.gen(function* () {
    // Run auth status which should trigger token refresh if needed
    const proc = Bun.spawn(["claude", "auth", "status"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CLAUDECODE: "" }, // Avoid nested session check
    });

    const exitCode = yield* Effect.promise(() => proc.exited);

    if (exitCode !== 0) {
      const stderr = yield* Effect.promise(() => new Response(proc.stderr).text());
      return yield* new AnthropicUsageError({
        reason: "api_error",
        message: `Failed to refresh OAuth token: ${stderr.trim()}`,
      });
    }

    // Give a moment for keychain to update
    yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 500)));
  });

/**
 * Full usage fetch strategy with fallback chain:
 * 1. OAuth API (instant, if/when Anthropic enables it)
 * 2. CLI /usage via expect (~3-5s, parses TUI output)
 * 3. Credentials metadata (instant, shows subscription tier only)
 */
const tryOAuthAPI = () =>
  Effect.gen(function* () {
    // Read credentials from Keychain
    console.log("[anthropic-usage] Reading credentials from Keychain...");
    const credentials = yield* readKeychainCredentials();
    console.log("[anthropic-usage] Credentials found, subscription:", credentials.claudeAiOauth.subscriptionType);

    // Try to fetch usage from API
    console.log("[anthropic-usage] Trying OAuth API...");
    const apiResult = yield* fetchUsageFromAPI(credentials.claudeAiOauth.accessToken).pipe(
      Effect.catchTag("AnthropicUsageError", (error) => {
        console.log("[anthropic-usage] OAuth API error:", error.reason, error.message);

        // If OAuth is not supported yet, skip directly to CLI probe (no retry)
        if (error.reason === "not_supported") {
          console.log("[anthropic-usage] OAuth API not available yet, skipping to CLI probe");
          return Effect.succeed(null);
        }

        // If token expired, try to refresh and retry
        if (error.reason === "token_expired") {
          return Effect.gen(function* () {
            console.log("[anthropic-usage] Token expired, attempting refresh...");
            yield* refreshOAuthToken();
            // Re-read credentials (token may have changed)
            const newCredentials = yield* readKeychainCredentials();
            return yield* fetchUsageFromAPI(newCredentials.claudeAiOauth.accessToken);
          });
        }

        // For other API errors, we'll fall back to CLI probe
        return Effect.fail(error);
      }),
      // If API fails, return null to signal fallback
      Effect.catchAll((err) => {
        console.log("[anthropic-usage] OAuth API failed, will try CLI probe. Error:", err);
        return Effect.succeed(null);
      })
    );

    // If API succeeded, transform and return
    if (apiResult) {
      console.log("[anthropic-usage] OAuth API succeeded!");
      const usage = transformUsageResponse(apiResult);
      // Augment with subscription info from credentials
      return {
        ...usage,
        subscription: {
          type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier ?? "unknown",
          expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
        },
      };
    }

    // Fallback to CLI /usage probe with retry
    console.log("[anthropic-usage] Trying CLI probe via native PTY...");
    const cliResult = yield* tryCliUsageWithRetry();

    if (cliResult) {
      console.log("[anthropic-usage] CLI probe succeeded! Source:", cliResult.source);
      console.log("[anthropic-usage] Usage data:", JSON.stringify({
        session: cliResult.session,
        weekly: cliResult.weekly,
        opus: cliResult.opus,
        sonnet: cliResult.sonnet,
      }, null, 2));
      // Augment CLI result with subscription info from credentials
      return {
        ...cliResult,
        subscription: {
          type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier ?? "unknown",
          expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
        },
      };
    }

    // Final fallback: credentials-only usage (no usage percentages, but subscription info)
    console.log("[anthropic-usage] Falling back to credentials-only (no percentages)");
    return createCredentialsOnlyUsage(credentials);
  });

// ─── Live Implementation ────────────────────────────────────────────────────

export const AnthropicUsageServiceLive = Layer.succeed(AnthropicUsageService, {
  getUsage: () =>
    // Acquire permit - only one caller proceeds, others wait
    cliProbeMutex.withPermits(1)(
      Effect.gen(function* () {
        // Check cache INSIDE mutex to avoid thundering herd
        // (concurrent callers wait here, then get cached data)
        const now = Date.now();
        if (usageCache && now - usageCache.cachedAt < CACHE_TTL_MS) {
          return usageCache.data;
        }

        // Try OAuth API, fall back to unavailable on any error
        const usage = yield* tryOAuthAPI().pipe(
          Effect.catchAll(() => Effect.succeed(createUnavailableUsage()))
        );

        // Update cache (safe - we hold the mutex)
        usageCache = { data: usage, cachedAt: now };

        return usage;
      })
    ),

  refreshUsage: () =>
    // Acquire permit for refresh (serialized with getUsage)
    cliProbeMutex.withPermits(1)(
      Effect.gen(function* () {
        // Clear cache and fetch fresh data
        usageCache = null;

        const usage = yield* tryOAuthAPI().pipe(
          Effect.catchAll(() => Effect.succeed(createUnavailableUsage()))
        );

        usageCache = { data: usage, cachedAt: Date.now() };

        return usage;
      })
    ),

  clearCache: () =>
    Effect.sync(() => {
      usageCache = null;
    }),
});
