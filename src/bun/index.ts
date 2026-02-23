import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, type Layer } from "effect";
import Electrobun, {
  ApplicationMenu,
  BrowserView,
  BrowserWindow,
  PATHS,
  Tray,
  Utils,
} from "electrobun/bun";

import type {
  UsageMonitorRPC,
  DashboardData,
  TrayStats,
  AppSettings,
  SyncResult,
  DateFilter,
  SessionSummary,
  SessionSchedule,
} from "../shared/rpc-types";

import { initializeDatabase } from "./db/migrate";
import { AppLive } from "./main";
import { SyncService } from "./sync";
import {
  SessionAnalyticsService,
  ModelAnalyticsService,
  ToolAnalyticsService,
  FileAnalyticsService,
  AgentAnalyticsService,
  ContextAnalyticsService,
  InsightsAnalyticsService,
} from "./analytics/index";
import { SchedulerService, parseDaysOfWeek } from "./services/scheduler";
import { modelDisplayNameWithVersion } from "./utils/pricing";
import { totalInputWithCache } from "./metrics";

// ─── App State ──────────────────────────────────────────────────────────────

const isMac = process.platform === "darwin";
let isScanning = false;
let isQuitting = false;
let lastScanAt: string | null = null;
let scanIntervalId: ReturnType<typeof setInterval> | null = null;
let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isMainViewReady = false;
const pendingWebviewMessages: Array<() => void> = [];

// App settings (persisted via settings file)
let settings: AppSettings = {
  theme: "system",
  scanOnLaunch: true,
  scanIntervalMinutes: 5,
  customPaths: {},
  schedulerEnabled: false, // Off by default until user enables it
};

Electrobun.events.on("before-quit", () => {
  isQuitting = true;
});

// ─── Date Filter Parsing ────────────────────────────────────────────────────

const parseDateFilter = (filter?: string): DateFilter => {
  const now = Date.now();

  switch (filter) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { startTime: start.getTime(), endTime: now };
    }
    case "7d":
      return { startTime: now - 7 * 86400000, endTime: now };
    case "30d":
      return { startTime: now - 30 * 86400000, endTime: now };
    default:
      return {}; // 'all' or no filter
  }
};

// ─── Effect Pipeline Runners ────────────────────────────────────────────────

/** Type alias for the services provided by AppLive */
type AppContext = Layer.Layer.Success<typeof AppLive>;

/**
 * Run an Effect with the AppLive layer and return a Promise.
 */
const runEffect = <A, E>(effect: Effect.Effect<A, E, AppContext>): Promise<A> => {
  return Effect.runPromise(effect.pipe(Effect.provide(AppLive)));
};

// ─── Dashboard Data Loading ─────────────────────────────────────────────────

/** Convert timestamp (ms) to YYYY-MM-DD string in local timezone */
const toDateString = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
    ] = yield* Effect.all([
      sessions.getTotals(dateFilter),
      sessions.getExtendedTotals(dateFilter),
      sessions.getDailyStats(undefined, dateFilter),
      sessions.getSessionSummaries({ includeSubagents: false, dateFilter }),
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
    ]);

    // Transform data for dashboard
    const totalTokens = totals.totalInputTokens + totals.totalOutputTokens;

    const dashboardTotals = {
      ...totals,
      totalTokens,
      output: totals.totalOutputTokens,
      uncachedInput: totals.totalInputTokens,
      cacheRead: totals.totalCacheRead,
      cacheCreation: totals.totalCacheWrite,
      savedByCaching: extendedTotals.savedByCaching,
      cacheEfficiencyRatio: extendedTotals.cacheEfficiencyRatio,
      cacheSavingsUsd: extendedTotals.savedByCaching,
      avgCostPerSession: extendedTotals.avgCostPerSession,
      avgCostPerQuery: extendedTotals.avgCostPerQuery,
      avgSessionDurationMs: extendedTotals.avgSessionDurationMs,
      dateRange: extendedTotals.dateRange,
      costPerEdit:
        extendedTotals.totalFileOperations > 0
          ? totals.totalCost / extendedTotals.totalFileOperations
          : 0,
      totalFileOperations: extendedTotals.totalFileOperations,
      contextEfficiencyScore: extendedTotals.cacheEfficiencyRatio * 100,
      avgContextUtilization: extendedTotals.cacheEfficiencyRatio,
      agentLeverageRatio: extendedTotals.agentLeverageRatio,
      totalAgentSpawns: extendedTotals.totalAgentSpawns,
      promptEfficiencyRatio: (() => {
        const fullInputContext = totalInputWithCache({
          uncachedInput: totals.totalInputTokens,
          cacheRead: totals.totalCacheRead,
          cacheWrite: totals.totalCacheWrite,
        });
        return fullInputContext > 0 ? totals.totalOutputTokens / fullInputContext : 0;
      })(),
      totalSkillInvocations: extendedTotals.totalSkillInvocations,
    };

    // Transform sessions
    const dashboardSessions = sessionList.map((s) => {
      const sessionModel = sessionPrimaryModels.get(s.sessionId) ?? "claude-sonnet-4-5-20251022";
      const sessionTools = sessionToolCounts.get(s.sessionId) ?? {};
      const sessionFileOps = sessionFileOperations.get(s.sessionId) ?? [];

      return {
        sessionId: s.sessionId,
        project: s.projectPath,
        date: toDateString(s.startTime),
        displayName: s.displayName,
        startTime: s.startTime,
        durationMs: s.durationMs ?? 0,
        totalCost: s.totalCost ?? 0,
        queryCount: s.queryCount ?? 0,
        toolUseCount: s.toolUseCount ?? 0,
        isSubagent: s.isSubagent ?? false,
        model: sessionModel,
        modelShort: modelDisplayNameWithVersion(sessionModel),
        firstPrompt: s.displayName ?? "Session",
        totalTokens: (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0),
        savedByCaching: s.savedByCaching ?? 0,
        uncachedInput: s.totalInputTokens ?? 0,
        cacheRead: s.totalCacheRead ?? 0,
        cacheCreation: s.totalCacheWrite ?? 0,
        output: s.totalOutputTokens ?? 0,
        compactions: s.compactions ?? 0,
        subagentCount: sessionAgentCounts.get(s.sessionId) ?? 0,
        toolErrorCount: sessionToolErrorCounts.get(s.sessionId) ?? 0,
        bashCommandCount: sessionTools.Bash ?? 0,
        fileReadCount: sessionFileOps.filter((op) => op.tool === "Read").length,
        fileEditCount: sessionFileOps.filter((op) => op.tool === "Edit").length,
        fileWriteCount: sessionFileOps.filter((op) => op.tool === "Write").length,
        toolCounts: sessionTools,
        queries: [],
        fileActivityDetails: sessionFileOps,
      } satisfies SessionSummary;
    });

    // Transform insights
    const transformedInsights = insights.map((i) => ({
      type: (i.type === "tip" ? "info" : i.type) as "success" | "warning" | "info",
      title: i.title,
      description: i.message,
      action: i.action ?? "",
      priority: i.priority,
      comparison: i.comparison,
    }));

    return {
      totals: dashboardTotals,
      dailyUsage: dailyStats,
      sessions: dashboardSessions,
      projects,
      insights: transformedInsights,
      efficiencyScore,
      weeklyComparison,
      modelBreakdown,
      toolUsage,
      topPrompts,
      toolHealth,
      agentROI,
      toolHealthReportCard,
    } as DashboardData;
  });

// ─── Sync Operations ────────────────────────────────────────────────────────

const runSync = (fullResync = false) =>
  Effect.gen(function* () {
    const syncService = yield* SyncService;
    return fullResync
      ? yield* syncService.fullResync({ verbose: false })
      : yield* syncService.syncIncremental({ verbose: false });
  });

const runSyncWithNotifications = async (fullScan = false): Promise<SyncResult> => {
  if (isScanning) {
    return { synced: 0, total: 0, unchanged: 0, errors: 0 };
  }

  isScanning = true;
  updateTrayMenu();
  dispatchToWebview(() => {
    rpc.send.syncStarted({});
  });

  try {
    const result = await runEffect(runSync(fullScan));
    lastScanAt = new Date().toISOString();

    dispatchToWebview(() => {
      rpc.send.syncCompleted({ synced: result.synced, errors: result.errors });
    });
    dispatchToWebview(() => {
      rpc.send.sessionsUpdated({
        scanResult: { scanned: result.synced, total: result.total },
      });
    });

    return result;
  } catch (error) {
    console.error("[scan] Failed", error);
    return { synced: 0, total: 0, unchanged: 0, errors: 1 };
  } finally {
    isScanning = false;
    updateTrayMenu();
  }
};

// ─── Tray Stats ─────────────────────────────────────────────────────────────

const getTrayStats = async (): Promise<TrayStats> => {
  const dateFilter = parseDateFilter("today");

  try {
    const totals = await runEffect(
      Effect.gen(function* () {
        const sessions = yield* SessionAnalyticsService;
        return yield* sessions.getTotals(dateFilter);
      })
    );

    return {
      todayTokens:
        totals.totalInputTokens +
        totals.totalOutputTokens +
        totals.totalCacheRead +
        totals.totalCacheWrite,
      todayCost: totals.totalCost,
      todaySessions: totals.totalSessions,
      todayEvents: totals.totalQueries + totals.totalToolUses,
      activeSessions: 0,
    };
  } catch {
    return {
      todayTokens: 0,
      todayCost: 0,
      todaySessions: 0,
      todayEvents: 0,
      activeSessions: 0,
    };
  }
};

// ─── Tray Icon ──────────────────────────────────────────────────────────────

const resolveTrayIconPath = (): string => {
  const bundledPath = join(PATHS.VIEWS_FOLDER, "mainview", "tray-icon.png");
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  // In dev builds, find the project-level public/tray-icon.png
  let current = process.cwd();
  while (true) {
    const candidate = join(current, "public", "tray-icon.png");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return "";
};

// ─── Webview Messaging ──────────────────────────────────────────────────────

const dispatchToWebview = (send: () => void) => {
  if (!isMainViewReady || !mainWindow) {
    pendingWebviewMessages.push(send);
    return;
  }

  try {
    send();
  } catch (error) {
    console.warn("[rpc] Failed to send message to webview", error);
  }
};

const flushPendingWebviewMessages = () => {
  if (!isMainViewReady || !mainWindow) return;

  const queued = pendingWebviewMessages.splice(0);
  for (const send of queued) {
    try {
      send();
    } catch (error) {
      console.warn("[rpc] Failed to send queued message to webview", error);
    }
  }
};

// ─── Tray Menu ──────────────────────────────────────────────────────────────

const buildTrayMenu = (stats: TrayStats) => [
  {
    label: `${stats.todaySessions} sessions today`,
    type: "normal" as const,
    enabled: false,
  },
  {
    label: `$${stats.todayCost.toFixed(2)} today`,
    type: "normal" as const,
    enabled: false,
  },
  { type: "separator" as const },
  {
    label: "Show Dashboard",
    type: "normal" as const,
    action: "show-dashboard",
  },
  {
    label: isScanning ? "Scanning..." : "Rescan Sessions",
    type: "normal" as const,
    action: "rescan-sessions",
    enabled: !isScanning,
  },
  { type: "separator" as const },
  {
    label: "Quit",
    type: "normal" as const,
    action: "quit-app",
  },
];

const updateTrayMenu = async () => {
  if (!tray) return;

  try {
    const stats = await getTrayStats();
    tray.setMenu(buildTrayMenu(stats));
  } catch (error) {
    console.warn("[tray] Failed to update stats", error);
  }
};

// ─── Window Management ──────────────────────────────────────────────────────

const createMainWindow = () => {
  const devUrl = process.env.ELECTROBUN_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL ?? null;
  const url = devUrl && devUrl.trim().length > 0 ? devUrl : "views://mainview/index.html";
  isMainViewReady = false;

  const window = new BrowserWindow({
    title: "Claude Usage Monitor",
    frame: {
      x: 64,
      y: 64,
      width: 1320,
      height: 860,
    },
    url,
    renderer: "native",
    titleBarStyle: "default",
    rpc,
  });

  const webviewWithEvents = window.webview as unknown as {
    on?: (event: string, handler: () => void) => void;
  };

  if (typeof webviewWithEvents.on === "function") {
    webviewWithEvents.on("dom-ready", () => {
      if (mainWindow !== window) return;
      isMainViewReady = true;
      flushPendingWebviewMessages();
    });
  } else {
    queueMicrotask(() => {
      if (mainWindow !== window) return;
      isMainViewReady = true;
      flushPendingWebviewMessages();
    });
  }

  window.on("close", () => {
    if (mainWindow === window) {
      mainWindow = null;
      isMainViewReady = false;
      pendingWebviewMessages.length = 0;
    }

    if (!isQuitting) {
      void updateTrayMenu();
    }
  });

  return window;
};

const ensureMainWindow = () => {
  if (mainWindow) {
    return { window: mainWindow, created: false };
  }

  mainWindow = createMainWindow();
  return { window: mainWindow, created: true };
};

const showMainWindow = () => {
  const { window } = ensureMainWindow();

  if (window.isMinimized()) {
    window.unminimize();
  }

  window.show();
  window.focus();
};

const quitApp = () => {
  isQuitting = true;
  Utils.quit();
};

// ─── Background Scan ────────────────────────────────────────────────────────

const configureBackgroundScan = (intervalMinutes: number) => {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }

  const safeMinutes = Number.isFinite(intervalMinutes) ? Math.max(1, Math.floor(intervalMinutes)) : 5;
  scanIntervalId = setInterval(() => {
    void runSyncWithNotifications(false);
  }, safeMinutes * 60_000);
};

// ─── Scheduler Configuration ─────────────────────────────────────────────────

const configureScheduler = (enabled: boolean) => {
  // Clear existing interval if any
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }

  if (!enabled) {
    console.log("[scheduler] Disabled");
    return;
  }

  console.log("[scheduler] Starting schedule checker (every 60s)");

  // Check schedules every minute
  schedulerIntervalId = setInterval(() => {
    void runEffect(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        yield* scheduler.checkSchedules();
      })
    ).catch((err) => {
      console.warn("[scheduler] Check failed:", err);
    });
  }, 60_000);

  // Also run an immediate check for any missed schedules
  void runEffect(
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      const missed = yield* scheduler.checkMissedSchedules();
      if (missed.length > 0) {
        console.log(`[scheduler] Executed ${missed.length} missed schedule(s)`);
      }
    })
  ).catch((err) => {
    console.warn("[scheduler] Missed check failed:", err);
  });
};

// ─── RPC Definition ─────────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<UsageMonitorRPC>({
  handlers: {
    requests: {
      getDashboardData: async ({ filter }) => {
        const dateFilter = parseDateFilter(filter);
        return runEffect(loadDashboardData(dateFilter));
      },

      getAnalytics: async ({ category, filter }) => {
        const dateFilter = parseDateFilter(filter);
        // Return category-specific analytics
        return runEffect(
          Effect.gen(function* () {
            switch (category) {
              case "models": {
                const models = yield* ModelAnalyticsService;
                const sessions = yield* SessionAnalyticsService;
                const [modelBreakdown, topPrompts] = yield* Effect.all([
                  models.getModelBreakdown(dateFilter),
                  sessions.getTopPrompts(30, dateFilter),
                ]);
                return { modelBreakdown, topPrompts };
              }
              case "tools": {
                const tools = yield* ToolAnalyticsService;
                const agents = yield* AgentAnalyticsService;
                const [toolUsage, toolHealth, bashCommands, hookStats, apiErrors, agentStats, skillROI] =
                  yield* Effect.all([
                    tools.getToolUsage(dateFilter),
                    tools.getToolHealth(dateFilter),
                    tools.getBashCommandStats(dateFilter),
                    agents.getHookStats(dateFilter),
                    tools.getApiErrors(dateFilter),
                    agents.getAgentStats(dateFilter),
                    agents.getSkillROI(dateFilter),
                  ]);
                return { toolUsage, toolHealth, bashCommands, hookStats, apiErrors, agentStats, skillROI };
              }
              case "files": {
                const files = yield* FileAnalyticsService;
                const [fileActivity, fileExtensions] = yield* Effect.all([
                  files.getFileActivity(50, dateFilter),
                  files.getFileExtensions(dateFilter),
                ]);
                return { fileActivity, fileExtensions };
              }
              case "context": {
                const context = yield* ContextAnalyticsService;
                const [contextHeatmap, cacheEfficiencyCurve, compactionAnalysis, contextWindowFill] =
                  yield* Effect.all([
                    context.getContextHeatmap(dateFilter),
                    context.getCacheEfficiencyCurve(dateFilter),
                    context.getCompactionAnalysis(dateFilter),
                    context.getContextWindowFill(dateFilter),
                  ]);
                return { contextHeatmap, cacheEfficiencyCurve, compactionAnalysis, contextWindowFill };
              }
              default:
                return {};
            }
          })
        );
      },

      getSessionDetail: async ({ sessionId }) => {
        // Return full session detail
        return runEffect(
          Effect.gen(function* () {
            const sessions = yield* SessionAnalyticsService;
            const list = yield* sessions.getSessionSummaries({ includeSubagents: true, dateFilter: {} });
            const session = list.find((s) => s.sessionId === sessionId);
            if (!session) return null;

            // Transform to SessionSummary format
            return {
              sessionId: session.sessionId,
              project: session.projectPath,
              date: toDateString(session.startTime),
              displayName: session.displayName,
              startTime: session.startTime,
              durationMs: session.durationMs ?? 0,
              totalCost: session.totalCost ?? 0,
              queryCount: session.queryCount ?? 0,
              toolUseCount: session.toolUseCount ?? 0,
              isSubagent: session.isSubagent ?? false,
              model: "claude-sonnet-4-5-20251022",
              modelShort: "Sonnet",
              firstPrompt: session.displayName ?? "Session",
              totalTokens: (session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0),
              savedByCaching: session.savedByCaching ?? 0,
              uncachedInput: session.totalInputTokens ?? 0,
              cacheRead: session.totalCacheRead ?? 0,
              cacheCreation: session.totalCacheWrite ?? 0,
              output: session.totalOutputTokens ?? 0,
              compactions: session.compactions ?? 0,
              subagentCount: 0,
              toolErrorCount: 0,
              bashCommandCount: 0,
              fileReadCount: 0,
              fileEditCount: 0,
              fileWriteCount: 0,
              toolCounts: {},
              queries: [],
              fileActivityDetails: [],
            } satisfies SessionSummary;
          })
        );
      },

      triggerSync: async ({ fullResync }) => {
        return runSyncWithNotifications(fullResync ?? false);
      },

      getSyncStatus: async () => {
        const sessionCount = await runEffect(
          Effect.gen(function* () {
            const sessions = yield* SessionAnalyticsService;
            const totals = yield* sessions.getTotals({});
            return totals.totalSessions;
          })
        );

        return {
          isScanning,
          lastScanAt,
          sessionCount,
        };
      },

      getTrayStats: async () => {
        return getTrayStats();
      },

      getSettings: async () => {
        return settings;
      },

      updateSettings: async (patch) => {
        settings = { ...settings, ...patch };

        if (patch.scanIntervalMinutes !== undefined) {
          configureBackgroundScan(patch.scanIntervalMinutes);
        }

        if (patch.schedulerEnabled !== undefined) {
          configureScheduler(patch.schedulerEnabled);
        }

        if (patch.theme !== undefined) {
          dispatchToWebview(() => {
            rpc.send.themeChanged({ theme: patch.theme! });
          });
        }

        return true;
      },

      // ─── Schedule Management ────────────────────────────────────────────
      getSchedules: async () => {
        return runEffect(
          Effect.gen(function* () {
            const scheduler = yield* SchedulerService;
            const schedules = yield* scheduler.getSchedules();

            // Transform DB records to RPC format
            return schedules.map(
              (s): SessionSchedule => ({
                id: s.id,
                name: s.name,
                enabled: s.enabled ?? true,
                hour: s.hour,
                minute: s.minute,
                daysOfWeek: parseDaysOfWeek(s.daysOfWeek),
                lastRunAt: s.lastRunAt,
                nextRunAt: s.nextRunAt,
                createdAt: s.createdAt,
              })
            );
          })
        );
      },

      createSchedule: async (input) => {
        return runEffect(
          Effect.gen(function* () {
            const scheduler = yield* SchedulerService;
            const schedule = yield* scheduler.createSchedule(input);

            return {
              id: schedule.id,
              name: schedule.name,
              enabled: schedule.enabled ?? true,
              hour: schedule.hour,
              minute: schedule.minute,
              daysOfWeek: parseDaysOfWeek(schedule.daysOfWeek),
              lastRunAt: schedule.lastRunAt,
              nextRunAt: schedule.nextRunAt,
              createdAt: schedule.createdAt,
            } satisfies SessionSchedule;
          })
        );
      },

      updateSchedule: async ({ id, patch }) => {
        return runEffect(
          Effect.gen(function* () {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.updateSchedule(id, patch);
          })
        );
      },

      deleteSchedule: async ({ id }) => {
        return runEffect(
          Effect.gen(function* () {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.deleteSchedule(id);
          })
        );
      },

      runScheduleNow: async ({ id }) => {
        const result = await runEffect(
          Effect.gen(function* () {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.runScheduleNow(id);
          })
        );

        // Notify webview of execution result
        dispatchToWebview(() => {
          rpc.send.scheduleExecuted({ scheduleId: id, result });
        });

        return result;
      },

      getScheduleHistory: async ({ scheduleId, limit }) => {
        return runEffect(
          Effect.gen(function* () {
            const scheduler = yield* SchedulerService;
            const history = yield* scheduler.getScheduleHistory(scheduleId, limit ?? 20);

            // Cast status to union type (DB stores as string)
            return history.map((h) => ({
              ...h,
              status: h.status as "success" | "error" | "skipped",
            }));
          })
        );
      },

      getAuthStatus: async () => {
        return runEffect(
          Effect.gen(function* () {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.checkAuthStatus();
          })
        );
      },
    },

    messages: {
      log: ({ msg, level }) => {
        if (level === "warn") {
          console.warn(`[webview] ${msg}`);
        } else if (level === "error") {
          console.error(`[webview] ${msg}`);
        } else {
          console.info(`[webview] ${msg}`);
        }
      },

      openExternal: ({ url }) => {
        // Only allow specific URL patterns
        if (!url.startsWith("https://")) {
          console.warn(`[rpc] Rejected openExternal for non-HTTPS URL: ${url}`);
          return;
        }

        try {
          const command =
            process.platform === "darwin"
              ? ["open", url]
              : process.platform === "win32"
                ? ["cmd", "/c", "start", "", url]
                : ["xdg-open", url];

          Bun.spawn(command, {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          });
        } catch (error) {
          console.warn(`[rpc] Failed to open URL: ${url}`, error);
        }
      },
    },
  },
});

// ─── Application Menu ───────────────────────────────────────────────────────

const refreshApplicationMenu = () => {
  ApplicationMenu.setApplicationMenu([
    ...(isMac
      ? [
          {
            label: "Claude Usage Monitor",
            submenu: [
              {
                label: "Show Dashboard",
                action: "show-dashboard",
              },
              {
                label: "Rescan Sessions",
                action: "rescan-sessions",
                enabled: !isScanning,
              },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Rescan Sessions",
          action: "rescan-sessions",
          enabled: !isScanning,
        },
        { type: "separator" as const },
        { role: "quit" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: settings.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
          type: "normal" as const,
          action: "toggle-dark-mode",
        },
      ],
    },
  ]);
};

const toggleDarkMode = () => {
  const nextTheme: AppSettings["theme"] = settings.theme === "dark" ? "light" : "dark";
  settings.theme = nextTheme;

  dispatchToWebview(() => {
    rpc.send.themeChanged({ theme: nextTheme });
  });
  refreshApplicationMenu();
};

// ─── Tray Setup ─────────────────────────────────────────────────────────────

const createTray = () => {
  const trayIconPath = resolveTrayIconPath();
  if (!trayIconPath) {
    console.warn("[tray] Icon not found; creating tray without an image");
  }

  tray = new Tray({
    ...(trayIconPath ? { image: trayIconPath } : {}),
    template: false,
    width: 18,
    height: 18,
  });

  tray.on("tray-clicked", (event: unknown) => {
    const getAction = (e: unknown): string => {
      if (!e || typeof e !== "object") return "";
      const data = (e as { data?: unknown }).data;
      if (!data || typeof data !== "object") return "";
      const action = (data as { action?: unknown }).action;
      return typeof action === "string" ? action : "";
    };

    const action = getAction(event);

    switch (action) {
      case "show-dashboard":
        showMainWindow();
        break;
      case "rescan-sessions":
        void runSyncWithNotifications(false);
        break;
      case "quit-app":
        quitApp();
        break;
      default:
        showMainWindow();
        break;
    }
  });

  void updateTrayMenu();
};

// ─── Application Menu Events ────────────────────────────────────────────────

ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
  const getAction = (e: unknown): string => {
    if (!e || typeof e !== "object") return "";
    const data = (e as { data?: unknown }).data;
    if (!data || typeof data !== "object") return "";
    const action = (data as { action?: unknown }).action;
    return typeof action === "string" ? action : "";
  };

  const action = getAction(event);

  switch (action) {
    case "show-dashboard":
      showMainWindow();
      break;
    case "rescan-sessions":
      void runSyncWithNotifications(false);
      break;
    case "toggle-dark-mode":
      toggleDarkMode();
      break;
  }
});

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const bootstrap = async () => {
  // Initialize database schema
  initializeDatabase();

  // Set up application menu
  refreshApplicationMenu();

  // Configure background scan
  configureBackgroundScan(settings.scanIntervalMinutes);

  // Configure scheduler if enabled
  if (settings.schedulerEnabled) {
    configureScheduler(true);
  }

  // Initial sync if enabled
  if (settings.scanOnLaunch) {
    await runSyncWithNotifications(false);
  }
};

// Initialize
mainWindow = createMainWindow();
createTray();
void bootstrap();

// Cleanup on exit
process.on("exit", () => {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }

  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }

  if (tray) {
    tray.remove();
    tray = null;
  }
});
