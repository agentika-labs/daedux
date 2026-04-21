/**
 * Effect branded types for domain primitives.
 * Prevents accidental mixing of structurally identical but semantically different values.
 */

import { Brand, Schema } from "effect";

// ─── Tier 1: Critical (High confusion risk) ─────────────────────────────────

/**
 * Unique session identifier (from JSONL filename or journal uuid).
 * Distinct from QueryId, ProjectPath, FilePath.
 */
export type SessionId = string & Brand.Brand<"SessionId">;
export const SessionId = Brand.nominal<SessionId>();
export const SessionIdSchema = Schema.String.pipe(Schema.fromBrand(SessionId));

/**
 * Composite query identifier: `${sessionId}:${queryIndex}`.
 * Primary key for queries table.
 */
export type QueryId = string & Brand.Brand<"QueryId">;
export const QueryId = Brand.refined<QueryId>(
  (id): id is QueryId => /^.+:\d+$/.test(id),
  (id) => Brand.error(`Invalid QueryId format (expected 'sessionId:index'): ${id}`)
);
export const QueryIdSchema = Schema.String.pipe(Schema.fromBrand(QueryId));

/**
 * Unix timestamp in milliseconds (not seconds).
 * Used for startTime, endTime, timestamp, lastRunAt, nextRunAt, createdAt.
 */
export type UnixTimestampMs = number & Brand.Brand<"UnixTimestampMs">;
export const UnixTimestampMs = Brand.nominal<UnixTimestampMs>();
export const UnixTimestampMsSchema = Schema.Number.pipe(
  Schema.fromBrand(UnixTimestampMs)
);

/**
 * Cost in USD (decimal dollars, e.g., 0.0034).
 * Distinct from token counts which are integers.
 */
export type CostUsd = number & Brand.Brand<"CostUsd">;
export const CostUsd = Brand.nominal<CostUsd>();
export const CostUsdSchema = Schema.Number.pipe(Schema.fromBrand(CostUsd));

// ─── Tier 2: Important (Improves clarity) ───────────────────────────────────

/**
 * Absolute path to a project root directory.
 * Distinct from FilePath and SessionId.
 */
export type ProjectPath = string & Brand.Brand<"ProjectPath">;
export const ProjectPath = Brand.nominal<ProjectPath>();
export const ProjectPathSchema = Schema.String.pipe(
  Schema.fromBrand(ProjectPath)
);

/**
 * Absolute path to a file (JSONL session file or edited file).
 * Distinct from ProjectPath and SessionId.
 */
export type FilePath = string & Brand.Brand<"FilePath">;
export const FilePath = Brand.nominal<FilePath>();
export const FilePathSchema = Schema.String.pipe(Schema.fromBrand(FilePath));

/**
 * Tool use identifier from journal entries.
 * Distinct from SessionId and QueryId.
 */
export type ToolUseId = string & Brand.Brand<"ToolUseId">;
export const ToolUseId = Brand.nominal<ToolUseId>();
export const ToolUseIdSchema = Schema.String.pipe(Schema.fromBrand(ToolUseId));

/**
 * Percentage value (0-100).
 * Used for usage percentages from Anthropic API.
 */
export type Percentage = number & Brand.Brand<"Percentage">;
export const Percentage = Brand.refined<Percentage>(
  (n): n is Percentage => n >= 0 && n <= 100,
  (n) => Brand.error(`Percentage must be 0-100, got: ${n}`)
);
export const PercentageSchema = Schema.Number.pipe(
  Schema.fromBrand(Percentage)
);

/**
 * Query index (0-based ordinal position within a session).
 * Distinct from numeric auto-increment IDs.
 */
export type QueryIndex = number & Brand.Brand<"QueryIndex">;
export const QueryIndex = Brand.refined<QueryIndex>(
  (n): n is QueryIndex => Number.isInteger(n) && n >= 0,
  (n) => Brand.error(`QueryIndex must be non-negative integer, got: ${n}`)
);
export const QueryIndexSchema = Schema.Number.pipe(
  Schema.fromBrand(QueryIndex)
);

// ─── Helper: Construct QueryId from components ──────────────────────────────

/**
 * Constructs a QueryId from SessionId and QueryIndex.
 * This is the only valid way to create a QueryId.
 */
export const makeQueryId = (
  sessionId: SessionId,
  queryIndex: QueryIndex
): QueryId => QueryId(`${sessionId}:${queryIndex}`);
