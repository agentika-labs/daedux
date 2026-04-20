/**
 * Effect-Native API Client
 *
 * Transport-agnostic API client using Effect patterns:
 * - Schema.TaggedError for typed errors
 * - Context.Tag for dependency injection
 * - Layers for HTTP vs RPC adapter selection
 */

import { Context, Effect, Schema } from "effect";

import type {
  AnthropicUsage,
  AppInfo,
  AppSettings,
  DashboardData,
  OtelDashboardData,
  OtelStatus,
  SessionSummary,
  SyncResult,
} from "./rpc-types";

// ─── Typed Errors ───────────────────────────────────────────────────────────

/** API request timed out */
export class ApiTimeoutError extends Schema.TaggedError<ApiTimeoutError>()(
  "ApiTimeoutError",
  {
    method: Schema.String,
    durationMs: Schema.Number,
  }
) {}

/** HTTP-specific: non-2xx status code */
export class HttpStatusError extends Schema.TaggedError<HttpStatusError>()(
  "HttpStatusError",
  {
    method: Schema.String,
    status: Schema.Number,
    body: Schema.optional(Schema.String),
  }
) {}

/** RPC-specific: WebSocket not connected or Electrobun unavailable */
export class RpcConnectionError extends Schema.TaggedError<RpcConnectionError>()(
  "RpcConnectionError",
  {
    method: Schema.String,
    message: Schema.String,
  }
) {}

/** Generic API error (network failure, parse error, etc.) */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  method: Schema.String,
  message: Schema.String,
}) {}

/** Union of all API client errors */
export type ApiClientError =
  | ApiTimeoutError
  | HttpStatusError
  | RpcConnectionError
  | ApiError;

// ─── Request Parameter Schemas ──────────────────────────────────────────────

export const FilterLiteral = Schema.Literal("today", "7d", "30d", "all");
export type FilterLiteral = Schema.Schema.Type<typeof FilterLiteral>;

export const HarnessLiteral = Schema.Literal(
  "claude-code",
  "codex",
  "opencode",
  "unknown"
);

export const DashboardParams = Schema.Struct({
  filter: Schema.optional(FilterLiteral),
  projectPath: Schema.optional(Schema.String),
  harness: Schema.optional(HarnessLiteral),
});
export type DashboardParams = Schema.Schema.Type<typeof DashboardParams>;

export const SyncParams = Schema.Struct({
  fullResync: Schema.optional(Schema.Boolean),
});
export type SyncParams = Schema.Schema.Type<typeof SyncParams>;

export const SessionDetailParams = Schema.Struct({
  sessionId: Schema.String,
});
export type SessionDetailParams = Schema.Schema.Type<
  typeof SessionDetailParams
>;

export const OtelAnalyticsParams = Schema.Struct({
  filter: FilterLiteral,
  harness: Schema.optional(HarnessLiteral),
});
export type OtelAnalyticsParams = Schema.Schema.Type<
  typeof OtelAnalyticsParams
>;

// ─── Sync Status Response ───────────────────────────────────────────────────

export interface SyncStatus {
  isScanning: boolean;
  lastScanAt: string | null;
  sessionCount: number;
}

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * API Client service interface.
 *
 * All methods return Effects with typed errors.
 * Implementations handle transport-specific details (HTTP fetch vs RPC).
 */
export interface ApiClientMethods {
  getDashboardData: (
    params: DashboardParams
  ) => Effect.Effect<DashboardData, ApiClientError>;

  triggerSync: (
    params: SyncParams
  ) => Effect.Effect<SyncResult, ApiClientError>;

  getSyncStatus: () => Effect.Effect<SyncStatus, ApiClientError>;

  getSessionDetail: (
    params: SessionDetailParams
  ) => Effect.Effect<SessionSummary | null, ApiClientError>;

  getSettings: () => Effect.Effect<AppSettings, ApiClientError>;

  getAppInfo: () => Effect.Effect<AppInfo, ApiClientError>;

  getAnthropicUsage: () => Effect.Effect<AnthropicUsage, ApiClientError>;

  getOtelStatus: () => Effect.Effect<OtelStatus, ApiClientError>;

  getOtelAnalytics: (
    params: OtelAnalyticsParams
  ) => Effect.Effect<OtelDashboardData, ApiClientError>;
}

/**
 * ApiClient service tag.
 *
 * Use with `yield* ApiClient` to access the client in an Effect.
 */
export class ApiClient extends Context.Tag("ApiClient")<
  ApiClient,
  ApiClientMethods
>() {}
