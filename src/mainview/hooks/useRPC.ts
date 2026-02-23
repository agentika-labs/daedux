import { Electroview } from "electrobun/view";
import type { UsageMonitorRPC } from "@shared/rpc-types";

// ─── Electrobun RPC Setup ────────────────────────────────────────────────────

// Define the RPC schema for type-safe requests
export const electroview = Electroview.defineRPC<UsageMonitorRPC>({
  handlers: {},
});

// Instantiate Electroview to connect the WebSocket transport.
// Without this, the RPC stays on a stub transport (no `send` method).
new Electroview({ rpc: electroview });

// ─── Type Helpers ────────────────────────────────────────────────────────────

type BunRequests = UsageMonitorRPC["bun"]["requests"];
export type RPCRequestName = keyof BunRequests;
export type RPCRequestParams<K extends RPCRequestName> = BunRequests[K]["params"];
export type RPCRequestResponse<K extends RPCRequestName> = BunRequests[K]["response"];

type BunMessages = UsageMonitorRPC["bun"]["messages"];
export type RPCMessageName = keyof BunMessages;
export type RPCMessageParams<K extends RPCMessageName> = BunMessages[K];

// ─── RPC Functions ───────────────────────────────────────────────────────────

/**
 * Make a typed RPC request to the bun process.
 */
export const rpcRequest = <K extends RPCRequestName>(
  method: K,
  params: RPCRequestParams<K>
): Promise<RPCRequestResponse<K>> => {
  const requestFn = electroview.request[method] as (
    input: RPCRequestParams<K>
  ) => Promise<RPCRequestResponse<K>>;
  return requestFn(params);
};

/**
 * Send a one-way message to the bun process (fire-and-forget).
 */
export const rpcSend = <K extends RPCMessageName>(method: K, params: RPCMessageParams<K>): void => {
  const sendFn = electroview.send[method] as (input: RPCMessageParams<K>) => void;
  sendFn(params);
};

// ─── Hook Interface ──────────────────────────────────────────────────────────

/**
 * Hook to interact with the Electrobun main process via RPC.
 * Returns the electroview singleton directly to ensure referential stability.
 * Components use: rpc.addMessageListener(), rpc.removeMessageListener()
 * For requests, use the exported rpcRequest() function directly.
 */
export const useRPC = () => electroview;

/**
 * Utility hook to log messages to the main process
 */
export function useLogger() {
  return {
    info: (msg: string) => rpcSend("log", { msg, level: "info" }),
    warn: (msg: string) => rpcSend("log", { msg, level: "warn" }),
    error: (msg: string) => rpcSend("log", { msg, level: "error" }),
  };
}
