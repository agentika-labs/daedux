import { Context, Effect, Layer } from "effect";
import { sql, desc, eq, and, count, avg } from "drizzle-orm";
import { DatabaseService } from "../db";
import { DatabaseError } from "../errors";
import * as schema from "../db/schema";
import { DateFilter, buildDateConditions } from "./shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillROI {
  readonly skillName: string;
  readonly invocationCount: number;
  readonly avgCostTokens: number;
  readonly avgToolsTriggered: number;
  readonly totalCost: number;
  readonly completionRate: number;
  readonly roiScore: number;
}

export interface AgentStat {
  readonly agentType: string;
  readonly invocationCount: number; // Dashboard-ready field name (was: spawns)
  readonly successCount: number; // Dashboard-ready (same as invocationCount - not tracked)
  readonly errorCount: number; // Dashboard-ready (0 for now - not tracked)
}

/**
 * Agent ROI metrics for story-driven analytics (Phase 2).
 * Measures value delivered vs cost for each agent type.
 */
export interface AgentROI {
  readonly agentType: string;
  readonly spawns: number;
  readonly totalCost: number;
  readonly avgCostPerSpawn: number;
  readonly toolsTriggered: number;
  readonly avgToolsPerSpawn: number;
  readonly successRate: number; // 0-100, based on tool error rate
  readonly roi: number; // tools per dollar spent (higher = better)
  readonly category: "high-value" | "low-value" | "experimental";
}

/**
 * Summary of agent usage patterns for recommendations.
 */
export interface AgentUsageSummary {
  readonly totalSpawns: number;
  readonly totalAgentCost: number;
  readonly avgCostPerSpawn: number;
  readonly mostUsedAgent: string;
  readonly highestROIAgent: string;
  readonly underusedAgents: string[]; // Agents with high ROI but low spawns
  readonly recommendations: string[];
}

export interface HookStat {
  readonly hookName: string;
  readonly hookType: string;
  readonly totalExecutions: number;
  readonly failures: number;
  readonly avgDurationMs: number;
}

export interface CommandStat {
  readonly command: string;
  readonly usageCount: number; // Dashboard-ready field name
  readonly avgSessionCost: number; // Not tracked yet
}

// ─── Service Interface ───────────────────────────────────────────────────────

export class AgentAnalyticsService extends Context.Tag("AgentAnalyticsService")<
  AgentAnalyticsService,
  {
    readonly getSkillROI: (
      dateFilter?: DateFilter
    ) => Effect.Effect<SkillROI[], DatabaseError>;
    readonly getAgentStats: (
      dateFilter?: DateFilter
    ) => Effect.Effect<AgentStat[], DatabaseError>;
    readonly getAgentROI: (
      dateFilter?: DateFilter
    ) => Effect.Effect<{ agents: AgentROI[]; summary: AgentUsageSummary }, DatabaseError>;
    readonly getSessionAgentCounts: (
      dateFilter?: DateFilter
    ) => Effect.Effect<Map<string, number>, DatabaseError>;
    readonly getHookStats: (
      dateFilter?: DateFilter
    ) => Effect.Effect<HookStat[], DatabaseError>;
    readonly getCommandStats: (
      dateFilter?: DateFilter
    ) => Effect.Effect<CommandStat[], DatabaseError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const AgentAnalyticsServiceLive = Layer.effect(
  AgentAnalyticsService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      getSkillROI: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            // FIX: Use COUNT(DISTINCT ...) for session-based metrics to avoid inflation
            // when a session has multiple invocations of the same skill.
            const result = await db
              .select({
                skillName: schema.skillInvocations.skillName,
                invocations: count(),
                uniqueSessions:
                  sql<number>`COUNT(DISTINCT ${schema.skillInvocations.sessionId})`.as(
                    "unique_sessions"
                  ),
                // FIX: Count distinct completed sessions, not sum per row
                completedSessions:
                  sql<number>`COUNT(DISTINCT CASE WHEN ${schema.sessions.endTime} IS NOT NULL THEN ${schema.skillInvocations.sessionId} END)`.as(
                    "completed_sessions"
                  ),
              })
              .from(schema.skillInvocations)
              .leftJoin(
                schema.sessions,
                eq(schema.skillInvocations.sessionId, schema.sessions.sessionId)
              )
              .where(dateConditions.length > 0 ? and(...dateConditions) : undefined)
              .groupBy(schema.skillInvocations.skillName)
              .orderBy(desc(count()));

            // FIX: Get session tokens per distinct session using window function approach
            // This sums tokens only once per unique (skillName, sessionId) pair
            const tokenResult = await db
              .select({
                skillName: schema.skillInvocations.skillName,
                sessionId: schema.skillInvocations.sessionId,
                totalInputTokens: schema.sessions.totalInputTokens,
                totalOutputTokens: schema.sessions.totalOutputTokens,
                totalCost: schema.sessions.totalCost,
              })
              .from(schema.skillInvocations)
              .leftJoin(
                schema.sessions,
                eq(schema.skillInvocations.sessionId, schema.sessions.sessionId)
              )
              .where(dateConditions.length > 0 ? and(...dateConditions) : undefined)
              .groupBy(
                schema.skillInvocations.skillName,
                schema.skillInvocations.sessionId
              );

            // Aggregate tokens per skill from distinct sessions
            const tokenMap = new Map<
              string,
              { totalInputTokens: number; totalOutputTokens: number; totalCost: number }
            >();
            for (const row of tokenResult) {
              const existing = tokenMap.get(row.skillName) ?? {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCost: 0,
              };
              existing.totalInputTokens += row.totalInputTokens ?? 0;
              existing.totalOutputTokens += row.totalOutputTokens ?? 0;
              existing.totalCost += row.totalCost ?? 0;
              tokenMap.set(row.skillName, existing);
            }

            // Get tool use counts per skill (separate query for cleaner SQL)
            let toolCountsResult;
            if (dateConditions.length === 0) {
              toolCountsResult = await db
                .select({
                  skillName: schema.skillInvocations.skillName,
                  toolCount: sql<number>`COUNT(DISTINCT ${schema.toolUses.id})`.as(
                    "tool_count"
                  ),
                })
                .from(schema.skillInvocations)
                .leftJoin(
                  schema.toolUses,
                  eq(schema.skillInvocations.sessionId, schema.toolUses.sessionId)
                )
                .groupBy(schema.skillInvocations.skillName);
            } else {
              toolCountsResult = await db
                .select({
                  skillName: schema.skillInvocations.skillName,
                  toolCount: sql<number>`COUNT(DISTINCT ${schema.toolUses.id})`.as(
                    "tool_count"
                  ),
                })
                .from(schema.skillInvocations)
                .leftJoin(
                  schema.toolUses,
                  eq(schema.skillInvocations.sessionId, schema.toolUses.sessionId)
                )
                .innerJoin(
                  schema.sessions,
                  eq(schema.skillInvocations.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.skillInvocations.skillName);
            }

            // Build a map for quick lookup
            const toolCountMap = new Map<string, number>();
            for (const row of toolCountsResult) {
              toolCountMap.set(row.skillName, row.toolCount ?? 0);
            }

            // First pass: compute raw efficiency values for all skills
            const skillMetrics = result.map((row) => {
              const invocationCount = row.invocations;
              const tokens = tokenMap.get(row.skillName) ?? {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCost: 0,
              };
              const totalTokens = tokens.totalInputTokens + tokens.totalOutputTokens;
              const toolCount = toolCountMap.get(row.skillName) ?? 0;

              // Compute averages (avoid division by zero)
              const avgCostTokens =
                invocationCount > 0 ? Math.round(totalTokens / invocationCount) : 0;
              const avgToolsTriggered =
                invocationCount > 0 ? Number((toolCount / invocationCount).toFixed(1)) : 0;
              // FIX: Now completedSessions is correctly distinct, so this rate is capped at 1.0
              const completionRate =
                row.uniqueSessions > 0
                  ? Math.min(
                      1,
                      Number(((row.completedSessions ?? 0) / row.uniqueSessions).toFixed(2))
                    )
                  : 0;

              // Raw efficiency: actions * completion rate / token cost (higher is better)
              // Add 1 to denominator to avoid division by zero and reduce extreme values
              const rawEfficiency =
                (avgToolsTriggered * completionRate) / (avgCostTokens / 1000 + 1);

              return {
                skillName: row.skillName,
                invocationCount,
                avgCostTokens,
                avgToolsTriggered,
                totalCost: Number(tokens.totalCost.toFixed(2)),
                completionRate,
                rawEfficiency,
              };
            });

            // Second pass: convert raw efficiency to percentile-based score (0-100)
            // Sort by raw efficiency descending to assign ranks
            const sortedByEfficiency = [...skillMetrics].sort(
              (a, b) => b.rawEfficiency - a.rawEfficiency
            );
            const totalSkills = sortedByEfficiency.length;
            const efficiencyRankMap = new Map<string, number>();
            sortedByEfficiency.forEach((skill, index) => {
              // Percentile: (totalSkills - rank) / totalSkills * 100
              // Rank 0 (best) gets 100, rank (n-1) gets close to 0
              const percentile =
                totalSkills > 1
                  ? Math.round(((totalSkills - 1 - index) / (totalSkills - 1)) * 100)
                  : 50; // Single skill gets 50
              efficiencyRankMap.set(skill.skillName, percentile);
            });

            // Return with percentile-based efficiency score (renamed from roiScore for API compatibility)
            return skillMetrics.map((skill) => ({
              skillName: skill.skillName,
              invocationCount: skill.invocationCount,
              avgCostTokens: skill.avgCostTokens,
              avgToolsTriggered: skill.avgToolsTriggered,
              totalCost: skill.totalCost,
              completionRate: skill.completionRate,
              // FIX: Now a 0-100 percentile score instead of unbounded ROI
              roiScore: efficiencyRankMap.get(skill.skillName) ?? 0,
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getSkillROI", cause: error }),
        }),

      getAgentStats: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  agentType: schema.agentSpawns.agentType,
                  spawns: count(),
                  sessions: sql<number>`COUNT(DISTINCT ${schema.agentSpawns.sessionId})`.as(
                    "sessions"
                  ),
                })
                .from(schema.agentSpawns)
                .groupBy(schema.agentSpawns.agentType)
                .orderBy(desc(count()));
            } else {
              result = await db
                .select({
                  agentType: schema.agentSpawns.agentType,
                  spawns: count(),
                  sessions: sql<number>`COUNT(DISTINCT ${schema.agentSpawns.sessionId})`.as(
                    "sessions"
                  ),
                })
                .from(schema.agentSpawns)
                .innerJoin(
                  schema.sessions,
                  eq(schema.agentSpawns.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.agentSpawns.agentType)
                .orderBy(desc(count()));
            }

            return result.map((row) => ({
              agentType: row.agentType,
              invocationCount: row.spawns, // Dashboard-ready field name
              successCount: row.spawns, // Assume all spawns successful (not tracked)
              errorCount: 0, // Not tracked in current schema
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getAgentStats", cause: error }),
        }),

      getAgentROI: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            // Count spawns directly from agent_spawns rows (no tool join).
            const spawnRows =
              dateConditions.length === 0
                ? await db
                    .select({
                      agentType: schema.agentSpawns.agentType,
                      sessionId: schema.agentSpawns.sessionId,
                    })
                    .from(schema.agentSpawns)
                : await db
                    .select({
                      agentType: schema.agentSpawns.agentType,
                      sessionId: schema.agentSpawns.sessionId,
                    })
                    .from(schema.agentSpawns)
                    .innerJoin(
                      schema.sessions,
                      eq(schema.agentSpawns.sessionId, schema.sessions.sessionId)
                    )
                    .where(and(...dateConditions));

            const spawnsByAgent = new Map<string, number>();
            const agentSessions = new Map<string, Set<string>>();

            for (const row of spawnRows) {
              spawnsByAgent.set(row.agentType, (spawnsByAgent.get(row.agentType) ?? 0) + 1);
              if (!agentSessions.has(row.agentType)) {
                agentSessions.set(row.agentType, new Set());
              }
              agentSessions.get(row.agentType)!.add(row.sessionId);
            }

            // Compute tool stats by session once, then attribute to agent types via unique sessions.
            const toolStatsBySessionRows =
              dateConditions.length === 0
                ? await db
                    .select({
                      sessionId: schema.toolUses.sessionId,
                      total: count(),
                      errors:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "errors"
                        ),
                    })
                    .from(schema.toolUses)
                    .groupBy(schema.toolUses.sessionId)
                : await db
                    .select({
                      sessionId: schema.toolUses.sessionId,
                      total: count(),
                      errors:
                        sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                          "errors"
                        ),
                    })
                    .from(schema.toolUses)
                    .innerJoin(
                      schema.sessions,
                      eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                    )
                    .where(and(...dateConditions))
                    .groupBy(schema.toolUses.sessionId);

            const toolStatsBySession = new Map<string, { total: number; errors: number }>();
            for (const row of toolStatsBySessionRows) {
              toolStatsBySession.set(row.sessionId, { total: row.total, errors: row.errors ?? 0 });
            }

            // Get total subagent cost for cost allocation (respect date filter)
            const subagentCostResult =
              dateConditions.length === 0
                ? await db
                    .select({
                      totalCost: sql<number>`COALESCE(SUM(${schema.sessions.totalCost}), 0)`.as(
                        "total_cost"
                      ),
                    })
                    .from(schema.sessions)
                    .where(eq(schema.sessions.isSubagent, true))
                : await db
                    .select({
                      totalCost: sql<number>`COALESCE(SUM(${schema.sessions.totalCost}), 0)`.as(
                        "total_cost"
                      ),
                    })
                    .from(schema.sessions)
                    .where(and(eq(schema.sessions.isSubagent, true), ...dateConditions));

            const totalSubagentCost = subagentCostResult[0]?.totalCost ?? 0;

            // Get total spawns for cost allocation
            const totalSpawns = Array.from(spawnsByAgent.values()).reduce(
              (sum, c) => sum + c,
              0
            );
            const avgCostPerSpawn = totalSpawns > 0 ? totalSubagentCost / totalSpawns : 0;

            // Calculate ROI metrics for each agent type
            const agents: AgentROI[] = Array.from(spawnsByAgent.entries())
              .map(([agentType, spawns]) => {
                const sessionIds = agentSessions.get(agentType) ?? new Set<string>();
                let toolsTriggered = 0;
                let errorCount = 0;

                for (const sessionId of sessionIds) {
                  const stats = toolStatsBySession.get(sessionId);
                  if (stats) {
                    toolsTriggered += stats.total;
                    errorCount += stats.errors;
                  }
                }

                // Estimate cost proportionally based on spawn count
                const totalCost = spawns * avgCostPerSpawn;
                const avgToolsPerSpawn = spawns > 0 ? toolsTriggered / spawns : 0;
                const successRate =
                  toolsTriggered > 0
                    ? Math.round(((toolsTriggered - errorCount) / toolsTriggered) * 100)
                    : 100;

                // ROI = tools triggered per dollar spent (higher = better value)
                const roi = totalCost > 0 ? toolsTriggered / totalCost : 0;

                // Categorize: high-value if ROI > median and spawns > 5
                // experimental if spawns < 3, otherwise low-value
                let category: "high-value" | "low-value" | "experimental";
                if (spawns < 3) {
                  category = "experimental";
                } else if (roi > 1 && successRate >= 80) {
                  category = "high-value";
                } else {
                  category = "low-value";
                }

                return {
                  agentType,
                  spawns,
                  totalCost: Math.round(totalCost * 100) / 100,
                  avgCostPerSpawn: Math.round(avgCostPerSpawn * 100) / 100,
                  toolsTriggered,
                  avgToolsPerSpawn: Math.round(avgToolsPerSpawn * 10) / 10,
                  successRate,
                  roi: Math.round(roi * 100) / 100,
                  category,
                };
              })
              .sort((a, b) => b.spawns - a.spawns);

            // Generate summary and recommendations
            const highROIAgents = agents.filter((a) => a.roi > 1 && a.spawns >= 3);
            const underusedAgents = agents
              .filter((a) => a.roi > 2 && a.spawns < 10 && a.spawns >= 3)
              .map((a) => a.agentType);

            const mostUsed = agents[0]?.agentType ?? "none";
            const highestROI = [...agents].sort((a, b) => b.roi - a.roi)[0]?.agentType ?? "none";

            // Generate actionable recommendations
            const recommendations: string[] = [];

            if (underusedAgents.length > 0) {
              const underusedAgent = agents.find((a) => a.agentType === underusedAgents[0]);
              if (underusedAgent) {
                recommendations.push(
                  `Consider using ${underusedAgent.agentType} more often - it has ${underusedAgent.roi.toFixed(1)}x ROI but only ${underusedAgent.spawns} spawns.`
                );
              }
            }

            const lowSuccessAgents = agents.filter((a) => a.successRate < 80 && a.spawns >= 5);
            const firstLowSuccess = lowSuccessAgents[0];
            if (firstLowSuccess) {
              recommendations.push(
                `${firstLowSuccess.agentType} has a ${firstLowSuccess.successRate}% success rate. Review its usage patterns.`
              );
            }

            if (highROIAgents.length === 0 && agents.length > 0) {
              recommendations.push(
                "No agents currently showing high ROI. Try using Explore or Plan agents for better tool efficiency."
              );
            }

            const summary: AgentUsageSummary = {
              totalSpawns,
              totalAgentCost: Math.round(totalSubagentCost * 100) / 100,
              avgCostPerSpawn: Math.round(avgCostPerSpawn * 100) / 100,
              mostUsedAgent: mostUsed,
              highestROIAgent: highestROI,
              underusedAgents,
              recommendations,
            };

            return { agents, summary };
          },
          catch: (error) => new DatabaseError({ operation: "getAgentROI", cause: error }),
        }),

      // Agent spawn counts per session for client-side reaggregation
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
                  eq(schema.agentSpawns.sessionId, schema.sessions.sessionId)
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
            new DatabaseError({ operation: "getSessionAgentCounts", cause: error }),
        }),

      getHookStats: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            const baseQuery = db
              .select({
                hookName: schema.hookEvents.hookName,
                hookType: schema.hookEvents.hookType,
                totalExecutions: count(),
                failures:
                  sql<number>`SUM(CASE WHEN ${schema.hookEvents.exitCode} != 0 THEN 1 ELSE 0 END)`.as(
                    "failures"
                  ),
                avgDurationMs: avg(schema.hookEvents.durationMs),
              })
              .from(schema.hookEvents);

            const result =
              dateConditions.length === 0
                ? await baseQuery
                    .groupBy(schema.hookEvents.hookName, schema.hookEvents.hookType)
                    .orderBy(desc(count()))
                : await baseQuery
                    .innerJoin(
                      schema.sessions,
                      eq(schema.hookEvents.sessionId, schema.sessions.sessionId)
                    )
                    .where(and(...dateConditions))
                    .groupBy(schema.hookEvents.hookName, schema.hookEvents.hookType)
                    .orderBy(desc(count()));

            return result.map((row) => ({
              hookName: row.hookName ?? "unknown",
              hookType: row.hookType,
              totalExecutions: row.totalExecutions,
              failures: row.failures ?? 0,
              avgDurationMs: Number(row.avgDurationMs) || 0,
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getHookStats", cause: error }),
        }),

      getCommandStats: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  command: schema.slashCommands.command,
                  count: count(),
                })
                .from(schema.slashCommands)
                .groupBy(schema.slashCommands.command)
                .orderBy(desc(count()));
            } else {
              result = await db
                .select({
                  command: schema.slashCommands.command,
                  count: count(),
                })
                .from(schema.slashCommands)
                .innerJoin(
                  schema.sessions,
                  eq(schema.slashCommands.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.slashCommands.command)
                .orderBy(desc(count()));
            }

            return result.map((row) => ({
              command: row.command,
              usageCount: row.count, // Dashboard-ready field name
              avgSessionCost: 0, // Not tracked yet
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getCommandStats", cause: error }),
        }),
    };
  })
);
