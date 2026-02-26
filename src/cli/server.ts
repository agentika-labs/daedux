/**
 * HTTP server for CLI mode - serves the dashboard via Bun.serve()
 */
import { Effect, ManagedRuntime, type Layer } from "effect";
import { dirname, join, extname } from "node:path";
import { existsSync } from "node:fs";

import type {
  DashboardData,
  DateFilter,
  SyncResult,
  SessionSummary,
} from "../shared/rpc-types";
import { modelDisplayNameWithVersion } from "../shared/model-utils";
import {
  SessionAnalyticsService,
  ModelAnalyticsService,
  ToolAnalyticsService,
  FileAnalyticsService,
  AgentAnalyticsService,
  InsightsAnalyticsService,
} from "../bun/analytics/index";
import { SyncService } from "../bun/sync";
import { AppLive } from "../bun/main";
import { toDateString } from "../bun/utils/formatting";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServerOptions {
  port: number;
  verbose?: boolean;
}

// ─── Effect Runtime ──────────────────────────────────────────────────────────

const runtime = ManagedRuntime.make(AppLive);

const runEffect = <A, E>(
  effect: Effect.Effect<A, E, Layer.Layer.Success<typeof AppLive>>
): Promise<A> => runtime.runPromise(effect);

// ─── Date Filter Parsing ─────────────────────────────────────────────────────

export const parseDateFilter = (filter?: string | null): DateFilter => {
  const now = Date.now();

  switch (filter) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { endTime: now, startTime: start.getTime() };
    }
    case "7d": {
      return { endTime: now, startTime: now - 7 * 86_400_000 };
    }
    case "30d": {
      return { endTime: now, startTime: now - 30 * 86_400_000 };
    }
    default: {
      return {};
    }
  }
};

// ─── Dashboard Data Loading ──────────────────────────────────────────────────

const loadDashboardData = (dateFilter: DateFilter = {}) =>
  Effect.gen(function* () {
    const sessions = yield* SessionAnalyticsService;
    const models = yield* ModelAnalyticsService;
    const tools = yield* ToolAnalyticsService;
    const files = yield* FileAnalyticsService;
    const agents = yield* AgentAnalyticsService;
    const insightsService = yield* InsightsAnalyticsService;

    const [
      totals,
      extendedTotals,
      dailyStats,
      sessionList,
      projects,
      modelBreakdown,
      toolUsage,
      topPrompts,
      insights,
      toolHealth,
      sessionToolCounts,
      sessionPrimaryModels,
      sessionFileOperations,
      sessionAgentCounts,
      sessionToolErrorCounts,
      efficiencyScore,
      weeklyComparison,
      agentROI,
      toolHealthReportCard,
      skillROI,
      hookStats,
      skillImpact,
    ] = yield* Effect.all([
      sessions.getTotals(dateFilter),
      sessions.getExtendedTotals(dateFilter),
      sessions.getDailyStats(undefined, dateFilter),
      sessions.getSessionSummaries({ dateFilter, includeSubagents: false }),
      sessions.getProjectSummaries(dateFilter),
      models.getModelBreakdown(dateFilter),
      tools.getToolUsage(dateFilter),
      sessions.getTopPrompts(30, dateFilter),
      insightsService.generateInsights(dateFilter),
      tools.getToolHealth(dateFilter),
      tools.getSessionToolCounts(dateFilter),
      sessions.getSessionPrimaryModels(dateFilter),
      files.getSessionFileOperations(dateFilter),
      sessions.getSessionAgentCounts(dateFilter),
      tools.getSessionToolErrorCounts(dateFilter),
      insightsService.getEfficiencyScore(dateFilter),
      insightsService.getWeeklyComparison(dateFilter),
      agents.getAgentROI(dateFilter),
      tools.getToolHealthReportCard(dateFilter),
      agents.getSkillROI(dateFilter),
      agents.getHookStats(dateFilter),
      agents.getSkillImpactComparison(dateFilter),
    ]);

    // Transform data for dashboard
    const totalTokens = totals.totalInputTokens + totals.totalOutputTokens;

    const dashboardTotals = {
      ...totals,
      agentLeverageRatio: extendedTotals.agentLeverageRatio,
      avgContextUtilization: extendedTotals.cacheEfficiencyRatio,
      avgCostPerQuery: extendedTotals.avgCostPerQuery,
      avgCostPerSession: extendedTotals.avgCostPerSession,
      avgSessionDurationMs: extendedTotals.avgSessionDurationMs,
      avgTurnsPerSession:
        sessionList.length > 0
          ? sessionList.reduce((sum, s) => sum + (s.turnCount ?? 0), 0) /
            sessionList.length
          : 0,
      cacheCreation: totals.totalCacheWrite,
      cacheEfficiencyRatio: extendedTotals.cacheEfficiencyRatio,
      cacheRead: totals.totalCacheRead,
      cacheSavingsUsd: extendedTotals.savedByCaching,
      contextEfficiencyScore: extendedTotals.cacheEfficiencyRatio * 100,
      costPerEdit:
        extendedTotals.totalFileOperations > 0
          ? totals.totalCost / extendedTotals.totalFileOperations
          : 0,
      dateRange: extendedTotals.dateRange,
      output: totals.totalOutputTokens,
      promptEfficiencyRatio: (() => {
        const newTokensSent = totals.totalInputTokens + totals.totalCacheWrite;
        return newTokensSent > 0 ? totals.totalOutputTokens / newTokensSent : 0;
      })(),
      savedByCaching: extendedTotals.savedByCaching,
      totalAgentSpawns: extendedTotals.totalAgentSpawns,
      totalFileOperations: extendedTotals.totalFileOperations,
      totalSkillInvocations: extendedTotals.totalSkillInvocations,
      totalTokens,
      totalTurns: sessionList.reduce((sum, s) => sum + (s.turnCount ?? 0), 0),
      uncachedInput: totals.totalInputTokens,
    };

    // Transform sessions
    const dashboardSessions = sessionList.map((s) => {
      const sessionModel =
        sessionPrimaryModels.get(s.sessionId) ?? "claude-sonnet-4-5-20251022";
      const sessionTools = sessionToolCounts.get(s.sessionId) ?? {};
      const sessionFileOps = sessionFileOperations.get(s.sessionId) ?? [];

      return {
        bashCommandCount: sessionTools.Bash ?? 0,
        cacheCreation: s.totalCacheWrite ?? 0,
        cacheRead: s.totalCacheRead ?? 0,
        compactions: s.compactions ?? 0,
        date: toDateString(s.startTime),
        displayName: s.displayName,
        durationMs: s.durationMs ?? 0,
        fileActivityDetails: sessionFileOps,
        fileEditCount: sessionFileOps.filter((op) => op.tool === "Edit").length,
        fileReadCount: sessionFileOps.filter((op) => op.tool === "Read").length,
        fileWriteCount: sessionFileOps.filter((op) => op.tool === "Write")
          .length,
        firstPrompt: s.displayName ?? "Session",
        isSubagent: s.isSubagent ?? false,
        model: sessionModel,
        modelShort: modelDisplayNameWithVersion(sessionModel),
        output: s.totalOutputTokens ?? 0,
        project: s.projectPath,
        queries: [],
        queryCount: s.queryCount ?? 0,
        savedByCaching: s.savedByCaching ?? 0,
        sessionId: s.sessionId,
        startTime: s.startTime,
        subagentCount: sessionAgentCounts.get(s.sessionId) ?? 0,
        toolCounts: sessionTools,
        toolErrorCount: sessionToolErrorCounts.get(s.sessionId) ?? 0,
        toolUseCount: s.toolUseCount ?? 0,
        totalCost: s.totalCost ?? 0,
        totalTokens: (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0),
        turnCount: s.turnCount ?? 0,
        uncachedInput: s.totalInputTokens ?? 0,
      } satisfies SessionSummary;
    });

    // Transform insights
    const transformedInsights = insights.map((i) => ({
      action: i.action ?? "",
      actionLabel: i.actionLabel,
      actionTarget: i.actionTarget,
      comparison: i.comparison,
      description: i.message,
      dollarImpact: i.dollarImpact,
      priority: i.priority,
      title: i.title,
      type: (i.type === "tip" ? "info" : i.type) as
        | "success"
        | "warning"
        | "info",
    }));

    // Transform topPrompts to include queryCount (default 1 per prompt)
    const transformedTopPrompts = topPrompts.map((p) => ({
      ...p,
      queryCount: 1, // Each prompt represents a single query
    }));

    return {
      agentROI,
      dailyUsage: dailyStats,
      efficiencyScore,
      hookStats,
      insights: transformedInsights,
      modelBreakdown,
      projects,
      sessions: dashboardSessions,
      skillImpact,
      skillROI,
      toolHealth,
      toolHealthReportCard,
      toolUsage,
      topPrompts: transformedTopPrompts,
      totals: dashboardTotals,
      weeklyComparison,
    } satisfies DashboardData;
  });

// ─── Sync Operations ─────────────────────────────────────────────────────────

const runSync = (fullResync = false) =>
  Effect.gen(function* () {
    const syncService = yield* SyncService;
    return fullResync
      ? yield* syncService.fullResync({ verbose: false })
      : yield* syncService.syncIncremental({ verbose: false });
  });

// ─── Static File Serving ─────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const getDistDir = (): string => {
  // In npm package: dist/ is sibling to bin/cli.js
  // When running from source: dist/ is at project root
  const candidates = [
    join(dirname(Bun.main), "..", "dist"),
    join(dirname(Bun.main), "dist"),
    join(process.cwd(), "dist"),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) {
      return dir;
    }
  }

  // Return first candidate as fallback (will result in 404s)
  return candidates[0] ?? join(process.cwd(), "dist");
};

const serveStatic = (pathname: string): Response | null => {
  const distDir = getDistDir();
  const filePath =
    pathname === "/" ? join(distDir, "index.html") : join(distDir, pathname);

  const file = Bun.file(filePath);
  if (!file.size) {
    return null;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new Response(file, {
    headers: { "Content-Type": contentType },
  });
};

// ─── HTTP Server ─────────────────────────────────────────────────────────────

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, verbose } = options;

  // Run initial sync before starting server
  if (verbose) {
    console.log("Running initial sync...");
  }

  try {
    const syncResult = await runEffect(runSync(false));
    if (verbose) {
      console.log(
        `Synced ${syncResult.synced} sessions (${syncResult.unchanged} unchanged, ${syncResult.errors} errors)`
      );
    }
  } catch (error) {
    console.error("Initial sync failed:", error);
  }

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // ─── Favicon (prevent 404 spam in console) ─────────────────────────────

      if (pathname === "/favicon.svg" || pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      // ─── API Routes ──────────────────────────────────────────────────────

      if (pathname === "/api/dashboard") {
        try {
          const filter = url.searchParams.get("filter");
          const dateFilter = parseDateFilter(filter);
          const data = await runEffect(loadDashboardData(dateFilter));
          return Response.json(data);
        } catch (error) {
          console.error("Dashboard data error:", error);
          return Response.json(
            { error: "Failed to load dashboard data" },
            { status: 500 }
          );
        }
      }

      if (pathname === "/api/sync" && req.method === "POST") {
        try {
          const body = await req.json().catch(() => ({}));
          const fullResync = (body as { fullResync?: boolean }).fullResync ?? false;
          const result = await runEffect(runSync(fullResync));
          return Response.json(result satisfies SyncResult);
        } catch (error) {
          console.error("Sync error:", error);
          return Response.json({ error: "Sync failed" }, { status: 500 });
        }
      }

      if (pathname === "/api/sync/status") {
        try {
          const status = await runEffect(
            Effect.gen(function* () {
              const sessionService = yield* SessionAnalyticsService;
              const totals = yield* sessionService.getTotals({});
              return {
                isScanning: false,
                lastScanAt: null,
                sessionCount: totals.totalSessions,
              };
            })
          );
          return Response.json(status);
        } catch (error) {
          console.error("Sync status error:", error);
          return Response.json(
            { error: "Failed to get sync status" },
            { status: 500 }
          );
        }
      }

      if (pathname.startsWith("/api/session/")) {
        const sessionId = pathname.split("/api/session/")[1];
        if (sessionId) {
          try {
            const detail = await runEffect(
              Effect.gen(function* () {
                const sessions = yield* SessionAnalyticsService;
                const tools = yield* ToolAnalyticsService;
                const files = yield* FileAnalyticsService;

                const list = yield* sessions.getSessionSummaries({
                  dateFilter: {},
                  includeSubagents: true,
                });

                const session = list.find((s) => s.sessionId === sessionId);
                if (!session) {
                  return null;
                }

                // Get additional data for the session
                const sessionToolCounts = yield* tools.getSessionToolCounts({});
                const sessionFileOps = yield* files.getSessionFileOperations({});
                const sessionPrimaryModels = yield* sessions.getSessionPrimaryModels({});
                const sessionAgentCounts = yield* sessions.getSessionAgentCounts({});
                const sessionToolErrors = yield* tools.getSessionToolErrorCounts({});

                const sessionModel =
                  sessionPrimaryModels.get(sessionId) ?? "claude-sonnet-4-5-20251022";
                const sessionTools = sessionToolCounts.get(sessionId) ?? {};
                const fileOps = sessionFileOps.get(sessionId) ?? [];

                return {
                  bashCommandCount: sessionTools.Bash ?? 0,
                  cacheCreation: session.totalCacheWrite ?? 0,
                  cacheRead: session.totalCacheRead ?? 0,
                  compactions: session.compactions ?? 0,
                  date: toDateString(session.startTime),
                  displayName: session.displayName,
                  durationMs: session.durationMs ?? 0,
                  fileActivityDetails: fileOps,
                  fileEditCount: fileOps.filter((op) => op.tool === "Edit").length,
                  fileReadCount: fileOps.filter((op) => op.tool === "Read").length,
                  fileWriteCount: fileOps.filter((op) => op.tool === "Write").length,
                  firstPrompt: session.displayName ?? "Session",
                  isSubagent: session.isSubagent ?? false,
                  model: sessionModel,
                  modelShort: modelDisplayNameWithVersion(sessionModel),
                  output: session.totalOutputTokens ?? 0,
                  project: session.projectPath,
                  queries: [],
                  queryCount: session.queryCount ?? 0,
                  savedByCaching: session.savedByCaching ?? 0,
                  sessionId: session.sessionId,
                  startTime: session.startTime,
                  subagentCount: sessionAgentCounts.get(sessionId) ?? 0,
                  toolCounts: sessionTools,
                  toolErrorCount: sessionToolErrors.get(sessionId) ?? 0,
                  toolUseCount: session.toolUseCount ?? 0,
                  totalCost: session.totalCost ?? 0,
                  totalTokens:
                    (session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0),
                  turnCount: session.turnCount ?? 0,
                  uncachedInput: session.totalInputTokens ?? 0,
                } satisfies SessionSummary;
              })
            );
            return Response.json(detail);
          } catch (error) {
            console.error("Session detail error:", error);
            return Response.json(
              { error: "Failed to load session" },
              { status: 500 }
            );
          }
        }
      }

      if (pathname === "/api/settings") {
        // Simplified settings for CLI mode
        return Response.json({
          theme: "system",
          scanOnLaunch: true,
          scanIntervalMinutes: 5,
          customPaths: {},
          schedulerEnabled: false,
        });
      }

      // ─── Static Files ────────────────────────────────────────────────────

      // Serve index.html for root and non-API routes (SPA fallback)
      if (pathname === "/" || !pathname.startsWith("/api")) {
        const staticResponse = serveStatic(pathname);
        if (staticResponse) {
          return staticResponse;
        }

        // SPA fallback - serve index.html for client-side routing
        if (!pathname.includes(".")) {
          const indexResponse = serveStatic("/");
          if (indexResponse) {
            return indexResponse;
          }
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`\nDaedux dashboard running at http://localhost:${port}`);
  console.log("Press Ctrl+C to stop\n");

  // Keep the server running
  await new Promise(() => {});
}

// ─── JSON Output Mode ────────────────────────────────────────────────────────

export async function outputJson(filter?: string): Promise<void> {
  try {
    const syncResult = await runEffect(runSync(false));
    const dateFilter = parseDateFilter(filter);
    const data = await runEffect(loadDashboardData(dateFilter));

    console.log(
      JSON.stringify(
        {
          ...data,
          _meta: {
            syncedSessions: syncResult.synced,
            unchangedSessions: syncResult.unchanged,
            errors: syncResult.errors,
            generatedAt: new Date().toISOString(),
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(JSON.stringify({ error: String(error) }));
    process.exit(1);
  }
}
