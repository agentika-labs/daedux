/**
 * HTTP Adapter for API Client
 *
 * Implements ApiClient using fetch for CLI/browser mode.
 * Normalizes HTTP errors to typed ApiClientError.
 */

import { Duration, Effect, Layer } from "effect";

import {
  ApiClient,
  ApiError,
  ApiTimeoutError,
  HttpStatusError,
  type ApiClientError,
  type ApiClientMethods,
  type DashboardParams,
  type OtelAnalyticsParams,
  type SessionDetailParams,
  type SyncParams,
} from "@shared/api-client";

const API_TIMEOUT = Duration.seconds(30);

/** Build URL with query params */
const buildUrl = (
  path: string,
  params?: Record<string, string | boolean | undefined>
): string => {
  const searchParams = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
  }
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
};

/** Wrap fetch with Effect error handling and timeout */
const fetchWithTimeout = <A>(
  method: string,
  url: string,
  options?: RequestInit
): Effect.Effect<A, ApiClientError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { ...options, signal });
      if (!response.ok) {
        const body = await response.text().catch(() => undefined);
        throw { _tag: "http", status: response.status, body };
      }
      return response.json() as Promise<A>;
    },
    catch: (error) => {
      if (
        error &&
        typeof error === "object" &&
        "_tag" in error &&
        error._tag === "http" &&
        "status" in error
      ) {
        const httpError = error as { status: number; body?: string };
        return new HttpStatusError({
          method,
          status: httpError.status,
          body: httpError.body,
        });
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        return new ApiTimeoutError({
          method,
          durationMs: Duration.toMillis(API_TIMEOUT),
        });
      }
      return new ApiError({ method, message: String(error) });
    },
  }).pipe(
    Effect.timeout(API_TIMEOUT),
    Effect.catchTag("TimeoutException", () =>
      Effect.fail(
        new ApiTimeoutError({
          method,
          durationMs: Duration.toMillis(API_TIMEOUT),
        })
      )
    )
  );

/** HTTP-based API client implementation */
const httpClientMethods: ApiClientMethods = {
  getDashboardData: (params: DashboardParams) =>
    fetchWithTimeout(
      "getDashboardData",
      buildUrl("/api/dashboard", {
        filter: params.filter,
        projectPath: params.projectPath,
        harness: params.harness,
      })
    ),

  triggerSync: (params: SyncParams) =>
    fetchWithTimeout("triggerSync", "/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),

  getSyncStatus: () => fetchWithTimeout("getSyncStatus", "/api/sync/status"),

  getSessionDetail: (params: SessionDetailParams) =>
    fetchWithTimeout("getSessionDetail", `/api/session/${params.sessionId}`),

  getSettings: () => fetchWithTimeout("getSettings", "/api/settings"),

  getAppInfo: () => fetchWithTimeout("getAppInfo", "/api/app-info"),

  getAnthropicUsage: () =>
    fetchWithTimeout("getAnthropicUsage", "/api/anthropic-usage"),

  getOtelStatus: () => fetchWithTimeout("getOtelStatus", "/api/otel/status"),

  getOtelAnalytics: (params: OtelAnalyticsParams) =>
    fetchWithTimeout(
      "getOtelAnalytics",
      buildUrl("/api/otel/analytics", {
        filter: params.filter,
        harness: params.harness,
      })
    ),
};

/** HTTP-based API client layer */
export const HttpApiClientLive = Layer.succeed(ApiClient, httpClientMethods);
