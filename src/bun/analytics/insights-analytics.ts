import { sql, eq, and, count, desc, gte, lte } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import type { DateFilter } from "./shared";
import { buildComparisonWindows, cacheHitRatio } from "./shared";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Target section for insight action navigation */
export type InsightActionTarget =
  | "overview"
  | "cost"
  | "efficiency"
  | "tools"
  | "sessions"
  | "projects";

export interface Insight {
  readonly id: string;
  readonly type: "success" | "warning" | "info" | "tip";
  readonly title: string;
  readonly message: string;
  readonly metric?: number;
  readonly action?: string; // Actionable recommendation
  readonly actionLabel?: string; // Short button label (e.g., "View Details")
  readonly actionTarget?: InsightActionTarget; // Navigation target section
  readonly dollarImpact?: number; // Estimated dollar impact for quantified insights
  readonly priority?: number; // 1-10 for sorting (higher = more important)
  readonly comparison?: {
    // Week-over-week comparison
    readonly thisWeek: number;
    readonly lastWeek: number;
    readonly changePercent: number;
    readonly direction: "up" | "down" | "flat";
  };
}

/** Workflow efficiency score with component breakdown */
export interface EfficiencyScore {
  readonly overall: number; // 0-100 composite score
  readonly cacheEfficiency: number; // 0-100 based on cache hit rate
  readonly toolSuccess: number; // 0-100 based on tool success rate
  readonly sessionEfficiency: number; // 0-100 based on queries per session
  readonly trend: "improving" | "declining" | "stable";
  readonly topOpportunity: string; // Most impactful improvement suggestion
}

/** Weekly comparison metrics for trend analysis */
export interface WeeklyComparison {
  readonly thisWeek: {
    readonly sessions: number;
    readonly cost: number;
    readonly costPerSession: number;
    readonly cacheHitRate: number;
    readonly toolErrorRate: number;
    readonly avgQueriesPerSession: number;
  };
  readonly lastWeek: {
    readonly sessions: number;
    readonly cost: number;
    readonly costPerSession: number;
    readonly cacheHitRate: number;
    readonly toolErrorRate: number;
    readonly avgQueriesPerSession: number;
  };
  readonly changes: {
    readonly sessions: number; // Percent change
    readonly cost: number;
    readonly costPerSession: number;
    readonly cacheHitRate: number;
    readonly toolErrorRate: number;
    readonly avgQueriesPerSession: number;
  };
  readonly improvements: string[]; // What improved
  readonly concerns: string[]; // What needs attention
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Benchmark thresholds for comparing user metrics to industry standards */
export const BENCHMARKS = {
  cacheRateExcellent: 0.35,
  cacheRateGood: 0.25,
  queriesPerSessionGood: 8,
  toolErrorRateBad: 0.1,
  toolErrorRateGood: 0.03,
} as const;

/**
 * Pattern-based fix suggestions for common bash errors by category.
 */
export const FIX_SUGGESTIONS: Record<
  string,
  { pattern: RegExp; suggestion: string }[]
> = {
  build_test: [
    {
      pattern: /command not found/i,
      suggestion: "Install missing dependencies with `bun add -D <package>`",
    },
    {
      pattern: /ENOENT.*package\.json/i,
      suggestion: "Run from project root or initialize with `bun init`",
    },
    {
      pattern: /test.*failed|failing|failure/i,
      suggestion: "Check test output for specific assertion failures",
    },
    {
      pattern: /typescript|tsc|type.*error/i,
      suggestion: "Run `bun run typecheck` to see all type errors",
    },
    {
      pattern: /Cannot find module/i,
      suggestion: "Verify import paths and run `bun install`",
    },
    {
      pattern: /EPERM|permission denied/i,
      suggestion: "Check file permissions or avoid writing to protected paths",
    },
  ],
  file_ops: [
    {
      pattern: /ENOENT|no such file/i,
      suggestion: "Verify file path exists before operation",
    },
    {
      pattern: /EACCES|permission denied/i,
      suggestion: "Check file/directory permissions",
    },
    {
      pattern: /EEXIST|already exists/i,
      suggestion:
        "File already exists; use overwrite flag or choose different name",
    },
    {
      pattern: /EISDIR|is a directory/i,
      suggestion: "Use recursive flag for directory operations",
    },
  ],
  git: [
    {
      pattern: /not a git repository/i,
      suggestion: "Initialize with `git init` or navigate to repo root",
    },
    {
      pattern: /merge conflict/i,
      suggestion:
        "Resolve conflicts in marked files, then `git add` and commit",
    },
    {
      pattern: /nothing to commit/i,
      suggestion: "Stage changes with `git add` before committing",
    },
    {
      pattern: /already exists/i,
      suggestion: "Delete or rename existing branch before creating new one",
    },
    {
      pattern: /rejected.*non-fast-forward/i,
      suggestion: "Pull latest changes first: `git pull --rebase`",
    },
    {
      pattern: /failed to push/i,
      suggestion: "Check remote permissions and branch protection rules",
    },
  ],
  other: [
    {
      pattern: /command not found/i,
      suggestion: "Install missing command or check PATH",
    },
    {
      pattern: /timeout|timed out/i,
      suggestion: "Increase timeout or check for deadlocks",
    },
    {
      pattern: /memory|heap|out of memory/i,
      suggestion: "Increase Node memory with `--max-old-space-size`",
    },
  ],
  package_manager: [
    {
      pattern: /EACCES|permission denied/i,
      suggestion: "Avoid sudo; use a node version manager (fnm, nvm)",
    },
    {
      pattern: /ERESOLVE|peer dep/i,
      suggestion: "Try `--legacy-peer-deps` or update conflicting packages",
    },
    {
      pattern: /ENOENT.*package\.json/i,
      suggestion:
        "Initialize project with `bun init` or navigate to project root",
    },
    {
      pattern: /network|ETIMEDOUT|ENOTFOUND/i,
      suggestion:
        "Check network connection; try `--offline` if packages are cached",
    },
    {
      pattern: /integrity|checksum/i,
      suggestion: "Clear cache with `bun pm cache rm` and reinstall",
    },
  ],
};

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Categorize errors by bash command category based on error message patterns.
 */
export function categorizeErrorsByPattern(
  errors: { errorMessage: string | null; count: number }[]
): Record<string, { message: string; count: number }[]> {
  const result: Record<string, { message: string; count: number }[]> = {
    build_test: [],
    file_ops: [],
    git: [],
    other: [],
    package_manager: [],
  };

  for (const err of errors) {
    const msg = err.errorMessage ?? "Unknown error";
    let categorized = false;

    // Try to categorize based on patterns
    if (/npm|yarn|bun|pnpm|package|install|add|remove/i.test(msg)) {
      result.package_manager!.push({ count: err.count, message: msg });
      categorized = true;
    } else if (/git|commit|push|pull|merge|branch|checkout/i.test(msg)) {
      result.git!.push({ count: err.count, message: msg });
      categorized = true;
    } else if (
      /test|jest|vitest|mocha|build|compile|tsc|typescript/i.test(msg)
    ) {
      result.build_test!.push({ count: err.count, message: msg });
      categorized = true;
    } else if (/ENOENT|EACCES|EEXIST|file|directory|path/i.test(msg)) {
      result.file_ops!.push({ count: err.count, message: msg });
      categorized = true;
    }

    if (!categorized) {
      result.other!.push({ count: err.count, message: msg });
    }
  }

  return result;
}

/**
 * Get fix suggestions for a category based on its top errors.
 */
export function getFixSuggestions(
  category: string,
  errors: { message: string; count: number }[]
): string[] {
  const patterns = FIX_SUGGESTIONS[category] ?? FIX_SUGGESTIONS.other ?? [];
  const suggestions: string[] = [];

  for (const err of errors.slice(0, 5)) {
    for (const { pattern, suggestion } of patterns) {
      if (pattern.test(err.message) && !suggestions.includes(suggestion)) {
        suggestions.push(suggestion);
        break;
      }
    }
  }

  return suggestions.slice(0, 3);
}

// ─── Service Interface ───────────────────────────────────────────────────────

export class InsightsAnalyticsService extends Context.Tag(
  "InsightsAnalyticsService"
)<
  InsightsAnalyticsService,
  {
    readonly generateInsights: (
      dateFilter?: DateFilter
    ) => Effect.Effect<Insight[], DatabaseError>;
    readonly getEfficiencyScore: (
      dateFilter?: DateFilter
    ) => Effect.Effect<EfficiencyScore, DatabaseError>;
    readonly getWeeklyComparison: (
      dateFilter?: DateFilter
    ) => Effect.Effect<WeeklyComparison, DatabaseError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const InsightsAnalyticsServiceLive = Layer.effect(
  InsightsAnalyticsService,
  Effect.gen(function* InsightsAnalyticsServiceLive() {
    const { db } = yield* DatabaseService;

    return {
      generateInsights: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({ cause: error, operation: "generateInsights" }),
          try: async () => {
            const insights: Insight[] = [];
            const { currentStart, currentEnd, previousStart, previousEnd } =
              buildComparisonWindows(dateFilter);

            // Get this week's metrics
            const thisWeekResult = await db
              .select({
                totalCacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "cache_read"
                  ),
                totalCacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "cache_write"
                  ),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost"
                ),
                totalInputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "input"
                  ),
                totalQueries:
                  sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total_queries"
                  ),
                totalSavedByCaching:
                  sql<number>`SUM(COALESCE(${schema.sessions.savedByCaching}, 0))`.as(
                    "saved"
                  ),
                totalSessions: count(),
                totalSubagents:
                  sql<number>`SUM(CASE WHEN ${schema.sessions.isSubagent} = 1 THEN 1 ELSE 0 END)`.as(
                    "subagents"
                  ),
              })
              .from(schema.sessions)
              .where(
                and(
                  gte(schema.sessions.startTime, currentStart),
                  lte(schema.sessions.startTime, currentEnd)
                )
              );

            // Get last week's metrics for comparison
            const lastWeekResult = await db
              .select({
                totalCacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "cache_read"
                  ),
                totalCacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "cache_write"
                  ),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost"
                ),
                totalInputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "input"
                  ),
                totalQueries:
                  sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total_queries"
                  ),
                totalSessions: count(),
              })
              .from(schema.sessions)
              .where(
                and(
                  gte(schema.sessions.startTime, previousStart),
                  lte(schema.sessions.startTime, previousEnd)
                )
              );

            const thisWeek = thisWeekResult[0]!;
            const lastWeek = lastWeekResult[0]!;

            // Tool error stats for this week
            const toolErrorResult = await db
              .select({
                errors:
                  sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "errors"
                  ),
                total: count(),
              })
              .from(schema.toolUses)
              .innerJoin(
                schema.sessions,
                eq(schema.toolUses.sessionId, schema.sessions.sessionId)
              )
              .where(
                and(
                  gte(schema.sessions.startTime, currentStart),
                  lte(schema.sessions.startTime, currentEnd)
                )
              );

            const toolStats = toolErrorResult[0]!;
            const errorRate =
              toolStats.total > 0
                ? (toolStats.errors ?? 0) / toolStats.total
                : 0;
            const toolSuccessRate = 1 - errorRate;

            // Calculate cache efficiency
            const cacheRatio = cacheHitRatio({
              cacheRead: thisWeek.totalCacheRead ?? 0,
              cacheWrite: thisWeek.totalCacheWrite ?? 0,
              uncachedInput: thisWeek.totalInputTokens ?? 0,
            });

            const lastWeekCacheRatio = cacheHitRatio({
              cacheRead: lastWeek.totalCacheRead ?? 0,
              cacheWrite: lastWeek.totalCacheWrite ?? 0,
              uncachedInput: lastWeek.totalInputTokens ?? 0,
            });

            // Calculate cost per session
            const costPerSession =
              thisWeek.totalSessions > 0
                ? (thisWeek.totalCost ?? 0) / thisWeek.totalSessions
                : 0;
            const lastWeekCostPerSession =
              lastWeek.totalSessions > 0
                ? (lastWeek.totalCost ?? 0) / lastWeek.totalSessions
                : 0;

            // Calculate queries per session (session efficiency)
            const queriesPerSession =
              thisWeek.totalSessions > 0
                ? (thisWeek.totalQueries ?? 0) / thisWeek.totalSessions
                : 0;

            // Helper for percent change
            const pctChange = (curr: number, prev: number): number => {
              if (prev === 0) {
                return curr > 0 ? 100 : 0;
              }
              return ((curr - prev) / prev) * 100;
            };

            // ─── HEADLINE INSIGHT: Workflow Efficiency Score ────────────────────
            const cacheScore = Math.min(100, cacheRatio * 200); // 50% cache = 100 score
            const toolScore = toolSuccessRate * 100;
            const sessionScore = Math.min(100, queriesPerSession * 10); // 10 queries = 100 score
            const efficiencyScore = Math.round(
              cacheScore * 0.4 + toolScore * 0.35 + sessionScore * 0.25
            );

            // Determine trend based on cost efficiency improvement
            const costImproved = costPerSession < lastWeekCostPerSession;
            const cacheImproved = cacheRatio > lastWeekCacheRatio;
            const trend =
              costImproved && cacheImproved
                ? "improving"
                : !costImproved && !cacheImproved
                  ? "declining"
                  : "stable";

            insights.push({
              action:
                efficiencyScore < 50
                  ? "Focus on longer sessions to improve cache hit rates."
                  : efficiencyScore < 70
                    ? "Good progress! Try batching related tasks to boost efficiency."
                    : "Excellent! Keep maintaining these patterns.",
              actionLabel: "View Details",
              actionTarget: "efficiency",
              id: "efficiency-score",
              message:
                trend === "improving"
                  ? "Your workflow is becoming more efficient over time."
                  : trend === "declining"
                    ? "Your efficiency metrics are trending down this week."
                    : "Your workflow efficiency is holding steady.",
              metric: efficiencyScore,
              priority: 10,
              title: `Workflow Efficiency: ${efficiencyScore}/100`,
              type:
                efficiencyScore >= 70
                  ? "success"
                  : efficiencyScore >= 50
                    ? "info"
                    : "warning",
            });

            // ─── WEEK-OVER-WEEK COMPARISON ──────────────────────────────────────
            if (lastWeek.totalSessions > 0) {
              const costPerSessionChange = pctChange(
                costPerSession,
                lastWeekCostPerSession
              );

              if (costPerSessionChange < -10) {
                // Calculate dollar savings
                const dollarSavings =
                  (lastWeekCostPerSession - costPerSession) *
                  thisWeek.totalSessions;

                insights.push({
                  action:
                    "Great work! You're getting more value from each session.",
                  actionLabel: "View Cost Breakdown",
                  actionTarget: "cost",
                  comparison: {
                    changePercent: costPerSessionChange,
                    direction: "down",
                    lastWeek: lastWeekCostPerSession,
                    thisWeek: costPerSession,
                  },
                  dollarImpact: dollarSavings,
                  id: "wow-cost-improved",
                  message: `Your cost per session dropped ${Math.abs(costPerSessionChange).toFixed(0)}% vs last week${dollarSavings > 0.5 ? `, saving ~$${dollarSavings.toFixed(2)}` : ""}.`,
                  metric: costPerSession,
                  priority: 8,
                  title: "Cost Efficiency Improved",
                  type: "success",
                });
              } else if (costPerSessionChange > 20) {
                // Calculate dollar increase
                const dollarIncrease =
                  (costPerSession - lastWeekCostPerSession) *
                  thisWeek.totalSessions;

                insights.push({
                  action:
                    "Consider using lighter models for simple tasks or improving cache utilization.",
                  actionLabel: "View Cost Breakdown",
                  actionTarget: "cost",
                  comparison: {
                    changePercent: costPerSessionChange,
                    direction: "up",
                    lastWeek: lastWeekCostPerSession,
                    thisWeek: costPerSession,
                  },
                  dollarImpact: dollarIncrease,
                  id: "wow-cost-increased",
                  message: `Sessions are costing ${costPerSessionChange.toFixed(0)}% more than last week${dollarIncrease > 0.5 ? ` (~$${dollarIncrease.toFixed(2)} extra)` : ""}.`,
                  metric: costPerSession,
                  priority: 7,
                  title: "Cost Per Session Increased",
                  type: "warning",
                });
              }
            }

            // ─── TOP OPPORTUNITY ────────────────────────────────────────────────
            // Identify the biggest single improvement opportunity
            if (cacheRatio < 0.2 && thisWeek.totalSessions >= 3) {
              // Estimate potential savings if cache rate improved to benchmark
              const potentialSavings =
                (thisWeek.totalCost ?? 0) *
                0.25 *
                (BENCHMARKS.cacheRateGood - cacheRatio);

              insights.push({
                action:
                  "Batch related tasks into single sessions to improve cache utilization by ~25%.",
                actionLabel: "Improve Cache",
                actionTarget: "efficiency",
                dollarImpact:
                  potentialSavings > 0 ? potentialSavings : undefined,
                id: "top-opportunity-cache",
                message: `Sessions with 10+ queries have 3x better cache hit rates. Your average: ${queriesPerSession.toFixed(1)} queries (benchmark: ${BENCHMARKS.queriesPerSessionGood}+).`,
                metric: cacheRatio * 100,
                priority: 9,
                title: "Top Opportunity: Cache Utilization",
                type: "tip",
              });
            } else if (errorRate > 0.05) {
              // Find the tool with highest errors
              const toolErrorsResult = await db
                .select({
                  errors:
                    sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                      "errors"
                    ),
                  toolName: schema.toolUses.toolName,
                  total: count(),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                )
                .where(
                  and(
                    gte(schema.sessions.startTime, currentStart),
                    lte(schema.sessions.startTime, currentEnd)
                  )
                )
                .groupBy(schema.toolUses.toolName)
                .orderBy(
                  desc(
                    sql`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`
                  )
                )
                .limit(1);

              if (toolErrorsResult.length > 0) {
                const worstTool = toolErrorsResult[0]!;
                const toolErrorPct =
                  worstTool.total > 0
                    ? (worstTool.errors / worstTool.total) * 100
                    : 0;
                if (toolErrorPct > 5) {
                  // Query for top error pattern to provide root cause
                  const topErrorPatternResult = await db
                    .select({
                      count: count(),
                      errorMessage: schema.toolUses.errorMessage,
                    })
                    .from(schema.toolUses)
                    .innerJoin(
                      schema.sessions,
                      eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                    )
                    .where(
                      and(
                        eq(schema.toolUses.hasError, true),
                        eq(schema.toolUses.toolName, worstTool.toolName),
                        gte(schema.sessions.startTime, currentStart),
                        lte(schema.sessions.startTime, currentEnd)
                      )
                    )
                    .groupBy(schema.toolUses.errorMessage)
                    .orderBy(desc(count()))
                    .limit(1);

                  const topErrorMsg = topErrorPatternResult[0]?.errorMessage;
                  const truncatedError = topErrorMsg
                    ? topErrorMsg.length > 50
                      ? topErrorMsg.slice(0, 47) + "..."
                      : topErrorMsg
                    : null;

                  insights.push({
                    action:
                      worstTool.toolName === "Bash"
                        ? "Check for missing dependencies or incorrect paths in your shell commands."
                        : `Review ${worstTool.toolName} usage patterns and fix common failure cases.`,
                    actionLabel: "Fix Tool Errors",
                    actionTarget: "tools",
                    id: "top-opportunity-tool",
                    message: truncatedError
                      ? `${worstTool.toolName} has ${toolErrorPct.toFixed(0)}% error rate. Top cause: "${truncatedError}"`
                      : `${worstTool.toolName} has a ${toolErrorPct.toFixed(0)}% error rate (benchmark: <${(BENCHMARKS.toolErrorRateGood * 100).toFixed(0)}%).`,
                    metric: toolErrorPct,
                    priority: 9,
                    title: `Top Opportunity: Fix ${worstTool.toolName} Errors`,
                    type: "tip",
                  });
                }
              }
            }

            // ─── CACHE EFFICIENCY ───────────────────────────────────────────────
            const savedTotal = thisWeek.totalSavedByCaching ?? 0;

            if (cacheRatio > BENCHMARKS.cacheRateExcellent) {
              insights.push({
                action:
                  "Keep maintaining longer sessions to preserve cache benefits.",
                actionLabel: "View Details",
                actionTarget: "efficiency",
                dollarImpact: savedTotal,
                id: "cache-efficiency",
                message: `${(cacheRatio * 100).toFixed(0)}% cache rate saved you $${savedTotal.toFixed(2)} this week (benchmark: ${(BENCHMARKS.cacheRateGood * 100).toFixed(0)}%+).`,
                metric: cacheRatio * 100,
                priority: 5,
                title: "Excellent Cache Efficiency",
                type: "success",
              });
            } else if (cacheRatio > 0 && cacheRatio < 0.15) {
              // Estimate how much extra you're paying vs benchmark cache rate
              const totalCost = thisWeek.totalCost ?? 0;
              const estimatedExtraCost =
                totalCost * 0.25 * (BENCHMARKS.cacheRateGood - cacheRatio);

              insights.push({
                action:
                  "Try longer sessions (10+ queries) to build up cache benefits.",
                actionLabel: "Improve Cache",
                actionTarget: "efficiency",
                dollarImpact:
                  estimatedExtraCost > 0 ? estimatedExtraCost : undefined,
                id: "cache-low",
                message: `Only ${(cacheRatio * 100).toFixed(0)}% cache hit rate (benchmark: ${(BENCHMARKS.cacheRateGood * 100).toFixed(0)}%+)${estimatedExtraCost > 0.5 ? ` - costing ~$${estimatedExtraCost.toFixed(2)} extra` : ""}.`,
                metric: cacheRatio * 100,
                priority: 6,
                title: "Low Cache Utilization",
                type: "warning",
              });
            }

            // ─── TOOL SUCCESS RATE ──────────────────────────────────────────────
            if (errorRate > BENCHMARKS.toolErrorRateBad) {
              insights.push({
                action: "Check project setup and fix common command failures.",
                actionLabel: "View Tool Health",
                actionTarget: "tools",
                id: "high-tool-errors",
                message: `${(errorRate * 100).toFixed(1)}% of tool calls are failing (benchmark: <${(BENCHMARKS.toolErrorRateGood * 100).toFixed(0)}%).`,
                metric: errorRate * 100,
                priority: 7,
                title: "High Tool Error Rate",
                type: "warning",
              });
            } else if (toolStats.total > 100 && errorRate < 0.02) {
              insights.push({
                actionLabel: "View Details",
                actionTarget: "tools",
                id: "low-tool-errors",
                message: `${(toolSuccessRate * 100).toFixed(1)}% tool success rate across ${toolStats.total} calls.`,
                metric: toolSuccessRate * 100,
                priority: 4,
                title: "Reliable Tool Execution",
                type: "success",
              });
            }

            // ─── AGENT LEVERAGE ─────────────────────────────────────────────────
            const agentRatio =
              thisWeek.totalSessions > 0
                ? (thisWeek.totalSubagents ?? 0) / thisWeek.totalSessions
                : 0;

            if (agentRatio > 0.3) {
              insights.push({
                actionLabel: "View Sessions",
                actionTarget: "sessions",
                id: "high-subagent-usage",
                message: `${(agentRatio * 100).toFixed(0)}% of sessions use subagents for parallel work.`,
                metric: agentRatio * 100,
                priority: 4,
                title: "Leveraging Parallel Agents",
                type: "info",
              });
            } else if (thisWeek.totalSessions > 5 && agentRatio < 0.1) {
              insights.push({
                action:
                  "Try delegating research tasks to Explore or Plan agents.",
                actionLabel: "Try Subagents",
                actionTarget: "sessions",
                id: "low-subagent-usage",
                message:
                  "Subagents can parallelize research and exploration tasks.",
                metric: agentRatio * 100,
                priority: 3,
                title: "Consider Using Subagents",
                type: "tip",
              });
            }

            // Sort by priority (highest first)
            return insights.toSorted(
              (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
            );
          },
        }),

      getEfficiencyScore: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({
              cause: error,
              operation: "getEfficiencyScore",
            }),
          try: async () => {
            const { currentStart, currentEnd, previousStart, previousEnd } =
              buildComparisonWindows(dateFilter);

            // This week's metrics
            const thisWeekResult = await db
              .select({
                totalCacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "cache_read"
                  ),
                totalCacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "cache_write"
                  ),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost"
                ),
                totalInputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "input"
                  ),
                totalQueries:
                  sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total_queries"
                  ),
                totalSessions: count(),
              })
              .from(schema.sessions)
              .where(
                and(
                  gte(schema.sessions.startTime, currentStart),
                  lte(schema.sessions.startTime, currentEnd)
                )
              );

            // Last week for trend comparison
            const lastWeekResult = await db
              .select({
                totalCacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "cache_read"
                  ),
                totalCacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "cache_write"
                  ),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost"
                ),
                totalInputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "input"
                  ),
                totalSessions: count(),
              })
              .from(schema.sessions)
              .where(
                and(
                  gte(schema.sessions.startTime, previousStart),
                  lte(schema.sessions.startTime, previousEnd)
                )
              );

            // Tool success rate
            const toolResult = await db
              .select({
                errors:
                  sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "errors"
                  ),
                total: count(),
              })
              .from(schema.toolUses)
              .innerJoin(
                schema.sessions,
                eq(schema.toolUses.sessionId, schema.sessions.sessionId)
              )
              .where(
                and(
                  gte(schema.sessions.startTime, currentStart),
                  lte(schema.sessions.startTime, currentEnd)
                )
              );

            const thisWeek = thisWeekResult[0]!;
            const lastWeek = lastWeekResult[0]!;
            const toolStats = toolResult[0]!;

            // Calculate component scores
            const cacheRatio = cacheHitRatio({
              cacheRead: thisWeek.totalCacheRead ?? 0,
              cacheWrite: thisWeek.totalCacheWrite ?? 0,
              uncachedInput: thisWeek.totalInputTokens ?? 0,
            });
            const cacheEfficiency = Math.min(100, cacheRatio * 200); // 50% = 100

            const errorRate =
              toolStats.total > 0
                ? (toolStats.errors ?? 0) / toolStats.total
                : 0;
            const toolSuccess = (1 - errorRate) * 100;

            const queriesPerSession =
              thisWeek.totalSessions > 0
                ? (thisWeek.totalQueries ?? 0) / thisWeek.totalSessions
                : 0;
            const sessionEfficiency = Math.min(100, queriesPerSession * 10); // 10 queries = 100

            // Composite score
            const overall = Math.round(
              cacheEfficiency * 0.4 +
                toolSuccess * 0.35 +
                sessionEfficiency * 0.25
            );

            // Trend calculation
            const thisWeekCostPerSession =
              thisWeek.totalSessions > 0
                ? (thisWeek.totalCost ?? 0) / thisWeek.totalSessions
                : 0;
            const lastWeekCostPerSession =
              lastWeek.totalSessions > 0
                ? (lastWeek.totalCost ?? 0) / lastWeek.totalSessions
                : 0;

            const lastWeekCacheRatio = cacheHitRatio({
              cacheRead: lastWeek.totalCacheRead ?? 0,
              cacheWrite: lastWeek.totalCacheWrite ?? 0,
              uncachedInput: lastWeek.totalInputTokens ?? 0,
            });

            const costImproved =
              thisWeekCostPerSession < lastWeekCostPerSession * 0.95;
            const cacheImproved = cacheRatio > lastWeekCacheRatio * 1.05;

            const trend: "improving" | "declining" | "stable" =
              costImproved && cacheImproved
                ? "improving"
                : thisWeekCostPerSession > lastWeekCostPerSession * 1.1
                  ? "declining"
                  : "stable";

            // Determine top opportunity
            let topOpportunity: string;
            if (cacheEfficiency < 40) {
              topOpportunity =
                "Extend session length to 10+ queries to improve cache hit rates by ~25%.";
            } else if (toolSuccess < 95) {
              topOpportunity =
                "Fix tool errors (especially Bash commands) to reduce workflow friction.";
            } else if (sessionEfficiency < 50) {
              topOpportunity =
                "Batch related tasks into fewer, longer sessions for better efficiency.";
            } else {
              topOpportunity =
                "Workflow is well-optimized. Maintain current patterns.";
            }

            return {
              cacheEfficiency: Math.round(cacheEfficiency),
              overall,
              sessionEfficiency: Math.round(sessionEfficiency),
              toolSuccess: Math.round(toolSuccess),
              topOpportunity,
              trend,
            };
          },
        }),

      getWeeklyComparison: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({
              cause: error,
              operation: "getWeeklyComparison",
            }),
          try: async () => {
            const { currentStart, currentEnd, previousStart, previousEnd } =
              buildComparisonWindows(dateFilter);

            // This week
            const thisWeekResult = await db
              .select({
                cacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "cache_read"
                  ),
                cacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "cache_write"
                  ),
                cost: sql<number>`SUM(${schema.sessions.totalCost})`.as("cost"),
                inputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "input"
                  ),
                queries: sql<number>`SUM(${schema.sessions.queryCount})`.as(
                  "queries"
                ),
                sessions: count(),
              })
              .from(schema.sessions)
              .where(
                and(
                  gte(schema.sessions.startTime, currentStart),
                  lte(schema.sessions.startTime, currentEnd)
                )
              );

            // Last week
            const lastWeekResult = await db
              .select({
                cacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "cache_read"
                  ),
                cacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "cache_write"
                  ),
                cost: sql<number>`SUM(${schema.sessions.totalCost})`.as("cost"),
                inputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "input"
                  ),
                queries: sql<number>`SUM(${schema.sessions.queryCount})`.as(
                  "queries"
                ),
                sessions: count(),
              })
              .from(schema.sessions)
              .where(
                and(
                  gte(schema.sessions.startTime, previousStart),
                  lte(schema.sessions.startTime, previousEnd)
                )
              );

            // Tool errors this week
            const thisWeekToolResult = await db
              .select({
                errors:
                  sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "errors"
                  ),
                total: count(),
              })
              .from(schema.toolUses)
              .innerJoin(
                schema.sessions,
                eq(schema.toolUses.sessionId, schema.sessions.sessionId)
              )
              .where(
                and(
                  gte(schema.sessions.startTime, currentStart),
                  lte(schema.sessions.startTime, currentEnd)
                )
              );

            // Tool errors last week
            const lastWeekToolResult = await db
              .select({
                errors:
                  sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "errors"
                  ),
                total: count(),
              })
              .from(schema.toolUses)
              .innerJoin(
                schema.sessions,
                eq(schema.toolUses.sessionId, schema.sessions.sessionId)
              )
              .where(
                and(
                  gte(schema.sessions.startTime, previousStart),
                  lte(schema.sessions.startTime, previousEnd)
                )
              );

            const tw = thisWeekResult[0]!;
            const lw = lastWeekResult[0]!;
            const twTool = thisWeekToolResult[0]!;
            const lwTool = lastWeekToolResult[0]!;

            // Compute metrics
            const thisWeekData = {
              avgQueriesPerSession:
                tw.sessions > 0 ? (tw.queries ?? 0) / tw.sessions : 0,
              cacheHitRate: cacheHitRatio({
                cacheRead: tw.cacheRead ?? 0,
                cacheWrite: tw.cacheWrite ?? 0,
                uncachedInput: tw.inputTokens ?? 0,
              }),
              cost: tw.cost ?? 0,
              costPerSession:
                tw.sessions > 0 ? (tw.cost ?? 0) / tw.sessions : 0,
              sessions: tw.sessions,
              toolErrorRate:
                twTool.total > 0 ? (twTool.errors ?? 0) / twTool.total : 0,
            };

            const lastWeekData = {
              avgQueriesPerSession:
                lw.sessions > 0 ? (lw.queries ?? 0) / lw.sessions : 0,
              cacheHitRate: cacheHitRatio({
                cacheRead: lw.cacheRead ?? 0,
                cacheWrite: lw.cacheWrite ?? 0,
                uncachedInput: lw.inputTokens ?? 0,
              }),
              cost: lw.cost ?? 0,
              costPerSession:
                lw.sessions > 0 ? (lw.cost ?? 0) / lw.sessions : 0,
              sessions: lw.sessions,
              toolErrorRate:
                lwTool.total > 0 ? (lwTool.errors ?? 0) / lwTool.total : 0,
            };

            // Calculate percent changes
            const pctChange = (curr: number, prev: number): number => {
              if (prev === 0) {
                return curr > 0 ? 100 : 0;
              }
              return ((curr - prev) / prev) * 100;
            };

            const changes = {
              avgQueriesPerSession: pctChange(
                thisWeekData.avgQueriesPerSession,
                lastWeekData.avgQueriesPerSession
              ),
              cacheHitRate: pctChange(
                thisWeekData.cacheHitRate,
                lastWeekData.cacheHitRate
              ),
              cost: pctChange(thisWeekData.cost, lastWeekData.cost),
              costPerSession: pctChange(
                thisWeekData.costPerSession,
                lastWeekData.costPerSession
              ),
              sessions: pctChange(thisWeekData.sessions, lastWeekData.sessions),
              toolErrorRate: pctChange(
                thisWeekData.toolErrorRate,
                lastWeekData.toolErrorRate
              ),
            };

            // Identify improvements and concerns
            const improvements: string[] = [];
            const concerns: string[] = [];

            if (changes.costPerSession < -10) {
              improvements.push(
                `Cost per session dropped ${Math.abs(changes.costPerSession).toFixed(0)}%`
              );
            }
            if (changes.cacheHitRate > 10) {
              improvements.push(
                `Cache hit rate improved ${changes.cacheHitRate.toFixed(0)}%`
              );
            }
            if (changes.toolErrorRate < -20) {
              improvements.push(
                `Tool errors reduced ${Math.abs(changes.toolErrorRate).toFixed(0)}%`
              );
            }
            if (changes.avgQueriesPerSession > 15) {
              improvements.push(
                `Longer sessions (${changes.avgQueriesPerSession.toFixed(0)}% more queries/session)`
              );
            }

            if (changes.costPerSession > 20) {
              concerns.push(
                `Cost per session increased ${changes.costPerSession.toFixed(0)}%`
              );
            }
            if (changes.cacheHitRate < -15) {
              concerns.push(
                `Cache hit rate dropped ${Math.abs(changes.cacheHitRate).toFixed(0)}%`
              );
            }
            if (changes.toolErrorRate > 30) {
              concerns.push(
                `Tool errors increased ${changes.toolErrorRate.toFixed(0)}%`
              );
            }

            return {
              changes,
              concerns,
              improvements,
              lastWeek: lastWeekData,
              thisWeek: thisWeekData,
            };
          },
        }),
    };
  })
);
