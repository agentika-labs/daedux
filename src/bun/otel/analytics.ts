import { sql, gte, lte, and, count, avg, sum, max, desc } from "drizzle-orm";
import { Effect } from "effect";

import type {
  OtelStatus,
  OtelAnalytics,
  OtelToolDecision,
  OtelApiLatency,
  OtelDashboardData,
  OtelProductivityMetrics,
  OtelCostBreakdown,
  OtelToolSuccessRate,
  OtelSessionBuckets,
  OtelProblemPatterns,
  OtelRecentEvent,
} from "../../shared/rpc-types";
import { DatabaseService, dbQuery } from "../db";
import { otelSessions, otelMetrics, otelEvents } from "../db/schema-otel";
import { DatabaseError } from "../errors";

// ─── Date Filter ────────────────────────────────────────────────────────────

interface DateFilter {
  startTime?: number;
  endTime?: number;
}

const buildTimeFilter = (filter: DateFilter) => {
  const conditions = [];
  if (filter.startTime) {
    const startNs = BigInt(filter.startTime) * 1_000_000n;
    conditions.push(gte(otelMetrics.timestampNs, Number(startNs)));
  }
  if (filter.endTime) {
    const endNs = BigInt(filter.endTime) * 1_000_000n;
    conditions.push(lte(otelMetrics.timestampNs, Number(endNs)));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
};

const buildEventsTimeFilter = (filter: DateFilter) => {
  const conditions = [];
  if (filter.startTime) {
    const startNs = BigInt(filter.startTime) * 1_000_000n;
    conditions.push(gte(otelEvents.timestampNs, Number(startNs)));
  }
  if (filter.endTime) {
    const endNs = BigInt(filter.endTime) * 1_000_000n;
    conditions.push(lte(otelEvents.timestampNs, Number(endNs)));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
};

// ─── OTEL Status ────────────────────────────────────────────────────────────

/**
 * Get OTEL receiver status - session count, event count, last received.
 */
export const getOtelStatus = (): Effect.Effect<
  OtelStatus,
  DatabaseError,
  DatabaseService
> =>
  Effect.gen(function* () {
    const sessionsResult = yield* dbQuery("otel_status_sessions", (db) =>
      db.select({ count: count() }).from(otelSessions)
    );

    const eventsResult = yield* dbQuery("otel_status_events", (db) =>
      db.select({ count: count() }).from(otelEvents)
    );

    const metricsResult = yield* dbQuery("otel_status_metrics", (db) =>
      db.select({ count: count() }).from(otelMetrics)
    );

    const lastReceived = yield* dbQuery("otel_status_last_received", (db) =>
      db.select({ lastSeenAt: max(otelSessions.lastSeenAt) }).from(otelSessions)
    );

    return {
      sessionCount: sessionsResult[0]?.count ?? 0,
      eventCount: eventsResult[0]?.count ?? 0,
      metricCount: metricsResult[0]?.count ?? 0,
      lastReceivedAt: lastReceived[0]?.lastSeenAt ?? null,
    };
  });

// ─── OTEL Analytics ─────────────────────────────────────────────────────────

/**
 * Get OTEL analytics summary.
 */
export const getOtelAnalytics = (
  filter: DateFilter
): Effect.Effect<OtelAnalytics, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    // Session count from otel_sessions
    const sessionsResult = yield* dbQuery("otel_analytics_sessions", (db) =>
      db.select({ count: count() }).from(otelSessions)
    );

    // Active time breakdown from metrics
    const activeTimeResult = yield* dbQuery(
      "otel_analytics_active_time",
      (db) =>
        db
          .select({
            timeType: otelMetrics.timeType,
            total: sum(otelMetrics.value),
          })
          .from(otelMetrics)
          .where(
            and(
              sql`${otelMetrics.metricName} = 'claude_code.active_time.total'`,
              buildTimeFilter(filter)
            )
          )
          .groupBy(otelMetrics.timeType)
    );

    // API call stats from events
    const apiCallsResult = yield* dbQuery("otel_analytics_api_calls", (db) =>
      db
        .select({
          count: count(),
          avgLatency: avg(otelEvents.durationMs),
          retryCount: sql<number>`SUM(CASE WHEN ${otelEvents.attempt} > 1 THEN 1 ELSE 0 END)`,
        })
        .from(otelEvents)
        .where(
          and(
            sql`${otelEvents.eventName} = 'claude_code.api_request'`,
            buildEventsTimeFilter(filter)
          )
        )
    );

    // Tool decisions from metrics
    const decisionsResult = yield* dbQuery("otel_analytics_decisions", (db) =>
      db
        .select({
          decision: otelMetrics.decision,
          total: sum(otelMetrics.value),
        })
        .from(otelMetrics)
        .where(
          and(
            sql`${otelMetrics.metricName} = 'claude_code.code_edit_tool.decision'`,
            buildTimeFilter(filter)
          )
        )
        .groupBy(otelMetrics.decision)
    );

    // Parse active time
    let userTime = 0;
    let cliTime = 0;
    for (const row of activeTimeResult) {
      const total = Number(row.total ?? 0);
      if (row.timeType === "user") {
        userTime = total;
      } else if (row.timeType === "cli") {
        cliTime = total;
      }
    }

    // Parse decisions
    let totalAccepts = 0;
    let totalRejects = 0;
    for (const row of decisionsResult) {
      const total = Number(row.total ?? 0);
      if (row.decision === "accept") {
        totalAccepts = total;
      } else if (row.decision === "reject") {
        totalRejects = total;
      }
    }

    const apiStats = apiCallsResult[0];
    const totalApiCalls = apiStats?.count ?? 0;
    const retryCount = Number(apiStats?.retryCount ?? 0);

    return {
      sessionCount: sessionsResult[0]?.count ?? 0,
      totalActiveTime: userTime + cliTime,
      userTime,
      cliTime,
      totalApiCalls,
      avgLatencyMs: Number(apiStats?.avgLatency ?? 0),
      retryRate: totalApiCalls > 0 ? retryCount / totalApiCalls : 0,
      totalAccepts,
      totalRejects,
    };
  });

// ─── Tool Decisions ─────────────────────────────────────────────────────────

/**
 * Get tool decision breakdown by tool name.
 */
export const getToolDecisions = (
  filter: DateFilter
): Effect.Effect<OtelToolDecision[], DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const result = yield* dbQuery("otel_tool_decisions", (db) =>
      db
        .select({
          toolName: otelMetrics.toolName,
          decision: otelMetrics.decision,
          total: sum(otelMetrics.value),
        })
        .from(otelMetrics)
        .where(
          and(
            sql`${otelMetrics.metricName} = 'claude_code.code_edit_tool.decision'`,
            sql`${otelMetrics.toolName} IS NOT NULL`,
            buildTimeFilter(filter)
          )
        )
        .groupBy(otelMetrics.toolName, otelMetrics.decision)
    );

    // Group by tool name
    const toolMap = new Map<string, { accepts: number; rejects: number }>();
    for (const row of result) {
      const toolName = row.toolName ?? "unknown";
      const entry = toolMap.get(toolName) ?? { accepts: 0, rejects: 0 };
      const total = Number(row.total ?? 0);
      if (row.decision === "accept") {
        entry.accepts = total;
      } else if (row.decision === "reject") {
        entry.rejects = total;
      }
      toolMap.set(toolName, entry);
    }

    // Convert to array with accept rate
    return [...toolMap.entries()]
      .map(([toolName, { accepts, rejects }]) => ({
        toolName,
        accepts,
        rejects,
        acceptRate: accepts + rejects > 0 ? accepts / (accepts + rejects) : 0,
      }))
      .toSorted((a, b) => b.accepts + b.rejects - (a.accepts + a.rejects));
  });

// ─── API Latency ────────────────────────────────────────────────────────────

/**
 * Get API latency breakdown by model.
 */
export const getApiLatency = (
  filter: DateFilter
): Effect.Effect<OtelApiLatency[], DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const result = yield* dbQuery("otel_api_latency", (db) =>
      db
        .select({
          model: otelEvents.model,
          avgLatencyMs: avg(otelEvents.durationMs),
          requestCount: count(),
          retryCount: sql<number>`SUM(CASE WHEN ${otelEvents.attempt} > 1 THEN 1 ELSE 0 END)`,
          avgCostUsd: avg(otelEvents.costUsd),
        })
        .from(otelEvents)
        .where(
          and(
            sql`${otelEvents.eventName} = 'claude_code.api_request'`,
            sql`${otelEvents.model} IS NOT NULL`,
            buildEventsTimeFilter(filter)
          )
        )
        .groupBy(otelEvents.model)
        .orderBy(desc(count()))
    );

    return result.map((row) => ({
      model: row.model ?? "unknown",
      avgLatencyMs: Number(row.avgLatencyMs ?? 0),
      requestCount: row.requestCount,
      retryRate:
        row.requestCount > 0
          ? Number(row.retryCount ?? 0) / row.requestCount
          : 0,
      avgCostUsd: Number(row.avgCostUsd ?? 0),
    }));
  });

// ─── Productivity Metrics ────────────────────────────────────────────────────

/**
 * Get productivity metrics (LOC, commits, PRs).
 */
export const getProductivityMetrics = (
  filter: DateFilter
): Effect.Effect<OtelProductivityMetrics, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    // Get aggregated session productivity
    const sessionTotals = yield* dbQuery("otel_productivity_sessions", (db) =>
      db
        .select({
          linesAdded: sum(otelSessions.linesAdded),
          linesRemoved: sum(otelSessions.linesRemoved),
          commits: sum(otelSessions.commitCount),
          prs: sum(otelSessions.prCount),
          sessionCount: count(),
        })
        .from(otelSessions)
        .where(
          filter.startTime
            ? gte(otelSessions.firstSeenAt, filter.startTime)
            : undefined
        )
    );

    // Get breakdown by language from metrics
    const byLanguageResult = yield* dbQuery(
      "otel_productivity_by_language",
      (db) =>
        db
          .select({
            language: otelMetrics.language,
            locType: otelMetrics.locType,
            total: sum(otelMetrics.value),
          })
          .from(otelMetrics)
          .where(
            and(
              sql`${otelMetrics.metricName} = 'claude_code.lines_of_code.count'`,
              sql`${otelMetrics.language} IS NOT NULL`,
              buildTimeFilter(filter)
            )
          )
          .groupBy(otelMetrics.language, otelMetrics.locType)
    );

    // Group by language
    const languageMap = new Map<
      string,
      { linesAdded: number; linesRemoved: number }
    >();
    for (const row of byLanguageResult) {
      const lang = row.language ?? "unknown";
      const entry = languageMap.get(lang) ?? { linesAdded: 0, linesRemoved: 0 };
      const total = Number(row.total ?? 0);
      if (row.locType === "added") {
        entry.linesAdded = total;
      } else if (row.locType === "removed") {
        entry.linesRemoved = total;
      }
      languageMap.set(lang, entry);
    }

    const totals = sessionTotals[0];
    const totalLinesAdded = Number(totals?.linesAdded ?? 0);
    const totalLinesRemoved = Number(totals?.linesRemoved ?? 0);
    const sessionCount = totals?.sessionCount ?? 1;

    return {
      totalLinesAdded,
      totalLinesRemoved,
      totalCommits: Number(totals?.commits ?? 0),
      totalPRs: Number(totals?.prs ?? 0),
      linesPerSession:
        sessionCount > 0
          ? (totalLinesAdded + totalLinesRemoved) / sessionCount
          : 0,
      byLanguage: [...languageMap.entries()]
        .map(([language, { linesAdded, linesRemoved }]) => ({
          language,
          linesAdded,
          linesRemoved,
        }))
        .toSorted((a, b) => b.linesAdded - a.linesAdded),
    };
  });

// ─── Cost Breakdown ──────────────────────────────────────────────────────────

/**
 * Get cost breakdown by model with efficiency metrics.
 */
export const getCostBreakdown = (
  filter: DateFilter
): Effect.Effect<OtelCostBreakdown, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    // Get total cost and sessions
    const sessionCosts = yield* dbQuery("otel_cost_sessions", (db) =>
      db
        .select({
          totalCost: sum(otelSessions.totalCostUsd),
          totalTokens: sum(otelSessions.totalTokens),
          totalLinesAdded: sum(otelSessions.linesAdded),
          totalLinesRemoved: sum(otelSessions.linesRemoved),
          sessionCount: count(),
        })
        .from(otelSessions)
        .where(
          filter.startTime
            ? gte(otelSessions.firstSeenAt, filter.startTime)
            : undefined
        )
    );

    // Get cost by model
    const byModelResult = yield* dbQuery("otel_cost_by_model", (db) =>
      db
        .select({
          model: otelEvents.model,
          totalCost: sum(otelEvents.costUsd),
          totalTokens: sql<number>`SUM(${otelEvents.inputTokens} + ${otelEvents.outputTokens})`,
          requestCount: count(),
        })
        .from(otelEvents)
        .where(
          and(
            sql`${otelEvents.eventName} = 'claude_code.api_request'`,
            sql`${otelEvents.model} IS NOT NULL`,
            buildEventsTimeFilter(filter)
          )
        )
        .groupBy(otelEvents.model)
        .orderBy(desc(sum(otelEvents.costUsd)))
    );

    // Get cache efficiency from events
    const cacheStats = yield* dbQuery("otel_cost_cache", (db) =>
      db
        .select({
          cacheRead: sum(otelEvents.cacheReadTokens),
          cacheCreation: sum(otelEvents.cacheCreationTokens),
        })
        .from(otelEvents)
        .where(
          and(
            sql`${otelEvents.eventName} = 'claude_code.api_request'`,
            buildEventsTimeFilter(filter)
          )
        )
    );

    // Get active time for cost/hour calculation
    const activeTimeResult = yield* dbQuery("otel_cost_active_time", (db) =>
      db
        .select({
          total: sum(otelMetrics.value),
        })
        .from(otelMetrics)
        .where(
          and(
            sql`${otelMetrics.metricName} = 'claude_code.active_time.total'`,
            buildTimeFilter(filter)
          )
        )
    );

    const totals = sessionCosts[0];
    const totalCost = Number(totals?.totalCost ?? 0);
    const sessionCount = totals?.sessionCount ?? 1;
    const totalLoc =
      Number(totals?.totalLinesAdded ?? 0) +
      Number(totals?.totalLinesRemoved ?? 0);

    const cache = cacheStats[0];
    const cacheRead = Number(cache?.cacheRead ?? 0);
    const cacheCreation = Number(cache?.cacheCreation ?? 1); // avoid div/0

    const activeTimeSeconds = Number(activeTimeResult[0]?.total ?? 1);
    const activeTimeHours = activeTimeSeconds / 3600;

    return {
      totalCost,
      avgCostPerSession: sessionCount > 0 ? totalCost / sessionCount : 0,
      costPerLoc: totalLoc > 0 ? totalCost / totalLoc : 0,
      costPerHour: activeTimeHours > 0 ? totalCost / activeTimeHours : 0,
      cacheEfficiencyRatio: cacheRead / cacheCreation,
      byModel: byModelResult.map((row) => ({
        model: row.model ?? "unknown",
        cost: Number(row.totalCost ?? 0),
        tokens: Number(row.totalTokens ?? 0),
        requests: row.requestCount,
      })),
    };
  });

// ─── Tool Success Rates ──────────────────────────────────────────────────────

/**
 * Get tool success/failure rates from tool_result events.
 */
export const getToolSuccessRates = (
  filter: DateFilter
): Effect.Effect<OtelToolSuccessRate[], DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const result = yield* dbQuery("otel_tool_success", (db) =>
      db
        .select({
          toolName: otelEvents.toolName,
          totalCalls: count(),
          successCount: sql<number>`SUM(CASE WHEN ${otelEvents.toolSuccess} = 1 THEN 1 ELSE 0 END)`,
          failureCount: sql<number>`SUM(CASE WHEN ${otelEvents.toolSuccess} = 0 THEN 1 ELSE 0 END)`,
          avgDurationMs: avg(otelEvents.toolDurationMs),
        })
        .from(otelEvents)
        .where(
          and(
            sql`${otelEvents.eventName} = 'claude_code.tool_result'`,
            sql`${otelEvents.toolName} IS NOT NULL`,
            buildEventsTimeFilter(filter)
          )
        )
        .groupBy(otelEvents.toolName)
        .orderBy(desc(count()))
    );

    return result.map((row) => {
      const total = row.totalCalls;
      const success = Number(row.successCount ?? 0);
      return {
        toolName: row.toolName ?? "unknown",
        totalCalls: total,
        successCount: success,
        failureCount: Number(row.failureCount ?? 0),
        successRate: total > 0 ? success / total : 0,
        avgDurationMs: Number(row.avgDurationMs ?? 0),
      };
    });
  });

// ─── Session Duration Buckets ────────────────────────────────────────────────

/**
 * Get session duration distribution (quick/feature/deep).
 */
export const getSessionDurationBuckets = (
  filter: DateFilter
): Effect.Effect<OtelSessionBuckets, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const result = yield* dbQuery("otel_session_buckets", (db) =>
      db
        .select({
          quick: sql<number>`SUM(CASE WHEN (last_seen_at - first_seen_at) < 300000 THEN 1 ELSE 0 END)`,
          feature: sql<number>`SUM(CASE WHEN (last_seen_at - first_seen_at) >= 300000 AND (last_seen_at - first_seen_at) < 1800000 THEN 1 ELSE 0 END)`,
          deep: sql<number>`SUM(CASE WHEN (last_seen_at - first_seen_at) >= 1800000 THEN 1 ELSE 0 END)`,
          avgDurationMs: avg(sql<number>`last_seen_at - first_seen_at`),
        })
        .from(otelSessions)
        .where(
          filter.startTime
            ? gte(otelSessions.firstSeenAt, filter.startTime)
            : undefined
        )
    );

    const row = result[0];
    return {
      quick: Number(row?.quick ?? 0),
      feature: Number(row?.feature ?? 0),
      deep: Number(row?.deep ?? 0),
      avgDurationMs: Number(row?.avgDurationMs ?? 0),
    };
  });

// ─── Problem Patterns ────────────────────────────────────────────────────────

/**
 * Detect problem patterns from ROI guide.
 */
export const getProblemPatterns = (
  filter: DateFilter
): Effect.Effect<OtelProblemPatterns, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    // Long unproductive sessions (>30min with 0 commits)
    const longUnproductive = yield* dbQuery(
      "otel_problems_long_unproductive",
      (db) =>
        db
          .select({
            sessionId: otelSessions.sessionId,
            durationMs: sql<number>`last_seen_at - first_seen_at`,
            commits: otelSessions.commitCount,
            cost: otelSessions.totalCostUsd,
          })
          .from(otelSessions)
          .where(
            and(
              sql`(last_seen_at - first_seen_at) >= 1800000`,
              sql`commit_count = 0`,
              filter.startTime
                ? gte(otelSessions.firstSeenAt, filter.startTime)
                : undefined
            )
          )
          .orderBy(desc(sql`last_seen_at - first_seen_at`))
          .limit(5)
    );

    // High rejection tools (reject rate > 20%)
    const toolDecisions = yield* getToolDecisions(filter);
    const highRejectionTools = toolDecisions
      .filter((t) => t.acceptRate < 0.8 && t.accepts + t.rejects >= 5)
      .map((t) => ({
        toolName: t.toolName,
        rejectRate: 1 - t.acceptRate,
        total: t.accepts + t.rejects,
      }))
      .slice(0, 5);

    // API error patterns
    const apiErrors = yield* dbQuery("otel_problems_api_errors", (db) =>
      db
        .select({
          errorType: otelEvents.statusCode,
          model: otelEvents.model,
          count: count(),
        })
        .from(otelEvents)
        .where(
          and(
            sql`${otelEvents.eventName} = 'claude_code.api_error'`,
            sql`${otelEvents.statusCode} IS NOT NULL`,
            buildEventsTimeFilter(filter)
          )
        )
        .groupBy(otelEvents.statusCode, otelEvents.model)
        .orderBy(desc(count()))
        .limit(5)
    );

    return {
      longUnproductiveSessions: longUnproductive.map((row) => ({
        sessionId: row.sessionId,
        durationMs: Number(row.durationMs ?? 0),
        commits: row.commits ?? 0,
        cost: row.cost ?? 0,
      })),
      highRejectionTools,
      apiErrorPatterns: apiErrors.map((row) => ({
        errorType: row.errorType ?? "unknown",
        count: row.count,
        model: row.model ?? "unknown",
      })),
    };
  });

// ─── Recent Events ───────────────────────────────────────────────────────────

/**
 * Get recent OTEL events for the Events tab.
 */
export const getRecentEvents = (
  limit = 50
): Effect.Effect<OtelRecentEvent[], DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const result = yield* dbQuery("otel_recent_events", (db) =>
      db
        .select({
          id: otelEvents.id,
          timestampNs: otelEvents.timestampNs,
          eventName: otelEvents.eventName,
          model: otelEvents.model,
          toolName: otelEvents.toolName,
          costUsd: otelEvents.costUsd,
          durationMs: otelEvents.durationMs,
          toolSuccess: otelEvents.toolSuccess,
        })
        .from(otelEvents)
        .orderBy(desc(otelEvents.timestampNs))
        .limit(limit)
    );

    return result.map((row) => ({
      id: row.id,
      timestampMs: Math.floor(row.timestampNs / 1_000_000),
      eventName: row.eventName,
      model: row.model,
      toolName: row.toolName,
      costUsd: row.costUsd,
      durationMs: row.durationMs,
      success: row.toolSuccess,
    }));
  });

// ─── Combined Dashboard Data ────────────────────────────────────────────────

/**
 * Get all OTEL data for dashboard.
 */
export const getOtelDashboardData = (
  filter: DateFilter
): Effect.Effect<OtelDashboardData, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const [
      status,
      analytics,
      toolDecisions,
      apiLatency,
      productivity,
      costBreakdown,
      toolSuccessRates,
      sessionBuckets,
      problemPatterns,
      recentEvents,
    ] = yield* Effect.all([
      getOtelStatus(),
      getOtelAnalytics(filter),
      getToolDecisions(filter),
      getApiLatency(filter),
      getProductivityMetrics(filter),
      getCostBreakdown(filter),
      getToolSuccessRates(filter),
      getSessionDurationBuckets(filter),
      getProblemPatterns(filter),
      getRecentEvents(50),
    ]);

    return {
      analytics,
      toolDecisions,
      apiLatency,
      productivity,
      costBreakdown,
      toolSuccessRates,
      sessionBuckets,
      problemPatterns,
      recentEvents,
      hasData: status.sessionCount > 0 || status.eventCount > 0,
    };
  });
