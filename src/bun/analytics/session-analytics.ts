import { Context, Effect, Layer } from "effect";
import { sql, desc, eq, and, gte, count } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { DatabaseService } from "../db";
import { DatabaseError } from "../errors";
import * as schema from "../db/schema";
import { type DateFilter, buildDateConditions } from "./shared";
import { cacheHitRatio, totalInputWithCache } from "../metrics";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Totals {
  readonly totalSessions: number;
  readonly totalSubagents: number;
  readonly totalQueries: number;
  readonly totalToolUses: number;
  readonly totalCost: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheRead: number;
  readonly totalCacheWrite: number;
}

export interface DailyStat {
  readonly date: string;
  readonly sessionCount: number;
  readonly queryCount: number;
  readonly totalCost: number;
  readonly totalTokens: number;
  // Token breakdown for daily usage chart
  readonly uncachedInput: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly output: number;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly projectPath: string;
  readonly displayName: string | null;
  readonly startTime: number;
  readonly durationMs: number | null;
  readonly totalCost: number | null;
  readonly queryCount: number | null;
  readonly toolUseCount: number | null;
  readonly turnCount: number | null;
  readonly isSubagent: boolean | null;
  // Token fields for per-session aggregation
  readonly totalInputTokens: number | null;
  readonly totalOutputTokens: number | null;
  readonly totalCacheRead: number | null;
  readonly totalCacheWrite: number | null;
  // Per-session cache savings (for filtered reaggregation)
  readonly savedByCaching: number | null;
  readonly compactions: number | null;
}

export interface ProjectSummary {
  readonly projectPath: string;
  readonly sessionCount: number;
  readonly totalCost: number;
  readonly totalQueries: number;
  readonly lastActivity: number;
  readonly cwd?: string;
}

export interface ExtendedTotals extends Totals {
  readonly totalTokens: number;
  readonly uncachedInput: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly output: number;
  readonly savedByCaching: number;
  readonly cacheEfficiencyRatio: number;
  readonly avgCostPerSession: number;
  readonly avgCostPerQuery: number;
  readonly avgSessionDurationMs: number;
  readonly dateRange: { from: string; to: string };
  readonly totalToolErrors: number;
  readonly toolErrorRate: number;
  readonly totalBashCommands: number;
  readonly totalFileOperations: number;
  readonly totalHookExecutions: number;
  readonly totalSkillInvocations: number;
  readonly totalAgentSpawns: number;
  readonly agentLeverageRatio: number;
}

/**
 * Unified dashboard statistics with consistent calculations.
 * All metrics are computed server-side to ensure consistency across the UI.
 */
export interface TopPrompt {
  readonly prompt: string;
  readonly date: string;
  readonly model: string;
  readonly totalTokens: number;
  readonly cost: number;
  readonly sessionId: string;
}

export interface DashboardStats {
  /** Session counts - consistent everywhere */
  readonly sessions: {
    readonly total: number; // All sessions (main + subagent)
    readonly main: number; // Main sessions only (displayed in table)
    readonly subagent: number; // Sessions that ARE subagents (isSubagent=true)
  };

  /** Agent metrics - clearly distinguished */
  readonly agents: {
    readonly subagentSessions: number; // Sessions where isSubagent=true
    readonly agentInvocations: number; // Rows in agent_spawns table (Task tool calls)
    readonly agentTokens: number; // Total tokens from subagent sessions
    readonly mainSessionTokens: number; // Total tokens from main sessions
  };

  /** Cache efficiency - single source of truth */
  readonly cache: {
    readonly totalInputTokens: number; // Total input tokens
    readonly cacheRead: number; // Tokens read from cache
    readonly cacheWrite: number; // Tokens written to cache
    readonly uncached: number; // Input tokens not from cache
    readonly hitRatio: number | null; // cacheRead / totalInputTokens (null if no data)
    readonly efficiencyPercent: number | null; // hitRatio * 100 (null if no data)
  };

  /** Context displacement metrics */
  readonly context: {
    readonly mainSessionTokens: number; // Tokens from main sessions
    readonly agentTokens: number; // Tokens from subagent sessions
    readonly leverageRatio: number | null; // agentTokens / total (null if no data)
    readonly hasAgentUsage: boolean; // true if any agent activity
  };

  /** Workflow efficiency scores */
  readonly workflow: {
    readonly overallScore: number; // 0-100 composite score
    readonly cacheEfficiency: number | null; // 0-100 based on cache hit rate
    readonly toolSuccess: number; // 0-100 based on tool success rate
    readonly sessionEfficiency: number | null; // 0-100 based on queries per session
  };
}

// ─── Service Interface ───────────────────────────────────────────────────────

export class SessionAnalyticsService extends Context.Tag(
  "SessionAnalyticsService",
)<
  SessionAnalyticsService,
  {
    readonly getTotals: (
      dateFilter?: DateFilter,
    ) => Effect.Effect<Totals, DatabaseError>;
    readonly getDailyStats: (
      days?: number,
      dateFilter?: DateFilter,
    ) => Effect.Effect<DailyStat[], DatabaseError>;
    readonly getSessionSummaries: (options?: {
      limit?: number;
      projectPath?: string;
      includeSubagents?: boolean;
      dateFilter?: DateFilter;
    }) => Effect.Effect<SessionSummary[], DatabaseError>;
    readonly getProjectSummaries: (
      dateFilter?: DateFilter,
    ) => Effect.Effect<ProjectSummary[], DatabaseError>;
    readonly getRecentSessions: (
      limit: number,
    ) => Effect.Effect<SessionSummary[], DatabaseError>;
    readonly getSessionPrimaryModels: (
      dateFilter?: DateFilter,
    ) => Effect.Effect<Map<string, string>, DatabaseError>;
    readonly getExtendedTotals: (
      dateFilter?: DateFilter,
    ) => Effect.Effect<ExtendedTotals, DatabaseError>;
    readonly getDashboardStats: (
      dateFilter?: DateFilter,
    ) => Effect.Effect<DashboardStats, DatabaseError>;
    readonly getTopPrompts: (
      limit: number,
      dateFilter?: DateFilter,
    ) => Effect.Effect<TopPrompt[], DatabaseError>;
    readonly getSessionAgentCounts: (
      dateFilter?: DateFilter,
    ) => Effect.Effect<Map<string, number>, DatabaseError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const SessionAnalyticsServiceLive = Layer.effect(
  SessionAnalyticsService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      getTotals: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let query = db
              .select({
                totalSessions: count(),
                totalSubagents:
                  sql<number>`SUM(CASE WHEN ${schema.sessions.isSubagent} = 1 THEN 1 ELSE 0 END)`.as(
                    "total_subagents",
                  ),
                totalQueries:
                  sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total_queries",
                  ),
                totalToolUses:
                  sql<number>`SUM(${schema.sessions.toolUseCount})`.as(
                    "total_tool_uses",
                  ),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost",
                ),
                totalInputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "total_input",
                  ),
                totalOutputTokens:
                  sql<number>`SUM(${schema.sessions.totalOutputTokens})`.as(
                    "total_output",
                  ),
                totalCacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "total_cache_read",
                  ),
                totalCacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "total_cache_write",
                  ),
              })
              .from(schema.sessions);

            if (dateConditions.length > 0) {
              query = query.where(and(...dateConditions)) as typeof query;
            }

            const result = await query;
            const row = result[0];
            return {
              totalSessions: row?.totalSessions ?? 0,
              totalSubagents: row?.totalSubagents ?? 0,
              totalQueries: row?.totalQueries ?? 0,
              totalToolUses: row?.totalToolUses ?? 0,
              totalCost: row?.totalCost ?? 0,
              totalInputTokens: row?.totalInputTokens ?? 0,
              totalOutputTokens: row?.totalOutputTokens ?? 0,
              totalCacheRead: row?.totalCacheRead ?? 0,
              totalCacheWrite: row?.totalCacheWrite ?? 0,
            };
          },
          catch: (error) =>
            new DatabaseError({ operation: "getTotals", cause: error }),
        }),

      getDailyStats: (days?: number, dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            // Use localtime to match user's calendar day
            const dateExpr = sql<string>`date(${schema.sessions.startTime} / 1000, 'unixepoch', 'localtime')`;

            let query = db
              .select({
                date: dateExpr.as("date"),
                sessionCount: count(),
                queryCount: sql<number>`SUM(${schema.sessions.queryCount})`.as(
                  "query_count",
                ),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost",
                ),
                totalTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens} + ${schema.sessions.totalOutputTokens})`.as(
                    "total_tokens",
                  ),
                // Token breakdown for daily usage chart
                uncachedInput:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "uncached_input",
                  ),
                cacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "cache_read",
                  ),
                cacheCreation:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "cache_creation",
                  ),
                output:
                  sql<number>`SUM(${schema.sessions.totalOutputTokens})`.as(
                    "output",
                  ),
              })
              .from(schema.sessions);

            const conditions: SQL[] = [...buildDateConditions(dateFilter)];
            if (days !== undefined) {
              const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
              conditions.push(gte(schema.sessions.startTime, cutoff));
            }

            if (conditions.length > 0) {
              query = query.where(and(...conditions)) as typeof query;
            }

            const result = await query
              .groupBy(
                sql`date(${schema.sessions.startTime} / 1000, 'unixepoch', 'localtime')`,
              )
              .orderBy(
                desc(
                  sql`date(${schema.sessions.startTime} / 1000, 'unixepoch', 'localtime')`,
                ),
              );

            return result.map((row) => ({
              date: row.date,
              sessionCount: row.sessionCount,
              queryCount: row.queryCount ?? 0,
              totalCost: row.totalCost ?? 0,
              totalTokens: row.totalTokens ?? 0,
              uncachedInput: row.uncachedInput ?? 0,
              cacheRead: row.cacheRead ?? 0,
              cacheCreation: row.cacheCreation ?? 0,
              output: row.output ?? 0,
            }));
          },
          catch: (error) =>
            new DatabaseError({ operation: "getDailyStats", cause: error }),
        }),

      getSessionSummaries: (options = {}) =>
        Effect.tryPromise({
          try: async () => {
            const {
              limit,
              projectPath,
              includeSubagents = true,
              dateFilter = {},
            } = options;

            let query = db
              .select({
                sessionId: schema.sessions.sessionId,
                projectPath: schema.sessions.projectPath,
                displayName: schema.sessions.displayName,
                startTime: schema.sessions.startTime,
                durationMs: schema.sessions.durationMs,
                totalCost: schema.sessions.totalCost,
                queryCount: schema.sessions.queryCount,
                toolUseCount: schema.sessions.toolUseCount,
                turnCount: schema.sessions.turnCount,
                isSubagent: schema.sessions.isSubagent,
                totalInputTokens: schema.sessions.totalInputTokens,
                totalOutputTokens: schema.sessions.totalOutputTokens,
                totalCacheRead: schema.sessions.totalCacheRead,
                totalCacheWrite: schema.sessions.totalCacheWrite,
                savedByCaching: schema.sessions.savedByCaching,
                compactions: schema.sessions.compactions,
              })
              .from(schema.sessions)
              .orderBy(desc(schema.sessions.startTime));

            if (limit !== undefined) {
              query = query.limit(limit) as typeof query;
            }

            const conditions: SQL[] = [...buildDateConditions(dateFilter)];
            if (projectPath) {
              conditions.push(eq(schema.sessions.projectPath, projectPath));
            }
            if (!includeSubagents) {
              conditions.push(eq(schema.sessions.isSubagent, false));
            }

            if (conditions.length > 0) {
              query = query.where(and(...conditions)) as typeof query;
            }

            return await query;
          },
          catch: (error) =>
            new DatabaseError({
              operation: "getSessionSummaries",
              cause: error,
            }),
        }),

      getProjectSummaries: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let query = db
              .select({
                projectPath: schema.sessions.projectPath,
                sessionCount: count(),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost",
                ),
                totalQueries:
                  sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total_queries",
                  ),
                lastActivity: sql<number>`MAX(${schema.sessions.startTime})`.as(
                  "last_activity",
                ),
                // Pick shortest cwd (project root) - MIN returns shortest path since subdirs are longer
                cwd: sql<string | null>`MIN(${schema.sessions.cwd})`.as("cwd"),
              })
              .from(schema.sessions);

            if (dateConditions.length > 0) {
              query = query.where(and(...dateConditions)) as typeof query;
            }

            const result = await query
              .groupBy(schema.sessions.projectPath)
              .orderBy(desc(sql`MAX(${schema.sessions.startTime})`));

            return result.map((row) => ({
              projectPath: row.projectPath,
              sessionCount: row.sessionCount,
              totalCost: row.totalCost ?? 0,
              totalQueries: row.totalQueries ?? 0,
              lastActivity: row.lastActivity ?? 0,
              cwd: row.cwd ?? undefined,
            }));
          },
          catch: (error) =>
            new DatabaseError({
              operation: "getProjectSummaries",
              cause: error,
            }),
        }),

      getRecentSessions: (limit: number) =>
        Effect.tryPromise({
          try: async () => {
            const result = await db
              .select({
                sessionId: schema.sessions.sessionId,
                projectPath: schema.sessions.projectPath,
                displayName: schema.sessions.displayName,
                startTime: schema.sessions.startTime,
                durationMs: schema.sessions.durationMs,
                totalCost: schema.sessions.totalCost,
                queryCount: schema.sessions.queryCount,
                toolUseCount: schema.sessions.toolUseCount,
                turnCount: schema.sessions.turnCount,
                isSubagent: schema.sessions.isSubagent,
                totalInputTokens: schema.sessions.totalInputTokens,
                totalOutputTokens: schema.sessions.totalOutputTokens,
                totalCacheRead: schema.sessions.totalCacheRead,
                totalCacheWrite: schema.sessions.totalCacheWrite,
                savedByCaching: schema.sessions.savedByCaching,
                compactions: schema.sessions.compactions,
              })
              .from(schema.sessions)
              .where(eq(schema.sessions.isSubagent, false))
              .orderBy(desc(schema.sessions.startTime))
              .limit(limit);

            return result;
          },
          catch: (error) =>
            new DatabaseError({ operation: "getRecentSessions", cause: error }),
        }),

      getSessionPrimaryModels: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);
            const modelNotNull = sql`${schema.queries.model} IS NOT NULL`;

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  sessionId: schema.queries.sessionId,
                  model: schema.queries.model,
                  count: count(),
                })
                .from(schema.queries)
                .where(modelNotNull)
                .groupBy(schema.queries.sessionId, schema.queries.model)
                .orderBy(schema.queries.sessionId, desc(count()));
            } else {
              result = await db
                .select({
                  sessionId: schema.queries.sessionId,
                  model: schema.queries.model,
                  count: count(),
                })
                .from(schema.queries)
                .innerJoin(
                  schema.sessions,
                  eq(schema.queries.sessionId, schema.sessions.sessionId),
                )
                .where(and(modelNotNull, ...dateConditions))
                .groupBy(schema.queries.sessionId, schema.queries.model)
                .orderBy(schema.queries.sessionId, desc(count()));
            }

            // For each session, pick the most-used model
            const sessionModels = new Map<string, string>();
            const sessionBestCount = new Map<string, number>();

            for (const row of result) {
              const currentBest = sessionBestCount.get(row.sessionId) ?? 0;
              if (row.count > currentBest) {
                sessionModels.set(row.sessionId, row.model!);
                sessionBestCount.set(row.sessionId, row.count);
              }
            }
            return sessionModels;
          },
          catch: (error) =>
            new DatabaseError({
              operation: "getSessionPrimaryModels",
              cause: error,
            }),
        }),

      getExtendedTotals: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            // Get base totals
            let baseQuery = db
              .select({
                totalSessions: count(),
                totalSubagents:
                  sql<number>`SUM(CASE WHEN ${schema.sessions.isSubagent} = 1 THEN 1 ELSE 0 END)`.as(
                    "total_subagents",
                  ),
                totalQueries:
                  sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total_queries",
                  ),
                totalToolUses:
                  sql<number>`SUM(${schema.sessions.toolUseCount})`.as(
                    "total_tool_uses",
                  ),
                totalCost: sql<number>`SUM(${schema.sessions.totalCost})`.as(
                  "total_cost",
                ),
                totalInputTokens:
                  sql<number>`SUM(${schema.sessions.totalInputTokens})`.as(
                    "total_input",
                  ),
                totalOutputTokens:
                  sql<number>`SUM(${schema.sessions.totalOutputTokens})`.as(
                    "total_output",
                  ),
                totalCacheRead:
                  sql<number>`SUM(${schema.sessions.totalCacheRead})`.as(
                    "total_cache_read",
                  ),
                totalCacheWrite:
                  sql<number>`SUM(${schema.sessions.totalCacheWrite})`.as(
                    "total_cache_write",
                  ),
                totalSavedByCaching:
                  sql<number>`SUM(COALESCE(${schema.sessions.savedByCaching}, 0))`.as(
                    "total_saved",
                  ),
                avgDuration: sql<number>`AVG(${schema.sessions.durationMs})`.as(
                  "avg_duration",
                ),
                minStartTime: sql<number>`MIN(${schema.sessions.startTime})`.as(
                  "min_start",
                ),
                maxStartTime: sql<number>`MAX(${schema.sessions.startTime})`.as(
                  "max_start",
                ),
              })
              .from(schema.sessions);

            if (dateConditions.length > 0) {
              baseQuery = baseQuery.where(
                and(...dateConditions),
              ) as typeof baseQuery;
            }

            const baseResult = await baseQuery;

            // Get tool errors count (join with sessions for date filter)
            let errorResult;
            if (dateConditions.length === 0) {
              errorResult = await db
                .select({
                  totalErrors:
                    sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                      "total_errors",
                    ),
                })
                .from(schema.toolUses);
            } else {
              errorResult = await db
                .select({
                  totalErrors:
                    sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                      "total_errors",
                    ),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId),
                )
                .where(and(...dateConditions));
            }

            // Get counts from extended tables (join with sessions for date filter)
            let bashCount, fileOpsCount, hookCount, skillCount, agentCount;
            if (dateConditions.length === 0) {
              [bashCount, fileOpsCount, hookCount, skillCount, agentCount] =
                await Promise.all([
                  db.select({ count: count() }).from(schema.bashCommands),
                  db.select({ count: count() }).from(schema.fileOperations),
                  db.select({ count: count() }).from(schema.hookEvents),
                  db.select({ count: count() }).from(schema.skillInvocations),
                  db.select({ count: count() }).from(schema.agentSpawns),
                ]);
            } else {
              [bashCount, fileOpsCount, hookCount, skillCount, agentCount] =
                await Promise.all([
                  db
                    .select({ count: count() })
                    .from(schema.bashCommands)
                    .innerJoin(
                      schema.sessions,
                      eq(
                        schema.bashCommands.sessionId,
                        schema.sessions.sessionId,
                      ),
                    )
                    .where(and(...dateConditions)),
                  db
                    .select({ count: count() })
                    .from(schema.fileOperations)
                    .innerJoin(
                      schema.sessions,
                      eq(
                        schema.fileOperations.sessionId,
                        schema.sessions.sessionId,
                      ),
                    )
                    .where(and(...dateConditions)),
                  db
                    .select({ count: count() })
                    .from(schema.hookEvents)
                    .innerJoin(
                      schema.sessions,
                      eq(
                        schema.hookEvents.sessionId,
                        schema.sessions.sessionId,
                      ),
                    )
                    .where(and(...dateConditions)),
                  db
                    .select({ count: count() })
                    .from(schema.skillInvocations)
                    .innerJoin(
                      schema.sessions,
                      eq(
                        schema.skillInvocations.sessionId,
                        schema.sessions.sessionId,
                      ),
                    )
                    .where(and(...dateConditions)),
                  db
                    .select({ count: count() })
                    .from(schema.agentSpawns)
                    .innerJoin(
                      schema.sessions,
                      eq(
                        schema.agentSpawns.sessionId,
                        schema.sessions.sessionId,
                      ),
                    )
                    .where(and(...dateConditions)),
                ]);
            }

            const base = baseResult[0]!;
            const errors = errorResult[0]!;

            const totalSessions = base.totalSessions ?? 0;
            const totalQueries = base.totalQueries ?? 0;
            const totalToolUses = base.totalToolUses ?? 0;
            const totalInputTokens = base.totalInputTokens ?? 0;
            const totalOutputTokens = base.totalOutputTokens ?? 0;
            const totalCacheRead = base.totalCacheRead ?? 0;
            const totalCacheWrite = base.totalCacheWrite ?? 0;
            const totalCost = base.totalCost ?? 0;
            const totalToolErrors = errors.totalErrors ?? 0;
            const totalAgentSpawns = agentCount[0]?.count ?? 0;

            const uncachedInput = totalInputTokens;
            const totalTokens = totalInputTokens + totalOutputTokens;

            const toDateStr = (ts: number) =>
              new Date(ts).toISOString().split("T")[0]!;

            return {
              totalSessions,
              totalSubagents: base.totalSubagents ?? 0,
              totalQueries,
              totalToolUses,
              totalCost,
              totalInputTokens,
              totalOutputTokens,
              totalCacheRead,
              totalCacheWrite,
              // Extended fields
              totalTokens,
              uncachedInput,
              cacheRead: totalCacheRead,
              cacheCreation: totalCacheWrite,
              output: totalOutputTokens,
              savedByCaching: base.totalSavedByCaching ?? 0,
              cacheEfficiencyRatio: cacheHitRatio({
                uncachedInput: totalInputTokens,
                cacheRead: totalCacheRead,
                cacheWrite: totalCacheWrite,
              }),
              avgCostPerSession:
                totalSessions > 0 ? totalCost / totalSessions : 0,
              avgCostPerQuery: totalQueries > 0 ? totalCost / totalQueries : 0,
              avgSessionDurationMs: base.avgDuration ?? 0,
              dateRange: {
                from: base.minStartTime
                  ? toDateStr(base.minStartTime)
                  : toDateStr(Date.now()),
                to: base.maxStartTime
                  ? toDateStr(base.maxStartTime)
                  : toDateStr(Date.now()),
              },
              totalToolErrors,
              toolErrorRate:
                totalToolUses > 0 ? totalToolErrors / totalToolUses : 0,
              totalBashCommands: bashCount[0]?.count ?? 0,
              totalFileOperations: fileOpsCount[0]?.count ?? 0,
              totalHookExecutions: hookCount[0]?.count ?? 0,
              totalSkillInvocations: skillCount[0]?.count ?? 0,
              totalAgentSpawns,
              agentLeverageRatio:
                totalSessions > 0 ? totalAgentSpawns / totalSessions : 0,
            };
          },
          catch: (error) =>
            new DatabaseError({ operation: "getExtendedTotals", cause: error }),
        }),

      getDashboardStats: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);
            const hasDateFilter = dateConditions.length > 0;

            // ─── Session Counts ─────────────────────────────────────────────
            let mainSessionsResult;
            let subagentSessionsResult;

            if (hasDateFilter) {
              mainSessionsResult = await db
                .select({ count: count() })
                .from(schema.sessions)
                .where(
                  and(eq(schema.sessions.isSubagent, false), ...dateConditions),
                );
              subagentSessionsResult = await db
                .select({ count: count() })
                .from(schema.sessions)
                .where(
                  and(eq(schema.sessions.isSubagent, true), ...dateConditions),
                );
            } else {
              mainSessionsResult = await db
                .select({ count: count() })
                .from(schema.sessions)
                .where(eq(schema.sessions.isSubagent, false));
              subagentSessionsResult = await db
                .select({ count: count() })
                .from(schema.sessions)
                .where(eq(schema.sessions.isSubagent, true));
            }

            const mainSessions = mainSessionsResult[0]?.count ?? 0;
            const subagentSessions = subagentSessionsResult[0]?.count ?? 0;
            const totalSessions = mainSessions + subagentSessions;

            // ─── Agent Invocations (Task tool calls) ────────────────────────
            let agentInvocationsResult;
            if (hasDateFilter) {
              agentInvocationsResult = await db
                .select({ count: count() })
                .from(schema.agentSpawns)
                .innerJoin(
                  schema.sessions,
                  eq(schema.agentSpawns.sessionId, schema.sessions.sessionId),
                )
                .where(and(...dateConditions));
            } else {
              agentInvocationsResult = await db
                .select({ count: count() })
                .from(schema.agentSpawns);
            }
            const agentInvocations = agentInvocationsResult[0]?.count ?? 0;

            // ─── Token Totals by Session Type ───────────────────────────────
            let mainTokensResult;
            let subagentTokensResult;

            if (hasDateFilter) {
              mainTokensResult = await db
                .select({
                  total:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalInputTokens}, 0) + COALESCE(${schema.sessions.totalOutputTokens}, 0))`.as(
                      "total",
                    ),
                })
                .from(schema.sessions)
                .where(
                  and(eq(schema.sessions.isSubagent, false), ...dateConditions),
                );
              subagentTokensResult = await db
                .select({
                  total:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalInputTokens}, 0) + COALESCE(${schema.sessions.totalOutputTokens}, 0))`.as(
                      "total",
                    ),
                })
                .from(schema.sessions)
                .where(
                  and(eq(schema.sessions.isSubagent, true), ...dateConditions),
                );
            } else {
              mainTokensResult = await db
                .select({
                  total:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalInputTokens}, 0) + COALESCE(${schema.sessions.totalOutputTokens}, 0))`.as(
                      "total",
                    ),
                })
                .from(schema.sessions)
                .where(eq(schema.sessions.isSubagent, false));
              subagentTokensResult = await db
                .select({
                  total:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalInputTokens}, 0) + COALESCE(${schema.sessions.totalOutputTokens}, 0))`.as(
                      "total",
                    ),
                })
                .from(schema.sessions)
                .where(eq(schema.sessions.isSubagent, true));
            }

            const mainSessionTokens = mainTokensResult[0]?.total ?? 0;
            const agentTokens = subagentTokensResult[0]?.total ?? 0;

            // ─── Cache Metrics (single source of truth) ─────────────────────
            let cacheResult;
            if (hasDateFilter) {
              cacheResult = await db
                .select({
                  totalInput:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalInputTokens}, 0))`.as(
                      "total_input",
                    ),
                  cacheRead:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalCacheRead}, 0))`.as(
                      "cache_read",
                    ),
                  cacheWrite:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalCacheWrite}, 0))`.as(
                      "cache_write",
                    ),
                })
                .from(schema.sessions)
                .where(and(...dateConditions));
            } else {
              cacheResult = await db
                .select({
                  totalInput:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalInputTokens}, 0))`.as(
                      "total_input",
                    ),
                  cacheRead:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalCacheRead}, 0))`.as(
                      "cache_read",
                    ),
                  cacheWrite:
                    sql<number>`SUM(COALESCE(${schema.sessions.totalCacheWrite}, 0))`.as(
                      "cache_write",
                    ),
                })
                .from(schema.sessions);
            }

            const totalInputTokens = cacheResult[0]?.totalInput ?? 0;
            const cacheRead = cacheResult[0]?.cacheRead ?? 0;
            const cacheWrite = cacheResult[0]?.cacheWrite ?? 0;
            const uncached = totalInputTokens;
            const inputWithCache = totalInputWithCache({
              uncachedInput: totalInputTokens,
              cacheRead,
              cacheWrite,
            });

            // Cache hit ratio: cacheRead / (uncached + cacheRead + cacheWrite)
            const hitRatio =
              inputWithCache > 0
                ? cacheHitRatio({
                    uncachedInput: totalInputTokens,
                    cacheRead,
                    cacheWrite,
                  })
                : null;
            const efficiencyPercent =
              hitRatio !== null ? Math.round(hitRatio * 100) : null;

            // ─── Context Displacement ───────────────────────────────────────
            const totalTokens = mainSessionTokens + agentTokens;
            const leverageRatio =
              totalTokens > 0 ? agentTokens / totalTokens : null;
            const hasAgentUsage = agentInvocations > 0 || subagentSessions > 0;

            // ─── Tool Success Rate ──────────────────────────────────────────
            let toolStatsResult;
            if (hasDateFilter) {
              toolStatsResult = await db
                .select({
                  total: count(),
                  errors:
                    sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                      "errors",
                    ),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId),
                )
                .where(and(...dateConditions));
            } else {
              toolStatsResult = await db
                .select({
                  total: count(),
                  errors:
                    sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                      "errors",
                    ),
                })
                .from(schema.toolUses);
            }

            const totalToolCalls = toolStatsResult[0]?.total ?? 0;
            const toolErrors = toolStatsResult[0]?.errors ?? 0;
            const toolSuccessRate =
              totalToolCalls > 0
                ? (1 - toolErrors / totalToolCalls) * 100
                : 100;

            // ─── Query Count for Session Efficiency ─────────────────────────
            let queryCountResult;
            if (hasDateFilter) {
              queryCountResult = await db
                .select({
                  total: sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total",
                  ),
                })
                .from(schema.sessions)
                .where(and(...dateConditions));
            } else {
              queryCountResult = await db
                .select({
                  total: sql<number>`SUM(${schema.sessions.queryCount})`.as(
                    "total",
                  ),
                })
                .from(schema.sessions);
            }

            const totalQueries = queryCountResult[0]?.total ?? 0;
            const avgQueriesPerSession =
              mainSessions > 0 ? totalQueries / mainSessions : null;

            // Session efficiency: fewer queries per session = more efficient
            // Target: 5-15 queries per session is ideal
            // Score 100 at 10 queries, 70 at 25 queries, 50 at 40+ queries
            const sessionEfficiency =
              avgQueriesPerSession !== null
                ? Math.max(
                    0,
                    Math.min(100, 100 - (avgQueriesPerSession - 10) * 2),
                  )
                : null;

            // ─── Workflow Overall Score ─────────────────────────────────────
            // Combine cache efficiency, tool success, and session efficiency
            const cacheScore = efficiencyPercent ?? 0;
            const overallScore = Math.round(
              cacheScore * 0.4 +
                toolSuccessRate * 0.4 +
                (sessionEfficiency ?? 50) * 0.2,
            );

            return {
              sessions: {
                total: totalSessions,
                main: mainSessions,
                subagent: subagentSessions,
              },
              agents: {
                subagentSessions,
                agentInvocations,
                agentTokens,
                mainSessionTokens,
              },
              cache: {
                totalInputTokens,
                cacheRead,
                cacheWrite,
                uncached,
                hitRatio,
                efficiencyPercent,
              },
              context: {
                mainSessionTokens,
                agentTokens,
                leverageRatio,
                hasAgentUsage,
              },
              workflow: {
                overallScore,
                cacheEfficiency: efficiencyPercent,
                toolSuccess: Math.round(toolSuccessRate),
                sessionEfficiency:
                  sessionEfficiency !== null
                    ? Math.round(sessionEfficiency)
                    : null,
              },
            };
          },
          catch: (error) =>
            new DatabaseError({ operation: "getDashboardStats", cause: error }),
        }),

      getTopPrompts: (limit: number, dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);
            // Filter out system-generated content that slipped through parse-time filters
            // (needed for historical data parsed before metadata checks were added)
            const baseConditions: SQL[] = [
              sql`${schema.queries.userMessagePreview} IS NOT NULL`,
              sql`${schema.queries.userMessagePreview} != ''`,
              // Exclude task-notification (not marked by isMeta flag)
              sql`${schema.queries.userMessagePreview} NOT LIKE '<task-notification>%'`,
              // Exclude other system tags for legacy data
              sql`${schema.queries.userMessagePreview} NOT LIKE '<system-reminder>%'`,
              // Exclude context compaction summaries for legacy data
              sql`${schema.queries.userMessagePreview} NOT LIKE 'This session is being continued%'`,
            ];

            // Aggregate costs across all API calls for each user prompt
            // A single user prompt can trigger multiple API calls (agentic turns, tool use, etc.)
            // Group by (sessionId, userMessagePreview) to capture the TOTAL cost of a user prompt
            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  prompt: schema.queries.userMessagePreview,
                  sessionId: schema.queries.sessionId,
                  totalCost: sql<number>`SUM(${schema.queries.cost})`.as(
                    "total_cost",
                  ),
                  totalTokens: sql<number>`SUM(
                    COALESCE(${schema.queries.inputTokens}, 0) +
                    COALESCE(${schema.queries.outputTokens}, 0) +
                    COALESCE(${schema.queries.cacheRead}, 0) +
                    COALESCE(${schema.queries.cacheWrite}, 0)
                  )`.as("total_tokens"),
                  queryCount: sql<number>`COUNT(*)`.as("query_count"),
                  timestamp: sql<number>`MAX(${schema.queries.timestamp})`.as(
                    "timestamp",
                  ),
                  model: sql<string>`MAX(${schema.queries.model})`.as("model"),
                })
                .from(schema.queries)
                .where(and(...baseConditions))
                .groupBy(
                  schema.queries.sessionId,
                  schema.queries.userMessagePreview,
                )
                .orderBy(sql`total_cost DESC`)
                .limit(limit);
            } else {
              result = await db
                .select({
                  prompt: schema.queries.userMessagePreview,
                  sessionId: schema.queries.sessionId,
                  totalCost: sql<number>`SUM(${schema.queries.cost})`.as(
                    "total_cost",
                  ),
                  totalTokens: sql<number>`SUM(
                    COALESCE(${schema.queries.inputTokens}, 0) +
                    COALESCE(${schema.queries.outputTokens}, 0) +
                    COALESCE(${schema.queries.cacheRead}, 0) +
                    COALESCE(${schema.queries.cacheWrite}, 0)
                  )`.as("total_tokens"),
                  queryCount: sql<number>`COUNT(*)`.as("query_count"),
                  timestamp: sql<number>`MAX(${schema.queries.timestamp})`.as(
                    "timestamp",
                  ),
                  model: sql<string>`MAX(${schema.queries.model})`.as("model"),
                })
                .from(schema.queries)
                .innerJoin(
                  schema.sessions,
                  eq(schema.queries.sessionId, schema.sessions.sessionId),
                )
                .where(and(...baseConditions, ...dateConditions))
                .groupBy(
                  schema.queries.sessionId,
                  schema.queries.userMessagePreview,
                )
                .orderBy(sql`total_cost DESC`)
                .limit(limit);
            }

            return result.map((row) => ({
              prompt: row.prompt ?? "",
              date: new Date(row.timestamp).toISOString().split("T")[0]!,
              model: row.model ?? "unknown",
              totalTokens: row.totalTokens ?? 0,
              cost: row.totalCost ?? 0,
              sessionId: row.sessionId,
              queryCount: row.queryCount ?? 1,
            }));
          },
          catch: (error) =>
            new DatabaseError({ operation: "getTopPrompts", cause: error }),
        }),

      getSessionAgentCounts: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  sessionId: schema.agentSpawns.sessionId,
                  count: count(),
                })
                .from(schema.agentSpawns)
                .groupBy(schema.agentSpawns.sessionId);
            } else {
              result = await db
                .select({
                  sessionId: schema.agentSpawns.sessionId,
                  count: count(),
                })
                .from(schema.agentSpawns)
                .innerJoin(
                  schema.sessions,
                  eq(schema.agentSpawns.sessionId, schema.sessions.sessionId),
                )
                .where(and(...dateConditions))
                .groupBy(schema.agentSpawns.sessionId);
            }

            const sessionAgentCounts = new Map<string, number>();
            for (const row of result) {
              sessionAgentCounts.set(row.sessionId, row.count);
            }
            return sessionAgentCounts;
          },
          catch: (error) =>
            new DatabaseError({
              operation: "getSessionAgentCounts",
              cause: error,
            }),
        }),
    };
  }),
);
