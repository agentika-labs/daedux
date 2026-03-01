import { sql, desc, eq, and, count, avg } from "drizzle-orm";
import { Effect } from "effect";
import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import type { DateFilter } from "./shared";
import { buildDateConditions } from "./shared";

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

/**
 * Metrics for skill impact comparison.
 */
export interface SkillImpactMetrics {
  readonly sessionCount: number;
  readonly avgToolErrorRate: number;
  readonly avgCompletionRate: number;
  readonly avgTurnCount: number;
  readonly avgCacheHitRatio: number;
}

/**
 * Comparison of sessions with vs without skill usage.
 */
export interface SkillImpactComparison {
  readonly withSkills: SkillImpactMetrics;
  readonly withoutSkills: SkillImpactMetrics;
  readonly impact: {
    readonly errorRateReduction: number;
    readonly completionImprovement: number;
    readonly turnsReduction: number;
    readonly cacheImprovement: number;
  };
}

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * AgentAnalyticsService provides agent and skill usage analytics.
 * Tracks agent spawns, skill ROI, hook stats, and automation metrics.
 */
export class AgentAnalyticsService extends Effect.Service<AgentAnalyticsService>()(
  "AgentAnalyticsService",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      return {
        getSkillROI: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getSkillROI" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              // Get skill invocation counts
              const result = await db
                .select({
                  invocations: count(),
                  skillName: schema.skillInvocations.skillName,
                  uniqueSessions:
                    sql<number>`COUNT(DISTINCT ${schema.skillInvocations.sessionId})`.as(
                      "unique_sessions",
                    ),
                })
                .from(schema.skillInvocations)
                .leftJoin(
                  schema.sessions,
                  eq(
                    schema.skillInvocations.sessionId,
                    schema.sessions.sessionId,
                  ),
                )
                .where(
                  dateConditions.length > 0
                    ? and(...dateConditions)
                    : undefined,
                )
                .groupBy(schema.skillInvocations.skillName)
                .orderBy(desc(count()));

              // FIX: Get actual Skill tool success rates from tool_uses table
              // This measures whether the Skill tool execution succeeded (not session completion)
              const skillToolErrorsResult =
                dateConditions.length === 0
                  ? await db
                      .select({
                        errorCalls:
                          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                            "error_calls",
                          ),
                        skillName: schema.skillInvocations.skillName,
                        totalSkillCalls: count(),
                      })
                      .from(schema.skillInvocations)
                      .innerJoin(
                        schema.toolUses,
                        and(
                          eq(
                            schema.skillInvocations.sessionId,
                            schema.toolUses.sessionId,
                          ),
                          eq(schema.toolUses.toolName, "Skill"),
                        ),
                      )
                      .groupBy(schema.skillInvocations.skillName)
                  : await db
                      .select({
                        errorCalls:
                          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                            "error_calls",
                          ),
                        skillName: schema.skillInvocations.skillName,
                        totalSkillCalls: count(),
                      })
                      .from(schema.skillInvocations)
                      .innerJoin(
                        schema.toolUses,
                        and(
                          eq(
                            schema.skillInvocations.sessionId,
                            schema.toolUses.sessionId,
                          ),
                          eq(schema.toolUses.toolName, "Skill"),
                        ),
                      )
                      .innerJoin(
                        schema.sessions,
                        eq(
                          schema.skillInvocations.sessionId,
                          schema.sessions.sessionId,
                        ),
                      )
                      .where(and(...dateConditions))
                      .groupBy(schema.skillInvocations.skillName);

              // Build error rate map: skillName -> successRate (0-1)
              const skillErrorMap = new Map<string, number>();
              for (const row of skillToolErrorsResult) {
                const successRate =
                  row.totalSkillCalls > 0
                    ? (row.totalSkillCalls - (row.errorCalls ?? 0)) /
                      row.totalSkillCalls
                    : 1; // Default to 100% if no data
                skillErrorMap.set(row.skillName, successRate);
              }

              // FIX: Get session tokens per distinct session using window function approach
              // This sums tokens only once per unique (skillName, sessionId) pair
              const tokenResult = await db
                .select({
                  sessionId: schema.skillInvocations.sessionId,
                  skillName: schema.skillInvocations.skillName,
                  totalCost: schema.sessions.totalCost,
                  totalInputTokens: schema.sessions.totalInputTokens,
                  totalOutputTokens: schema.sessions.totalOutputTokens,
                })
                .from(schema.skillInvocations)
                .leftJoin(
                  schema.sessions,
                  eq(
                    schema.skillInvocations.sessionId,
                    schema.sessions.sessionId,
                  ),
                )
                .where(
                  dateConditions.length > 0
                    ? and(...dateConditions)
                    : undefined,
                )
                .groupBy(
                  schema.skillInvocations.skillName,
                  schema.skillInvocations.sessionId,
                );

              // Aggregate tokens per skill from distinct sessions
              const tokenMap = new Map<
                string,
                {
                  totalInputTokens: number;
                  totalOutputTokens: number;
                  totalCost: number;
                }
              >();
              for (const row of tokenResult) {
                const existing = tokenMap.get(row.skillName) ?? {
                  totalCost: 0,
                  totalInputTokens: 0,
                  totalOutputTokens: 0,
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
                    toolCount:
                      sql<number>`COUNT(DISTINCT ${schema.toolUses.id})`.as(
                        "tool_count",
                      ),
                  })
                  .from(schema.skillInvocations)
                  .leftJoin(
                    schema.toolUses,
                    eq(
                      schema.skillInvocations.sessionId,
                      schema.toolUses.sessionId,
                    ),
                  )
                  .groupBy(schema.skillInvocations.skillName);
              } else {
                toolCountsResult = await db
                  .select({
                    skillName: schema.skillInvocations.skillName,
                    toolCount:
                      sql<number>`COUNT(DISTINCT ${schema.toolUses.id})`.as(
                        "tool_count",
                      ),
                  })
                  .from(schema.skillInvocations)
                  .leftJoin(
                    schema.toolUses,
                    eq(
                      schema.skillInvocations.sessionId,
                      schema.toolUses.sessionId,
                    ),
                  )
                  .innerJoin(
                    schema.sessions,
                    eq(
                      schema.skillInvocations.sessionId,
                      schema.sessions.sessionId,
                    ),
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
                  totalCost: 0,
                  totalInputTokens: 0,
                  totalOutputTokens: 0,
                };
                const totalTokens =
                  tokens.totalInputTokens + tokens.totalOutputTokens;
                const toolCount = toolCountMap.get(row.skillName) ?? 0;

                // Compute averages (avoid division by zero)
                const avgCostTokens =
                  invocationCount > 0
                    ? Math.round(totalTokens / invocationCount)
                    : 0;
                const avgToolsTriggered =
                  invocationCount > 0
                    ? Number((toolCount / invocationCount).toFixed(1))
                    : 0;
                // FIX: Use actual Skill tool success rate from tool_uses table
                // This measures whether the Skill tool execution succeeded (hasError = false)
                // Falls back to 1.0 if no Skill tool data found (conservative assumption)
                const completionRate = skillErrorMap.get(row.skillName) ?? 1;

                // Raw efficiency: actions * completion rate / token cost (higher is better)
                // Add 1 to denominator to avoid division by zero and reduce extreme values
                const rawEfficiency =
                  (avgToolsTriggered * completionRate) /
                  (avgCostTokens / 1000 + 1);

                return {
                  avgCostTokens,
                  avgToolsTriggered,
                  completionRate,
                  invocationCount,
                  rawEfficiency,
                  skillName: row.skillName,
                  totalCost: Number(tokens.totalCost.toFixed(2)),
                };
              });

              // Second pass: convert raw efficiency to percentile-based score (0-100)
              // Sort by raw efficiency descending to assign ranks
              const sortedByEfficiency = [...skillMetrics].toSorted(
                (a, b) => b.rawEfficiency - a.rawEfficiency,
              );
              const totalSkills = sortedByEfficiency.length;
              const efficiencyRankMap = new Map<string, number>();
              sortedByEfficiency.forEach((skill, index) => {
                // Percentile: (totalSkills - rank) / totalSkills * 100
                // Rank 0 (best) gets 100, rank (n-1) gets close to 0
                const percentile =
                  totalSkills > 1
                    ? Math.round(
                        ((totalSkills - 1 - index) / (totalSkills - 1)) * 100,
                      )
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
          }),

        getAgentStats: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getAgentStats" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    agentType: schema.agentSpawns.agentType,
                    sessions:
                      sql<number>`COUNT(DISTINCT ${schema.agentSpawns.sessionId})`.as(
                        "sessions",
                      ),
                    spawns: count(),
                  })
                  .from(schema.agentSpawns)
                  .groupBy(schema.agentSpawns.agentType)
                  .orderBy(desc(count()));
              } else {
                result = await db
                  .select({
                    agentType: schema.agentSpawns.agentType,
                    sessions:
                      sql<number>`COUNT(DISTINCT ${schema.agentSpawns.sessionId})`.as(
                        "sessions",
                      ),
                    spawns: count(),
                  })
                  .from(schema.agentSpawns)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.agentSpawns.sessionId, schema.sessions.sessionId),
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
          }),

        getAgentROI: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getAgentROI" }),
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
                        eq(
                          schema.agentSpawns.sessionId,
                          schema.sessions.sessionId,
                        ),
                      )
                      .where(and(...dateConditions));

              const spawnsByAgent = new Map<string, number>();
              const agentSessions = new Map<string, Set<string>>();

              for (const row of spawnRows) {
                spawnsByAgent.set(
                  row.agentType,
                  (spawnsByAgent.get(row.agentType) ?? 0) + 1,
                );
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
                        errors:
                          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                            "errors",
                          ),
                        sessionId: schema.toolUses.sessionId,
                        total: count(),
                      })
                      .from(schema.toolUses)
                      .groupBy(schema.toolUses.sessionId)
                  : await db
                      .select({
                        errors:
                          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                            "errors",
                          ),
                        sessionId: schema.toolUses.sessionId,
                        total: count(),
                      })
                      .from(schema.toolUses)
                      .innerJoin(
                        schema.sessions,
                        eq(
                          schema.toolUses.sessionId,
                          schema.sessions.sessionId,
                        ),
                      )
                      .where(and(...dateConditions))
                      .groupBy(schema.toolUses.sessionId);

              const toolStatsBySession = new Map<
                string,
                { total: number; errors: number }
              >();
              for (const row of toolStatsBySessionRows) {
                toolStatsBySession.set(row.sessionId, {
                  errors: row.errors ?? 0,
                  total: row.total,
                });
              }

              // Get total subagent cost for cost allocation (respect date filter)
              const subagentCostResult =
                dateConditions.length === 0
                  ? await db
                      .select({
                        totalCost:
                          sql<number>`COALESCE(SUM(${schema.sessions.totalCost}), 0)`.as(
                            "total_cost",
                          ),
                      })
                      .from(schema.sessions)
                      .where(eq(schema.sessions.isSubagent, true))
                  : await db
                      .select({
                        totalCost:
                          sql<number>`COALESCE(SUM(${schema.sessions.totalCost}), 0)`.as(
                            "total_cost",
                          ),
                      })
                      .from(schema.sessions)
                      .where(
                        and(
                          eq(schema.sessions.isSubagent, true),
                          ...dateConditions,
                        ),
                      );

              const totalSubagentCost = subagentCostResult[0]?.totalCost ?? 0;

              // Get total spawns for cost allocation
              const totalSpawns = [...spawnsByAgent.values()].reduce(
                (sum, c) => sum + c,
                0,
              );
              const avgCostPerSpawn =
                totalSpawns > 0 ? totalSubagentCost / totalSpawns : 0;

              // Calculate ROI metrics for each agent type
              const agents: AgentROI[] = [...spawnsByAgent.entries()]
                .map(([agentType, spawns]) => {
                  const sessionIds =
                    agentSessions.get(agentType) ?? new Set<string>();
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
                  const avgToolsPerSpawn =
                    spawns > 0 ? toolsTriggered / spawns : 0;
                  const successRate =
                    toolsTriggered > 0
                      ? Math.round(
                          ((toolsTriggered - errorCount) / toolsTriggered) *
                            100,
                        )
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
                    avgCostPerSpawn: Math.round(avgCostPerSpawn * 100) / 100,
                    avgToolsPerSpawn: Math.round(avgToolsPerSpawn * 10) / 10,
                    category,
                    roi: Math.round(roi * 100) / 100,
                    spawns,
                    successRate,
                    toolsTriggered,
                    totalCost: Math.round(totalCost * 100) / 100,
                  };
                })
                .toSorted((a, b) => b.spawns - a.spawns);

              // Generate summary and recommendations
              const highROIAgents = agents.filter(
                (a) => a.roi > 1 && a.spawns >= 3,
              );
              const underusedAgents = agents
                .filter((a) => a.roi > 2 && a.spawns < 10 && a.spawns >= 3)
                .map((a) => a.agentType);

              const mostUsed = agents[0]?.agentType ?? "none";
              const highestROI =
                [...agents].toSorted((a, b) => b.roi - a.roi)[0]?.agentType ??
                "none";

              // Generate actionable recommendations
              const recommendations: string[] = [];

              if (underusedAgents.length > 0) {
                const underusedAgent = agents.find(
                  (a) => a.agentType === underusedAgents[0],
                );
                if (underusedAgent) {
                  recommendations.push(
                    `Consider using ${underusedAgent.agentType} more often - it has ${underusedAgent.roi.toFixed(1)}x ROI but only ${underusedAgent.spawns} spawns.`,
                  );
                }
              }

              const lowSuccessAgents = agents.filter(
                (a) => a.successRate < 80 && a.spawns >= 5,
              );
              const firstLowSuccess = lowSuccessAgents[0];
              if (firstLowSuccess) {
                recommendations.push(
                  `${firstLowSuccess.agentType} has a ${firstLowSuccess.successRate}% success rate. Review its usage patterns.`,
                );
              }

              if (highROIAgents.length === 0 && agents.length > 0) {
                recommendations.push(
                  "No agents currently showing high ROI. Try using Explore or Plan agents for better tool efficiency.",
                );
              }

              const summary: AgentUsageSummary = {
                avgCostPerSpawn: Math.round(avgCostPerSpawn * 100) / 100,
                highestROIAgent: highestROI,
                mostUsedAgent: mostUsed,
                recommendations,
                totalAgentCost: Math.round(totalSubagentCost * 100) / 100,
                totalSpawns,
                underusedAgents,
              };

              return { agents, summary };
            },
          }),

        // Agent spawn counts per session for client-side reaggregation
        getSessionAgentCounts: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getSessionAgentCounts",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    count: count(),
                    sessionId: schema.agentSpawns.sessionId,
                  })
                  .from(schema.agentSpawns)
                  .groupBy(schema.agentSpawns.sessionId);
              } else {
                result = await db
                  .select({
                    count: count(),
                    sessionId: schema.agentSpawns.sessionId,
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
          }),

        getHookStats: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getHookStats" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              const baseQuery = db
                .select({
                  avgDurationMs: avg(schema.hookEvents.durationMs),
                  failures:
                    sql<number>`SUM(CASE WHEN ${schema.hookEvents.exitCode} != 0 THEN 1 ELSE 0 END)`.as(
                      "failures",
                    ),
                  hookName: schema.hookEvents.hookName,
                  hookType: schema.hookEvents.hookType,
                  totalExecutions: count(),
                })
                .from(schema.hookEvents);

              const result =
                dateConditions.length === 0
                  ? await baseQuery
                      .groupBy(
                        schema.hookEvents.hookName,
                        schema.hookEvents.hookType,
                      )
                      .orderBy(desc(count()))
                  : await baseQuery
                      .innerJoin(
                        schema.sessions,
                        eq(
                          schema.hookEvents.sessionId,
                          schema.sessions.sessionId,
                        ),
                      )
                      .where(and(...dateConditions))
                      .groupBy(
                        schema.hookEvents.hookName,
                        schema.hookEvents.hookType,
                      )
                      .orderBy(desc(count()));

              return result.map((row) => ({
                avgDurationMs: Number(row.avgDurationMs) || 0,
                failures: row.failures ?? 0,
                hookName: row.hookName ?? "unknown",
                hookType: row.hookType,
                totalExecutions: row.totalExecutions,
              }));
            },
          }),

        getCommandStats: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getCommandStats" }),
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
                    eq(
                      schema.slashCommands.sessionId,
                      schema.sessions.sessionId,
                    ),
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
          }),

        getSkillImpactComparison: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getSkillImpactComparison",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              // Get all session IDs that used skills
              const skillSessionsResult =
                dateConditions.length === 0
                  ? await db
                      .selectDistinct({
                        sessionId: schema.skillInvocations.sessionId,
                      })
                      .from(schema.skillInvocations)
                  : await db
                      .selectDistinct({
                        sessionId: schema.skillInvocations.sessionId,
                      })
                      .from(schema.skillInvocations)
                      .innerJoin(
                        schema.sessions,
                        eq(
                          schema.skillInvocations.sessionId,
                          schema.sessions.sessionId,
                        ),
                      )
                      .where(and(...dateConditions));

              const skillSessionSet = new Set(
                skillSessionsResult.map((r) => r.sessionId),
              );

              if (skillSessionSet.size === 0) {
                return null; // No skill data to compare
              }

              // Get all sessions with their metrics
              const allSessions =
                dateConditions.length === 0
                  ? await db
                      .select({
                        endTime: schema.sessions.endTime,
                        sessionId: schema.sessions.sessionId,
                        toolUseCount: schema.sessions.toolUseCount,
                        totalCacheRead: schema.sessions.totalCacheRead,
                        totalCacheWrite: schema.sessions.totalCacheWrite,
                        totalInputTokens: schema.sessions.totalInputTokens,
                        turnCount: schema.sessions.turnCount,
                      })
                      .from(schema.sessions)
                      .where(eq(schema.sessions.isSubagent, false))
                  : await db
                      .select({
                        endTime: schema.sessions.endTime,
                        sessionId: schema.sessions.sessionId,
                        toolUseCount: schema.sessions.toolUseCount,
                        totalCacheRead: schema.sessions.totalCacheRead,
                        totalCacheWrite: schema.sessions.totalCacheWrite,
                        totalInputTokens: schema.sessions.totalInputTokens,
                        turnCount: schema.sessions.turnCount,
                      })
                      .from(schema.sessions)
                      .where(
                        and(
                          eq(schema.sessions.isSubagent, false),
                          ...dateConditions,
                        ),
                      );

              // Get tool errors per session
              const toolErrorsResult =
                dateConditions.length === 0
                  ? await db
                      .select({
                        errors:
                          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                            "errors",
                          ),
                        sessionId: schema.toolUses.sessionId,
                        total: count(),
                      })
                      .from(schema.toolUses)
                      .groupBy(schema.toolUses.sessionId)
                  : await db
                      .select({
                        errors:
                          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                            "errors",
                          ),
                        sessionId: schema.toolUses.sessionId,
                        total: count(),
                      })
                      .from(schema.toolUses)
                      .innerJoin(
                        schema.sessions,
                        eq(
                          schema.toolUses.sessionId,
                          schema.sessions.sessionId,
                        ),
                      )
                      .where(and(...dateConditions))
                      .groupBy(schema.toolUses.sessionId);

              const toolErrorMap = new Map(
                toolErrorsResult.map((r) => [
                  r.sessionId,
                  { errors: r.errors ?? 0, total: r.total },
                ]),
              );

              // Partition sessions
              const withSkills = allSessions.filter((s) =>
                skillSessionSet.has(s.sessionId),
              );
              const withoutSkills = allSessions.filter(
                (s) => !skillSessionSet.has(s.sessionId),
              );

              // Calculate metrics for each group
              const calcMetrics = (
                sessions: typeof allSessions,
              ): SkillImpactMetrics => {
                if (sessions.length === 0) {
                  return {
                    avgCacheHitRatio: 0,
                    avgCompletionRate: 0,
                    avgToolErrorRate: 0,
                    avgTurnCount: 0,
                    sessionCount: 0,
                  };
                }

                let totalErrorRate = 0;
                let totalCompletionRate = 0;
                let totalTurns = 0;
                let totalCacheRatio = 0;

                for (const session of sessions) {
                  // Tool error rate
                  const toolStats = toolErrorMap.get(session.sessionId);
                  if (toolStats && toolStats.total > 0) {
                    totalErrorRate += toolStats.errors / toolStats.total;
                  }

                  // Completion rate (has endTime = completed)
                  totalCompletionRate += session.endTime ? 1 : 0;

                  // Turn count
                  totalTurns += session.turnCount ?? 0;

                  // Cache hit ratio
                  const totalInput =
                    (session.totalInputTokens ?? 0) +
                    (session.totalCacheRead ?? 0) +
                    (session.totalCacheWrite ?? 0);
                  if (totalInput > 0) {
                    totalCacheRatio +=
                      (session.totalCacheRead ?? 0) / totalInput;
                  }
                }

                return {
                  avgCacheHitRatio: totalCacheRatio / sessions.length,
                  avgCompletionRate: totalCompletionRate / sessions.length,
                  avgToolErrorRate: totalErrorRate / sessions.length,
                  avgTurnCount: totalTurns / sessions.length,
                  sessionCount: sessions.length,
                };
              };

              const withSkillsMetrics = calcMetrics(withSkills);
              const withoutSkillsMetrics = calcMetrics(withoutSkills);

              // Calculate impact (positive = skills are better)
              const impact = {
                cacheImprovement:
                  withSkillsMetrics.avgCacheHitRatio -
                  withoutSkillsMetrics.avgCacheHitRatio,
                completionImprovement:
                  withSkillsMetrics.avgCompletionRate -
                  withoutSkillsMetrics.avgCompletionRate,
                errorRateReduction:
                  withoutSkillsMetrics.avgToolErrorRate -
                  withSkillsMetrics.avgToolErrorRate,
                turnsReduction:
                  withoutSkillsMetrics.avgTurnCount -
                  withSkillsMetrics.avgTurnCount,
              };

              return {
                impact,
                withSkills: withSkillsMetrics,
                withoutSkills: withoutSkillsMetrics,
              };
            },
          }),
      } as const;
    }),
  },
) {}

