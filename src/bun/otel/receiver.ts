import { Effect, ParseResult, Schema } from "effect";

import { DatabaseService } from "../db";
import { DatabaseError, OtelStorageError } from "../errors";
import { log } from "../utils/log";
import { storeMetrics, storeEvents } from "./storage";
import { OtlpMetricsRequest, OtlpLogsRequest } from "./types";

// ─── OTLP HTTP Handler Types ─────────────────────────────────────────────────

export interface OtlpResponse {
  partialSuccess?: {
    rejectedDataPoints?: number;
    rejectedLogRecords?: number;
    errorMessage?: string;
  };
}

// ─── Metrics Endpoint Handler ────────────────────────────────────────────────

/**
 * Handle POST /v1/metrics - OTLP metrics ingestion.
 * Validates payload with Effect Schema, stores to SQLite.
 */
export const handleMetrics = (
  body: unknown
): Effect.Effect<
  { stored: number },
  OtelStorageError | DatabaseError | ParseResult.ParseError,
  DatabaseService
> =>
  Effect.gen(function* () {
    // Validate payload
    const request = yield* Schema.decodeUnknown(OtlpMetricsRequest)(body);

    // Store metrics
    const result = yield* storeMetrics(request);

    yield* Effect.sync(() =>
      log.debug("otel", `Stored ${result.stored} metrics`)
    );

    return result;
  });

// ─── Logs Endpoint Handler ───────────────────────────────────────────────────

/**
 * Handle POST /v1/logs - OTLP logs/events ingestion.
 * Validates payload with Effect Schema, stores to SQLite.
 */
export const handleLogs = (
  body: unknown
): Effect.Effect<
  { stored: number },
  OtelStorageError | DatabaseError | ParseResult.ParseError,
  DatabaseService
> =>
  Effect.gen(function* () {
    // Validate payload
    const request = yield* Schema.decodeUnknown(OtlpLogsRequest)(body);

    // Store events
    const result = yield* storeEvents(request);

    yield* Effect.sync(() =>
      log.debug("otel", `Stored ${result.stored} events`)
    );

    return result;
  });

// ─── HTTP Response Helpers ───────────────────────────────────────────────────

/**
 * Build a successful OTLP response.
 * OTLP spec says partial_success should be omitted on full success.
 */
export const buildSuccessResponse = (): OtlpResponse => ({});

/**
 * Build an error response for client-side issues (400).
 */
export const buildClientErrorResponse = (message: string): OtlpResponse => ({
  partialSuccess: {
    errorMessage: message,
  },
});

/**
 * Build an error response for server-side issues (500).
 * Include retry hint for transient errors.
 */
export const buildServerErrorResponse = (message: string): OtlpResponse => ({
  partialSuccess: {
    errorMessage: `${message} (retry recommended)`,
  },
});
