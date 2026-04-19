export type UsageMethod = "oauth" | "cli" | "unknown";

export interface MethodState {
  method: UsageMethod;
  determinedAt: number | null;
}

export interface DialogFlags {
  trustHandled: boolean;
  permissionsHandled: boolean;
  usageCommandSent: boolean;
}

export type DialogState =
  | { type: "none" }
  | { type: "trust_prompt"; ready: boolean }
  | { type: "permissions_warning" }
  | { type: "mcp_prompt" }
  | { type: "repl_ready" }
  | { type: "usage_displayed" }
  | { type: "cli_error"; message: string };

export const METHOD_RECHECK_MS = 30 * 60_000;
