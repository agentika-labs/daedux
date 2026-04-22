/**
 * Analytics Orchestration Service
 *
 * Deep module that hides 6 analytics services, 23 parallel queries,
 * and ~100 lines of transformation behind a single entry point.
 *
 * Callers get `DashboardData` without knowing about:
 * - SessionAnalyticsService, ModelAnalyticsService, ToolAnalyticsService, etc.
 * - Cross-service joins (session + tools + files per session)
 * - Field transformations and null coalescing
 */

import { Context, Effect, Layer } from "effect";

import {
  CostUsd,
  ProjectPath,
  SessionId,
  UnixTimestampMs,
} from "../../shared/branded";
import type { DashboardData, DateFilter } from "../../shared/rpc-types";
import { AgentAnalyticsService } from "../analytics/agent-analytics";
import { FileAnalyticsService } from "../analytics/file-analytics";
import { InsightsAnalyticsService } from "../analytics/insights-analytics";
import { ModelAnalyticsService } from "../analytics/model-analytics";
import { SessionAnalyticsService } from "../analytics/session-analytics";
import { ToolAnalyticsService } from "../analytics/tool-analytics";
import { DatabaseError } from "../errors";
import { transformSessionCompat } from "../schemas/session-pipeline";

/**
 * Query parameters for dashboard data.
 */
export interface DashboardQuery {
  readonly dateFilter?: DateFilter;
}

/**
 * AnalyticsOrchestrator service interface.
 */
export interface AnalyticsOrchestratorMethods {
  /**
   * Load all dashboard data for the given query parameters.
   *
   * Executes 23 analytics queries in parallel, joins cross-service data
   * (session + tools + files), and transforms to DashboardData shape.
   */
  getDashboard: (
    query?: DashboardQuery
  ) => Effect.Effect<DashboardData, DatabaseError>;
}

/**
 * AnalyticsOrchestrator service tag.
 */
export class AnalyticsOrchestrator extends Context.Tag("AnalyticsOrchestrator")<
  AnalyticsOrchestrator,
  AnalyticsOrchestratorMethods
>() {}

/**
 * Live implementation of AnalyticsOrchestrator.
 *
 * This layer requires all analytics services to be provided by the runtime.
 * Use with AppLive which already provides AllAnalyticsServicesLive.
 */
export const AnalyticsOrchestratorLive = Layer.effect(
  AnalyticsOrchestrator,
  Effect.gen(function* () {
    const sessions = yield* SessionAnalyticsService;
    const models = yield* ModelAnalyticsService;
    const tools = yield* ToolAnalyticsService;
    const files = yield* FileAnalyticsService;
    const agents = yield* AgentAnalyticsService;
    const insightsService = yield* InsightsAnalyticsService;

    return {
      getDashboard: (query: DashboardQuery = {}) =>
        Effect.gen(function* () {
          const dateFilter = query.dateFilter ?? {};

          const [
            totals,
            extendedTotals,
            dailyStats,
            sessionList,
            projects,
            modelBreakdown,
            toolUsage,
            topPrompts,
            insights,
            toolHealth,
            sessionToolCounts,
            sessionPrimaryModels,
            sessionFileOperations,
            sessionAgentCounts,
            sessionToolErrorCounts,
            efficiencyScoreBase,
            weeklyComparison,
            agentROI,
            toolHealthReportCard,
            skillROI,
            hookStats,
            skillImpact,
            outcomeMetrics,
          ] = yield* Effect.all([
            sessions.getTotals(dateFilter),
            sessions.getExtendedTotals(dateFilter),
            sessions.getDailyStats(undefined, dateFilter),
            sessions.getSessionSummaries({
              dateFilter,
              includeSubagents: false,
            }),
            sessions.getProjectSummaries(dateFilter),
            models.getModelBreakdown(dateFilter),
            tools.getToolUsage(dateFilter),
            sessions.getTopPrompts(30, dateFilter),
            insightsService.generateInsights(dateFilter),
            tools.getToolHealth(dateFilter),
            tools.getSessionToolCounts(dateFilter),
            sessions.getSessionPrimaryModels(dateFilter),
            files.getSessionFileOperations(dateFilter),
            sessions.getSessionAgentCounts(dateFilter),
            tools.getSessionToolErrorCounts(dateFilter),
            insightsService.getEfficiencyScore(dateFilter),
            insightsService.getWeeklyComparison(dateFilter),
            agents.getAgentROI(dateFilter),
            tools.getToolHealthReportCard(dateFilter),
            agents.getSkillROI(dateFilter),
            agents.getHookStats(dateFilter),
            agents.getSkillImpactComparison(dateFilter),
            insightsService.getOutcomeMetrics(dateFilter),
          ]);

          // Merge outcome metrics into efficiency score
          const efficiencyScore = {
            ...efficiencyScoreBase,
            ...outcomeMetrics,
          };

          // Transform data for dashboard
          const totalTokens =
            totals.totalInputTokens + totals.totalOutputTokens;

          const dashboardTotals = {
            ...totals,
            agentLeverageRatio: extendedTotals.agentLeverageRatio,
            avgContextUtilization: extendedTotals.cacheEfficiencyRatio,
            avgCostPerQuery: CostUsd(extendedTotals.avgCostPerQuery),
            avgCostPerSession: CostUsd(extendedTotals.avgCostPerSession),
            avgSessionDurationMs: extendedTotals.avgSessionDurationMs,
            avgTurnsPerSession:
              sessionList.length > 0
                ? sessionList.reduce((sum, s) => sum + (s.turnCount ?? 0), 0) /
                  sessionList.length
                : 0,
            cacheCreation: totals.totalCacheWrite,
            cacheEfficiencyRatio: extendedTotals.cacheEfficiencyRatio,
            cacheRead: totals.totalCacheRead,
            cacheSavingsUsd: CostUsd(extendedTotals.savedByCaching),
            contextEfficiencyScore: extendedTotals.cacheEfficiencyRatio * 100,
            costPerEdit: CostUsd(
              extendedTotals.totalFileOperations > 0
                ? totals.totalCost / extendedTotals.totalFileOperations
                : 0
            ),
            dateRange: extendedTotals.dateRange,
            output: totals.totalOutputTokens,
            promptEfficiencyRatio: (() => {
              const newTokensSent =
                totals.totalInputTokens + totals.totalCacheWrite;
              return newTokensSent > 0
                ? totals.totalOutputTokens / newTokensSent
                : 0;
            })(),
            savedByCaching: CostUsd(extendedTotals.savedByCaching),
            totalAgentSpawns: extendedTotals.totalAgentSpawns,
            totalCost: CostUsd(totals.totalCost),
            totalFileOperations: extendedTotals.totalFileOperations,
            totalSkillInvocations: extendedTotals.totalSkillInvocations,
            totalTokens,
            totalTurns: sessionList.reduce(
              (sum, s) => sum + (s.turnCount ?? 0),
              0
            ),
            uncachedInput: totals.totalInputTokens,
          };

          // Transform sessions using schema-based pipeline
          const dashboardSessions = sessionList.map((s) => {
            const rpc = transformSessionCompat({
              session: s,
              sessionTools: sessionToolCounts.get(s.sessionId) ?? {},
              sessionFileOps: sessionFileOperations.get(s.sessionId) ?? [],
              sessionModel:
                sessionPrimaryModels.get(s.sessionId) ??
                "claude-sonnet-4-5-20251022",
              agentCount: sessionAgentCounts.get(s.sessionId) ?? 0,
              errorCount: sessionToolErrorCounts.get(s.sessionId) ?? 0,
            });
            return {
              ...rpc,
              sessionId: SessionId(rpc.sessionId),
              project: ProjectPath(rpc.project),
              startTime: UnixTimestampMs(rpc.startTime),
              totalCost: CostUsd(rpc.totalCost),
              savedByCaching: CostUsd(rpc.savedByCaching),
            };
          });

          // Transform insights with branded dollarImpact
          const transformedInsights = insights.map((i) => ({
            action: i.action ?? "",
            actionLabel: i.actionLabel,
            actionTarget: i.actionTarget,
            comparison: i.comparison,
            description: i.message,
            dollarImpact:
              i.dollarImpact != null ? CostUsd(i.dollarImpact) : undefined,
            priority: i.priority,
            title: i.title,
            type: i.type === "tip" ? "info" : i.type,
          }));

          // Transform topPrompts with branded fields
          const transformedTopPrompts = topPrompts.map((p) => ({
            ...p,
            cost: CostUsd(p.cost),
            sessionId: SessionId(p.sessionId),
            queryCount: 1,
          }));

          // Brand agent ROI entries
          const brandedAgentROI = {
            agents: agentROI.agents.map((e) => ({
              ...e,
              totalCost: CostUsd(e.totalCost),
              avgCostPerSpawn: CostUsd(e.avgCostPerSpawn),
            })),
            summary: {
              ...agentROI.summary,
              avgCostPerSpawn: CostUsd(agentROI.summary.avgCostPerSpawn),
              totalAgentCost: CostUsd(agentROI.summary.totalAgentCost),
            },
          };

          // Brand weekly comparison
          const brandWeekly = (s: typeof weeklyComparison.thisWeek) => ({
            ...s,
            cost: CostUsd(s.cost),
            costPerSession: CostUsd(s.costPerSession),
          });
          const brandedWeeklyComparison = {
            ...weeklyComparison,
            changes: brandWeekly(weeklyComparison.changes),
            lastWeek: brandWeekly(weeklyComparison.lastWeek),
            thisWeek: brandWeekly(weeklyComparison.thisWeek),
          };

          // Brand skill ROI
          const brandedSkillROI = skillROI.map((s) => ({
            ...s,
            totalCost: CostUsd(s.totalCost),
          }));

          return {
            agentROI: brandedAgentROI,
            dailyUsage: dailyStats.map((s) => ({
              ...s,
              totalCost: CostUsd(s.totalCost),
            })),
            efficiencyScore,
            hookStats,
            insights: transformedInsights,
            modelBreakdown: modelBreakdown.map((m) => ({
              ...m,
              totalCost: CostUsd(m.totalCost),
            })),
            projects: projects.map((p) => ({
              ...p,
              projectPath: ProjectPath(p.projectPath),
              totalCost: CostUsd(p.totalCost),
              lastActivity: UnixTimestampMs(p.lastActivity),
            })),
            sessions: dashboardSessions,
            skillImpact,
            skillROI: brandedSkillROI,
            toolHealth,
            toolHealthReportCard,
            toolUsage,
            topPrompts: transformedTopPrompts,
            totals: dashboardTotals,
            weeklyComparison: brandedWeeklyComparison,
          } satisfies DashboardData;
        }).pipe(Effect.withSpan("AnalyticsOrchestrator.getDashboard")),
    } satisfies AnalyticsOrchestratorMethods;
  })
);
