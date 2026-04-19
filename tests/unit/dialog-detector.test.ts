import { describe, expect, it } from "bun:test";

import {
  detectDialog,
  getDialogResponse,
  hasUsageData,
} from "../../src/bun/services/anthropic-usage/dialog-detector";
import type { DialogFlags } from "../../src/bun/services/anthropic-usage/types";

const defaultFlags: DialogFlags = {
  trustHandled: false,
  permissionsHandled: false,
  usageCommandSent: false,
};

describe("detectDialog", () => {
  describe("MCP prompt detection", () => {
    it("detects MCP server prompt with 'Continue without' option", () => {
      const output = "MCP server found in this directory. Continue without using this MCP server?";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("mcp_prompt");
    });

    it("detects MCP server prompt with 'without using' variant", () => {
      const output = "MCP server found. Choose: 1. Use server 2. Skip 3. Continue without using";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("mcp_prompt");
    });
  });

  describe("trust prompt detection", () => {
    it("detects trust prompt when fully rendered", () => {
      const output = "Is this a project you created? I trust this folder Itrustthisfolder Entertoconfirm";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("trust_prompt");
      expect(state.type === "trust_prompt" && state.ready).toBe(true);
    });

    it("detects trust prompt when not fully rendered", () => {
      const output = "Is this a project you created? I trust this folder Itrustthisfolder";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("trust_prompt");
      expect(state.type === "trust_prompt" && state.ready).toBe(false);
    });

    it("ignores trust prompt if already handled", () => {
      const output = "I trust this folder Itrustthisfolder Entertoconfirm";
      const flags = { ...defaultFlags, trustHandled: true };
      const state = detectDialog(output, flags);
      expect(state.type).not.toBe("trust_prompt");
    });
  });

  describe("permissions warning detection", () => {
    it("detects Bypasspermissions warning", () => {
      const output = "Bypasspermissions mode is enabled. This may be dangerous.";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("permissions_warning");
    });

    it("detects security docs link", () => {
      const output = "For more information, visit code.claude.com/docs/security";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("permissions_warning");
    });

    it("ignores permissions warning if REPL header visible", () => {
      const output = "Claude Code v1.2.3 Bypasspermissions security";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).not.toBe("permissions_warning");
    });

    it("ignores permissions warning if already handled", () => {
      const output = "Bypasspermissions mode is enabled";
      const flags = { ...defaultFlags, permissionsHandled: true };
      const state = detectDialog(output, flags);
      expect(state.type).not.toBe("permissions_warning");
    });
  });

  describe("CLI error detection", () => {
    it("detects rate limit error after /usage sent", () => {
      const output = "Error: Failed to load usage data. Rate limit exceeded.";
      const flags = { ...defaultFlags, usageCommandSent: true };
      const state = detectDialog(output, flags);
      expect(state.type).toBe("cli_error");
      if (state.type === "cli_error") {
        expect(state.message).toContain("Failed to load");
      }
    });

    it("ignores error if /usage not yet sent", () => {
      const output = "Error: Failed to load usage data";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).not.toBe("cli_error");
    });
  });

  describe("usage panel detection", () => {
    it("detects usage panel with Current session and Esc", () => {
      const output = "Current session 45% used Esc to close";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("usage_displayed");
    });

    it("detects usage panel with Resets text", () => {
      const output = "Current session 45% used Resets in 2h";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("usage_displayed");
    });

    it("detects usage panel with spent text", () => {
      const output = "Current session 45% $10.00 spent";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("usage_displayed");
    });

    it("detects percentage pattern alone", () => {
      const output = "69% used";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("usage_displayed");
    });
  });

  describe("REPL ready detection", () => {
    it("detects REPL prompt when ❯ visible and no dialogs", () => {
      const output = "Claude Code v1.2.3 ❯ ";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).toBe("repl_ready");
    });

    it("ignores ❯ when trust dialog visible", () => {
      const output = "Itrustthisfolder ❯ 1. Yes ❯ 2. No";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).not.toBe("repl_ready");
    });

    it("ignores ❯ when in numbered menu", () => {
      const output = "❯ 1. Option one ❯1. Other option";
      const state = detectDialog(output, defaultFlags);
      expect(state.type).not.toBe("repl_ready");
    });
  });

  describe("none state", () => {
    it("returns none for empty output", () => {
      const state = detectDialog("", defaultFlags);
      expect(state.type).toBe("none");
    });

    it("returns none for unrecognized output", () => {
      const state = detectDialog("Loading...", defaultFlags);
      expect(state.type).toBe("none");
    });
  });
});

describe("getDialogResponse", () => {
  it("returns 3\\r for MCP prompt", () => {
    expect(getDialogResponse({ type: "mcp_prompt" })).toBe("3\r");
  });

  it("returns \\r for ready trust prompt", () => {
    expect(getDialogResponse({ type: "trust_prompt", ready: true })).toBe("\r");
  });

  it("returns null for not-ready trust prompt", () => {
    expect(getDialogResponse({ type: "trust_prompt", ready: false })).toBeNull();
  });

  it("returns DOWN ARROW for permissions warning", () => {
    expect(getDialogResponse({ type: "permissions_warning" })).toBe("\u001B[B");
  });

  it("returns /usage\\r for REPL ready", () => {
    expect(getDialogResponse({ type: "repl_ready" })).toBe("/usage\r");
  });

  it("returns /exit\\r for usage displayed", () => {
    expect(getDialogResponse({ type: "usage_displayed" })).toBe("/exit\r");
  });

  it("returns /exit\\r for CLI error", () => {
    expect(getDialogResponse({ type: "cli_error", message: "Error" })).toBe("/exit\r");
  });

  it("returns null for none state", () => {
    expect(getDialogResponse({ type: "none" })).toBeNull();
  });
});

describe("hasUsageData", () => {
  it("returns true for usage panel with Esc", () => {
    expect(hasUsageData("Current session 45% Esc")).toBe(true);
  });

  it("returns true for usage panel with Resets", () => {
    expect(hasUsageData("Current session Resets in 2h")).toBe(true);
  });

  it("returns true for percentage pattern", () => {
    expect(hasUsageData("45% used")).toBe(true);
  });

  it("returns false for empty output", () => {
    expect(hasUsageData("")).toBe(false);
  });

  it("returns false for unrelated output", () => {
    expect(hasUsageData("Loading...")).toBe(false);
  });
});
