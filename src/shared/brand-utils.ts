/**
 * Utility functions for applying branded types at service boundaries.
 * These transform internal service data to branded RPC types.
 */

import type {
  AgentROI,
  AgentROIEntry,
  AgentROISummary,
  DailyStat,
  DashboardTotals,
  ModelBreakdown,
  OtelApiLatency,
  OtelCostBreakdown,
  OtelProblemPatterns,
  OtelRecentEvent,
  ProjectSummary,
  SessionSummary,
  SkillROIEntry,
  WeeklyComparison,
  WeeklyStats,
} from "./rpc-types";
import {
  CostUsd,
  FilePath,
  ProjectPath,
  SessionId,
  UnixTimestampMs,
} from "./branded";

/** Brand a raw SessionSummary with branded types */
export const brandSessionSummary = (
  raw: Omit<SessionSummary, "sessionId" | "project" | "startTime" | "totalCost" | "savedByCaching" | "fileActivityDetails"> & {
    sessionId: string;
    project: string;
    startTime: number;
    totalCost: number;
    savedByCaching: number;
    fileActivityDetails: { filePath: string; tool: string; extension: string }[];
  }
): SessionSummary => ({
  ...raw,
  sessionId: SessionId(raw.sessionId),
  project: ProjectPath(raw.project),
  startTime: UnixTimestampMs(raw.startTime),
  totalCost: CostUsd(raw.totalCost),
  savedByCaching: CostUsd(raw.savedByCaching),
  fileActivityDetails: raw.fileActivityDetails.map((f) => ({
    ...f,
    filePath: FilePath(f.filePath),
  })),
});

/** Brand a raw ProjectSummary with branded types */
export const brandProjectSummary = (
  raw: Omit<ProjectSummary, "projectPath" | "totalCost" | "lastActivity"> & {
    projectPath: string;
    totalCost: number;
    lastActivity: number;
  }
): ProjectSummary => ({
  ...raw,
  projectPath: ProjectPath(raw.projectPath),
  totalCost: CostUsd(raw.totalCost),
  lastActivity: UnixTimestampMs(raw.lastActivity),
});

/** Brand a raw DailyStat with branded types */
export const brandDailyStat = (
  raw: Omit<DailyStat, "totalCost"> & { totalCost: number }
): DailyStat => ({
  ...raw,
  totalCost: CostUsd(raw.totalCost),
});

/** Brand a raw ModelBreakdown with branded types */
export const brandModelBreakdown = (
  raw: Omit<ModelBreakdown, "totalCost"> & { totalCost: number }
): ModelBreakdown => ({
  ...raw,
  totalCost: CostUsd(raw.totalCost),
});

/** Brand a raw WeeklyStats with branded types */
export const brandWeeklyStats = (
  raw: Omit<WeeklyStats, "cost" | "costPerSession"> & {
    cost: number;
    costPerSession: number;
  }
): WeeklyStats => ({
  ...raw,
  cost: CostUsd(raw.cost),
  costPerSession: CostUsd(raw.costPerSession),
});

/** Brand a raw WeeklyComparison with branded types */
export const brandWeeklyComparison = (
  raw: Omit<WeeklyComparison, "thisWeek" | "lastWeek" | "changes"> & {
    thisWeek: Omit<WeeklyStats, "cost" | "costPerSession"> & {
      cost: number;
      costPerSession: number;
    };
    lastWeek: Omit<WeeklyStats, "cost" | "costPerSession"> & {
      cost: number;
      costPerSession: number;
    };
    changes: Omit<WeeklyStats, "cost" | "costPerSession"> & {
      cost: number;
      costPerSession: number;
    };
  }
): WeeklyComparison => ({
  ...raw,
  thisWeek: brandWeeklyStats(raw.thisWeek),
  lastWeek: brandWeeklyStats(raw.lastWeek),
  changes: brandWeeklyStats(raw.changes),
});

/** Brand a raw DashboardTotals with branded types */
export const brandDashboardTotals = (
  raw: Omit<
    DashboardTotals,
    | "totalCost"
    | "savedByCaching"
    | "cacheSavingsUsd"
    | "avgCostPerSession"
    | "avgCostPerQuery"
    | "costPerEdit"
  > & {
    totalCost: number;
    savedByCaching: number;
    cacheSavingsUsd: number;
    avgCostPerSession: number;
    avgCostPerQuery: number;
    costPerEdit: number;
  }
): DashboardTotals => ({
  ...raw,
  totalCost: CostUsd(raw.totalCost),
  savedByCaching: CostUsd(raw.savedByCaching),
  cacheSavingsUsd: CostUsd(raw.cacheSavingsUsd),
  avgCostPerSession: CostUsd(raw.avgCostPerSession),
  avgCostPerQuery: CostUsd(raw.avgCostPerQuery),
  costPerEdit: CostUsd(raw.costPerEdit),
});

/** Brand AgentROIEntry */
export const brandAgentROIEntry = (
  raw: Omit<AgentROIEntry, "totalCost" | "avgCostPerSpawn"> & {
    totalCost: number;
    avgCostPerSpawn: number;
  }
): AgentROIEntry => ({
  ...raw,
  totalCost: CostUsd(raw.totalCost),
  avgCostPerSpawn: CostUsd(raw.avgCostPerSpawn),
});

/** Brand AgentROISummary */
export const brandAgentROISummary = (
  raw: Omit<AgentROISummary, "totalAgentCost" | "avgCostPerSpawn"> & {
    totalAgentCost: number;
    avgCostPerSpawn: number;
  }
): AgentROISummary => ({
  ...raw,
  totalAgentCost: CostUsd(raw.totalAgentCost),
  avgCostPerSpawn: CostUsd(raw.avgCostPerSpawn),
});

/** Brand AgentROI */
export const brandAgentROI = (raw: {
  agents: (Omit<AgentROIEntry, "totalCost" | "avgCostPerSpawn"> & {
    totalCost: number;
    avgCostPerSpawn: number;
  })[];
  summary: Omit<AgentROISummary, "totalAgentCost" | "avgCostPerSpawn"> & {
    totalAgentCost: number;
    avgCostPerSpawn: number;
  };
}): AgentROI => ({
  agents: raw.agents.map(brandAgentROIEntry),
  summary: brandAgentROISummary(raw.summary),
});

/** Brand SkillROIEntry */
export const brandSkillROIEntry = (
  raw: Omit<SkillROIEntry, "totalCost"> & { totalCost: number }
): SkillROIEntry => ({
  ...raw,
  totalCost: CostUsd(raw.totalCost),
});

/** Brand topPrompts */
export const brandTopPrompt = (raw: {
  prompt: string;
  date: string;
  model: string;
  totalTokens: number;
  cost: number;
  sessionId: string;
  queryCount: number;
}): {
  prompt: string;
  date: string;
  model: string;
  totalTokens: number;
  cost: CostUsd;
  sessionId: SessionId;
  queryCount: number;
} => ({
  ...raw,
  cost: CostUsd(raw.cost),
  sessionId: SessionId(raw.sessionId),
});

/** Brand OtelApiLatency */
export const brandOtelApiLatency = (
  raw: Omit<OtelApiLatency, "avgCostUsd"> & { avgCostUsd: number }
): OtelApiLatency => ({
  ...raw,
  avgCostUsd: CostUsd(raw.avgCostUsd),
});

/** Brand OtelCostBreakdown */
export const brandOtelCostBreakdown = (
  raw: Omit<
    OtelCostBreakdown,
    "totalCost" | "avgCostPerSession" | "costPerLoc" | "costPerHour" | "byModel"
  > & {
    totalCost: number;
    avgCostPerSession: number;
    costPerLoc: number;
    costPerHour: number;
    byModel: { model: string; cost: number; tokens: number; requests: number }[];
  }
): OtelCostBreakdown => ({
  ...raw,
  totalCost: CostUsd(raw.totalCost),
  avgCostPerSession: CostUsd(raw.avgCostPerSession),
  costPerLoc: CostUsd(raw.costPerLoc),
  costPerHour: CostUsd(raw.costPerHour),
  byModel: raw.byModel.map((m) => ({
    ...m,
    cost: CostUsd(m.cost),
  })),
});

/** Brand OtelProblemPatterns */
export const brandOtelProblemPatterns = (
  raw: Omit<OtelProblemPatterns, "longUnproductiveSessions"> & {
    longUnproductiveSessions: {
      sessionId: string;
      durationMs: number;
      commits: number;
      cost: number;
    }[];
  }
): OtelProblemPatterns => ({
  ...raw,
  longUnproductiveSessions: raw.longUnproductiveSessions.map((s) => ({
    ...s,
    sessionId: SessionId(s.sessionId),
    cost: CostUsd(s.cost),
  })),
});

/** Brand OtelRecentEvent */
export const brandOtelRecentEvent = (
  raw: Omit<OtelRecentEvent, "timestampMs" | "costUsd"> & {
    timestampMs: number;
    costUsd: number | null;
  }
): OtelRecentEvent => ({
  ...raw,
  timestampMs: UnixTimestampMs(raw.timestampMs),
  costUsd: raw.costUsd !== null ? CostUsd(raw.costUsd) : null,
});
