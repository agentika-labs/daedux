/**
 * Environment-Aware API Layer Selection
 *
 * Single source of truth for environment detection.
 * Selects HTTP or RPC adapter based on runtime environment.
 */

import { ApiClient } from "@shared/api-client";
import type { ApiClientError } from "@shared/api-client";
import { ManagedRuntime } from "effect";
import type { Effect, Layer } from "effect";

import { HttpApiClientLive } from "./api-http";
import { RpcApiClientLive } from "./api-rpc";

/**
 * Check if we're running in Electrobun desktop environment.
 * Single source of truth - import this instead of reimplementing.
 */
export const isElectrobun = (): boolean =>
  typeof window !== "undefined" && "__electrobun" in window;

/**
 * Unified API layer - selects HTTP or RPC based on environment.
 */
export const ApiClientLive: Layer.Layer<ApiClient> = isElectrobun()
  ? RpcApiClientLive
  : HttpApiClientLive;

// ─── Runtime Management ─────────────────────────────────────────────────────

/** Singleton runtime for the browser */
let runtime: ManagedRuntime.ManagedRuntime<ApiClient, never> | null = null;

const getRuntime = () => {
  runtime ??= ManagedRuntime.make(ApiClientLive);
  return runtime;
};

/**
 * Run an Effect that requires ApiClient.
 *
 * Use this to bridge Effect-based API calls to Promise-based TanStack Query.
 *
 * @example
 * ```ts
 * const data = await runApiEffect(
 *   Effect.gen(function* () {
 *     const api = yield* ApiClient;
 *     return yield* api.getDashboardData({ filter: "7d" });
 *   })
 * );
 * ```
 */
export const runApiEffect = async <A, E extends ApiClientError>(
  effect: Effect.Effect<A, E, ApiClient>
): Promise<A> => getRuntime().runPromise(effect);

/**
 * Convert an ApiClientError to a standard Error for TanStack Query.
 *
 * TanStack Query expects standard Error objects in its error state.
 * This preserves the error information while converting to the expected type.
 */
export const apiErrorToError = (error: ApiClientError): Error => {
  switch (error._tag) {
    case "ApiTimeoutError": {
      return new Error(`Request timed out after ${error.durationMs}ms`);
    }
    case "HttpStatusError": {
      return new Error(
        `HTTP ${error.status}: ${error.body ?? "Request failed"}`
      );
    }
    case "RpcConnectionError": {
      return new Error(`Connection error: ${error.message}`);
    }
    case "ApiError": {
      return new Error(error.message);
    }
  }
};
