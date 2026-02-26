import { sql, eq, and, count, avg } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import type { DateFilter } from "./shared";
import { buildDateConditions } from "./shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContextHeatmapPoint {
  readonly turnRange: string;
  readonly utilizationBucket: string;
  readonly count: number;
}

export interface CacheEfficiencyPoint {
  readonly queryIndex: number;
  readonly avgCacheHitRatio: number;
  readonly sessionCount: number;
}

export interface CompactionAnalysis {
  readonly sessionsWithCompactions: number;
  readonly totalSessions: number;
  readonly avgCompactionsPerSession: number;
}

/** Context window fill data by turn number for line chart visualization */
export interface ContextWindowFillPoint {
  readonly queryIndex: number;
  readonly avgCumulativeTokens: number;
  readonly maxCumulativeTokens: number;
  readonly sessionCount: number;
  readonly p25Tokens: number; // 25th percentile
  readonly p75Tokens: number; // 75th percentile
}

/** Peak context usage per session for histogram visualization */
export interface PeakContextData {
  readonly sessionId: string;
  readonly peakTokens: number;
  readonly model: string | null;
}

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * ContextAnalyticsService provides context window utilization analytics.
 * Tracks cache efficiency, compaction patterns, and token usage over turns.
 */
export class ContextAnalyticsService extends Effect.Service<ContextAnalyticsService>()(
  "ContextAnalyticsService",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      return {
      getCacheEfficiencyCurve: (
        dateFilter: DateFilter = {},
        projectPath?: string
      ) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({
              cause: error,
              operation: "getCacheEfficiencyCurve",
            }),
          try: async () => {
            const conditions: SQL[] = [...buildDateConditions(dateFilter)];
            if (projectPath) {
              conditions.push(eq(schema.sessions.projectPath, projectPath));
            }

            let result;
            if (conditions.length === 0) {
              result = await db
                .select({
                  avgCacheHitRatio: avg(
                    schema.contextWindowUsage.cacheHitRatio
                  ),
                  queryIndex: schema.contextWindowUsage.queryIndex,
                  sessionCount:
                    sql<number>`COUNT(DISTINCT ${schema.contextWindowUsage.sessionId})`.as(
                      "session_count"
                    ),
                })
                .from(schema.contextWindowUsage)
                .groupBy(schema.contextWindowUsage.queryIndex)
                .orderBy(schema.contextWindowUsage.queryIndex)
                .limit(100);
            } else {
              result = await db
                .select({
                  avgCacheHitRatio: avg(
                    schema.contextWindowUsage.cacheHitRatio
                  ),
                  queryIndex: schema.contextWindowUsage.queryIndex,
                  sessionCount:
                    sql<number>`COUNT(DISTINCT ${schema.contextWindowUsage.sessionId})`.as(
                      "session_count"
                    ),
                })
                .from(schema.contextWindowUsage)
                .innerJoin(
                  schema.sessions,
                  eq(
                    schema.contextWindowUsage.sessionId,
                    schema.sessions.sessionId
                  )
                )
                .where(and(...conditions))
                .groupBy(schema.contextWindowUsage.queryIndex)
                .orderBy(schema.contextWindowUsage.queryIndex)
                .limit(100);
            }

            return result.map((row) => ({
              avgCacheHitRatio: Number(row.avgCacheHitRatio) || 0,
              queryIndex: row.queryIndex,
              sessionCount: row.sessionCount ?? 0,
            }));
          },
        }),

      getCompactionAnalysis: (
        dateFilter: DateFilter = {},
        projectPath?: string
      ) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({
              cause: error,
              operation: "getCompactionAnalysis",
            }),
          try: async () => {
            const conditions: SQL[] = [...buildDateConditions(dateFilter)];
            if (projectPath) {
              conditions.push(eq(schema.sessions.projectPath, projectPath));
            }

            let query = db
              .select({
                avgCompactions: avg(schema.sessions.compactions),
                sessionsWithCompactions:
                  sql<number>`SUM(CASE WHEN COALESCE(${schema.sessions.compactions}, 0) > 0 THEN 1 ELSE 0 END)`.as(
                    "with_compactions"
                  ),
                totalSessions: count(),
              })
              .from(schema.sessions);

            if (conditions.length > 0) {
              query = query.where(and(...conditions)) as typeof query;
            }

            const result = await query;

            const row = result[0]!;
            return {
              avgCompactionsPerSession: Number(row.avgCompactions) || 0,
              sessionsWithCompactions: row.sessionsWithCompactions ?? 0,
              totalSessions: row.totalSessions ?? 0,
            };
          },
        }),

      getContextHeatmap: (dateFilter: DateFilter = {}, projectPath?: string) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({ cause: error, operation: "getContextHeatmap" }),
          try: async () => {
            const conditions: SQL[] = [...buildDateConditions(dateFilter)];
            if (projectPath) {
              conditions.push(eq(schema.sessions.projectPath, projectPath));
            }

            // Bucket queries by turn index ranges and cache hit ratio ranges
            let result;
            if (conditions.length === 0) {
              result = await db
                .select({
                  cacheHitRatio: schema.contextWindowUsage.cacheHitRatio,
                  queryIndex: schema.contextWindowUsage.queryIndex,
                })
                .from(schema.contextWindowUsage);
            } else {
              result = await db
                .select({
                  cacheHitRatio: schema.contextWindowUsage.cacheHitRatio,
                  queryIndex: schema.contextWindowUsage.queryIndex,
                })
                .from(schema.contextWindowUsage)
                .innerJoin(
                  schema.sessions,
                  eq(
                    schema.contextWindowUsage.sessionId,
                    schema.sessions.sessionId
                  )
                )
                .where(and(...conditions));
            }

            // Create heatmap buckets (aligned with frontend naming convention)
            const buckets = new Map<string, number>();
            const turnRanges = ["1-5", "6-10", "11-20", "21-50", "51+"];
            const utilizationRanges = [
              "0-20%",
              "21-40%",
              "41-60%",
              "61-80%",
              "81-100%",
            ];

            for (const row of result) {
              const turn = row.queryIndex;
              const ratio = (row.cacheHitRatio ?? 0) * 100;

              let turnRange = "51+";
              if (turn <= 5) {
                turnRange = "1-5";
              } else if (turn <= 10) {
                turnRange = "6-10";
              } else if (turn <= 20) {
                turnRange = "11-20";
              } else if (turn <= 50) {
                turnRange = "21-50";
              }

              let utilBucket = "81-100%";
              if (ratio <= 20) {
                utilBucket = "0-20%";
              } else if (ratio <= 40) {
                utilBucket = "21-40%";
              } else if (ratio <= 60) {
                utilBucket = "41-60%";
              } else if (ratio <= 80) {
                utilBucket = "61-80%";
              }

              const key = `${turnRange}:${utilBucket}`;
              buckets.set(key, (buckets.get(key) ?? 0) + 1);
            }

            // Convert to array
            const heatmap: ContextHeatmapPoint[] = [];
            for (const turnRange of turnRanges) {
              for (const utilBucket of utilizationRanges) {
                const key = `${turnRange}:${utilBucket}`;
                heatmap.push({
                  count: buckets.get(key) ?? 0,
                  turnRange,
                  utilizationBucket: utilBucket,
                });
              }
            }

            return heatmap;
          },
        }),

      getContextPeakDistribution: (
        dateFilter: DateFilter = {},
        projectPath?: string
      ) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({
              cause: error,
              operation: "getContextPeakDistribution",
            }),
          try: async () => {
            const conditions: SQL[] = [...buildDateConditions(dateFilter)];
            if (projectPath) {
              conditions.push(eq(schema.sessions.projectPath, projectPath));
            }
            const excludeSubagents = eq(schema.sessions.isSubagent, false);

            // Get max context fill per session (input_tokens + cache_read + cache_write)
            // Include cache_write as it represents tokens being written to cache (also part of context)
            // Filter out subagent sessions as they have shorter contexts
            const peakTokensExpr =
              sql<number>`MAX(COALESCE(${schema.queries.inputTokens}, 0) + COALESCE(${schema.queries.cacheRead}, 0) + COALESCE(${schema.queries.cacheWrite}, 0))`.as(
                "peak_tokens"
              );
            const modelExpr =
              sql<string>`(SELECT model FROM ${schema.queries} q2 WHERE q2.session_id = ${schema.queries.sessionId} AND q2.query_index = 0 LIMIT 1)`.as(
                "model"
              );

            let result;
            if (conditions.length === 0) {
              result = await db
                .select({
                  model: modelExpr,
                  peakTokens: peakTokensExpr,
                  sessionId: schema.queries.sessionId,
                })
                .from(schema.queries)
                .innerJoin(
                  schema.sessions,
                  eq(schema.queries.sessionId, schema.sessions.sessionId)
                )
                .where(excludeSubagents)
                .groupBy(schema.queries.sessionId);
            } else {
              result = await db
                .select({
                  model: modelExpr,
                  peakTokens: peakTokensExpr,
                  sessionId: schema.queries.sessionId,
                })
                .from(schema.queries)
                .innerJoin(
                  schema.sessions,
                  eq(schema.queries.sessionId, schema.sessions.sessionId)
                )
                .where(and(excludeSubagents, ...conditions))
                .groupBy(schema.queries.sessionId);
            }

            return result.map((row) => ({
              model: row.model ?? null,
              peakTokens: row.peakTokens ?? 0,
              sessionId: row.sessionId,
            }));
          },
        }),

      getContextWindowFill: (
        dateFilter: DateFilter = {},
        projectPath?: string
      ) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({
              cause: error,
              operation: "getContextWindowFill",
            }),
          try: async () => {
            const conditions: SQL[] = [...buildDateConditions(dateFilter)];
            if (projectPath) {
              conditions.push(eq(schema.sessions.projectPath, projectPath));
            }
            const excludeSubagents = eq(schema.sessions.isSubagent, false);

            // Context fill = input_tokens + cache_read + cache_write (full context window)
            // cache_write (cache_creation_input_tokens) represents tokens being written to cache
            // which are ALSO part of the input context for that request
            // Filter out subagent sessions as they have much shorter contexts and dilute metrics
            const contextFillExpr =
              sql<number>`(COALESCE(${schema.queries.inputTokens}, 0) + COALESCE(${schema.queries.cacheRead}, 0) + COALESCE(${schema.queries.cacheWrite}, 0))`.as(
                "context_fill"
              );

            let result;
            if (conditions.length === 0) {
              result = await db
                .select({
                  contextFill: contextFillExpr,
                  queryIndex: schema.queries.queryIndex,
                })
                .from(schema.queries)
                .innerJoin(
                  schema.sessions,
                  eq(schema.queries.sessionId, schema.sessions.sessionId)
                )
                .where(excludeSubagents)
                .orderBy(schema.queries.queryIndex);
            } else {
              result = await db
                .select({
                  contextFill: contextFillExpr,
                  queryIndex: schema.queries.queryIndex,
                })
                .from(schema.queries)
                .innerJoin(
                  schema.sessions,
                  eq(schema.queries.sessionId, schema.sessions.sessionId)
                )
                .where(and(excludeSubagents, ...conditions))
                .orderBy(schema.queries.queryIndex);
            }

            // Group by queryIndex and calculate statistics
            const byIndex = new Map<number, number[]>();
            for (const row of result) {
              const tokens = row.contextFill ?? 0;
              const idx = row.queryIndex;
              if (!byIndex.has(idx)) {
                byIndex.set(idx, []);
              }
              byIndex.get(idx)!.push(tokens);
            }

            // Calculate aggregates for each query index
            const fillPoints: ContextWindowFillPoint[] = [];
            for (const [queryIndex, tokenValues] of [
              ...byIndex.entries(),
            ].toSorted((a, b) => a[0] - b[0])) {
              if (tokenValues.length === 0) {
                continue;
              }

              // Sort for percentile calculation
              const sorted = [...tokenValues].toSorted((a, b) => a - b);
              const len = sorted.length;

              const avgCumulativeTokens =
                tokenValues.reduce((a, b) => a + b, 0) / len;
              const maxCumulativeTokens = sorted[len - 1]!;
              const p25Tokens = sorted[Math.floor(len * 0.25)] ?? sorted[0]!;
              const p75Tokens =
                sorted[Math.floor(len * 0.75)] ?? sorted[len - 1]!;

              fillPoints.push({
                avgCumulativeTokens: Math.round(avgCumulativeTokens),
                maxCumulativeTokens,
                p25Tokens,
                p75Tokens,
                queryIndex,
                sessionCount: len,
              });
            }

            // Limit to first 100 turns for reasonable chart size
            return fillPoints.slice(0, 100);
          },
        }),
      } as const;
    }),
  }
) {}

/** @deprecated Use ContextAnalyticsService.Default instead */
export const ContextAnalyticsServiceLive = ContextAnalyticsService.Default;
