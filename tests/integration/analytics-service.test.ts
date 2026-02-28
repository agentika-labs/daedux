/**
 * Integration tests for domain analytics services.
 * Tests the SQL queries against an in-memory SQLite database.
 */
import { describe, expect, it } from "bun:test";

import { Effect, Layer } from "effect";

import {
  AllAnalyticsServicesLive,
  SessionAnalyticsService,
  ModelAnalyticsService,
  ToolAnalyticsService,
  FileAnalyticsService,
  AgentAnalyticsService,
  ContextAnalyticsService,
  InsightsAnalyticsService,
} from "../../src/bun/analytics/index";
import { DatabaseService } from "../../src/bun/db";
import * as schema from "../../src/bun/db/schema";
import { createTestDb } from "../helpers/test-db";

// ─── Test Helpers ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runWithAnalytics = <A, E>(
  setup: (db: ReturnType<typeof createTestDb>["db"]) => Promise<void>,
  effect: Effect.Effect<A, E, any>
): Promise<A> => {
  const { db, sqlite } = createTestDb();
  const dbLayer = Layer.succeed(DatabaseService, { db, sqlite });
  const analyticsLayer = Layer.provide(AllAnalyticsServicesLive, dbLayer);

  return Effect.runPromise(
    Effect.gen(function* runWithAnalytics() {
      yield* Effect.promise(() => setup(db));
      return yield* Effect.provide(effect, analyticsLayer);
    })
  );
};

const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AnalyticsService", () => {
  describe("getTotals", () => {
    it("returns zeros for empty database", async () => {
      const result = await runWithAnalytics(
        async () => {},
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getTotals();
        })
      );

      expect(result.totalSessions).toBe(0);
      expect(result.totalQueries).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it("sums session totals correctly", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              projectPath: "/project",
              queryCount: 5,
              sessionId: "s1",
              startTime: now,
              toolUseCount: 10,
              totalCacheRead: 5000,
              totalCacheWrite: 1000,
              totalCost: 1.5,
              totalInputTokens: 10_000,
              totalOutputTokens: 2000,
            },
            {
              projectPath: "/project",
              queryCount: 3,
              sessionId: "s2",
              startTime: now,
              toolUseCount: 5,
              totalCacheRead: 2500,
              totalCacheWrite: 500,
              totalCost: 0.75,
              totalInputTokens: 5000,
              totalOutputTokens: 1000,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getTotals();
        })
      );

      expect(result.totalSessions).toBe(2);
      expect(result.totalQueries).toBe(8);
      expect(result.totalToolUses).toBe(15);
      expect(result.totalCost).toBeCloseTo(2.25, 2);
      expect(result.totalInputTokens).toBe(15_000);
      expect(result.totalOutputTokens).toBe(3000);
      expect(result.totalCacheRead).toBe(7500);
      expect(result.totalCacheWrite).toBe(1500);
    });

    it("counts subagents separately", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "parent",
              startTime: now,
            },
            {
              isSubagent: true,
              parentSessionId: "parent",
              projectPath: "/p",
              sessionId: "sub1",
              startTime: now,
            },
            {
              isSubagent: true,
              parentSessionId: "parent",
              projectPath: "/p",
              sessionId: "sub2",
              startTime: now,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getTotals();
        })
      );

      expect(result.totalSessions).toBe(3);
      expect(result.totalSubagents).toBe(2);
    });
  });

  describe("getDailyStats", () => {
    it("groups sessions by day", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              projectPath: "/p",
              queryCount: 5,
              sessionId: "s1",
              startTime: now,
              totalCost: 1,
            },
            {
              projectPath: "/p",
              queryCount: 3,
              sessionId: "s2",
              startTime: now,
              totalCost: 0.5,
            },
            {
              projectPath: "/p",
              queryCount: 2,
              sessionId: "s3",
              startTime: now - dayMs,
              totalCost: 0.25,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDailyStats();
        })
      );

      expect(result.length).toBe(2); // Two different days
    });

    it("filters by days parameter", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              projectPath: "/p",
              queryCount: 5,
              sessionId: "recent",
              startTime: now,
            },
            {
              projectPath: "/p",
              queryCount: 3,
              sessionId: "old",
              startTime: now - 10 * dayMs,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDailyStats(5); // Last 5 days
        })
      );

      expect(result.length).toBe(1); // Only recent session
    });
  });

  describe("getSessionSummaries", () => {
    it("returns sessions ordered by start time descending", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              displayName: "Old",
              projectPath: "/p",
              sessionId: "oldest",
              startTime: now - 2 * dayMs,
            },
            {
              displayName: "New",
              projectPath: "/p",
              sessionId: "newest",
              startTime: now,
            },
            {
              displayName: "Middle",
              projectPath: "/p",
              sessionId: "middle",
              startTime: now - dayMs,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getSessionSummaries();
        })
      );

      expect(result[0]!.sessionId).toBe("newest");
      expect(result[1]!.sessionId).toBe("middle");
      expect(result[2]!.sessionId).toBe("oldest");
    });

    it("filters by project path", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { projectPath: "/project-a", sessionId: "s1", startTime: now },
            { projectPath: "/project-b", sessionId: "s2", startTime: now },
            { projectPath: "/project-a", sessionId: "s3", startTime: now },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getSessionSummaries({
            projectPath: "/project-a",
          });
        })
      );

      expect(result).toHaveLength(2);
      expect(result.every((s) => s.projectPath === "/project-a")).toBe(true);
    });

    it("can exclude subagents", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "parent",
              startTime: now,
            },
            {
              isSubagent: true,
              projectPath: "/p",
              sessionId: "sub",
              startTime: now,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getSessionSummaries({
            includeSubagents: false,
          });
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe("parent");
    });
  });

  describe("getProjectSummaries", () => {
    it("groups sessions by project", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              projectPath: "/project-a",
              queryCount: 5,
              sessionId: "s1",
              startTime: now,
              totalCost: 1,
            },
            {
              projectPath: "/project-a",
              queryCount: 3,
              sessionId: "s2",
              startTime: now - dayMs,
              totalCost: 0.5,
            },
            {
              projectPath: "/project-b",
              queryCount: 10,
              sessionId: "s3",
              startTime: now,
              totalCost: 2,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getProjectSummaries();
        })
      );

      expect(result).toHaveLength(2);

      const projectA = result.find((p) => p.projectPath === "/project-a")!;
      expect(projectA.sessionCount).toBe(2);
      expect(projectA.totalCost).toBeCloseTo(1.5, 2);
      expect(projectA.totalQueries).toBe(8);
    });
  });

  describe("getModelBreakdown", () => {
    it("groups queries by model", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db.insert(schema.queries).values([
            {
              cost: 1,
              id: "s1:0",
              inputTokens: 1000,
              model: "claude-sonnet-4-5-20251022",
              outputTokens: 500,
              queryIndex: 0,
              sessionId: "s1",
              timestamp: now,
            },
            {
              cost: 0.5,
              id: "s1:1",
              inputTokens: 500,
              model: "claude-sonnet-4-5-20251022",
              outputTokens: 250,
              queryIndex: 1,
              sessionId: "s1",
              timestamp: now,
            },
            {
              cost: 2,
              id: "s1:2",
              inputTokens: 2000,
              model: "claude-opus-4-5-20251022",
              outputTokens: 1000,
              queryIndex: 2,
              sessionId: "s1",
              timestamp: now,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* ModelAnalyticsService;
          return yield* analytics.getModelBreakdown();
        })
      );

      expect(result.length).toBeGreaterThan(0);

      // Should have Sonnet and Opus
      const sonnet = result.find((m) => m.modelShort.includes("Sonnet"));
      const opus = result.find((m) => m.modelShort.includes("Opus"));

      expect(sonnet).toBeDefined();
      expect(opus).toBeDefined();

      expect(sonnet!.queries).toBe(2);
      expect(opus!.queries).toBe(1);
    });
  });

  describe("getToolUsage", () => {
    it("counts tool uses by name", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db
            .insert(schema.queries)
            .values([
              { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
            ]);
          await db.insert(schema.toolUses).values([
            { id: "t1", queryId: "s1:0", sessionId: "s1", toolName: "Read" },
            { id: "t2", queryId: "s1:0", sessionId: "s1", toolName: "Read" },
            { id: "t3", queryId: "s1:0", sessionId: "s1", toolName: "Edit" },
            { id: "t4", queryId: "s1:0", sessionId: "s1", toolName: "Bash" },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* ToolAnalyticsService;
          return yield* analytics.getToolUsage();
        })
      );

      const readStat = result.find((t) => t.name === "Read")!;
      expect(readStat.count).toBe(2);

      const editStat = result.find((t) => t.name === "Edit")!;
      expect(editStat.count).toBe(1);
    });
  });

  describe("getToolHealth", () => {
    it("calculates error rates per tool", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db
            .insert(schema.queries)
            .values([
              { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
            ]);
          await db.insert(schema.toolUses).values([
            {
              hasError: false,
              id: "t1",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
            {
              hasError: true,
              id: "t2",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
            {
              hasError: true,
              id: "t3",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
            {
              hasError: false,
              id: "t4",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Read",
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* ToolAnalyticsService;
          return yield* analytics.getToolHealth();
        })
      );

      const bashHealth = result.find((t) => t.name === "Bash")!;
      expect(bashHealth.totalCalls).toBe(3);
      expect(bashHealth.errors).toBe(2);
      expect(bashHealth.errorRate).toBeCloseTo(0.666, 2);

      const readHealth = result.find((t) => t.name === "Read")!;
      expect(readHealth.errorRate).toBe(0);
    });
  });

  describe("getBashCommandStats", () => {
    it("groups bash commands by category", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db.insert(schema.bashCommands).values([
            { category: "git", command: "git status", sessionId: "s1" },
            { category: "git", command: "git diff", sessionId: "s1" },
            {
              category: "package_manager",
              command: "bun test",
              sessionId: "s1",
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* ToolAnalyticsService;
          return yield* analytics.getBashCommandStats();
        })
      );

      const gitStats = result.find((c) => c.category === "git")!;
      expect(gitStats.count).toBe(2);
      expect(gitStats.topCommands).toContain("git status");

      const pkgStats = result.find((c) => c.category === "package_manager")!;
      expect(pkgStats.count).toBe(1);
    });
  });

  describe("getFileExtensions", () => {
    it("counts file operations by extension", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db.insert(schema.fileOperations).values([
            {
              fileExtension: "ts",
              filePath: "/src/index.ts",
              operation: "read",
              sessionId: "s1",
              timestamp: now,
            },
            {
              fileExtension: "ts",
              filePath: "/src/utils.ts",
              operation: "read",
              sessionId: "s1",
              timestamp: now,
            },
            {
              fileExtension: "json",
              filePath: "/package.json",
              operation: "edit",
              sessionId: "s1",
              timestamp: now,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* FileAnalyticsService;
          return yield* analytics.getFileExtensions();
        })
      );

      const tsStat = result.find((e) => e.extension === "ts")!;
      expect(tsStat.count).toBe(2);
      expect(tsStat.percentage).toBeCloseTo(66.67, 0);
    });
  });

  describe("getToolHealthReportCard", () => {
    it("uses Wilson scores to identify reliable tools with small samples", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db
            .insert(schema.queries)
            .values([
              { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
            ]);
          // Read: 15 calls, 0 errors - should be reliable with low confidence
          // Bash: 200 calls, 2 errors - should be reliable with high confidence
          // Edit: 5 calls, 2 errors - should be friction point with low confidence
          const toolUses: (typeof schema.toolUses.$inferInsert)[] = [];
          for (let i = 0; i < 15; i++) {
            toolUses.push({
              hasError: false,
              id: `read-${i}`,
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Read",
            });
          }
          for (let i = 0; i < 200; i++) {
            toolUses.push({
              hasError: i < 2,
              id: `bash-${i}`,
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            });
          }
          for (let i = 0; i < 5; i++) {
            toolUses.push({
              hasError: i < 2,
              id: `edit-${i}`,
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Edit",
            });
          }
          await db.insert(schema.toolUses).values(toolUses);
        },
        Effect.gen(function* result() {
          const analytics = yield* ToolAnalyticsService;
          return yield* analytics.getToolHealthReportCard();
        })
      );

      // All tools should be processed with Wilson scores
      expect(result.populationStats).toBeDefined();
      expect(result.populationStats!.totalTools).toBe(3);

      // Bash (200 calls, 1% error) should be in reliable tools with high confidence
      const bashReliable = result.reliableTools.find((t) => t.name === "Bash");
      expect(bashReliable).toBeDefined();
      expect(bashReliable!.confidence).toBe("high");
      expect(bashReliable!.reliabilityScore).toBeGreaterThan(95);

      // Read (15 calls, 0% error) - may or may not be in reliable depending on threshold
      // The important thing is that if present, it should have low confidence
      const readReliable = result.reliableTools.find((t) => t.name === "Read");
      if (readReliable) {
        expect(readReliable.confidence).toBe("low");
      }

      // Edit (5 calls, 40% error) should be in friction points
      const editFriction = result.frictionPoints.find((t) => t.name === "Edit");
      expect(editFriction).toBeDefined();
      expect(editFriction!.confidence).toBe("low");
      expect(editFriction!.frictionScore).toBeGreaterThan(30);
    });

    it("handles single-call tools correctly", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db
            .insert(schema.queries)
            .values([
              { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
            ]);
          // Single call with error should have high friction score (Wilson upper bound)
          await db.insert(schema.toolUses).values([
            {
              hasError: true,
              id: "t1",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "SingleError",
            },
            {
              hasError: false,
              id: "t2",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "SingleSuccess",
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* ToolAnalyticsService;
          return yield* analytics.getToolHealthReportCard();
        })
      );

      // Single error tool should have very high friction score (Wilson upper bound ~0.975)
      const singleError = result.frictionPoints.find(
        (t) => t.name === "SingleError"
      );
      // Only 1 call, so filtered out by minCallsForFriction (3)
      expect(singleError).toBeUndefined();

      // Population stats should be included
      expect(result.populationStats).toBeDefined();
      expect(result.populationStats!.totalTools).toBe(2);
    });

    it("provides percentile-based thresholds in populationStats", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db
            .insert(schema.queries)
            .values([
              { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
            ]);
          // Create 5 tools with varying error rates
          const toolUses: (typeof schema.toolUses.$inferInsert)[] = [];
          const tools = ["Read", "Write", "Edit", "Bash", "Glob"];
          for (const toolName of tools) {
            for (let i = 0; i < 50; i++) {
              toolUses.push({
                hasError: toolName === "Bash" && i < 25, // 50% error rate for Bash
                id: `${toolName}-${i}`,
                queryId: "s1:0",
                sessionId: "s1",
                toolName,
              });
            }
          }
          await db.insert(schema.toolUses).values(toolUses);
        },
        Effect.gen(function* result() {
          const analytics = yield* ToolAnalyticsService;
          return yield* analytics.getToolHealthReportCard();
        })
      );

      expect(result.populationStats).toBeDefined();
      expect(result.populationStats!.totalTools).toBe(5);
      expect(result.populationStats!.reliableThreshold).toBeGreaterThan(0);
      expect(result.populationStats!.frictionThreshold).toBeGreaterThan(0);

      // Bash should be in friction points due to high error rate
      const bashFriction = result.frictionPoints.find((t) => t.name === "Bash");
      expect(bashFriction).toBeDefined();
      expect(bashFriction!.errorRate).toBeCloseTo(0.5, 1);
    });
  });

  describe("getApiErrors", () => {
    it("counts errors by type", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db.insert(schema.apiErrors).values([
            {
              errorType: "rate_limit",
              sessionId: "s1",
              statusCode: 429,
              timestamp: now,
            },
            {
              errorType: "rate_limit",
              sessionId: "s1",
              statusCode: 429,
              timestamp: now - 1000,
            },
            {
              errorType: "server_error",
              sessionId: "s1",
              statusCode: 500,
              timestamp: now - 2000,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* ToolAnalyticsService;
          return yield* analytics.getApiErrors();
        })
      );

      const rateLimitStat = result.find((e) => e.errorType === "rate_limit")!;
      expect(rateLimitStat.count).toBe(2);

      const serverStat = result.find((e) => e.errorType === "server_error")!;
      expect(serverStat.count).toBe(1);
    });
  });

  describe("getAgentStats", () => {
    it("counts agent spawns by type", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db.insert(schema.agentSpawns).values([
            {
              agentType: "Explore",
              description: "Explore codebase",
              sessionId: "s1",
            },
            {
              agentType: "Explore",
              description: "More exploration",
              sessionId: "s1",
            },
            { agentType: "Bash", description: "Run tests", sessionId: "s1" },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* AgentAnalyticsService;
          return yield* analytics.getAgentStats();
        })
      );

      const exploreStat = result.find((a) => a.agentType === "Explore")!;
      expect(exploreStat.invocationCount).toBe(2);
    });
  });

  describe("getExtendedTotals", () => {
    it("calculates cache efficiency ratio", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              sessionId: "s1",
              projectPath: "/p",
              startTime: now,
              totalInputTokens: 10_000,
              totalOutputTokens: 2000,
              totalCacheRead: 8000, // 80% cache hit
              totalCacheWrite: 1000,
              savedByCaching: 5,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getExtendedTotals();
        })
      );

      expect(result.cacheEfficiencyRatio).toBeGreaterThan(0);
      expect(result.savedByCaching).toBe(5);
    });

    it("calculates averages correctly", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              durationMs: 60_000,
              projectPath: "/p",
              sessionId: "s1",
              startTime: now,
              totalCost: 1,
            },
            {
              durationMs: 120_000,
              projectPath: "/p",
              queryCount: 10,
              sessionId: "s2",
              startTime: now,
              totalCost: 2,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getExtendedTotals();
        })
      );

      expect(result.avgCostPerSession).toBeCloseTo(1.5, 2);
      expect(result.avgSessionDurationMs).toBeCloseTo(90_000, -1); // ~90 seconds
    });
  });

  describe("generateInsights", () => {
    it("generates cache efficiency insight for high cache usage", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              projectPath: "/p",
              sessionId: "s1",
              startTime: now,
              totalCacheRead: 50_000,
              totalInputTokens: 50_000, // 50% cache hit (cacheRead / (uncached + cacheRead))
            },
          ]);
        },
        Effect.gen(function* result() {
          const insights = yield* InsightsAnalyticsService;
          return yield* insights.generateInsights();
        })
      );

      const cacheInsight = result.find((i) => i.id === "cache-efficiency");
      expect(cacheInsight).toBeDefined();
      expect(cacheInsight!.type).toBe("success");
    });

    it("generates tool error warning for high error rate", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db
            .insert(schema.queries)
            .values([
              { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
            ]);
          // 50% error rate
          await db.insert(schema.toolUses).values([
            {
              hasError: true,
              id: "t1",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
            {
              hasError: true,
              id: "t2",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
            {
              hasError: false,
              id: "t3",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
            {
              hasError: false,
              id: "t4",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
          ]);
        },
        Effect.gen(function* result() {
          const insights = yield* InsightsAnalyticsService;
          return yield* insights.generateInsights();
        })
      );

      const errorInsight = result.find((i) => i.id === "high-tool-errors");
      expect(errorInsight).toBeDefined();
      expect(errorInsight!.type).toBe("warning");
    });
  });

  describe("getContextHeatmap", () => {
    it("buckets context window usage correctly", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db
            .insert(schema.sessions)
            .values([{ projectPath: "/p", sessionId: "s1", startTime: now }]);
          await db.insert(schema.contextWindowUsage).values([
            { cacheHitRatio: 0.1, queryIndex: 1, sessionId: "s1" }, // 1-5, 0-20%
            { cacheHitRatio: 0.5, queryIndex: 3, sessionId: "s1" }, // 1-5, 40-60%
            { cacheHitRatio: 0.9, queryIndex: 7, sessionId: "s1" }, // 6-10, 80-100%
          ]);
        },
        Effect.gen(function* result() {
          const context = yield* ContextAnalyticsService;
          return yield* context.getContextHeatmap();
        })
      );

      // Should have heatmap points
      expect(result.length).toBeGreaterThan(0);

      // Check specific buckets
      const lowEarlyBucket = result.find(
        (p) => p.turnRange === "1-5" && p.utilizationBucket === "0-20%"
      );
      expect(lowEarlyBucket).toBeDefined();
    });
  });

  describe("getCacheEfficiencyCurve", () => {
    it("returns average cache hit ratio per query index", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { projectPath: "/p", sessionId: "s1", startTime: now },
            { projectPath: "/p", sessionId: "s2", startTime: now },
          ]);
          await db.insert(schema.contextWindowUsage).values([
            { cacheHitRatio: 0, queryIndex: 0, sessionId: "s1" },
            { cacheHitRatio: 0, queryIndex: 0, sessionId: "s2" },
            { cacheHitRatio: 0.5, queryIndex: 1, sessionId: "s1" },
            { cacheHitRatio: 0.6, queryIndex: 1, sessionId: "s2" },
          ]);
        },
        Effect.gen(function* result() {
          const context = yield* ContextAnalyticsService;
          return yield* context.getCacheEfficiencyCurve();
        })
      );

      expect(result).toHaveLength(2);

      const query0 = result.find((p) => p.queryIndex === 0)!;
      expect(query0.avgCacheHitRatio).toBe(0);
      expect(query0.sessionCount).toBe(2);

      const query1 = result.find((p) => p.queryIndex === 1)!;
      expect(query1.avgCacheHitRatio).toBeCloseTo(0.55, 2);
    });
  });

  describe("getCompactionAnalysis", () => {
    it("counts sessions with compactions", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              compactions: 0,
              projectPath: "/p",
              sessionId: "s1",
              startTime: now,
            },
            {
              compactions: 2,
              projectPath: "/p",
              sessionId: "s2",
              startTime: now,
            },
            {
              compactions: 1,
              projectPath: "/p",
              sessionId: "s3",
              startTime: now,
            },
          ]);
        },
        Effect.gen(function* result() {
          const context = yield* ContextAnalyticsService;
          return yield* context.getCompactionAnalysis();
        })
      );

      expect(result.totalSessions).toBe(3);
      expect(result.sessionsWithCompactions).toBe(2);
      expect(result.avgCompactionsPerSession).toBe(1); // (0+2+1)/3 = 1
    });

    it("respects date filters", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              compactions: 2,
              projectPath: "/p",
              sessionId: "recent",
              startTime: now,
            },
            {
              compactions: 4,
              projectPath: "/p",
              sessionId: "old",
              startTime: now - 10 * dayMs,
            },
          ]);
        },
        Effect.gen(function* result() {
          const context = yield* ContextAnalyticsService;
          return yield* context.getCompactionAnalysis({
            endTime: now + 1000,
            startTime: now - 2 * dayMs,
          });
        })
      );

      expect(result.totalSessions).toBe(1);
      expect(result.sessionsWithCompactions).toBe(1);
      expect(result.avgCompactionsPerSession).toBe(2);
    });
  });

  describe("date filter support for lazy analytics", () => {
    it("filters top prompts by session date", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { projectPath: "/p", sessionId: "recent", startTime: now },
            {
              projectPath: "/p",
              sessionId: "old",
              startTime: now - 10 * dayMs,
            },
          ]);
          await db.insert(schema.queries).values([
            {
              cost: 1,
              id: "recent:0",
              queryIndex: 0,
              sessionId: "recent",
              timestamp: now,
              userMessagePreview: "recent prompt",
            },
            {
              cost: 2,
              id: "old:0",
              queryIndex: 0,
              sessionId: "old",
              timestamp: now - 10 * dayMs,
              userMessagePreview: "old prompt",
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getTopPrompts(10, {
            endTime: now + 1000,
            startTime: now - 2 * dayMs,
          });
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe("recent");
    });

    it("filters hook stats by session date", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { projectPath: "/p", sessionId: "recent", startTime: now },
            {
              projectPath: "/p",
              sessionId: "old",
              startTime: now - 10 * dayMs,
            },
          ]);
          await db.insert(schema.hookEvents).values([
            {
              exitCode: 0,
              hookName: "format",
              hookType: "PostToolUse",
              sessionId: "recent",
              timestamp: now,
            },
            {
              exitCode: 1,
              hookName: "format",
              hookType: "PostToolUse",
              sessionId: "old",
              timestamp: now - 10 * dayMs,
            },
          ]);
        },
        Effect.gen(function* result() {
          const agents = yield* AgentAnalyticsService;
          return yield* agents.getHookStats({
            endTime: now + 1000,
            startTime: now - 2 * dayMs,
          });
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.totalExecutions).toBe(1);
      expect(result[0]!.failures).toBe(0);
    });
  });

  describe("getDashboardStats", () => {
    it("returns correct session counts (main vs subagent)", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "main1",
              startTime: now,
            },
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "main2",
              startTime: now,
            },
            {
              isSubagent: true,
              projectPath: "/p",
              sessionId: "sub1",
              startTime: now,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDashboardStats();
        })
      );

      expect(result.sessions.total).toBe(3);
      expect(result.sessions.main).toBe(2);
      expect(result.sessions.subagent).toBe(1);
    });

    it("returns correct agent metrics", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          // Main sessions
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "main1",
              startTime: now,
              totalInputTokens: 1000,
              totalOutputTokens: 500,
            },
            {
              isSubagent: true,
              projectPath: "/p",
              sessionId: "sub1",
              startTime: now,
              totalInputTokens: 200,
              totalOutputTokens: 100,
            },
          ]);
          // Agent spawns (Task tool invocations)
          await db.insert(schema.agentSpawns).values([
            { agentType: "Explore", queryIndex: 0, sessionId: "main1" },
            { agentType: "Explore", queryIndex: 1, sessionId: "main1" },
            { agentType: "Plan", queryIndex: 2, sessionId: "main1" },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDashboardStats();
        })
      );

      expect(result.agents.subagentSessions).toBe(1);
      expect(result.agents.agentInvocations).toBe(3);
      expect(result.agents.mainSessionTokens).toBe(1500); // 1000 + 500
      expect(result.agents.agentTokens).toBe(300); // 200 + 100
    });

    it("calculates cache metrics consistently", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              projectPath: "/p",
              sessionId: "s1",
              startTime: now,
              totalCacheRead: 700,
              totalCacheWrite: 200,
              totalInputTokens: 1000,
            },
            {
              projectPath: "/p",
              sessionId: "s2",
              startTime: now,
              totalCacheRead: 300,
              totalCacheWrite: 100,
              totalInputTokens: 500,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDashboardStats();
        })
      );

      expect(result.cache.totalInputTokens).toBe(1500);
      expect(result.cache.cacheRead).toBe(1000);
      expect(result.cache.cacheWrite).toBe(300);
      expect(result.cache.uncached).toBe(1500); // total_input_tokens stores uncached input directly
      // hitRatio = cacheRead / (uncached + cacheRead + cacheWrite) = 1000/2800 = 0.357
      expect(result.cache.hitRatio).toBeCloseTo(0.357, 2);
      expect(result.cache.efficiencyPercent).toBe(36); // Math.round(0.357 * 100)
    });

    it("handles empty database with null values", async () => {
      const result = await runWithAnalytics(
        async () => {},
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDashboardStats();
        })
      );

      expect(result.sessions.total).toBe(0);
      expect(result.sessions.main).toBe(0);
      expect(result.sessions.subagent).toBe(0);
      expect(result.agents.agentInvocations).toBe(0);
      expect(result.cache.hitRatio).toBeNull();
      expect(result.cache.efficiencyPercent).toBeNull();
      expect(result.context.leverageRatio).toBeNull();
      expect(result.context.hasAgentUsage).toBe(false);
    });

    it("calculates context displacement metrics", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "main1",
              startTime: now,
              totalInputTokens: 800,
              totalOutputTokens: 200,
            },
            {
              isSubagent: true,
              projectPath: "/p",
              sessionId: "sub1",
              startTime: now,
              totalInputTokens: 160,
              totalOutputTokens: 40,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDashboardStats();
        })
      );

      expect(result.context.mainSessionTokens).toBe(1000); // 800 + 200
      expect(result.context.agentTokens).toBe(200); // 160 + 40
      // leverageRatio = agentTokens / (main + agent) = 200 / 1200 = 0.167
      expect(result.context.leverageRatio).toBeCloseTo(0.167, 2);
      expect(result.context.hasAgentUsage).toBe(true);
    });

    it("calculates workflow scores", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          // Sessions with some cache usage
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              queryCount: 10,
              sessionId: "s1",
              startTime: now,
              totalCacheRead: 500,
              totalInputTokens: 1000,
            },
          ]);
          // Query (required for toolUses foreign key)
          await db
            .insert(schema.queries)
            .values([
              { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
            ]);
          // Tool uses (some with errors)
          await db.insert(schema.toolUses).values([
            {
              hasError: false,
              id: "t1",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Read",
            },
            {
              hasError: false,
              id: "t2",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Read",
            },
            {
              hasError: true,
              id: "t3",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Edit",
            },
            {
              hasError: false,
              id: "t4",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          return yield* analytics.getDashboardStats();
        })
      );

      // Cache efficiency = 33% (500 / (1000 + 500 + 0))
      expect(result.workflow.cacheEfficiency).toBe(33);
      // Tool success = 75% (3/4 tools succeeded)
      expect(result.workflow.toolSuccess).toBe(75);
      // Session efficiency based on queries per session
      expect(result.workflow.sessionEfficiency).toBeDefined();
      // Overall score is weighted average
      expect(result.workflow.overallScore).toBeGreaterThan(0);
      expect(result.workflow.overallScore).toBeLessThanOrEqual(100);
    });

    it("respects date filters", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "recent",
              startTime: now,
              totalInputTokens: 1000,
            },
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "old",
              startTime: now - 10 * dayMs,
              totalInputTokens: 500,
            },
          ]);
        },
        Effect.gen(function* result() {
          const analytics = yield* SessionAnalyticsService;
          // Filter to last 5 days
          return yield* analytics.getDashboardStats({
            startTime: now - 5 * dayMs,
          });
        })
      );

      // Should only include the recent session
      expect(result.sessions.total).toBe(1);
      expect(result.cache.totalInputTokens).toBe(1000);
    });
  });

  describe("getAgentROI", () => {
    it("counts spawns without inflation from tool-use joins", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "main1",
              startTime: now,
              totalCost: 1,
            },
            {
              isSubagent: true,
              projectPath: "/p",
              sessionId: "sub1",
              startTime: now,
              totalCost: 2,
            },
          ]);
          await db.insert(schema.agentSpawns).values([
            { agentType: "Explore", queryIndex: 0, sessionId: "main1" },
            { agentType: "Explore", queryIndex: 1, sessionId: "main1" },
          ]);
          await db.insert(schema.queries).values([
            {
              id: "main1:0",
              queryIndex: 0,
              sessionId: "main1",
              timestamp: now,
            },
          ]);
          await db.insert(schema.toolUses).values([
            {
              hasError: false,
              id: "tu1",
              queryId: "main1:0",
              sessionId: "main1",
              toolName: "Read",
            },
            {
              hasError: false,
              id: "tu2",
              queryId: "main1:0",
              sessionId: "main1",
              toolName: "Edit",
            },
            {
              hasError: true,
              id: "tu3",
              queryId: "main1:0",
              sessionId: "main1",
              toolName: "Bash",
            },
          ]);
        },
        Effect.gen(function* result() {
          const agentsService = yield* AgentAnalyticsService;
          return yield* agentsService.getAgentROI();
        })
      );

      const explore = result.agents.find((a) => a.agentType === "Explore");
      expect(explore).toBeDefined();
      expect(explore!.spawns).toBe(2);
    });

    it("respects date filter when allocating subagent cost", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "recent-main",
              startTime: now,
              totalCost: 1,
            },
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "old-main",
              startTime: now - 20 * dayMs,
              totalCost: 1,
            },
            {
              isSubagent: true,
              projectPath: "/p",
              sessionId: "recent-sub",
              startTime: now,
              totalCost: 10,
            },
            {
              isSubagent: true,
              projectPath: "/p",
              sessionId: "old-sub",
              startTime: now - 20 * dayMs,
              totalCost: 100,
            },
          ]);
          await db
            .insert(schema.agentSpawns)
            .values([
              { agentType: "Explore", queryIndex: 0, sessionId: "recent-main" },
            ]);
        },
        Effect.gen(function* result() {
          const agentsService = yield* AgentAnalyticsService;
          return yield* agentsService.getAgentROI({
            startTime: now - 7 * dayMs,
          });
        })
      );

      const explore = result.agents.find((a) => a.agentType === "Explore");
      expect(explore).toBeDefined();
      expect(explore!.totalCost).toBe(10);
    });
  });

  describe("getContextPeakDistribution", () => {
    it("uses the first query model (queryIndex 0) for peak attribution", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              isSubagent: false,
              projectPath: "/p",
              sessionId: "s1",
              startTime: now,
            },
          ]);
          await db.insert(schema.queries).values([
            {
              cacheRead: 10,
              cacheWrite: 5,
              id: "s1:0",
              inputTokens: 100,
              model: "claude-sonnet-4-5-20251022",
              queryIndex: 0,
              sessionId: "s1",
              timestamp: now,
            },
            {
              cacheRead: 20,
              cacheWrite: 10,
              id: "s1:1",
              inputTokens: 200,
              model: "claude-opus-4-6-20260210",
              queryIndex: 1,
              sessionId: "s1",
              timestamp: now + 1,
            },
          ]);
        },
        Effect.gen(function* result() {
          const contextService = yield* ContextAnalyticsService;
          return yield* contextService.getContextPeakDistribution();
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.model).toBe("claude-sonnet-4-5-20251022");
    });
  });

  describe("getEfficiencyScore", () => {
    it("returns null toolSuccess when no tool calls exist", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          // Session with queries but no tool uses
          await db.insert(schema.sessions).values([
            {
              projectPath: "/p",
              sessionId: "s1",
              startTime: now,
              totalCacheRead: 5000,
              totalInputTokens: 10000,
              totalQueries: 5,
            },
          ]);
        },
        Effect.gen(function* result() {
          const insights = yield* InsightsAnalyticsService;
          return yield* insights.getEfficiencyScore();
        })
      );

      // toolSuccess should be null when no tool calls
      expect(result.toolSuccess).toBeNull();
      // But overall score should still be calculated (from cache + session only)
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
    });

    it("returns numeric toolSuccess when tool calls exist", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              projectPath: "/p",
              sessionId: "s1",
              startTime: now,
              totalCacheRead: 5000,
              totalInputTokens: 10000,
              totalQueries: 5,
            },
          ]);
          await db.insert(schema.queries).values([
            { id: "s1:0", queryIndex: 0, sessionId: "s1", timestamp: now },
          ]);
          // Add some tool uses - 1 error out of 4 = 75% success
          await db.insert(schema.toolUses).values([
            {
              hasError: true,
              id: "t1",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Bash",
            },
            {
              hasError: false,
              id: "t2",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Read",
            },
            {
              hasError: false,
              id: "t3",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Write",
            },
            {
              hasError: false,
              id: "t4",
              queryId: "s1:0",
              sessionId: "s1",
              toolName: "Edit",
            },
          ]);
        },
        Effect.gen(function* result() {
          const insights = yield* InsightsAnalyticsService;
          return yield* insights.getEfficiencyScore();
        })
      );

      // toolSuccess should be 75% (3/4 successful)
      expect(result.toolSuccess).not.toBeNull();
      expect(result.toolSuccess).toBe(75);
    });
  });
});
