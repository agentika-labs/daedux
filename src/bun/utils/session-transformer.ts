/**
 * Shared session transformation logic for RPC responses.
 * Used by both desktop (Electrobun) and CLI (HTTP) modes.
 */

import { modelDisplayNameWithVersion } from "../../shared/model-utils";
import type { SessionSummary } from "../../shared/rpc-types";
import { toDateString } from "./formatting";

/**
 * File operation details for session file activity.
 */
export interface FileOperation {
  filePath: string;
  tool: string;
  extension: string;
}

/**
 * Minimal session fields required for transformation.
 * This is a subset of the full Session schema that matches
 * what getSessionSummaries() returns.
 */
export interface SessionData {
  sessionId: string;
  projectPath: string;
  displayName: string | null;
  startTime: number;
  durationMs: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCacheRead: number | null;
  totalCacheWrite: number | null;
  totalCost: number | null;
  queryCount: number | null;
  toolUseCount: number | null;
  isSubagent: boolean | null;
  compactions: number | null;
  savedByCaching: number | null;
  turnCount: number | null;
}

/**
 * Input parameters for session transformation.
 */
export interface SessionTransformInput {
  session: SessionData;
  sessionTools: Record<string, number>;
  sessionFileOps: FileOperation[];
  sessionModel: string;
  agentCount: number;
  errorCount: number;
}

/**
 * Transform an internal session record to the RPC SessionSummary format.
 *
 * This function handles all ~30 field mappings needed to convert database
 * session records into the frontend-ready SessionSummary type.
 */
export function transformSessionToRPC({
  session: s,
  sessionTools,
  sessionFileOps,
  sessionModel,
  agentCount,
  errorCount,
}: SessionTransformInput): SessionSummary {
  return {
    bashCommandCount: sessionTools.Bash ?? 0,
    cacheCreation: s.totalCacheWrite ?? 0,
    cacheRead: s.totalCacheRead ?? 0,
    compactions: s.compactions ?? 0,
    date: toDateString(s.startTime),
    displayName: s.displayName,
    durationMs: s.durationMs ?? 0,
    fileActivityDetails: sessionFileOps,
    fileEditCount: sessionFileOps.filter((op) => op.tool === "Edit").length,
    fileReadCount: sessionFileOps.filter((op) => op.tool === "Read").length,
    fileWriteCount: sessionFileOps.filter((op) => op.tool === "Write").length,
    firstPrompt: s.displayName ?? "Session",
    isSubagent: s.isSubagent ?? false,
    model: sessionModel,
    modelShort: modelDisplayNameWithVersion(sessionModel),
    output: s.totalOutputTokens ?? 0,
    project: s.projectPath,
    queries: [],
    queryCount: s.queryCount ?? 0,
    savedByCaching: s.savedByCaching ?? 0,
    sessionId: s.sessionId,
    startTime: s.startTime,
    subagentCount: agentCount,
    toolCounts: sessionTools,
    toolErrorCount: errorCount,
    toolUseCount: s.toolUseCount ?? 0,
    totalCost: s.totalCost ?? 0,
    totalTokens: (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0),
    turnCount: s.turnCount ?? 0,
    uncachedInput: s.totalInputTokens ?? 0,
  };
}
