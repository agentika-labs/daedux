/**
 * Analytics Services Index
 *
 * Re-exports all domain-specific analytics services and their types.
 * Consumers import directly from this module and use domain services explicitly.
 */

import { Layer } from "effect";

// ─── Domain Service Imports ──────────────────────────────────────────────────

import {
  SessionAnalyticsService,
  SessionAnalyticsServiceLive,
  type Totals,
  type ExtendedTotals,
  type DailyStat,
  type SessionSummary,
  type ProjectSummary,
  type TopPrompt,
  type DashboardStats,
} from "./session-analytics";

import {
  ModelAnalyticsService,
  ModelAnalyticsServiceLive,
  type ModelBreakdown,
  type ModelUsage,
} from "./model-analytics";

import {
  ToolAnalyticsService,
  ToolAnalyticsServiceLive,
  type ToolUsageStat,
  type ToolHealthStat,
  type BashCommandStat,
  type BashCategoryHealth,
  type ToolHealthReportCard,
  type ApiErrorStat,
} from "./tool-analytics";

import {
  FileAnalyticsService,
  FileAnalyticsServiceLive,
  type FileActivityStat,
  type FileExtensionStat,
  type SessionFileOperation,
} from "./file-analytics";

import {
  AgentAnalyticsService,
  AgentAnalyticsServiceLive,
  type SkillROI,
  type AgentStat,
  type AgentROI,
  type AgentUsageSummary,
  type HookStat,
  type CommandStat,
} from "./agent-analytics";

import {
  ContextAnalyticsService,
  ContextAnalyticsServiceLive,
  type ContextHeatmapPoint,
  type CacheEfficiencyPoint,
  type CompactionAnalysis,
  type ContextWindowFillPoint,
  type PeakContextData,
} from "./context-analytics";

import {
  InsightsAnalyticsService,
  InsightsAnalyticsServiceLive,
  type Insight,
  type EfficiencyScore,
  type WeeklyComparison,
  FIX_SUGGESTIONS,
} from "./insights-analytics";

// ─── Re-export Types ─────────────────────────────────────────────────────────

export type {
  // Session analytics
  Totals,
  ExtendedTotals,
  DailyStat,
  SessionSummary,
  ProjectSummary,
  TopPrompt,
  DashboardStats,
  // Model analytics
  ModelBreakdown,
  ModelUsage,
  // Tool analytics
  ToolUsageStat,
  ToolHealthStat,
  BashCommandStat,
  BashCategoryHealth,
  ToolHealthReportCard,
  ApiErrorStat,
  // File analytics
  FileActivityStat,
  FileExtensionStat,
  SessionFileOperation,
  // Agent analytics
  SkillROI,
  AgentStat,
  AgentROI,
  AgentUsageSummary,
  HookStat,
  CommandStat,
  // Context analytics
  ContextHeatmapPoint,
  CacheEfficiencyPoint,
  CompactionAnalysis,
  ContextWindowFillPoint,
  PeakContextData,
  // Insights analytics
  Insight,
  EfficiencyScore,
  WeeklyComparison,
};

// Re-export shared utilities
export { buildDateConditions, buildComparisonWindows, DAY_MS, WEEK_MS } from "./shared";
export type { DateFilter, ComparisonWindows } from "./shared";

// Re-export FIX_SUGGESTIONS for backward compatibility
export { FIX_SUGGESTIONS };

// Re-export domain services for direct access
export {
  SessionAnalyticsService,
  SessionAnalyticsServiceLive,
  ModelAnalyticsService,
  ModelAnalyticsServiceLive,
  ToolAnalyticsService,
  ToolAnalyticsServiceLive,
  FileAnalyticsService,
  FileAnalyticsServiceLive,
  AgentAnalyticsService,
  AgentAnalyticsServiceLive,
  ContextAnalyticsService,
  ContextAnalyticsServiceLive,
  InsightsAnalyticsService,
  InsightsAnalyticsServiceLive,
};

// ─── Composed Layer for Direct Domain Service Access ─────────────────────────

/**
 * Layer that provides all domain analytics services directly.
 * Use this when you want to access domain services individually rather than
 * through the facade.
 */
export const AllAnalyticsServicesLive = Layer.mergeAll(
  SessionAnalyticsServiceLive,
  ModelAnalyticsServiceLive,
  ToolAnalyticsServiceLive,
  FileAnalyticsServiceLive,
  AgentAnalyticsServiceLive,
  ContextAnalyticsServiceLive,
  InsightsAnalyticsServiceLive
);
