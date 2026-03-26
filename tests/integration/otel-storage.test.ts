import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { DatabaseService } from "../../src/bun/db";
import { otelSessions, otelEvents } from "../../src/bun/db/schema-otel";
import { storeMetrics, storeEvents } from "../../src/bun/otel/storage";
import { createTestDb } from "../helpers/test-db";

// ─── Test Helper ─────────────────────────────────────────────────────────────

const runWithDb = async <A, E>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness
  effect: Effect.Effect<A, E, any>
): Promise<A> => {
  const { db, sqlite, cleanup } = createTestDb();
  try {
    return await Effect.runPromise(
      Effect.provide(effect, Layer.succeed(DatabaseService, { db, sqlite }))
    );
  } finally {
    cleanup();
  }
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OTEL Storage", () => {
  describe("storeMetrics", () => {
    test("stores a metric and creates session", async () => {
      const payload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "session.id", value: { stringValue: "test-session-1" } },
                {
                  key: "user.account_uuid",
                  value: { stringValue: "user-123" },
                },
                { key: "app.version", value: { stringValue: "1.0.0" } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "claude_code.token.usage",
                    sum: {
                      dataPoints: [
                        {
                          timeUnixNano: "1709000000000000000",
                          asDouble: 1500,
                          attributes: [
                            { key: "type", value: { stringValue: "input" } },
                            {
                              key: "model",
                              value: { stringValue: "claude-3-opus" },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = await runWithDb(storeMetrics(payload));
      expect(result.stored).toBe(1);
    });

    test("skips metrics without session.id", async () => {
      const payload = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "claude_code.token.usage",
                    sum: {
                      dataPoints: [
                        {
                          timeUnixNano: "1709000000000000000",
                          asDouble: 1500,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = await runWithDb(storeMetrics(payload));
      expect(result.stored).toBe(0);
    });

    test("accumulates token totals in session", async () => {
      const makePayload = (tokens: number) => ({
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "session.id",
                  value: { stringValue: "accumulate-test" },
                },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "claude_code.token.usage",
                    sum: {
                      dataPoints: [
                        {
                          timeUnixNano: "1709000000000000000",
                          asDouble: tokens,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const { db, sqlite, cleanup } = createTestDb();
      const dbLayer = Layer.succeed(DatabaseService, { db, sqlite });

      try {
        // Store two metrics for the same session
        await Effect.runPromise(
          Effect.gen(function* () {
            yield* storeMetrics(makePayload(1000));
            yield* storeMetrics(makePayload(500));
          }).pipe(Effect.provide(dbLayer))
        );

        // Query sessions to verify totals
        const sessions = await db.select().from(otelSessions);
        expect(sessions).toHaveLength(1);
        expect(sessions[0]!.totalTokens).toBe(1500);
      } finally {
        cleanup();
      }
    });
  });

  describe("storeEvents", () => {
    test("stores an event and creates session", async () => {
      const payload = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                {
                  key: "session.id",
                  value: { stringValue: "event-session-1" },
                },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: "1709000000000000000",
                    body: { stringValue: "claude_code.api_request" },
                    attributes: [
                      { key: "model", value: { stringValue: "claude-3-opus" } },
                      { key: "cost_usd", value: { doubleValue: 0.05 } },
                      { key: "duration_ms", value: { intValue: "1200" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const { db, sqlite, cleanup } = createTestDb();
      const dbLayer = Layer.succeed(DatabaseService, { db, sqlite });

      try {
        const result = await Effect.runPromise(
          storeEvents(payload).pipe(Effect.provide(dbLayer))
        );

        expect(result.stored).toBe(1);

        const events = await db.select().from(otelEvents);
        expect(events).toHaveLength(1);
        expect(events[0]!.eventName).toBe("claude_code.api_request");
        expect(events[0]!.model).toBe("claude-3-opus");
        expect(events[0]!.costUsd).toBe(0.05);
        expect(events[0]!.durationMs).toBe(1200);
      } finally {
        cleanup();
      }
    });

    test("stores tool decision event", async () => {
      const payload = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: "session.id", value: { stringValue: "tool-session-1" } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: "1709000000000000000",
                    body: { stringValue: "claude_code.tool_decision" },
                    attributes: [
                      { key: "tool_name", value: { stringValue: "Edit" } },
                      { key: "decision", value: { stringValue: "accept" } },
                      { key: "source", value: { stringValue: "user" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const { db, sqlite, cleanup } = createTestDb();
      const dbLayer = Layer.succeed(DatabaseService, { db, sqlite });

      try {
        await Effect.runPromise(
          storeEvents(payload).pipe(Effect.provide(dbLayer))
        );

        const events = await db.select().from(otelEvents);
        expect(events[0]!.toolName).toBe("Edit");
        expect(events[0]!.toolDecision).toBe("accept");
        expect(events[0]!.toolDecisionSource).toBe("user");
      } finally {
        cleanup();
      }
    });
  });
});
