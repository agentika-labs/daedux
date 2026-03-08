import { sql, gte, lte, and, count, avg, sum, max, desc } from "drizzle-orm";
import { Effect } from "effect";

import type {
  OtelStatus,
  OtelAnalytics,
  OtelToolDecision,
  OtelApiLatency,
  OtelDashboardData,
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

// ─── Combined Dashboard Data ────────────────────────────────────────────────

/**
 * Get all OTEL data for dashboard.
 */
export const getOtelDashboardData = (
  filter: DateFilter
): Effect.Effect<OtelDashboardData, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const [status, analytics, toolDecisions, apiLatency] = yield* Effect.all([
      getOtelStatus(),
      getOtelAnalytics(filter),
      getToolDecisions(filter),
      getApiLatency(filter),
    ]);

    return {
      analytics,
      toolDecisions,
      apiLatency,
      hasData: status.sessionCount > 0 || status.eventCount > 0,
    };
  });
