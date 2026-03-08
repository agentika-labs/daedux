import { Effect } from "effect";

import { DatabaseService } from "../db";
import { DatabaseError } from "../errors";
import { log } from "../utils/log";

// ─── Retention Cleanup ──────────────────────────────────────────────────────

export interface CleanupResult {
  deletedSessions: number;
  deletedMetrics: number;
  deletedEvents: number;
}

/**
 * Clean up OTEL data older than the specified retention period.
 * Deletes in order: events -> metrics -> sessions (foreign key constraints).
 * Uses raw SQL for change counts.
 */
export const cleanupOtelData = (
  retentionDays: number
): Effect.Effect<CleanupResult, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const { sqlite } = yield* DatabaseService;
    const cutoffMs = Date.now() - retentionDays * 86_400_000;
    const cutoffNs = BigInt(cutoffMs) * 1_000_000n;

    yield* Effect.sync(() =>
      log.debug(
        "otel",
        `Cleaning up OTEL data older than ${retentionDays} days (cutoff: ${new Date(cutoffMs).toISOString()})`
      )
    );

    // Delete old events first (child table)
    const eventsDeleted = yield* Effect.try({
      try: () => {
        sqlite.run("DELETE FROM otel_events WHERE timestamp_ns < ?", [
          Number(cutoffNs),
        ]);
        return sqlite.query("SELECT changes() as changes").get() as {
          changes: number;
        };
      },
      catch: (cause) =>
        new DatabaseError({ operation: "otel_cleanup_events", cause }),
    });

    // Delete old metrics (child table)
    const metricsDeleted = yield* Effect.try({
      try: () => {
        sqlite.run("DELETE FROM otel_metrics WHERE timestamp_ns < ?", [
          Number(cutoffNs),
        ]);
        return sqlite.query("SELECT changes() as changes").get() as {
          changes: number;
        };
      },
      catch: (cause) =>
        new DatabaseError({ operation: "otel_cleanup_metrics", cause }),
    });

    // Delete orphaned sessions (sessions with no remaining metrics or events)
    const sessionsDeleted = yield* Effect.try({
      try: () => {
        sqlite.run(`
          DELETE FROM otel_sessions WHERE session_id NOT IN (
            SELECT DISTINCT session_id FROM otel_metrics
            UNION
            SELECT DISTINCT session_id FROM otel_events
          )
        `);
        return sqlite.query("SELECT changes() as changes").get() as {
          changes: number;
        };
      },
      catch: (cause) =>
        new DatabaseError({ operation: "otel_cleanup_sessions", cause }),
    });

    const result = {
      deletedSessions: sessionsDeleted?.changes ?? 0,
      deletedMetrics: metricsDeleted?.changes ?? 0,
      deletedEvents: eventsDeleted?.changes ?? 0,
    };

    yield* Effect.sync(() =>
      log.info(
        "otel",
        `Cleanup complete: ${result.deletedSessions} sessions, ${result.deletedMetrics} metrics, ${result.deletedEvents} events deleted`
      )
    );

    return result;
  });
