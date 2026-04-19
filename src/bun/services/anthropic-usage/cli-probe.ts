import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { Effect, Schedule } from "effect";

import type { AnthropicUsage } from "../../../shared/rpc-types";
import { AnthropicUsageError } from "../../errors";
import { stripAnsi } from "../../utils/ansi";
import { debugLog, log } from "../../utils/log";
import { getCliSpawnEnv } from "../../utils/path";
import { detectDialog, getDialogResponse, hasUsageData } from "./dialog-detector";
import { parseUsageOutput } from "./tui-parser";
import type { DialogFlags } from "./types";

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
export const tryCliUsage = () =>
  Effect.tryPromise({
    catch: (e) => {
      const msg = String(e);
      const isRateLimited =
        msg.includes("rate limited") || msg.includes("Rate limit");
      const isDisabled =
        msg.includes("disabled in test") || msg.includes("disabled in CLI server");
      return new AnthropicUsageError({
        cause: e,
        message: isRateLimited ? "CLI rate limited" : `CLI probe failed: ${e}`,
        reason: isRateLimited ? "rate_limited" : isDisabled ? "not_supported" : "api_error",
      });
    },
    try: async () => {
      if (process.env.BUN_TEST === "1" || process.env.NODE_ENV === "test") {
        throw new Error("CLI probe disabled in test environment");
      }

      if (process.env.DAEDUX_CLI_SERVER === "1") {
        throw new Error("CLI probe disabled in CLI server mode");
      }

      if (!(await commandExists("claude"))) {
        debugLog(
          "anthropic-usage",
          "claude not in PATH. PATH:",
          process.env.PATH?.split(":").slice(0, 5).join(":"),
          "..."
        );
        throw new Error("claude binary not found in PATH");
      }

      const sandboxDir = mkdtempSync(`${tmpdir()}/claude-probe-`);
      debugLog("anthropic-usage", "Created sandbox directory:", sandboxDir);

      let output = "";
      let resolved = false;
      let dataCallbackCount = 0;
      const decoder = new TextDecoder();

      const flags: DialogFlags = {
        trustHandled: false,
        permissionsHandled: false,
        usageCommandSent: false,
      };

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

            log.info("usage", "CLI probe timeout debug:", {
              cleanedLength: cleanedForDebug.length,
              dataCallbackCount,
              hasCurrentSession: cleanedForDebug.includes("Current session"),
              hasCurrentWeek: cleanedForDebug.includes("Current week"),
              hasPercentUsed: cleanedForDebug.includes("% used"),
              hasTerminal: !!proc.terminal,
              outputLength: output.length,
              usageCommandSent: flags.usageCommandSent,
            });
            log.info(
              "usage",
              "CLI probe output:",
              cleanedForDebug.slice(0, 1000)
            );
            reject(new Error("CLI probe timed out after 8s"));
          }
        }, 8000);

        const proc = Bun.spawn(["claude", "--dangerously-skip-permissions"], {
          cwd: sandboxDir,
          env: getCliSpawnEnv(),
          terminal: {
            cols: 120,
            rows: 40,
            data(terminal, data) {
              dataCallbackCount++;
              const chunk = decoder.decode(data, { stream: true });
              output += chunk;

              debugLog(
                "anthropic-usage",
                `PTY data #${dataCallbackCount}:`,
                chunk
                  .slice(0, 100)
                  .replaceAll("\n", "\\n")
                  .replaceAll("\r", "\\r")
              );

              const clean = stripAnsi(output);
              const state = detectDialog(clean, flags);

              debugLog("anthropic-usage", "Dialog state:", state.type);

              switch (state.type) {
                case "mcp_prompt": {
                  log.info("usage", "MCP prompt detected, bypassing...");
                  const response = getDialogResponse(state);
                  if (response) terminal.write(response);
                  return;
                }

                case "trust_prompt": {
                  if (state.ready) {
                    log.info("usage", "Trust prompt detected, pressing Enter...");
                    flags.trustHandled = true;
                    output = "";
                    const response = getDialogResponse(state);
                    if (response) terminal.write(response);
                  }
                  return;
                }

                case "permissions_warning": {
                  log.info(
                    "usage",
                    "Permissions warning detected, selecting 'Yes, I accept'..."
                  );
                  flags.permissionsHandled = true;
                  output = "";
                  const response = getDialogResponse(state);
                  if (response) terminal.write(response);
                  setTimeout(() => {
                    if (!resolved && proc.terminal) {
                      debugLog(
                        "anthropic-usage",
                        "Confirming permissions selection..."
                      );
                      proc.terminal.write("\r");
                    }
                  }, 100);
                  return;
                }

                case "repl_ready": {
                  if (!flags.usageCommandSent) {
                    log.info("usage", "REPL prompt detected, sending /usage...");
                    flags.usageCommandSent = true;
                    terminal.write("/usage\r");
                    setTimeout(() => {
                      if (!resolved && proc.terminal) {
                        debugLog(
                          "anthropic-usage",
                          "Pressing Enter to select menu item..."
                        );
                        proc.terminal.write("\r");
                      }
                    }, 300);
                  }
                  return;
                }

                case "cli_error": {
                  debugLog(
                    "anthropic-usage",
                    "CLI error detected:",
                    state.message
                  );
                  if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    terminal.write("/exit\r");
                    cleanupSandbox();
                    reject(new Error(`CLI error: ${state.message}`));
                  }
                  return;
                }

                case "usage_displayed": {
                  if (hasUsageData(clean)) {
                    debugLog("anthropic-usage", "Usage data detected!");
                    setTimeout(() => {
                      if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
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
                  return;
                }

                case "none":
                  return;
              }
            },
            exit(_terminal, exitCode, signal) {
              debugLog("anthropic-usage", "PTY exit:", { exitCode, signal });
            },
          },
        });

        debugLog(
          "anthropic-usage",
          "PTY spawned, terminal exists:",
          !!proc.terminal
        );
      });
    },
  });

/**
 * Retry schedule for CLI probe: jittered exponential backoff, max 2 retries.
 * Produces delays of ~30s, ~60s before giving up.
 */
const cliRetrySchedule = Schedule.intersect(
  Schedule.jittered(Schedule.exponential("30 seconds")),
  Schedule.recurs(2)
);

/**
 * CLI probe with retry logic.
 * Retries with exponential backoff, but doesn't retry rate limits.
 */
export const tryCliUsageWithRetry = () =>
  tryCliUsage().pipe(
    Effect.retry({
      schedule: cliRetrySchedule,
      while: (err) => err.reason !== "rate_limited" && err.reason !== "not_supported",
    }),
    Effect.catchTag("AnthropicUsageError", (err) => {
      if (err.reason === "rate_limited") {
        log.info("usage", "CLI probe rate limited");
        return Effect.fail(err);
      }
      log.info("usage", "CLI probe failed after retries:", err);
      return Effect.succeed(null);
    })
  );
