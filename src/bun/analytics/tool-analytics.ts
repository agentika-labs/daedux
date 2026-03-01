import { sql, desc, eq, and, count } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { Effect } from "effect";

import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import {
  categorizeErrorsByPattern,
  getFixSuggestions,
} from "../utils/error-patterns";
import {
  getConfidenceLevel,
  percentile,
  wilsonScoreInterval,
} from "../utils/statistics";
import type { ConfidenceLevel } from "../utils/statistics";
import type { DateFilter } from "./shared";
import {
  buildDateConditions,
  sessionsTable,
  sessionJoinOn,
  withDateFilter,
} from "./shared";

export interface ToolUsageStat {
  readonly name: string;
  readonly count: number;
  readonly sessions: number;
}

export interface ToolHealthStat {
  readonly name: string;
  readonly totalCalls: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly sessions: number;
  readonly topErrors: { message: string; count: number }[];
}

export interface BashCommandStat {
  readonly category: string;
  readonly count: number;
  readonly topCommands: string[];
}

export interface BashCategoryHealth {
  readonly category: string;
  readonly totalCommands: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly topErrors: { message: string; count: number }[];
  readonly fixSuggestions: string[];
}

export interface ToolHealthReportCard {
  readonly reliableTools: {
    name: string;
    successRate: number;
    totalCalls: number;
    /** Wilson lower bound of success rate × 100 */
    reliabilityScore: number;
    confidence: ConfidenceLevel;
  }[];
  readonly frictionPoints: {
    name: string;
    errorRate: number;
    topError: string;
    totalCalls: number;
    /** Wilson upper bound of error rate × 100 */
    frictionScore: number;
    confidence: ConfidenceLevel;
  }[];
  readonly bashDeepDive: BashCategoryHealth[];
  readonly headline: string;
  readonly recommendation: string;
  /** Population statistics for context */
  readonly populationStats?: {
    totalTools: number;
    reliableThreshold: number;
    frictionThreshold: number;
  };
}

export interface ApiErrorStat {
  readonly errorType: string;
  readonly count: number;
  readonly lastOccurred: number;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

async function getBashCategoryHealthInternal(
  db: SQLiteBunDatabase<typeof schema>,
  dateConditions: SQL[]
): Promise<BashCategoryHealth[]> {
  // Get category counts
  const categoryData = await withDateFilter(
    dateConditions,
    () =>
      db
        .select({
          category: schema.bashCommands.category,
          totalCommands: count(),
        })
        .from(schema.bashCommands)
        .groupBy(schema.bashCommands.category)
        .orderBy(desc(count())),
    () =>
      db
        .select({
          category: schema.bashCommands.category,
          totalCommands: count(),
        })
        .from(schema.bashCommands)
        .innerJoin(sessionsTable, sessionJoinOn(schema.bashCommands))
        .where(and(...dateConditions))
        .groupBy(schema.bashCommands.category)
        .orderBy(desc(count()))
  );

  // Get Bash tool errors
  const bashErrors = await withDateFilter(
    dateConditions,
    () =>
      db
        .select({
          count: count(),
          errorMessage: schema.toolUses.errorMessage,
        })
        .from(schema.toolUses)
        .where(
          and(
            eq(schema.toolUses.toolName, "Bash"),
            eq(schema.toolUses.hasError, true)
          )
        )
        .groupBy(schema.toolUses.errorMessage)
        .orderBy(desc(count()))
        .limit(20),
    () =>
      db
        .select({
          count: count(),
          errorMessage: schema.toolUses.errorMessage,
        })
        .from(schema.toolUses)
        .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
        .where(
          and(
            eq(schema.toolUses.toolName, "Bash"),
            eq(schema.toolUses.hasError, true),
            ...dateConditions
          )
        )
        .groupBy(schema.toolUses.errorMessage)
        .orderBy(desc(count()))
        .limit(20)
  );

  // Get overall bash error rate
  const bashTotalStats = await withDateFilter(
    dateConditions,
    () =>
      db
        .select({
          errors:
            sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
              "errors"
            ),
          total: count(),
        })
        .from(schema.toolUses)
        .where(eq(schema.toolUses.toolName, "Bash")),
    () =>
      db
        .select({
          errors:
            sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
              "errors"
            ),
          total: count(),
        })
        .from(schema.toolUses)
        .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
        .where(and(eq(schema.toolUses.toolName, "Bash"), ...dateConditions))
  );

  const totalBashUses = bashTotalStats[0]?.total ?? 0;
  const totalBashErrors = bashTotalStats[0]?.errors ?? 0;
  const overallBashErrorRate =
    totalBashUses > 0 ? totalBashErrors / totalBashUses : 0;

  const errorsByCategory = categorizeErrorsByPattern(bashErrors);

  return categoryData.map((cat) => {
    const categoryErrors = errorsByCategory[cat.category] ?? [];
    const categoryErrorCount = categoryErrors.reduce(
      (sum: number, e: { count: number }) => sum + e.count,
      0
    );
    const categoryErrorRate =
      cat.totalCommands > 0
        ? Math.min(
            categoryErrorCount / cat.totalCommands,
            overallBashErrorRate * 2
          )
        : 0;

    return {
      category: cat.category,
      errorCount: categoryErrorCount,
      errorRate: categoryErrorRate,
      fixSuggestions: getFixSuggestions(cat.category, categoryErrors),
      topErrors: categoryErrors.slice(0, 3),
      totalCommands: cat.totalCommands,
    };
  });
}

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * ToolAnalyticsService provides tool usage and health analytics.
 * Tracks tool invocations, error rates, bash commands, and API errors.
 */
export class ToolAnalyticsService extends Effect.Service<ToolAnalyticsService>()(
  "ToolAnalyticsService",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      return {
        getApiErrors: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getApiErrors" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      count: count(),
                      errorType: schema.apiErrors.errorType,
                      lastOccurred:
                        sql<number>`MAX(${schema.apiErrors.timestamp})`.as(
                          "last_occurred"
                        ),
                    })
                    .from(schema.apiErrors)
                    .groupBy(schema.apiErrors.errorType)
                    .orderBy(desc(count())),
                () =>
                  db
                    .select({
                      count: count(),
                      errorType: schema.apiErrors.errorType,
                      lastOccurred:
                        sql<number>`MAX(${schema.apiErrors.timestamp})`.as(
                          "last_occurred"
                        ),
                    })
                    .from(schema.apiErrors)
                    .innerJoin(sessionsTable, sessionJoinOn(schema.apiErrors))
                    .where(and(...dateConditions))
                    .groupBy(schema.apiErrors.errorType)
                    .orderBy(desc(count()))
              );

              return result.map((row) => ({
                count: row.count,
                errorType: row.errorType,
                lastOccurred: row.lastOccurred ?? 0,
              }));
            },
          }),

        getBashCategoryHealth: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getBashCategoryHealth",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);
              return getBashCategoryHealthInternal(db, dateConditions);
            },
          }),

        getBashCommandStats: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getBashCommandStats",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              // Use SUBSTR to cap GROUP_CONCAT at 10KB to prevent memory issues
              // We only need ~5 unique commands, and each command is typically <200 chars
              // Deduplication happens in TypeScript since SQLite DISTINCT doesn't work with separators
              const boundedGroupConcat =
                sql<string>`SUBSTR(GROUP_CONCAT(${schema.bashCommands.command}, '|||'), 1, 10000)`.as(
                  "commands"
                );

              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      category: schema.bashCommands.category,
                      commands: boundedGroupConcat,
                      count: count(),
                    })
                    .from(schema.bashCommands)
                    .groupBy(schema.bashCommands.category)
                    .orderBy(desc(count())),
                () =>
                  db
                    .select({
                      category: schema.bashCommands.category,
                      commands: boundedGroupConcat,
                      count: count(),
                    })
                    .from(schema.bashCommands)
                    .innerJoin(
                      sessionsTable,
                      sessionJoinOn(schema.bashCommands)
                    )
                    .where(and(...dateConditions))
                    .groupBy(schema.bashCommands.category)
                    .orderBy(desc(count()))
              );

              return result.map((row) => {
                const allCommands = (row.commands ?? "").split("|||");
                // Deduplicate and take top 5 unique commands
                const uniqueCommands = [...new Set(allCommands)].slice(0, 5);
                return {
                  category: row.category,
                  count: row.count,
                  topCommands: uniqueCommands,
                };
              });
            },
          }),

        getSessionToolCounts: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getSessionToolCounts",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      count: count(),
                      sessionId: schema.toolUses.sessionId,
                      toolName: schema.toolUses.toolName,
                    })
                    .from(schema.toolUses)
                    .groupBy(
                      schema.toolUses.sessionId,
                      schema.toolUses.toolName
                    ),
                () =>
                  db
                    .select({
                      count: count(),
                      sessionId: schema.toolUses.sessionId,
                      toolName: schema.toolUses.toolName,
                    })
                    .from(schema.toolUses)
                    .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
                    .where(and(...dateConditions))
                    .groupBy(
                      schema.toolUses.sessionId,
                      schema.toolUses.toolName
                    )
              );

              const sessionToolCounts = new Map<
                string,
                Record<string, number>
              >();
              for (const row of result) {
                if (!sessionToolCounts.has(row.sessionId)) {
                  sessionToolCounts.set(row.sessionId, {});
                }
                sessionToolCounts.get(row.sessionId)![row.toolName] = row.count;
              }
              return sessionToolCounts;
            },
          }),

        getSessionToolErrorCounts: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getSessionToolErrorCounts",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      errorCount:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "error_count"
                        ),
                      sessionId: schema.toolUses.sessionId,
                    })
                    .from(schema.toolUses)
                    .groupBy(schema.toolUses.sessionId),
                () =>
                  db
                    .select({
                      errorCount:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "error_count"
                        ),
                      sessionId: schema.toolUses.sessionId,
                    })
                    .from(schema.toolUses)
                    .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
                    .where(and(...dateConditions))
                    .groupBy(schema.toolUses.sessionId)
              );

              const sessionToolErrors = new Map<string, number>();
              for (const row of result) {
                sessionToolErrors.set(row.sessionId, row.errorCount ?? 0);
              }
              return sessionToolErrors;
            },
          }),

        getToolHealth: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getToolHealth" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      errorCount:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "error_count"
                        ),
                      sessions:
                        sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                          "sessions"
                        ),
                      toolName: schema.toolUses.toolName,
                      totalUses: count(),
                    })
                    .from(schema.toolUses)
                    .groupBy(schema.toolUses.toolName)
                    .orderBy(desc(count())),
                () =>
                  db
                    .select({
                      errorCount:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "error_count"
                        ),
                      sessions:
                        sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                          "sessions"
                        ),
                      toolName: schema.toolUses.toolName,
                      totalUses: count(),
                    })
                    .from(schema.toolUses)
                    .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
                    .where(and(...dateConditions))
                    .groupBy(schema.toolUses.toolName)
                    .orderBy(desc(count()))
              );

              return result.map((row) => ({
                errorRate:
                  row.totalUses > 0 ? (row.errorCount ?? 0) / row.totalUses : 0,
                errors: row.errorCount ?? 0,
                name: row.toolName,
                sessions: row.sessions ?? 0,
                topErrors: [] as { message: string; count: number }[],
                totalCalls: row.totalUses,
              }));
            },
          }),

        getToolHealthReportCard: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getToolHealthReportCard",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              // Get tool health stats
              const toolHealthData = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      errorCount:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "error_count"
                        ),
                      toolName: schema.toolUses.toolName,
                      totalUses: count(),
                    })
                    .from(schema.toolUses)
                    .groupBy(schema.toolUses.toolName)
                    .orderBy(desc(count())),
                () =>
                  db
                    .select({
                      errorCount:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "error_count"
                        ),
                      toolName: schema.toolUses.toolName,
                      totalUses: count(),
                    })
                    .from(schema.toolUses)
                    .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
                    .where(and(...dateConditions))
                    .groupBy(schema.toolUses.toolName)
                    .orderBy(desc(count()))
              );

              // Get top errors per tool
              const topErrorsData = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      count: count(),
                      errorMessage: schema.toolUses.errorMessage,
                      toolName: schema.toolUses.toolName,
                    })
                    .from(schema.toolUses)
                    .where(eq(schema.toolUses.hasError, true))
                    .groupBy(
                      schema.toolUses.toolName,
                      schema.toolUses.errorMessage
                    )
                    .orderBy(desc(count()))
                    .limit(100),
                () =>
                  db
                    .select({
                      count: count(),
                      errorMessage: schema.toolUses.errorMessage,
                      toolName: schema.toolUses.toolName,
                    })
                    .from(schema.toolUses)
                    .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
                    .where(
                      and(eq(schema.toolUses.hasError, true), ...dateConditions)
                    )
                    .groupBy(
                      schema.toolUses.toolName,
                      schema.toolUses.errorMessage
                    )
                    .orderBy(desc(count()))
                    .limit(100)
              );

              // Group errors by tool
              const errorsByTool = new Map<
                string,
                { message: string; count: number }[]
              >();
              for (const err of topErrorsData) {
                const toolErrors = errorsByTool.get(err.toolName) ?? [];
                toolErrors.push({
                  count: err.count,
                  message: err.errorMessage ?? "Unknown error",
                });
                errorsByTool.set(err.toolName, toolErrors);
              }

              // Calculate metrics for each tool using Wilson score intervals
              const toolMetrics = toolHealthData.map((tool) => {
                const errorCount = tool.errorCount ?? 0;
                const successes = tool.totalUses - errorCount;

                // Wilson score intervals provide confidence bounds
                const successInterval = wilsonScoreInterval(
                  successes,
                  tool.totalUses
                );
                const errorInterval = wilsonScoreInterval(
                  errorCount,
                  tool.totalUses
                );

                return {
                  confidence: getConfidenceLevel(tool.totalUses),
                  errorCount,
                  errorRate:
                    tool.totalUses > 0 ? errorCount / tool.totalUses : 0,
                  // frictionScore: Wilson upper bound of error rate (worst-case error rate)
                  frictionScore: errorInterval.upper * 100,
                  name: tool.toolName,
                  // reliabilityScore: Wilson lower bound of success rate (conservative estimate)
                  reliabilityScore: successInterval.lower * 100,
                  successRate:
                    tool.totalUses > 0 ? successes / tool.totalUses : 1,
                  topError: errorsByTool.get(tool.toolName)?.[0]?.message ?? "",
                  totalCalls: tool.totalUses,
                };
              });

              // Percentile-based thresholds adapt to actual data distribution
              const reliabilityScores = toolMetrics.map(
                (t) => t.reliabilityScore
              );
              const frictionScores = toolMetrics.map((t) => t.frictionScore);

              // Top 20% reliability score = 80th percentile threshold
              const reliableThreshold = percentile(reliabilityScores, 80);
              // Top 20% friction score (worst errors) = 80th percentile
              const frictionThreshold = percentile(frictionScores, 80);

              // Reliable tools: high reliability score, minimum sample size for credibility
              const reliableTools = toolMetrics
                .filter(
                  (t) =>
                    t.reliabilityScore >= reliableThreshold &&
                    t.totalCalls >= 10
                )
                .toSorted((a, b) => b.reliabilityScore - a.reliabilityScore)
                .slice(0, 5)
                .map((t) => ({
                  confidence: t.confidence,
                  name: t.name,
                  reliabilityScore: t.reliabilityScore,
                  successRate: t.successRate,
                  totalCalls: t.totalCalls,
                }));

              // Friction points: high friction score OR any errors with small samples
              const frictionPoints = toolMetrics
                .filter(
                  (t) =>
                    (t.frictionScore >= frictionThreshold ||
                      t.errorCount > 0) &&
                    t.totalCalls >= 3
                )
                .toSorted((a, b) => b.frictionScore - a.frictionScore)
                .slice(0, 5)
                .map((t) => ({
                  confidence: t.confidence,
                  errorRate: t.errorRate,
                  frictionScore: t.frictionScore,
                  name: t.name,
                  topError: t.topError.slice(0, 100),
                  totalCalls: t.totalCalls,
                }));

              // Get bash category health for deep dive
              const bashCategoryData = await getBashCategoryHealthInternal(
                db,
                dateConditions
              );

              // Generate headline and recommendation
              const totalErrors = toolMetrics.reduce(
                (sum, t) => sum + t.errorCount,
                0
              );

              const topFriction = frictionPoints[0];
              const bashFriction = bashCategoryData
                .filter((c) => c.errorRate > 0.1)
                .toSorted((a, b) => b.errorCount - a.errorCount)[0];

              let headline = "Your tools are running smoothly";
              let recommendation =
                "Keep up the great work! Your workflow has minimal friction.";

              if (frictionPoints.length > 0 && topFriction) {
                const frictionPercent =
                  Math.round(
                    (frictionPoints.reduce(
                      (sum, f) => sum + (f.errorRate / 100) * f.totalCalls,
                      0
                    ) /
                      totalErrors) *
                      100
                  ) || 0;
                headline = `${frictionPoints.length} tool${frictionPoints.length > 1 ? "s" : ""} ${frictionPoints.length > 1 ? "are" : "is"} causing ${frictionPercent > 50 ? "most" : "significant"} workflow friction`;

                if (topFriction.name === "Bash" && bashFriction) {
                  recommendation = `Focus on ${bashFriction.category.replace("_", " ")} commands - ${bashFriction.fixSuggestions[0] ?? "check error logs for patterns"}`;
                } else {
                  recommendation = `${topFriction.name} has ${topFriction.errorRate.toFixed(1)}% error rate. ${topFriction.topError ? `Common error: "${topFriction.topError.slice(0, 50)}..."` : "Review usage patterns."}`;
                }
              }

              return {
                bashDeepDive: bashCategoryData,
                frictionPoints,
                headline,
                populationStats: {
                  frictionThreshold,
                  reliableThreshold,
                  totalTools: toolMetrics.length,
                },
                recommendation,
                reliableTools,
              };
            },
          }),

        getToolUsage: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getToolUsage" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      count: count(),
                      name: schema.toolUses.toolName,
                      sessions:
                        sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                          "sessions"
                        ),
                    })
                    .from(schema.toolUses)
                    .groupBy(schema.toolUses.toolName)
                    .orderBy(desc(count())),
                () =>
                  db
                    .select({
                      count: count(),
                      name: schema.toolUses.toolName,
                      sessions:
                        sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                          "sessions"
                        ),
                    })
                    .from(schema.toolUses)
                    .innerJoin(sessionsTable, sessionJoinOn(schema.toolUses))
                    .where(and(...dateConditions))
                    .groupBy(schema.toolUses.toolName)
                    .orderBy(desc(count()))
              );

              return result.map((row) => ({
                count: row.count,
                name: row.name,
                sessions: row.sessions ?? 0,
              }));
            },
          }),
      } as const;
    }),
  }
) {}
