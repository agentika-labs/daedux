/**
 * Analytics Services Index
 *
 * Re-exports all domain-specific analytics services and their types.
 * Consumers import directly from this module and use domain services explicitly.
 */

import { Layer } from "effect";
// ─── Domain Service Imports ──────────────────────────────────────────────────

import {
  AgentAnalyticsService,
  AgentAnalyticsServiceLive,
} from "./agent-analytics";
import type {
  SkillROI,
  AgentStat,
  AgentROI,
  AgentUsageSummary,
  HookStat,
  CommandStat,
} from "./agent-analytics";
import {
  ContextAnalyticsService,
  ContextAnalyticsServiceLive,
} from "./context-analytics";
import type {
  ContextHeatmapPoint,
  CacheEfficiencyPoint,
  CompactionAnalysis,
  ContextWindowFillPoint,
  PeakContextData,
} from "./context-analytics";
import {
  FileAnalyticsService,
  FileAnalyticsServiceLive,
} from "./file-analytics";
import type {
  FileActivityStat,
  FileExtensionStat,
  SessionFileOperation,
} from "./file-analytics";
import {
  InsightsAnalyticsService,
  InsightsAnalyticsServiceLive,
  FIX_SUGGESTIONS,
} from "./insights-analytics";
import type {
  Insight,
  EfficiencyScore,
  WeeklyComparison,
} from "./insights-analytics";
import {
  ModelAnalyticsService,
  ModelAnalyticsServiceLive,
} from "./model-analytics";
import type { ModelBreakdown, ModelUsage } from "./model-analytics";
import {
  SessionAnalyticsService,
  SessionAnalyticsServiceLive,
} from "./session-analytics";
import type {
  Totals,
  ExtendedTotals,
  DailyStat,
  SessionSummary,
  ProjectSummary,
  TopPrompt,
  DashboardStats,
} from "./session-analytics";
import {
  ToolAnalyticsService,
  ToolAnalyticsServiceLive,
} from "./tool-analytics";
import type {
  ToolUsageStat,
  ToolHealthStat,
  BashCommandStat,
  BashCategoryHealth,
  ToolHealthReportCard,
  ApiErrorStat,
} from "./tool-analytics";

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
export {
  buildDateConditions,
  buildComparisonWindows,
  DAY_MS,
  WEEK_MS,
} from "./shared";
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
