import { sql, eq, and, count, avg } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import type { DateFilter } from "./shared";
import {
  buildDateConditions,
  sessionsTable,
  sessionJoinOn,
  withDateFilter,
} from "./shared";

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

              const result = await withDateFilter(
                conditions,
                () =>
                  db
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
                    .limit(100),
                () =>
                  db
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
                      sessionsTable,
                      sessionJoinOn(schema.contextWindowUsage)
                    )
                    .where(and(...conditions))
                    .groupBy(schema.contextWindowUsage.queryIndex)
                    .orderBy(schema.contextWindowUsage.queryIndex)
                    .limit(100)
              );

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

        getContextHeatmap: (
          dateFilter: DateFilter = {},
          projectPath?: string
        ) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getContextHeatmap",
              }),
            try: async () => {
              const conditions: SQL[] = [...buildDateConditions(dateFilter)];
              if (projectPath) {
                conditions.push(eq(schema.sessions.projectPath, projectPath));
              }

              // SQL-side bucketing for turn ranges and utilization ranges
              // This avoids loading all raw data into memory
              const turnBucketExpr = sql<string>`CASE
                WHEN ${schema.contextWindowUsage.queryIndex} <= 5 THEN '1-5'
                WHEN ${schema.contextWindowUsage.queryIndex} <= 10 THEN '6-10'
                WHEN ${schema.contextWindowUsage.queryIndex} <= 20 THEN '11-20'
                WHEN ${schema.contextWindowUsage.queryIndex} <= 50 THEN '21-50'
                ELSE '51+'
              END`;

              const utilizationBucketExpr = sql<string>`CASE
                WHEN COALESCE(${schema.contextWindowUsage.cacheHitRatio}, 0) * 100 <= 20 THEN '0-20%'
                WHEN COALESCE(${schema.contextWindowUsage.cacheHitRatio}, 0) * 100 <= 40 THEN '21-40%'
                WHEN COALESCE(${schema.contextWindowUsage.cacheHitRatio}, 0) * 100 <= 60 THEN '41-60%'
                WHEN COALESCE(${schema.contextWindowUsage.cacheHitRatio}, 0) * 100 <= 80 THEN '61-80%'
                ELSE '81-100%'
              END`;

              const result = await withDateFilter(
                conditions,
                () =>
                  db
                    .select({
                      count: count(),
                      turnRange: turnBucketExpr,
                      utilizationBucket: utilizationBucketExpr,
                    })
                    .from(schema.contextWindowUsage)
                    .groupBy(turnBucketExpr, utilizationBucketExpr),
                () =>
                  db
                    .select({
                      count: count(),
                      turnRange: turnBucketExpr,
                      utilizationBucket: utilizationBucketExpr,
                    })
                    .from(schema.contextWindowUsage)
                    .innerJoin(
                      sessionsTable,
                      sessionJoinOn(schema.contextWindowUsage)
                    )
                    .where(and(...conditions))
                    .groupBy(turnBucketExpr, utilizationBucketExpr)
              );

              // Build lookup map from SQL results
              const buckets = new Map<string, number>();
              for (const row of result) {
                const key = `${row.turnRange}:${row.utilizationBucket}`;
                buckets.set(key, row.count);
              }

              // Generate all possible combinations (frontend expects complete grid)
              const turnRanges = ["1-5", "6-10", "11-20", "21-50", "51+"];
              const utilizationRanges = [
                "0-20%",
                "21-40%",
                "41-60%",
                "61-80%",
                "81-100%",
              ];

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
              // Build WHERE clause for date/project filtering
              const dateConditions = buildDateConditions(dateFilter);
              const whereFragments: string[] = [
                "s.is_subagent = 0",
                "q.query_index <= 100",
              ];
              if (dateConditions.length > 0) {
                if (dateFilter.startTime) {
                  whereFragments.push(
                    `s.start_time >= ${dateFilter.startTime}`
                  );
                }
                if (dateFilter.endTime) {
                  whereFragments.push(`s.start_time <= ${dateFilter.endTime}`);
                }
              }
              if (projectPath) {
                whereFragments.push(
                  `s.project_path = '${projectPath.replaceAll("'", "''")}'`
                );
              }
              const whereClause = whereFragments.join(" AND ");

              // SQL-side aggregation with NTILE for approximate percentiles
              // This avoids loading all rows into memory
              // NTILE(4) divides values into 4 quartiles:
              // - quartile 1: lowest 25% (max = ~p25)
              // - quartile 3: 50-75% range (max = ~p75)
              const result = await db.all<{
                avgCumulativeTokens: number;
                maxCumulativeTokens: number;
                p25Tokens: number | null;
                p75Tokens: number | null;
                queryIndex: number;
                sessionCount: number;
              }>(sql`
                WITH ranked AS (
                  SELECT
                    q.query_index,
                    (COALESCE(q.input_tokens, 0) + COALESCE(q.cache_read, 0) + COALESCE(q.cache_write, 0)) as context_fill,
                    NTILE(4) OVER (
                      PARTITION BY q.query_index
                      ORDER BY (COALESCE(q.input_tokens, 0) + COALESCE(q.cache_read, 0) + COALESCE(q.cache_write, 0))
                    ) as quartile
                  FROM queries q
                  INNER JOIN sessions s ON q.session_id = s.session_id
                  WHERE ${sql.raw(whereClause)}
                )
                SELECT
                  query_index as "queryIndex",
                  CAST(ROUND(AVG(context_fill)) AS INTEGER) as "avgCumulativeTokens",
                  MAX(context_fill) as "maxCumulativeTokens",
                  COUNT(*) as "sessionCount",
                  MAX(CASE WHEN quartile = 1 THEN context_fill END) as "p25Tokens",
                  MAX(CASE WHEN quartile = 3 THEN context_fill END) as "p75Tokens"
                FROM ranked
                GROUP BY query_index
                ORDER BY query_index
                LIMIT 100
              `);

              return result.map((row) => ({
                avgCumulativeTokens: row.avgCumulativeTokens ?? 0,
                maxCumulativeTokens: row.maxCumulativeTokens ?? 0,
                p25Tokens: row.p25Tokens ?? row.avgCumulativeTokens ?? 0,
                p75Tokens: row.p75Tokens ?? row.maxCumulativeTokens ?? 0,
                queryIndex: row.queryIndex,
                sessionCount: row.sessionCount ?? 0,
              }));
            },
          }),
      } as const;
    }),
  }
) {}

