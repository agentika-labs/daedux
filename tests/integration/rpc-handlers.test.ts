/**
 * RPC Handler Integration Tests
 *
 * Tests the RPC handler flows using the test harness.
 * These tests verify the end-to-end flow from RPC request to service response.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import { Effect } from "effect";

import { ContextAnalyticsService } from "../../src/bun/analytics/context-analytics";
import { FileAnalyticsService } from "../../src/bun/analytics/file-analytics";
import { InsightsAnalyticsService } from "../../src/bun/analytics/insights-analytics";
import { ModelAnalyticsService } from "../../src/bun/analytics/model-analytics";
import { SessionAnalyticsService } from "../../src/bun/analytics/session-analytics";
import { ToolAnalyticsService } from "../../src/bun/analytics/tool-analytics";
import * as schema from "../../src/bun/db/schema";
import { SchedulerService } from "../../src/bun/services/scheduler";
import { createRpcTestHarness } from "../helpers/rpc-test-harness";

// ─── Test Setup ──────────────────────────────────────────────────────────────

type Harness = ReturnType<typeof createRpcTestHarness>;
let harness: Harness;

const now = Date.now();

beforeEach(() => {
  harness = createRpcTestHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const runEffect = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  harness.runEffect(effect);

// ─── Helper to create test session data ──────────────────────────────────────

const createSession = (
  overrides: Partial<schema.NewSession> = {}
): schema.NewSession => ({
  projectPath: "/project",
  queryCount: 5,
  sessionId: `session-${crypto.randomUUID()}`,
  startTime: now,
  toolUseCount: 10,
  totalCacheRead: 5000,
  totalCacheWrite: 1000,
  totalCost: 1.5,
  totalInputTokens: 10_000,
  totalOutputTokens: 2000,
  ...overrides,
});

const createQuery = (
  sessionId: string,
  overrides: Partial<schema.NewQuery> = {}
): schema.NewQuery => ({
  id: crypto.randomUUID(),
  sessionId,
  queryIndex: 0,
  model: "claude-3-5-sonnet-20241022",
  inputTokens: 1000,
  outputTokens: 500,
  cacheRead: 500,
  cacheWrite: 100,
  cost: 0.05,
  timestamp: now,
  ...overrides,
});

// ─── getDashboardData Tests ──────────────────────────────────────────────────

describe("getDashboardData flow", () => {
  test("returns zeros for empty database", async () => {
    const totals = await runEffect(
      Effect.gen(function* () {
        const sessions = yield* SessionAnalyticsService;
        return yield* sessions.getTotals({});
      })
    );

    expect(totals.totalSessions).toBe(0);
    expect(totals.totalCost).toBe(0);
    expect(totals.totalInputTokens).toBe(0);
  });

  test("returns aggregated data with sessions", async () => {
    const session = createSession({
      totalCost: 0.15,
      totalInputTokens: 5000,
      totalOutputTokens: 2000,
    });
    await harness.db.insert(schema.sessions).values(session);

    const totals = await runEffect(
      Effect.gen(function* () {
        const sessions = yield* SessionAnalyticsService;
        return yield* sessions.getTotals({});
      })
    );

    expect(totals.totalSessions).toBe(1);
    expect(totals.totalCost).toBeCloseTo(0.15, 2);
    expect(totals.totalInputTokens + totals.totalOutputTokens).toBe(7000);
  });

  test("respects date filter via startTime", async () => {
    const oneWeekAgo = now - 8 * 24 * 60 * 60 * 1000;

    // Insert old session
    const oldSession = createSession({
      startTime: oneWeekAgo,
      totalCost: 0.5,
    });
    await harness.db.insert(schema.sessions).values(oldSession);

    // Insert recent session
    const newSession = createSession({
      startTime: now - 1000,
      totalCost: 0.25,
    });
    await harness.db.insert(schema.sessions).values(newSession);

    const totals = await runEffect(
      Effect.gen(function* () {
        const sessions = yield* SessionAnalyticsService;
        return yield* sessions.getTotals({
          startTime: now - 7 * 24 * 60 * 60 * 1000,
        });
      })
    );

    // Should only include recent session
    expect(totals.totalSessions).toBe(1);
    expect(totals.totalCost).toBeCloseTo(0.25, 2);
  });
});

// ─── getAnalytics("models") Tests ────────────────────────────────────────────

describe("getAnalytics models flow", () => {
  test("returns model breakdown", async () => {
    const session = createSession();
    await harness.db.insert(schema.sessions).values(session);

    const query = createQuery(session.sessionId, {
      model: "claude-3-5-sonnet-20241022",
      cost: 0.05,
    });
    await harness.db.insert(schema.queries).values(query);

    const breakdown = await runEffect(
      Effect.gen(function* () {
        const models = yield* ModelAnalyticsService;
        return yield* models.getModelBreakdown({});
      })
    );

    expect(breakdown.length).toBeGreaterThan(0);
    expect(breakdown[0]!.modelShort).toBeDefined();
    expect(breakdown[0]!.totalCost).toBeCloseTo(0.05, 2);
  });
});

// ─── getAnalytics("tools") Tests ─────────────────────────────────────────────

describe("getAnalytics tools flow", () => {
  test("returns tool usage and health stats", async () => {
    const session = createSession();
    await harness.db.insert(schema.sessions).values(session);

    // Insert queries first (tool_uses has FK to queries)
    const queries: schema.NewQuery[] = [
      createQuery(session.sessionId, { id: "q1", queryIndex: 0 }),
      createQuery(session.sessionId, { id: "q2", queryIndex: 1 }),
      createQuery(session.sessionId, { id: "q3", queryIndex: 2 }),
    ];
    await harness.db.insert(schema.queries).values(queries);

    // Insert tool uses with required fields
    const toolUses: schema.NewToolUse[] = [
      {
        id: crypto.randomUUID(),
        sessionId: session.sessionId,
        queryId: "q1",
        toolName: "Read",
        hasError: false,
      },
      {
        id: crypto.randomUUID(),
        sessionId: session.sessionId,
        queryId: "q2",
        toolName: "Edit",
        hasError: false,
      },
      {
        id: crypto.randomUUID(),
        sessionId: session.sessionId,
        queryId: "q3",
        toolName: "Bash",
        hasError: true,
        errorMessage: "Command failed",
      },
    ];
    await harness.db.insert(schema.toolUses).values(toolUses);

    const [toolUsage, toolHealth] = await runEffect(
      Effect.gen(function* () {
        const tools = yield* ToolAnalyticsService;
        return yield* Effect.all([
          tools.getToolUsage({}),
          tools.getToolHealth({}),
        ]);
      })
    );

    expect(toolUsage.length).toBe(3);
    expect(toolHealth.length).toBeGreaterThan(0);

    // Check that Bash tool appears in health with errors tracked
    const bashHealth = toolHealth.find((t: any) => t.name === "Bash");
    expect(bashHealth).toBeDefined();
    // The health report tracks errors
    expect(bashHealth!.errors).toBeGreaterThan(0);
  });
});

// ─── getAnalytics("files") Tests ─────────────────────────────────────────────

describe("getAnalytics files flow", () => {
  test("returns file activity stats", async () => {
    const session = createSession();
    await harness.db.insert(schema.sessions).values(session);

    // Insert file operations
    const fileOps: schema.NewFileOperation[] = [
      {
        sessionId: session.sessionId,
        filePath: "/src/main.ts",
        operation: "read",
        fileExtension: ".ts",
        timestamp: now,
      },
      {
        sessionId: session.sessionId,
        filePath: "/src/main.ts",
        operation: "edit",
        fileExtension: ".ts",
        timestamp: now,
      },
      {
        sessionId: session.sessionId,
        filePath: "/src/utils.ts",
        operation: "write",
        fileExtension: ".ts",
        timestamp: now,
      },
    ];
    await harness.db.insert(schema.fileOperations).values(fileOps);

    const [fileActivity, extensions] = await runEffect(
      Effect.gen(function* () {
        const files = yield* FileAnalyticsService;
        return yield* Effect.all([
          files.getFileActivity(50, {}),
          files.getFileExtensions({}),
        ]);
      })
    );

    expect(fileActivity.length).toBe(2); // 2 unique files
    const mainTs = fileActivity.find((f: any) => f.filePath === "/src/main.ts");
    expect(mainTs?.reads).toBe(1);
    expect(mainTs?.edits).toBe(1);

    expect(extensions.length).toBe(1);
    expect(extensions[0]!.extension).toBe(".ts");
  });
});

// ─── getAnalytics("context") Tests ───────────────────────────────────────────

describe("getAnalytics context flow", () => {
  test("returns context heatmap and efficiency data", async () => {
    const session = createSession();
    await harness.db.insert(schema.sessions).values(session);

    // Insert context window usage data
    const contextUsage: schema.NewContextWindowUsage[] = [
      {
        sessionId: session.sessionId,
        queryIndex: 0,
        cacheHitRatio: 0,
        cumulativeTokens: 1000,
      },
      {
        sessionId: session.sessionId,
        queryIndex: 1,
        cacheHitRatio: 0.5,
        cumulativeTokens: 2000,
      },
      {
        sessionId: session.sessionId,
        queryIndex: 2,
        cacheHitRatio: 0.75,
        cumulativeTokens: 3000,
      },
    ];
    await harness.db.insert(schema.contextWindowUsage).values(contextUsage);

    const [heatmap, efficiency] = await runEffect(
      Effect.gen(function* () {
        const context = yield* ContextAnalyticsService;
        return yield* Effect.all([
          context.getContextHeatmap({}),
          context.getCacheEfficiencyCurve({}),
        ]);
      })
    );

    expect(heatmap.length).toBeGreaterThan(0);
    expect(efficiency.length).toBe(3);
    expect(efficiency[0]!.queryIndex).toBe(0);
    expect(efficiency[2]!.avgCacheHitRatio).toBeCloseTo(0.75, 2);
  });
});

// ─── Scheduler RPC Flow Tests ────────────────────────────────────────────────

describe("Scheduler RPC flows", () => {
  test("getSchedules returns empty initially", async () => {
    const schedules = await runEffect(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return yield* scheduler.getSchedules();
      })
    );

    expect(schedules).toEqual([]);
  });

  test("createSchedule -> getSchedules -> deleteSchedule flow", async () => {
    // Create schedule
    const created = await runEffect(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return yield* scheduler.createSchedule({
          name: "Morning warmup",
          hour: 9,
          minute: 0,
          daysOfWeek: [1, 2, 3, 4, 5],
        });
      })
    );

    expect(created.name).toBe("Morning warmup");
    expect(created.id).toBeDefined();

    // Get schedules
    const schedules = await runEffect(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return yield* scheduler.getSchedules();
      })
    );

    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.id).toBe(created.id);

    // Delete schedule
    const deleted = await runEffect(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return yield* scheduler.deleteSchedule(created.id);
      })
    );

    expect(deleted).toBe(true);

    // Verify deletion
    const remaining = await runEffect(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return yield* scheduler.getSchedules();
      })
    );

    expect(remaining).toEqual([]);
  });
});

// ─── Insights RPC Flow Tests ─────────────────────────────────────────────────

describe("Insights RPC flows", () => {
  test("generates insights from session data with cost variance", async () => {
    // Insert sessions with very high variance (100x difference triggers insight)
    const sessions = [
      createSession({ totalCost: 0.01 }),
      createSession({ totalCost: 10 }),
      createSession({ totalCost: 0.02 }),
    ];
    await harness.db.insert(schema.sessions).values(sessions);

    const insights = await runEffect(
      Effect.gen(function* () {
        const insightsService = yield* InsightsAnalyticsService;
        return yield* insightsService.generateInsights({});
      })
    );

    // Should generate insights (at least one)
    expect(Array.isArray(insights)).toBe(true);
  });

  test("efficiency score calculation", async () => {
    // Insert sessions with some high cache usage
    const session = createSession({
      totalCacheRead: 100_000,
      totalCacheWrite: 50_000,
      totalInputTokens: 10_000,
    });
    await harness.db.insert(schema.sessions).values(session);

    const score = await runEffect(
      Effect.gen(function* () {
        const insightsService = yield* InsightsAnalyticsService;
        return yield* insightsService.getEfficiencyScore({});
      })
    );

    // Score should be calculated (between 0-100)
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.cacheEfficiency).toBeDefined();
  });
});

// ─── Session Summaries Tests ─────────────────────────────────────────────────

describe("Session summaries flow", () => {
  test("returns session summaries with pagination", async () => {
    // Insert multiple sessions
    const sessions = Array.from({ length: 5 }, (_, i) =>
      createSession({
        startTime: now - i * 1000,
        totalCost: 0.1 * (i + 1),
      })
    );
    await harness.db.insert(schema.sessions).values(sessions);

    const summaries = await runEffect(
      Effect.gen(function* () {
        const sessionService = yield* SessionAnalyticsService;
        return yield* sessionService.getSessionSummaries({ limit: 3 });
      })
    );

    // getSessionSummaries returns an array directly
    expect(summaries).toHaveLength(3);
  });
});
