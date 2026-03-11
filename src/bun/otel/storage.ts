import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseService, dbQuery } from "../db";
import { otelSessions, otelMetrics, otelEvents } from "../db/schema-otel";
import type { NewOtelMetric, NewOtelEvent } from "../db/schema-otel";
import { DatabaseError, OtelStorageError } from "../errors";
import {
  getStringAttr,
  getNumberAttr,
  getBoolAttr,
  parseNanoTimestamp,
  CLAUDE_ATTRS,
} from "./types";
import type { OtlpMetricsRequest, OtlpLogsRequest } from "./types";
import type { HarnessId } from "../../shared/rpc-types";

// ─── Session Upsert ──────────────────────────────────────────────────────────

interface SessionInfo {
  sessionId: string;
  userAccountUuid: string | null;
  organizationId: string | null;
  userEmail: string | null;
  appVersion: string | null;
  terminalType: string | null;
  timestampMs: number;
  harness: HarnessId;
}

/**
 * Upsert a session, updating last_seen_at and incrementing event_count.
 */
const upsertSession = (info: SessionInfo) =>
  dbQuery("otel_upsert_session", async (db) => {
    const existing = await db
      .select()
      .from(otelSessions)
      .where(eq(otelSessions.sessionId, info.sessionId))
      .limit(1);

    if (existing.length > 0) {
      // Update last_seen_at and increment event_count
      await db
        .update(otelSessions)
        .set({
          lastSeenAt: Math.max(existing[0]!.lastSeenAt, info.timestampMs),
          eventCount: (existing[0]!.eventCount ?? 0) + 1,
        })
        .where(eq(otelSessions.sessionId, info.sessionId));
    } else {
      // Insert new session
      await db.insert(otelSessions).values({
        sessionId: info.sessionId,
        userAccountUuid: info.userAccountUuid,
        organizationId: info.organizationId,
        userEmail: info.userEmail,
        appVersion: info.appVersion,
        terminalType: info.terminalType,
        firstSeenAt: info.timestampMs,
        lastSeenAt: info.timestampMs,
        eventCount: 1,
        harness: info.harness,
      });
    }
  });

// ─── Metrics Storage ─────────────────────────────────────────────────────────

/**
 * Store metrics from an OTLP /v1/metrics request.
 * Uses batched operations to avoid N+1 query patterns.
 */
export const storeMetrics = (
  request: OtlpMetricsRequest
): Effect.Effect<
  { stored: number },
  OtelStorageError | DatabaseError,
  DatabaseService
> =>
  Effect.gen(function* () {
    const metricsToInsert: NewOtelMetric[] = [];
    const sessionsToUpsert = new Map<string, SessionInfo>();
    const sessionUpdates = new Map<
      string,
      {
        tokens: number;
        cost: number;
        linesAdded: number;
        linesRemoved: number;
        commits: number;
        prs: number;
      }
    >();

    // Collect phase - no DB calls
    for (const resourceMetrics of request.resourceMetrics) {
      const resourceAttrs = resourceMetrics.resource?.attributes ?? [];

      for (const scopeMetrics of resourceMetrics.scopeMetrics) {
        for (const metric of scopeMetrics.metrics) {
          const dataPoints =
            metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];

          for (const dp of dataPoints) {
            const allAttrs = [...resourceAttrs, ...(dp.attributes ?? [])];
            const sessionId = getStringAttr(allAttrs, CLAUDE_ATTRS.SESSION_ID);

            if (!sessionId) {
              continue;
            }

            const timestampMs = parseNanoTimestamp(dp.timeUnixNano);
            const value =
              dp.asDouble ?? (dp.asInt ? Number.parseInt(dp.asInt, 10) : 0);

            // Collect session info (latest timestamp wins)
            const existing = sessionsToUpsert.get(sessionId);
            if (!existing || existing.timestampMs < timestampMs) {
              sessionsToUpsert.set(sessionId, {
                sessionId,
                userAccountUuid: getStringAttr(
                  allAttrs,
                  CLAUDE_ATTRS.USER_ACCOUNT_UUID
                ),
                organizationId: getStringAttr(
                  allAttrs,
                  CLAUDE_ATTRS.ORGANIZATION_ID
                ),
                userEmail: getStringAttr(allAttrs, CLAUDE_ATTRS.USER_EMAIL),
                appVersion: getStringAttr(allAttrs, CLAUDE_ATTRS.APP_VERSION),
                terminalType: getStringAttr(
                  allAttrs,
                  CLAUDE_ATTRS.TERMINAL_TYPE
                ),
                timestampMs,
                harness: (getStringAttr(allAttrs, "harness") as HarnessId) ?? "claude-code",
              });
            }

            // Collect metric
            metricsToInsert.push({
              sessionId,
              timestampNs: Number(BigInt(dp.timeUnixNano)),
              metricName: metric.name,
              value,
              model: getStringAttr(allAttrs, CLAUDE_ATTRS.MODEL),
              tokenType:
                metric.name.includes("token") || metric.name.includes("cost")
                  ? getStringAttr(allAttrs, CLAUDE_ATTRS.TYPE)
                  : null,
              timeType: metric.name.includes("active_time")
                ? getStringAttr(allAttrs, CLAUDE_ATTRS.TYPE)
                : null,
              toolName: getStringAttr(allAttrs, CLAUDE_ATTRS.TOOL_NAME),
              decision: getStringAttr(allAttrs, CLAUDE_ATTRS.DECISION),
              decisionSource: getStringAttr(
                allAttrs,
                CLAUDE_ATTRS.DECISION_SOURCE
              ),
              language: getStringAttr(allAttrs, CLAUDE_ATTRS.LANGUAGE),
              locType: metric.name.includes("lines_of_code")
                ? getStringAttr(allAttrs, CLAUDE_ATTRS.TYPE)
                : null,
            });

            // Aggregate session metric updates
            const updates = sessionUpdates.get(sessionId) ?? {
              tokens: 0,
              cost: 0,
              linesAdded: 0,
              linesRemoved: 0,
              commits: 0,
              prs: 0,
            };

            if (metric.name === "claude_code.token.usage") {
              updates.tokens += value;
            } else if (metric.name === "claude_code.cost.usage") {
              updates.cost += value;
            } else if (metric.name === "claude_code.lines_of_code.count") {
              const locType = getStringAttr(allAttrs, CLAUDE_ATTRS.TYPE);
              if (locType === "added") {
                updates.linesAdded += value;
              } else if (locType === "removed") {
                updates.linesRemoved += value;
              }
            } else if (metric.name === "claude_code.commit.count") {
              updates.commits += value;
            } else if (metric.name === "claude_code.pull_request.count") {
              updates.prs += value;
            }

            sessionUpdates.set(sessionId, updates);
          }
        }
      }
    }

    // Batch upsert sessions
    for (const [, info] of sessionsToUpsert) {
      yield* upsertSession(info);
    }

    // Batch insert metrics (respect SQLite 999 param limit - ~12 columns per row = ~80 rows)
    const BATCH_SIZE = 80;
    for (let i = 0; i < metricsToInsert.length; i += BATCH_SIZE) {
      const batch = metricsToInsert.slice(i, i + BATCH_SIZE);
      yield* dbQuery("otel_batch_insert_metrics", (db) =>
        db.insert(otelMetrics).values(batch)
      );
    }

    // Batch update session totals (including productivity metrics)
    for (const [sessionId, updates] of sessionUpdates) {
      yield* dbQuery("otel_update_session_totals", async (db) => {
        const session = await db
          .select()
          .from(otelSessions)
          .where(eq(otelSessions.sessionId, sessionId))
          .limit(1);

        if (session[0]) {
          await db
            .update(otelSessions)
            .set({
              totalTokens: (session[0].totalTokens ?? 0) + updates.tokens,
              totalCostUsd: (session[0].totalCostUsd ?? 0) + updates.cost,
              linesAdded: (session[0].linesAdded ?? 0) + updates.linesAdded,
              linesRemoved:
                (session[0].linesRemoved ?? 0) + updates.linesRemoved,
              commitCount: (session[0].commitCount ?? 0) + updates.commits,
              prCount: (session[0].prCount ?? 0) + updates.prs,
            })
            .where(eq(otelSessions.sessionId, sessionId));
        }
      });
    }

    return { stored: metricsToInsert.length };
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.fail(
        new OtelStorageError({ operation: "storeMetrics", cause: defect })
      )
    )
  );

// ─── Logs/Events Storage ─────────────────────────────────────────────────────

/**
 * Store events from an OTLP /v1/logs request.
 * Claude Code sends events as log records with structured attributes.
 */
export const storeEvents = (
  request: OtlpLogsRequest
): Effect.Effect<
  { stored: number },
  OtelStorageError | DatabaseError,
  DatabaseService
> =>
  Effect.gen(function* () {
    let stored = 0;

    for (const resourceLogs of request.resourceLogs) {
      const resourceAttrs = resourceLogs.resource?.attributes ?? [];

      for (const scopeLogs of resourceLogs.scopeLogs) {
        for (const logRecord of scopeLogs.logRecords) {
          const allAttrs = [...resourceAttrs, ...(logRecord.attributes ?? [])];
          const sessionId = getStringAttr(allAttrs, CLAUDE_ATTRS.SESSION_ID);

          if (!sessionId) {
            continue;
          } // Skip logs without session

          const timestampNano =
            logRecord.timeUnixNano ?? logRecord.observedTimeUnixNano ?? "0";
          const timestampMs = parseNanoTimestamp(timestampNano);

          // Event name from body or severity
          const eventName =
            logRecord.body?.stringValue ?? logRecord.severityText ?? "unknown";

          // Upsert session
          yield* upsertSession({
            sessionId,
            userAccountUuid: getStringAttr(
              allAttrs,
              CLAUDE_ATTRS.USER_ACCOUNT_UUID
            ),
            organizationId: getStringAttr(
              allAttrs,
              CLAUDE_ATTRS.ORGANIZATION_ID
            ),
            userEmail: getStringAttr(allAttrs, CLAUDE_ATTRS.USER_EMAIL),
            appVersion: getStringAttr(allAttrs, CLAUDE_ATTRS.APP_VERSION),
            terminalType: getStringAttr(allAttrs, CLAUDE_ATTRS.TERMINAL_TYPE),
            timestampMs,
            harness: (getStringAttr(allAttrs, "harness") as HarnessId) ?? "claude-code",
          });

          // Build event row
          const eventRow: NewOtelEvent = {
            sessionId,
            timestampNs: Number(BigInt(timestampNano)),
            eventName,
            promptId: getStringAttr(allAttrs, CLAUDE_ATTRS.PROMPT_ID),
            // API fields
            model: getStringAttr(allAttrs, CLAUDE_ATTRS.MODEL),
            costUsd: getNumberAttr(allAttrs, CLAUDE_ATTRS.COST_USD),
            durationMs: getNumberAttr(allAttrs, CLAUDE_ATTRS.DURATION_MS),
            inputTokens: getNumberAttr(allAttrs, CLAUDE_ATTRS.INPUT_TOKENS),
            outputTokens: getNumberAttr(allAttrs, CLAUDE_ATTRS.OUTPUT_TOKENS),
            cacheReadTokens: getNumberAttr(
              allAttrs,
              CLAUDE_ATTRS.CACHE_READ_TOKENS
            ),
            cacheCreationTokens: getNumberAttr(
              allAttrs,
              CLAUDE_ATTRS.CACHE_CREATION_TOKENS
            ),
            speed: getStringAttr(allAttrs, CLAUDE_ATTRS.SPEED),
            errorMessage: getStringAttr(allAttrs, CLAUDE_ATTRS.ERROR),
            statusCode: getStringAttr(allAttrs, CLAUDE_ATTRS.STATUS_CODE),
            attempt: getNumberAttr(allAttrs, CLAUDE_ATTRS.ATTEMPT),
            // Tool fields
            toolName: getStringAttr(allAttrs, CLAUDE_ATTRS.TOOL_NAME),
            toolSuccess: getBoolAttr(allAttrs, CLAUDE_ATTRS.SUCCESS),
            toolDurationMs: getNumberAttr(allAttrs, CLAUDE_ATTRS.DURATION_MS),
            toolDecision: getStringAttr(allAttrs, CLAUDE_ATTRS.DECISION),
            toolDecisionSource: getStringAttr(
              allAttrs,
              CLAUDE_ATTRS.DECISION_SOURCE
            ),
            // Prompt fields
            promptLength: getNumberAttr(allAttrs, CLAUDE_ATTRS.PROMPT_LENGTH),
            promptContent: getStringAttr(allAttrs, CLAUDE_ATTRS.PROMPT),
          };

          yield* dbQuery("otel_insert_event", (db) =>
            db.insert(otelEvents).values(eventRow)
          );

          stored++;
        }
      }
    }

    return { stored };
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.fail(
        new OtelStorageError({ operation: "storeEvents", cause: defect })
      )
    )
  );
