/**
 * Effect branded types for function parameters.
 * Use these to prevent mixing structurally identical but semantically different values.
 *
 * Example:
 *   const getSession = (id: SessionId) => ...
 *   getSession(projectPath)  // ❌ Type error
 *   getSession(sessionId)    // ✅ Works
 */

import { Brand } from "effect";

// ─── Identity Types ─────────────────────────────────────────────────────────

export type SessionId = string & Brand.Brand<"SessionId">;
export const SessionId = Brand.nominal<SessionId>();

export type QueryId = string & Brand.Brand<"QueryId">;
export const QueryId = Brand.nominal<QueryId>();

export type ProjectPath = string & Brand.Brand<"ProjectPath">;
export const ProjectPath = Brand.nominal<ProjectPath>();

export type FilePath = string & Brand.Brand<"FilePath">;
export const FilePath = Brand.nominal<FilePath>();

// ─── Numeric Types ──────────────────────────────────────────────────────────

export type UnixTimestampMs = number & Brand.Brand<"UnixTimestampMs">;
export const UnixTimestampMs = Brand.nominal<UnixTimestampMs>();

export type CostUsd = number & Brand.Brand<"CostUsd">;
export const CostUsd = Brand.nominal<CostUsd>();

// ─── Helper Functions ───────────────────────────────────────────────────────

export const nowMs = (): UnixTimestampMs => UnixTimestampMs(Date.now());

export const addMs = (ts: UnixTimestampMs, ms: number): UnixTimestampMs =>
  UnixTimestampMs(ts + ms);

export const zeroCost = (): CostUsd => CostUsd(0);

// ─── Batch Branding Helpers ─────────────────────────────────────────────────

/** Brand a DailyStat-like object's cost fields */
export const brandDailyStat = <T extends { totalCost: number }>(
  stat: T
): T & { totalCost: CostUsd } => ({
  ...stat,
  totalCost: CostUsd(stat.totalCost),
});

/** Brand a ProjectSummary-like object */
export const brandProjectSummary = <
  T extends { projectPath: string; totalCost: number; lastActivity: number },
>(
  p: T
): T & {
  projectPath: ProjectPath;
  totalCost: CostUsd;
  lastActivity: UnixTimestampMs;
} => ({
  ...p,
  lastActivity: UnixTimestampMs(p.lastActivity),
  projectPath: ProjectPath(p.projectPath),
  totalCost: CostUsd(p.totalCost),
});

/** Brand a cost field */
export const brandCost = <T extends { totalCost: number }>(
  obj: T
): T & { totalCost: CostUsd } => ({
  ...obj,
  totalCost: CostUsd(obj.totalCost),
});

/** Brand cost fields in ROI entries */
export const brandAgentROIEntry = <
  T extends { totalCost: number; avgCostPerSpawn: number },
>(
  entry: T
): T & { totalCost: CostUsd; avgCostPerSpawn: CostUsd } => ({
  ...entry,
  avgCostPerSpawn: CostUsd(entry.avgCostPerSpawn),
  totalCost: CostUsd(entry.totalCost),
});

/** Brand WeeklyStats cost fields */
export const brandWeeklyStats = <
  T extends { cost: number; costPerSession: number },
>(
  stats: T
): T & { cost: CostUsd; costPerSession: CostUsd } => ({
  ...stats,
  cost: CostUsd(stats.cost),
  costPerSession: CostUsd(stats.costPerSession),
});

/** Brand ModelBreakdown totalCost */
export const brandModelBreakdown = <T extends { totalCost: number }>(
  m: T
): T & { totalCost: CostUsd } => ({
  ...m,
  totalCost: CostUsd(m.totalCost),
});

/** Brand TopPrompt fields */
export const brandTopPrompt = <T extends { cost: number; sessionId: string }>(
  p: T
): T & { cost: CostUsd; sessionId: SessionId } => ({
  ...p,
  cost: CostUsd(p.cost),
  sessionId: SessionId(p.sessionId),
});

/** Brand SessionSummary fields */
export const brandSessionSummary = <
  T extends {
    sessionId: string;
    project: string;
    startTime: number;
    totalCost: number;
    savedByCaching: number;
  },
>(
  s: T
): T & {
  sessionId: SessionId;
  project: ProjectPath;
  startTime: UnixTimestampMs;
  totalCost: CostUsd;
  savedByCaching: CostUsd;
} => ({
  ...s,
  project: ProjectPath(s.project),
  savedByCaching: CostUsd(s.savedByCaching),
  sessionId: SessionId(s.sessionId),
  startTime: UnixTimestampMs(s.startTime),
  totalCost: CostUsd(s.totalCost),
});
