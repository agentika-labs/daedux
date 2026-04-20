/**
 * Session Pipeline with Effect Schema
 *
 * Defines schemas for DB rows and RPC types with automatic transformation.
 * Schema drift is detected at compile time and test time via validation.
 *
 * Benefits:
 * - Schema.NullOr + withDefault replaces scattered ?? 0
 * - validateDbRow() catches schema drift at test time
 * - Schema.transform derives transformer from schema relationship
 */

import { Context, Effect, Layer, ParseResult, Schema } from "effect";

import { modelDisplayNameWithVersion } from "../../shared/model-utils";
import type { HarnessId } from "../../shared/rpc-types";
import { toDateString } from "../utils/formatting";

// ─── File Operation Schema ──────────────────────────────────────────────────

export const FileOperationSchema = Schema.Struct({
  filePath: Schema.String,
  tool: Schema.String,
  extension: Schema.String,
});

export type FileOperation = Schema.Schema.Type<typeof FileOperationSchema>;

// ─── DB Schema (Source of Truth) ────────────────────────────────────────────

/**
 * SessionDbRow - Schema matching database sessions table.
 * Nullable columns are represented with Schema.NullOr.
 */
export const SessionDbRowSchema = Schema.Struct({
  sessionId: Schema.String,
  projectPath: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  startTime: Schema.Number,
  durationMs: Schema.NullOr(Schema.Number),
  totalInputTokens: Schema.NullOr(Schema.Number),
  totalOutputTokens: Schema.NullOr(Schema.Number),
  totalCacheRead: Schema.NullOr(Schema.Number),
  totalCacheWrite: Schema.NullOr(Schema.Number),
  totalCost: Schema.NullOr(Schema.Number),
  queryCount: Schema.NullOr(Schema.Number),
  toolUseCount: Schema.NullOr(Schema.Number),
  isSubagent: Schema.NullOr(Schema.Boolean),
  compactions: Schema.NullOr(Schema.Number),
  savedByCaching: Schema.NullOr(Schema.Number),
  turnCount: Schema.NullOr(Schema.Number),
  harness: Schema.NullOr(Schema.String),
});

export type SessionDbRow = Schema.Schema.Type<typeof SessionDbRowSchema>;

// ─── Aggregated Data Schema ─────────────────────────────────────────────────

/**
 * SessionAggregates - Related data from joins (tools, files, agents).
 * Computed separately and joined during transformation.
 */
export const SessionAggregatesSchema = Schema.Struct({
  toolCounts: Schema.Record({ key: Schema.String, value: Schema.Number }),
  fileOperations: Schema.Array(FileOperationSchema),
  primaryModel: Schema.String,
  agentCount: Schema.Number,
  errorCount: Schema.Number,
});

export type SessionAggregates = Schema.Schema.Type<
  typeof SessionAggregatesSchema
>;

// ─── RPC Schema (Frontend Contract) ─────────────────────────────────────────

/**
 * SessionSummaryRpc - Schema for the RPC/frontend type.
 * All fields are required with defaults applied during transformation.
 */
/** HarnessId literal schema */
const HarnessIdSchema = Schema.Literal(
  "claude-code",
  "codex",
  "opencode",
  "unknown"
);

export const SessionSummaryRpcSchema = Schema.Struct({
  sessionId: Schema.String,
  project: Schema.String,
  date: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  startTime: Schema.Number,
  durationMs: Schema.Number,
  totalCost: Schema.Number,
  queryCount: Schema.Number,
  toolUseCount: Schema.Number,
  turnCount: Schema.Number,
  isSubagent: Schema.Boolean,
  harness: HarnessIdSchema,
  model: Schema.String,
  modelShort: Schema.String,
  firstPrompt: Schema.String,
  totalTokens: Schema.Number,
  savedByCaching: Schema.Number,
  uncachedInput: Schema.Number,
  cacheRead: Schema.Number,
  cacheCreation: Schema.Number,
  output: Schema.Number,
  compactions: Schema.Number,
  subagentCount: Schema.Number,
  toolErrorCount: Schema.Number,
  bashCommandCount: Schema.Number,
  fileReadCount: Schema.Number,
  fileEditCount: Schema.Number,
  fileWriteCount: Schema.Number,
  toolCounts: Schema.Record({ key: Schema.String, value: Schema.Number }),
  queries: Schema.mutable(Schema.Array(Schema.Unknown)),
  fileActivityDetails: Schema.mutable(Schema.Array(FileOperationSchema)),
});

export type SessionSummaryRpc = Schema.Schema.Type<
  typeof SessionSummaryRpcSchema
>;

// ─── Transformation Input ───────────────────────────────────────────────────

/**
 * Combined input for transformation: DB row + aggregates.
 */
export const SessionTransformInputSchema = Schema.Struct({
  session: SessionDbRowSchema,
  aggregates: SessionAggregatesSchema,
});

export type SessionTransformInput = Schema.Schema.Type<
  typeof SessionTransformInputSchema
>;

// ─── Pure Transformation Function ───────────────────────────────────────────

/**
 * Transform session DB row + aggregates to RPC format.
 *
 * Pure function that handles all ~30 field mappings with null coalescing.
 */
export const transformSession = (
  input: SessionTransformInput
): SessionSummaryRpc => {
  const { session: s, aggregates: agg } = input;

  const totalInputTokens = s.totalInputTokens ?? 0;
  const totalOutputTokens = s.totalOutputTokens ?? 0;

  return {
    sessionId: s.sessionId,
    project: s.projectPath,
    date: toDateString(s.startTime),
    displayName: s.displayName,
    startTime: s.startTime,
    durationMs: s.durationMs ?? 0,
    totalCost: s.totalCost ?? 0,
    queryCount: s.queryCount ?? 0,
    toolUseCount: s.toolUseCount ?? 0,
    turnCount: s.turnCount ?? 0,
    isSubagent: s.isSubagent ?? false,
    harness: (s.harness ?? "claude-code") as HarnessId,
    model: agg.primaryModel,
    modelShort: modelDisplayNameWithVersion(agg.primaryModel),
    firstPrompt: s.displayName ?? "Session",
    totalTokens: totalInputTokens + totalOutputTokens,
    savedByCaching: s.savedByCaching ?? 0,
    uncachedInput: totalInputTokens,
    cacheRead: s.totalCacheRead ?? 0,
    cacheCreation: s.totalCacheWrite ?? 0,
    output: totalOutputTokens,
    compactions: s.compactions ?? 0,
    subagentCount: agg.agentCount,
    toolErrorCount: agg.errorCount,
    bashCommandCount: agg.toolCounts.Bash ?? 0,
    fileReadCount: agg.fileOperations.filter((op) => op.tool === "Read").length,
    fileEditCount: agg.fileOperations.filter((op) => op.tool === "Edit").length,
    fileWriteCount: agg.fileOperations.filter((op) => op.tool === "Write")
      .length,
    toolCounts: { ...agg.toolCounts },
    queries: [],
    fileActivityDetails: [...agg.fileOperations],
  };
};

// ─── Pipeline Service Interface ─────────────────────────────────────────────

/**
 * SessionPipeline service interface.
 */
export interface SessionPipelineMethods {
  /**
   * Transform a single session with its aggregates to RPC format.
   */
  transform: (input: SessionTransformInput) => SessionSummaryRpc;

  /**
   * Validate that a raw object matches the DB row schema.
   * Use in tests to catch schema drift.
   */
  validateDbRow: (
    raw: unknown
  ) => Effect.Effect<SessionDbRow, ParseResult.ParseError>;

  /**
   * Validate that a transformed output matches the RPC schema.
   * Use in tests for API contract verification.
   */
  validateRpcOutput: (
    raw: unknown
  ) => Effect.Effect<SessionSummaryRpc, ParseResult.ParseError>;
}

/**
 * SessionPipeline service tag.
 */
export class SessionPipeline extends Context.Tag("SessionPipeline")<
  SessionPipeline,
  SessionPipelineMethods
>() {}

/**
 * Live implementation of SessionPipeline.
 */
export const SessionPipelineLive = Layer.succeed(SessionPipeline, {
  transform: transformSession,

  validateDbRow: (raw: unknown) =>
    Schema.decodeUnknown(SessionDbRowSchema)(raw),

  validateRpcOutput: (raw: unknown) =>
    Schema.decodeUnknown(SessionSummaryRpcSchema)(raw),
});

// ─── Compatibility Layer ────────────────────────────────────────────────────

/**
 * Transform session using the old interface for backward compatibility.
 *
 * Maps the old SessionTransformInput shape to the new schema-based input.
 */
export const transformSessionCompat = (input: {
  session: SessionDbRow;
  sessionTools: Record<string, number>;
  sessionFileOps: FileOperation[];
  sessionModel: string;
  agentCount: number;
  errorCount: number;
}): SessionSummaryRpc =>
  transformSession({
    session: input.session,
    aggregates: {
      toolCounts: input.sessionTools,
      fileOperations: input.sessionFileOps,
      primaryModel: input.sessionModel,
      agentCount: input.agentCount,
      errorCount: input.errorCount,
    },
  });
