/**
 * RPC Adapter for API Client
 *
 * Implements ApiClient using Electrobun WebSocket RPC for desktop mode.
 * Normalizes RPC errors to typed ApiClientError.
 */

import { Duration, Effect, Layer } from "effect";

import {
  ApiClient,
  ApiError,
  ApiTimeoutError,
  RpcConnectionError,
  type ApiClientError,
  type ApiClientMethods,
  type DashboardParams,
  type OtelAnalyticsParams,
  type SessionDetailParams,
  type SyncParams,
} from "@shared/api-client";

const RPC_TIMEOUT = Duration.seconds(30);

/** Lazy-loaded electroview singleton */
let electroviewPromise: Promise<typeof import("../hooks/useRPC")> | null = null;

const getElectroview = () => {
  electroviewPromise ??= import("../hooks/useRPC");
  return electroviewPromise;
};

/** Wrap RPC call with Effect error handling and timeout */
const rpcCall = <A>(
  method: string,
  fn: (
    rpc: Awaited<ReturnType<typeof getElectroview>>["electroview"]
  ) => Promise<A>
): Effect.Effect<A, ApiClientError> =>
  Effect.tryPromise({
    try: async () => {
      const { electroview } = await getElectroview();
      return fn(electroview);
    },
    catch: (error) => {
      const errorMessage = String(error);
      if (
        errorMessage.includes("WebSocket") ||
        errorMessage.includes("not connected")
      ) {
        return new RpcConnectionError({ method, message: errorMessage });
      }
      return new ApiError({ method, message: errorMessage });
    },
  }).pipe(
    Effect.timeout(RPC_TIMEOUT),
    Effect.catchTag("TimeoutException", () =>
      Effect.fail(
        new ApiTimeoutError({
          method,
          durationMs: Duration.toMillis(RPC_TIMEOUT),
        })
      )
    )
  );

/** RPC-based API client implementation */
const rpcClientMethods: ApiClientMethods = {
  getDashboardData: (params: DashboardParams) =>
    rpcCall("getDashboardData", (rpc) => rpc.request.getDashboardData(params)),

  triggerSync: (params: SyncParams) =>
    rpcCall("triggerSync", (rpc) => rpc.request.triggerSync(params)),

  getSyncStatus: () =>
    rpcCall("getSyncStatus", (rpc) => rpc.request.getSyncStatus({})),

  getSessionDetail: (params: SessionDetailParams) =>
    rpcCall("getSessionDetail", (rpc) => rpc.request.getSessionDetail(params)),

  getSettings: () =>
    rpcCall("getSettings", (rpc) => rpc.request.getSettings({})),

  getAppInfo: () => rpcCall("getAppInfo", (rpc) => rpc.request.getAppInfo({})),

  getAnthropicUsage: () =>
    rpcCall("getAnthropicUsage", (rpc) => rpc.request.getAnthropicUsage({})),

  getOtelStatus: () =>
    rpcCall("getOtelStatus", (rpc) => rpc.request.getOtelStatus({})),

  getOtelAnalytics: (params: OtelAnalyticsParams) =>
    rpcCall("getOtelAnalytics", (rpc) => rpc.request.getOtelAnalytics(params)),
};

/** RPC-based API client layer for Electrobun */
export const RpcApiClientLive = Layer.succeed(ApiClient, rpcClientMethods);
