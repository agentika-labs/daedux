/**
 * Integration tests for domain analytics services.
 * Tests the SQL queries against an in-memory SQLite database.
 */
import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { createTestDb } from "../helpers/test-db"
import {
  AllAnalyticsServicesLive,
  SessionAnalyticsService,
  ModelAnalyticsService,
  ToolAnalyticsService,
  FileAnalyticsService,
  AgentAnalyticsService,
  ContextAnalyticsService,
  InsightsAnalyticsService,
} from "../../src/services/analytics/index"
import { DatabaseService } from "../../src/services/db"
import * as schema from "../../src/db/schema"

// ─── Test Helpers ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runWithAnalytics = <A, E>(
  setup: (db: ReturnType<typeof createTestDb>["db"]) => Promise<void>,
  effect: Effect.Effect<A, E, any>
): Promise<A> => {
  const { db, sqlite } = createTestDb()
  const dbLayer = Layer.succeed(DatabaseService, { db, sqlite })
  const analyticsLayer = Layer.provide(AllAnalyticsServicesLive, dbLayer)

  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.promise(() => setup(db))
      return yield* Effect.provide(effect, analyticsLayer)
    })
  )
}

const now = Date.now()
const dayMs = 24 * 60 * 60 * 1000

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AnalyticsService", () => {
  describe("getTotals", () => {
    it("returns zeros for empty database", async () => {
      const result = await runWithAnalytics(
        async () => {},
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getTotals()
        })
      )

      expect(result.totalSessions).toBe(0)
      expect(result.totalQueries).toBe(0)
      expect(result.totalCost).toBe(0)
    })

    it("sums session totals correctly", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              sessionId: "s1",
              projectPath: "/project",
              startTime: now,
              queryCount: 5,
              toolUseCount: 10,
              totalCost: 1.5,
              totalInputTokens: 10000,
              totalOutputTokens: 2000,
              totalCacheRead: 5000,
              totalCacheWrite: 1000,
            },
            {
              sessionId: "s2",
              projectPath: "/project",
              startTime: now,
              queryCount: 3,
              toolUseCount: 5,
              totalCost: 0.75,
              totalInputTokens: 5000,
              totalOutputTokens: 1000,
              totalCacheRead: 2500,
              totalCacheWrite: 500,
            },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getTotals()
        })
      )

      expect(result.totalSessions).toBe(2)
      expect(result.totalQueries).toBe(8)
      expect(result.totalToolUses).toBe(15)
      expect(result.totalCost).toBeCloseTo(2.25, 2)
      expect(result.totalInputTokens).toBe(15000)
      expect(result.totalOutputTokens).toBe(3000)
      expect(result.totalCacheRead).toBe(7500)
      expect(result.totalCacheWrite).toBe(1500)
    })

    it("counts subagents separately", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "parent", projectPath: "/p", startTime: now, isSubagent: false },
            { sessionId: "sub1", projectPath: "/p", startTime: now, isSubagent: true, parentSessionId: "parent" },
            { sessionId: "sub2", projectPath: "/p", startTime: now, isSubagent: true, parentSessionId: "parent" },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getTotals()
        })
      )

      expect(result.totalSessions).toBe(3)
      expect(result.totalSubagents).toBe(2)
    })
  })

  describe("getDailyStats", () => {
    it("groups sessions by day", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now, queryCount: 5, totalCost: 1.0 },
            { sessionId: "s2", projectPath: "/p", startTime: now, queryCount: 3, totalCost: 0.5 },
            { sessionId: "s3", projectPath: "/p", startTime: now - dayMs, queryCount: 2, totalCost: 0.25 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDailyStats()
        })
      )

      expect(result.length).toBe(2) // Two different days
    })

    it("filters by days parameter", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "recent", projectPath: "/p", startTime: now, queryCount: 5 },
            { sessionId: "old", projectPath: "/p", startTime: now - 10 * dayMs, queryCount: 3 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDailyStats(5) // Last 5 days
        })
      )

      expect(result.length).toBe(1) // Only recent session
    })
  })

  describe("getSessionSummaries", () => {
    it("returns sessions ordered by start time descending", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "oldest", projectPath: "/p", startTime: now - 2 * dayMs, displayName: "Old" },
            { sessionId: "newest", projectPath: "/p", startTime: now, displayName: "New" },
            { sessionId: "middle", projectPath: "/p", startTime: now - dayMs, displayName: "Middle" },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getSessionSummaries()
        })
      )

      expect(result[0]!.sessionId).toBe("newest")
      expect(result[1]!.sessionId).toBe("middle")
      expect(result[2]!.sessionId).toBe("oldest")
    })

    it("filters by project path", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/project-a", startTime: now },
            { sessionId: "s2", projectPath: "/project-b", startTime: now },
            { sessionId: "s3", projectPath: "/project-a", startTime: now },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getSessionSummaries({ projectPath: "/project-a" })
        })
      )

      expect(result).toHaveLength(2)
      expect(result.every((s) => s.projectPath === "/project-a")).toBe(true)
    })

    it("can exclude subagents", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "parent", projectPath: "/p", startTime: now, isSubagent: false },
            { sessionId: "sub", projectPath: "/p", startTime: now, isSubagent: true },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getSessionSummaries({ includeSubagents: false })
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.sessionId).toBe("parent")
    })
  })

  describe("getProjectSummaries", () => {
    it("groups sessions by project", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/project-a", startTime: now, totalCost: 1.0, queryCount: 5 },
            { sessionId: "s2", projectPath: "/project-a", startTime: now - dayMs, totalCost: 0.5, queryCount: 3 },
            { sessionId: "s3", projectPath: "/project-b", startTime: now, totalCost: 2.0, queryCount: 10 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getProjectSummaries()
        })
      )

      expect(result).toHaveLength(2)

      const projectA = result.find((p) => p.projectPath === "/project-a")!
      expect(projectA.sessionCount).toBe(2)
      expect(projectA.totalCost).toBeCloseTo(1.5, 2)
      expect(projectA.totalQueries).toBe(8)
    })
  })

  describe("getModelBreakdown", () => {
    it("groups queries by model", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.queries).values([
            { id: "s1:0", sessionId: "s1", queryIndex: 0, timestamp: now, model: "claude-sonnet-4-5-20251022", cost: 1.0, inputTokens: 1000, outputTokens: 500 },
            { id: "s1:1", sessionId: "s1", queryIndex: 1, timestamp: now, model: "claude-sonnet-4-5-20251022", cost: 0.5, inputTokens: 500, outputTokens: 250 },
            { id: "s1:2", sessionId: "s1", queryIndex: 2, timestamp: now, model: "claude-opus-4-5-20251022", cost: 2.0, inputTokens: 2000, outputTokens: 1000 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* ModelAnalyticsService
          return yield* analytics.getModelBreakdown()
        })
      )

      expect(result.length).toBeGreaterThan(0)

      // Should have Sonnet and Opus
      const sonnet = result.find((m) => m.modelShort.includes("Sonnet"))
      const opus = result.find((m) => m.modelShort.includes("Opus"))

      expect(sonnet).toBeDefined()
      expect(opus).toBeDefined()

      expect(sonnet!.queries).toBe(2)
      expect(opus!.queries).toBe(1)
    })
  })

  describe("getToolUsage", () => {
    it("counts tool uses by name", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.queries).values([
            { id: "s1:0", sessionId: "s1", queryIndex: 0, timestamp: now },
          ])
          await db.insert(schema.toolUses).values([
            { id: "t1", queryId: "s1:0", sessionId: "s1", toolName: "Read" },
            { id: "t2", queryId: "s1:0", sessionId: "s1", toolName: "Read" },
            { id: "t3", queryId: "s1:0", sessionId: "s1", toolName: "Edit" },
            { id: "t4", queryId: "s1:0", sessionId: "s1", toolName: "Bash" },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* ToolAnalyticsService
          return yield* analytics.getToolUsage()
        })
      )

      const readStat = result.find((t) => t.name === "Read")!
      expect(readStat.count).toBe(2)

      const editStat = result.find((t) => t.name === "Edit")!
      expect(editStat.count).toBe(1)
    })
  })

  describe("getToolHealth", () => {
    it("calculates error rates per tool", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.queries).values([
            { id: "s1:0", sessionId: "s1", queryIndex: 0, timestamp: now },
          ])
          await db.insert(schema.toolUses).values([
            { id: "t1", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: false },
            { id: "t2", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: true },
            { id: "t3", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: true },
            { id: "t4", queryId: "s1:0", sessionId: "s1", toolName: "Read", hasError: false },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* ToolAnalyticsService
          return yield* analytics.getToolHealth()
        })
      )

      const bashHealth = result.find((t) => t.name === "Bash")!
      expect(bashHealth.totalCalls).toBe(3)
      expect(bashHealth.errors).toBe(2)
      expect(bashHealth.errorRate).toBeCloseTo(0.666, 2)

      const readHealth = result.find((t) => t.name === "Read")!
      expect(readHealth.errorRate).toBe(0)
    })
  })

  describe("getBashCommandStats", () => {
    it("groups bash commands by category", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.bashCommands).values([
            { sessionId: "s1", command: "git status", category: "git" },
            { sessionId: "s1", command: "git diff", category: "git" },
            { sessionId: "s1", command: "bun test", category: "package_manager" },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* ToolAnalyticsService
          return yield* analytics.getBashCommandStats()
        })
      )

      const gitStats = result.find((c) => c.category === "git")!
      expect(gitStats.count).toBe(2)
      expect(gitStats.topCommands).toContain("git status")

      const pkgStats = result.find((c) => c.category === "package_manager")!
      expect(pkgStats.count).toBe(1)
    })
  })

  describe("getFileExtensions", () => {
    it("counts file operations by extension", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.fileOperations).values([
            { sessionId: "s1", operation: "read", filePath: "/src/index.ts", fileExtension: "ts", timestamp: now },
            { sessionId: "s1", operation: "read", filePath: "/src/utils.ts", fileExtension: "ts", timestamp: now },
            { sessionId: "s1", operation: "edit", filePath: "/package.json", fileExtension: "json", timestamp: now },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* FileAnalyticsService
          return yield* analytics.getFileExtensions()
        })
      )

      const tsStat = result.find((e) => e.extension === "ts")!
      expect(tsStat.count).toBe(2)
      expect(tsStat.percentage).toBeCloseTo(66.67, 0)
    })
  })

  describe("getApiErrors", () => {
    it("counts errors by type", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.apiErrors).values([
            { sessionId: "s1", errorType: "rate_limit", statusCode: 429, timestamp: now },
            { sessionId: "s1", errorType: "rate_limit", statusCode: 429, timestamp: now - 1000 },
            { sessionId: "s1", errorType: "server_error", statusCode: 500, timestamp: now - 2000 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* ToolAnalyticsService
          return yield* analytics.getApiErrors()
        })
      )

      const rateLimitStat = result.find((e) => e.errorType === "rate_limit")!
      expect(rateLimitStat.count).toBe(2)

      const serverStat = result.find((e) => e.errorType === "server_error")!
      expect(serverStat.count).toBe(1)
    })
  })

  describe("getAgentStats", () => {
    it("counts agent spawns by type", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.agentSpawns).values([
            { sessionId: "s1", agentType: "Explore", description: "Explore codebase" },
            { sessionId: "s1", agentType: "Explore", description: "More exploration" },
            { sessionId: "s1", agentType: "Bash", description: "Run tests" },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* AgentAnalyticsService
          return yield* analytics.getAgentStats()
        })
      )

      const exploreStat = result.find((a) => a.agentType === "Explore")!
      expect(exploreStat.invocationCount).toBe(2)
    })
  })

  describe("getExtendedTotals", () => {
    it("calculates cache efficiency ratio", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              sessionId: "s1",
              projectPath: "/p",
              startTime: now,
              totalInputTokens: 10000,
              totalOutputTokens: 2000,
              totalCacheRead: 8000, // 80% cache hit
              totalCacheWrite: 1000,
              savedByCaching: 5.0,
            },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getExtendedTotals()
        })
      )

      expect(result.cacheEfficiencyRatio).toBeGreaterThan(0)
      expect(result.savedByCaching).toBe(5.0)
    })

    it("calculates averages correctly", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now, totalCost: 1.0, durationMs: 60000 },
            { sessionId: "s2", projectPath: "/p", startTime: now, totalCost: 2.0, durationMs: 120000, queryCount: 10 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getExtendedTotals()
        })
      )

      expect(result.avgCostPerSession).toBeCloseTo(1.5, 2)
      expect(result.avgSessionDurationMs).toBeCloseTo(90000, -1) // ~90 seconds
    })
  })

  describe("generateInsights", () => {
    it("generates cache efficiency insight for high cache usage", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            {
              sessionId: "s1",
              projectPath: "/p",
              startTime: now,
              totalInputTokens: 100000,
              totalCacheRead: 50000, // 50% cache hit
            },
          ])
        },
        Effect.gen(function* () {
          const insights = yield* InsightsAnalyticsService
          return yield* insights.generateInsights()
        })
      )

      const cacheInsight = result.find((i) => i.id === "cache-efficiency")
      expect(cacheInsight).toBeDefined()
      expect(cacheInsight!.type).toBe("success")
    })

    it("generates tool error warning for high error rate", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.queries).values([
            { id: "s1:0", sessionId: "s1", queryIndex: 0, timestamp: now },
          ])
          // 50% error rate
          await db.insert(schema.toolUses).values([
            { id: "t1", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: true },
            { id: "t2", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: true },
            { id: "t3", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: false },
            { id: "t4", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: false },
          ])
        },
        Effect.gen(function* () {
          const insights = yield* InsightsAnalyticsService
          return yield* insights.generateInsights()
        })
      )

      const errorInsight = result.find((i) => i.id === "high-tool-errors")
      expect(errorInsight).toBeDefined()
      expect(errorInsight!.type).toBe("warning")
    })
  })

  describe("getContextHeatmap", () => {
    it("buckets context window usage correctly", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.contextWindowUsage).values([
            { sessionId: "s1", queryIndex: 1, cacheHitRatio: 0.1 }, // 1-5, 0-20%
            { sessionId: "s1", queryIndex: 3, cacheHitRatio: 0.5 }, // 1-5, 40-60%
            { sessionId: "s1", queryIndex: 7, cacheHitRatio: 0.9 }, // 6-10, 80-100%
          ])
        },
        Effect.gen(function* () {
          const context = yield* ContextAnalyticsService
          return yield* context.getContextHeatmap()
        })
      )

      // Should have heatmap points
      expect(result.length).toBeGreaterThan(0)

      // Check specific buckets
      const lowEarlyBucket = result.find((p) => p.turnRange === "1-5" && p.utilizationBucket === "0-20%")
      expect(lowEarlyBucket).toBeDefined()
    })
  })

  describe("getCacheEfficiencyCurve", () => {
    it("returns average cache hit ratio per query index", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now },
            { sessionId: "s2", projectPath: "/p", startTime: now },
          ])
          await db.insert(schema.contextWindowUsage).values([
            { sessionId: "s1", queryIndex: 0, cacheHitRatio: 0.0 },
            { sessionId: "s2", queryIndex: 0, cacheHitRatio: 0.0 },
            { sessionId: "s1", queryIndex: 1, cacheHitRatio: 0.5 },
            { sessionId: "s2", queryIndex: 1, cacheHitRatio: 0.6 },
          ])
        },
        Effect.gen(function* () {
          const context = yield* ContextAnalyticsService
          return yield* context.getCacheEfficiencyCurve()
        })
      )

      expect(result).toHaveLength(2)

      const query0 = result.find((p) => p.queryIndex === 0)!
      expect(query0.avgCacheHitRatio).toBe(0)
      expect(query0.sessionCount).toBe(2)

      const query1 = result.find((p) => p.queryIndex === 1)!
      expect(query1.avgCacheHitRatio).toBeCloseTo(0.55, 2)
    })
  })

  describe("getCompactionAnalysis", () => {
    it("counts sessions with compactions", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now, compactions: 0 },
            { sessionId: "s2", projectPath: "/p", startTime: now, compactions: 2 },
            { sessionId: "s3", projectPath: "/p", startTime: now, compactions: 1 },
          ])
        },
        Effect.gen(function* () {
          const context = yield* ContextAnalyticsService
          return yield* context.getCompactionAnalysis()
        })
      )

      expect(result.totalSessions).toBe(3)
      expect(result.sessionsWithCompactions).toBe(2)
      expect(result.avgCompactionsPerSession).toBe(1) // (0+2+1)/3 = 1
    })

    it("respects date filters", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "recent", projectPath: "/p", startTime: now, compactions: 2 },
            { sessionId: "old", projectPath: "/p", startTime: now - 10 * dayMs, compactions: 4 },
          ])
        },
        Effect.gen(function* () {
          const context = yield* ContextAnalyticsService
          return yield* context.getCompactionAnalysis({ startTime: now - 2 * dayMs, endTime: now + 1000 })
        })
      )

      expect(result.totalSessions).toBe(1)
      expect(result.sessionsWithCompactions).toBe(1)
      expect(result.avgCompactionsPerSession).toBe(2)
    })
  })

  describe("date filter support for lazy analytics", () => {
    it("filters top prompts by session date", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "recent", projectPath: "/p", startTime: now },
            { sessionId: "old", projectPath: "/p", startTime: now - 10 * dayMs },
          ])
          await db.insert(schema.queries).values([
            { id: "recent:0", sessionId: "recent", queryIndex: 0, timestamp: now, userMessagePreview: "recent prompt", cost: 1.0 },
            { id: "old:0", sessionId: "old", queryIndex: 0, timestamp: now - 10 * dayMs, userMessagePreview: "old prompt", cost: 2.0 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getTopPrompts(10, { startTime: now - 2 * dayMs, endTime: now + 1000 })
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.sessionId).toBe("recent")
    })

    it("filters hook stats by session date", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "recent", projectPath: "/p", startTime: now },
            { sessionId: "old", projectPath: "/p", startTime: now - 10 * dayMs },
          ])
          await db.insert(schema.hookEvents).values([
            { sessionId: "recent", hookType: "PostToolUse", hookName: "format", timestamp: now, exitCode: 0 },
            { sessionId: "old", hookType: "PostToolUse", hookName: "format", timestamp: now - 10 * dayMs, exitCode: 1 },
          ])
        },
        Effect.gen(function* () {
          const agents = yield* AgentAnalyticsService
          return yield* agents.getHookStats({ startTime: now - 2 * dayMs, endTime: now + 1000 })
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.totalExecutions).toBe(1)
      expect(result[0]!.failures).toBe(0)
    })
  })

  describe("getDashboardStats", () => {
    it("returns correct session counts (main vs subagent)", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "main1", projectPath: "/p", startTime: now, isSubagent: false },
            { sessionId: "main2", projectPath: "/p", startTime: now, isSubagent: false },
            { sessionId: "sub1", projectPath: "/p", startTime: now, isSubagent: true },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDashboardStats()
        })
      )

      expect(result.sessions.total).toBe(3)
      expect(result.sessions.main).toBe(2)
      expect(result.sessions.subagent).toBe(1)
    })

    it("returns correct agent metrics", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          // Main sessions
          await db.insert(schema.sessions).values([
            { sessionId: "main1", projectPath: "/p", startTime: now, isSubagent: false, totalInputTokens: 1000, totalOutputTokens: 500 },
            { sessionId: "sub1", projectPath: "/p", startTime: now, isSubagent: true, totalInputTokens: 200, totalOutputTokens: 100 },
          ])
          // Agent spawns (Task tool invocations)
          await db.insert(schema.agentSpawns).values([
            { sessionId: "main1", agentType: "Explore", queryIndex: 0 },
            { sessionId: "main1", agentType: "Explore", queryIndex: 1 },
            { sessionId: "main1", agentType: "Plan", queryIndex: 2 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDashboardStats()
        })
      )

      expect(result.agents.subagentSessions).toBe(1)
      expect(result.agents.agentInvocations).toBe(3)
      expect(result.agents.mainSessionTokens).toBe(1500) // 1000 + 500
      expect(result.agents.agentTokens).toBe(300) // 200 + 100
    })

    it("calculates cache metrics consistently", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now, totalInputTokens: 1000, totalCacheRead: 700, totalCacheWrite: 200 },
            { sessionId: "s2", projectPath: "/p", startTime: now, totalInputTokens: 500, totalCacheRead: 300, totalCacheWrite: 100 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDashboardStats()
        })
      )

      expect(result.cache.totalInputTokens).toBe(1500)
      expect(result.cache.cacheRead).toBe(1000)
      expect(result.cache.cacheWrite).toBe(300)
      expect(result.cache.uncached).toBe(1500) // total_input_tokens stores uncached input directly
      // hitRatio = cacheRead / (uncached + cacheRead + cacheWrite) = 1000/2800 = 0.357
      expect(result.cache.hitRatio).toBeCloseTo(0.357, 2)
      expect(result.cache.efficiencyPercent).toBe(36) // Math.round(0.357 * 100)
    })

    it("handles empty database with null values", async () => {
      const result = await runWithAnalytics(
        async () => {},
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDashboardStats()
        })
      )

      expect(result.sessions.total).toBe(0)
      expect(result.sessions.main).toBe(0)
      expect(result.sessions.subagent).toBe(0)
      expect(result.agents.agentInvocations).toBe(0)
      expect(result.cache.hitRatio).toBeNull()
      expect(result.cache.efficiencyPercent).toBeNull()
      expect(result.context.leverageRatio).toBeNull()
      expect(result.context.hasAgentUsage).toBe(false)
    })

    it("calculates context displacement metrics", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "main1", projectPath: "/p", startTime: now, isSubagent: false, totalInputTokens: 800, totalOutputTokens: 200 },
            { sessionId: "sub1", projectPath: "/p", startTime: now, isSubagent: true, totalInputTokens: 160, totalOutputTokens: 40 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDashboardStats()
        })
      )

      expect(result.context.mainSessionTokens).toBe(1000) // 800 + 200
      expect(result.context.agentTokens).toBe(200) // 160 + 40
      // leverageRatio = agentTokens / (main + agent) = 200 / 1200 = 0.167
      expect(result.context.leverageRatio).toBeCloseTo(0.167, 2)
      expect(result.context.hasAgentUsage).toBe(true)
    })

    it("calculates workflow scores", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          // Sessions with some cache usage
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now, isSubagent: false, totalInputTokens: 1000, totalCacheRead: 500, queryCount: 10 },
          ])
          // Query (required for toolUses foreign key)
          await db.insert(schema.queries).values([
            { id: "s1:0", sessionId: "s1", queryIndex: 0, timestamp: now },
          ])
          // Tool uses (some with errors)
          await db.insert(schema.toolUses).values([
            { id: "t1", queryId: "s1:0", sessionId: "s1", toolName: "Read", hasError: false },
            { id: "t2", queryId: "s1:0", sessionId: "s1", toolName: "Read", hasError: false },
            { id: "t3", queryId: "s1:0", sessionId: "s1", toolName: "Edit", hasError: true },
            { id: "t4", queryId: "s1:0", sessionId: "s1", toolName: "Bash", hasError: false },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          return yield* analytics.getDashboardStats()
        })
      )

      // Cache efficiency = 33% (500 / (1000 + 500 + 0))
      expect(result.workflow.cacheEfficiency).toBe(33)
      // Tool success = 75% (3/4 tools succeeded)
      expect(result.workflow.toolSuccess).toBe(75)
      // Session efficiency based on queries per session
      expect(result.workflow.sessionEfficiency).toBeDefined()
      // Overall score is weighted average
      expect(result.workflow.overallScore).toBeGreaterThan(0)
      expect(result.workflow.overallScore).toBeLessThanOrEqual(100)
    })

    it("respects date filters", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "recent", projectPath: "/p", startTime: now, isSubagent: false, totalInputTokens: 1000 },
            { sessionId: "old", projectPath: "/p", startTime: now - 10 * dayMs, isSubagent: false, totalInputTokens: 500 },
          ])
        },
        Effect.gen(function* () {
          const analytics = yield* SessionAnalyticsService
          // Filter to last 5 days
          return yield* analytics.getDashboardStats({ startTime: now - 5 * dayMs })
        })
      )

      // Should only include the recent session
      expect(result.sessions.total).toBe(1)
      expect(result.cache.totalInputTokens).toBe(1000)
    })
  })

  describe("getAgentROI", () => {
    it("counts spawns without inflation from tool-use joins", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "main1", projectPath: "/p", startTime: now, isSubagent: false, totalCost: 1.0 },
            { sessionId: "sub1", projectPath: "/p", startTime: now, isSubagent: true, totalCost: 2.0 },
          ])
          await db.insert(schema.agentSpawns).values([
            { sessionId: "main1", agentType: "Explore", queryIndex: 0 },
            { sessionId: "main1", agentType: "Explore", queryIndex: 1 },
          ])
          await db.insert(schema.queries).values([
            { id: "main1:0", sessionId: "main1", queryIndex: 0, timestamp: now },
          ])
          await db.insert(schema.toolUses).values([
            { id: "tu1", queryId: "main1:0", sessionId: "main1", toolName: "Read", hasError: false },
            { id: "tu2", queryId: "main1:0", sessionId: "main1", toolName: "Edit", hasError: false },
            { id: "tu3", queryId: "main1:0", sessionId: "main1", toolName: "Bash", hasError: true },
          ])
        },
        Effect.gen(function* () {
          const agentsService = yield* AgentAnalyticsService
          return yield* agentsService.getAgentROI()
        })
      )

      const explore = result.agents.find((a) => a.agentType === "Explore")
      expect(explore).toBeDefined()
      expect(explore!.spawns).toBe(2)
    })

    it("respects date filter when allocating subagent cost", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "recent-main", projectPath: "/p", startTime: now, isSubagent: false, totalCost: 1.0 },
            { sessionId: "old-main", projectPath: "/p", startTime: now - 20 * dayMs, isSubagent: false, totalCost: 1.0 },
            { sessionId: "recent-sub", projectPath: "/p", startTime: now, isSubagent: true, totalCost: 10.0 },
            { sessionId: "old-sub", projectPath: "/p", startTime: now - 20 * dayMs, isSubagent: true, totalCost: 100.0 },
          ])
          await db.insert(schema.agentSpawns).values([
            { sessionId: "recent-main", agentType: "Explore", queryIndex: 0 },
          ])
        },
        Effect.gen(function* () {
          const agentsService = yield* AgentAnalyticsService
          return yield* agentsService.getAgentROI({ startTime: now - 7 * dayMs })
        })
      )

      const explore = result.agents.find((a) => a.agentType === "Explore")
      expect(explore).toBeDefined()
      expect(explore!.totalCost).toBe(10)
    })
  })

  describe("getContextPeakDistribution", () => {
    it("uses the first query model (queryIndex 0) for peak attribution", async () => {
      const result = await runWithAnalytics(
        async (db) => {
          await db.insert(schema.sessions).values([
            { sessionId: "s1", projectPath: "/p", startTime: now, isSubagent: false },
          ])
          await db.insert(schema.queries).values([
            { id: "s1:0", sessionId: "s1", queryIndex: 0, timestamp: now, model: "claude-sonnet-4-5-20251022", inputTokens: 100, cacheRead: 10, cacheWrite: 5 },
            { id: "s1:1", sessionId: "s1", queryIndex: 1, timestamp: now + 1, model: "claude-opus-4-6-20260210", inputTokens: 200, cacheRead: 20, cacheWrite: 10 },
          ])
        },
        Effect.gen(function* () {
          const contextService = yield* ContextAnalyticsService
          return yield* contextService.getContextPeakDistribution()
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.model).toBe("claude-sonnet-4-5-20251022")
    })
  })
})
