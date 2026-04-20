import type { DialogFlags, DialogState } from "./types";

/**
 * Detect which dialog (if any) is currently displayed in CLI output.
 * Pure function for unit testing the state machine logic.
 *
 * Dialog detection order matters — we check in priority order:
 * 1. MCP prompt (can appear before trust)
 * 2. Trust prompt (appears on first launch in new directory)
 * 3. Permissions warning (appears after accepting trust)
 * 4. CLI error (rate limit, API failure)
 * 5. Usage panel (success state)
 * 6. REPL ready (waiting for command)
 */
export const detectDialog = (
  cleanOutput: string,
  flags: DialogFlags
): DialogState => {
  // MCP server prompt: "MCP server found" with "Continue without" option
  if (
    cleanOutput.includes("MCP server") &&
    cleanOutput.includes("found") &&
    (cleanOutput.includes("Continue without") ||
      cleanOutput.includes("without using"))
  ) {
    return { type: "mcp_prompt" };
  }

  // Trust prompt: "Is this a project you created" / "I trust this folder"
  // Wait for FULL dialog to render (indicated by "Entertoconfirm")
  // Note: ANSI stripping removes spaces, so we check for text without spaces
  if (
    !flags.trustHandled &&
    cleanOutput.includes("trust") &&
    cleanOutput.includes("folder") &&
    cleanOutput.includes("Itrustthisfolder") &&
    cleanOutput.includes("Entertoconfirm")
  ) {
    return { type: "trust_prompt", ready: true };
  }

  // Trust prompt visible but not fully rendered yet
  if (
    !flags.trustHandled &&
    cleanOutput.includes("trust") &&
    cleanOutput.includes("folder") &&
    cleanOutput.includes("Itrustthisfolder")
  ) {
    return { type: "trust_prompt", ready: false };
  }

  // Permissions warning: "Bypass Permissions mode" or security docs link
  // Guard: Don't match if we see "Claude Code v" header (indicates REPL is ready)
  if (
    !flags.permissionsHandled &&
    (cleanOutput.includes("Bypasspermissions") ||
      cleanOutput.includes("BypassPermissions") ||
      cleanOutput.includes("code.claude.com/docs") ||
      cleanOutput.includes("security")) &&
    !cleanOutput.includes("Claude Code v")
  ) {
    return { type: "permissions_warning" };
  }

  // CLI-level errors (rate limits, API failures)
  if (
    flags.usageCommandSent &&
    ((cleanOutput.includes("Error:") &&
      cleanOutput.includes("Failed to load")) ||
      cleanOutput.includes("Rate limit") ||
      cleanOutput.includes("rate limit"))
  ) {
    const errorMatch = cleanOutput.match(/Error:\s*([^\n]+)/);
    return {
      type: "cli_error",
      message: errorMatch?.[1] ?? "CLI error detected",
    };
  }

  // Usage panel: "Current session" with "Esc" or "Resets" or "spent"
  const hasUsagePanel =
    cleanOutput.includes("Current session") &&
    (cleanOutput.includes("Esc") ||
      cleanOutput.includes("Resets") ||
      cleanOutput.includes("spent"));

  // Also check for percentage pattern
  const hasPercentPattern = /\d+%\s*used/i.test(cleanOutput);

  if (hasUsagePanel || hasPercentPattern) {
    return { type: "usage_displayed" };
  }

  // REPL ready: "❯" prompt visible, not in any dialog state
  // Use NEGATIVE detection: check we're NOT in any known dialog
  const inTrustDialog =
    !flags.trustHandled &&
    (cleanOutput.includes("Itrustthisfolder") ||
      cleanOutput.includes("trust this folder"));
  const inPermissionsDialog =
    !flags.permissionsHandled &&
    (cleanOutput.includes("Bypasspermissions") ||
      cleanOutput.includes("BypassPermissions"));
  const inMcpPrompt =
    cleanOutput.includes("MCP server") && cleanOutput.includes("found");
  const inMenu = cleanOutput.includes("❯ 1.") || cleanOutput.includes("❯1.");

  if (
    cleanOutput.includes("❯") &&
    !inTrustDialog &&
    !inPermissionsDialog &&
    !inMcpPrompt &&
    !inMenu
  ) {
    return { type: "repl_ready" };
  }

  return { type: "none" };
};

/**
 * Get the terminal response to send for a given dialog state.
 * Returns null if no response is needed.
 */
export const getDialogResponse = (state: DialogState): string | null => {
  switch (state.type) {
    case "mcp_prompt": {
      // Select option 3 "Continue without using this MCP server"
      return "3\r";
    }

    case "trust_prompt": {
      // Option 1 is pre-selected, press Enter to confirm
      return state.ready ? "\r" : null;
    }

    case "permissions_warning": {
      // DOWN ARROW to select "Yes, I accept" (option 1 "No, exit" is pre-selected)
      // Caller should send "\r" after a short delay
      return "\u001B[B";
    }

    case "repl_ready": {
      // Send /usage command
      return "/usage\r";
    }

    case "usage_displayed": {
      // Exit the CLI
      return "/exit\r";
    }

    case "cli_error": {
      // Exit on error
      return "/exit\r";
    }

    case "none": {
      return null;
    }
  }
};

/**
 * Check if usage data is complete enough to parse.
 * Returns true when we have enough output to attempt parsing.
 */
export const hasUsageData = (cleanOutput: string): boolean => {
  const hasUsagePanel =
    cleanOutput.includes("Current session") &&
    (cleanOutput.includes("Esc") ||
      cleanOutput.includes("Resets") ||
      cleanOutput.includes("spent"));

  const hasPercentPattern = /\d+%\s*used/i.test(cleanOutput);

  return hasUsagePanel || hasPercentPattern;
};
