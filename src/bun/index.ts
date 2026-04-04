import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { Duration, Effect, ManagedRuntime } from "effect";
import type { Layer } from "effect";
import Electrobun, {
  ApplicationMenu,
  BrowserView,
  BrowserWindow,
  PATHS,
  Tray,
  Updater,
  Utils,
} from "electrobun/bun";

import { parseDateFilter } from "../shared/date-filter";
import type {
  UsageMonitorRPC,
  TrayStats,
  AppSettings,
  SyncResult,
  DateFilter,
  SessionSummary,
  SessionSchedule,
  AnthropicUsage,
  AppInfo,
  OtelStatus,
  OtelDashboardData,
} from "../shared/rpc-types";
import { AgentAnalyticsService } from "./analytics/agent-analytics";
import { ContextAnalyticsService } from "./analytics/context-analytics";
import { FileAnalyticsService } from "./analytics/file-analytics";
import { ModelAnalyticsService } from "./analytics/model-analytics";
import { SessionAnalyticsService } from "./analytics/session-analytics";
import { ToolAnalyticsService } from "./analytics/tool-analytics";
import { initializeDatabase } from "./db/migrate";
import { TimeoutError } from "./errors";
import {
  configureBackgroundScan,
  configureScheduler,
  configureUsageRefresh,
} from "./lifecycle/intervals";
import { AppLive } from "./main";
import {
  applyMacOSWindowEffects,
  updateDragExclusionZones,
} from "./native/macos-effects";
import type { NativeLib } from "./native/macos-effects";
import { getOtelStatus, getOtelDashboardData } from "./otel/analytics";
import {
  handleMetrics,
  handleLogs,
  buildSuccessResponse,
  buildClientErrorResponse,
  buildServerErrorResponse,
} from "./otel/receiver";
import { cleanupOtelData } from "./otel/retention";
import { AnthropicUsageService } from "./services/anthropic-usage";
import { loadDashboardData } from "./services/dashboard-loader";
import { SchedulerService, parseDaysOfWeek } from "./services/scheduler";
import { SyncService } from "./sync";
import { buildTrayMenu } from "./tray/menu";
import { toDateString } from "./utils/formatting";
import { log } from "./utils/log";

// ─── App State ──────────────────────────────────────────────────────────────

const isMac = process.platform === "darwin";

// Reference to the loaded native library for drag exclusion zones
let nativeLib: NativeLib | null = null;

let isScanning = false;
let isQuitting = false;
let lastScanAt: string | null = null;
let scanIntervalId: ReturnType<typeof setInterval> | null = null;
let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
let usageRefreshHandle: { cancel: () => void } | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isMainViewReady = false;
const pendingWebviewMessages: (() => void)[] = [];

// Cached Anthropic usage for tray updates (avoid refetch during sync)
let cachedAnthropicUsage: AnthropicUsage | null = null;

// Update state
let updateAvailable = false;
let updateVersion: string | null = null;

// App settings (persisted via settings file)
let settings: AppSettings = {
  customPaths: {},
  scanIntervalMinutes: 5,
  scanOnLaunch: true,
  schedulerEnabled: false,
  theme: "system", // Off by default until user enables it
  otel: {
    enabled: true,
    retentionDays: 30,
    roiHourlyDevCost: 50,
    roiMinutesPerLoc: 3,
    roiMinutesPerCommit: 15,
  },
};

Electrobun.events.on("before-quit", () => {
  isQuitting = true;
});

// ─── Effect Pipeline Runners ────────────────────────────────────────────────

/** Type alias for the services provided by AppLive */
type AppContext = Layer.Layer.Success<typeof AppLive>;

/**
 * Shared ManagedRuntime instance - ensures all Effect fibers share the same
 * synchronization context, making semaphores work correctly across calls.
 *
 * Without this, each Effect.runPromise() creates a new runtime, and semaphores
 * don't synchronize across different runtimes (causing race conditions).
 */
let managedRuntime: ManagedRuntime.ManagedRuntime<AppContext, never> | null =
  null;

const getRuntime = () => {
  if (!managedRuntime) {
    managedRuntime = ManagedRuntime.make(AppLive);
  }
  return managedRuntime;
};

/**
 * Run an Effect with the shared ManagedRuntime.
 * Using a single runtime ensures semaphores work correctly across all calls.
 * Includes a 30-second timeout to prevent indefinite hangs from blocking the UI.
 */
const runEffect = <A, E>(
  effect: Effect.Effect<A, E, AppContext>,
  timeoutMs = 30_000
): Promise<A> =>
  getRuntime().runPromise(
    effect.pipe(
      Effect.timeoutFail({
        duration: Duration.millis(timeoutMs),
        onTimeout: () => new TimeoutError({ durationMs: timeoutMs }),
      })
    )
  );

// ─── Sync Operations ────────────────────────────────────────────────────────

const runSync = (fullResync = false) =>
  Effect.gen(function* runSync() {
    const syncService = yield* SyncService;
    return fullResync
      ? yield* syncService.fullResync({ verbose: false })
      : yield* syncService.syncIncremental({ verbose: false });
  }).pipe(Effect.withSpan("rpc.runSync", { attributes: { fullResync } }));

const runSyncWithNotifications = async (
  fullScan = false
): Promise<SyncResult> => {
  if (isScanning) {
    return { errors: 0, synced: 0, total: 0, unchanged: 0 };
  }

  isScanning = true;
  // Use quick update to show "Scanning..." without triggering CLI probe
  void updateTrayMenuQuick();
  dispatchToWebview(() => {
    rpc.send.syncStarted({});
  });

  try {
    const result = await runEffect(runSync(fullScan));
    lastScanAt = new Date().toISOString();

    dispatchToWebview(() => {
      rpc.send.syncCompleted({ errors: result.errors, synced: result.synced });
    });
    dispatchToWebview(() => {
      rpc.send.sessionsUpdated({
        scanResult: { scanned: result.synced, total: result.total },
      });
    });

    return result;
  } catch (error) {
    log.error("scan", "Failed", error);
    return { errors: 1, synced: 0, total: 0, unchanged: 0 };
  } finally {
    isScanning = false;
    // Use quick update here too - we'll get fresh usage from periodic refresh
    void updateTrayMenuQuick();
  }
};

// ─── Tray Stats ─────────────────────────────────────────────────────────────

/**
 * Full tray stats - fetches fresh Anthropic usage data.
 * Use for initial load and periodic refresh (every 5 min).
 */
const getTrayStats = async (): Promise<TrayStats> => {
  const dateFilter = parseDateFilter("today");

  try {
    const result = await runEffect(
      Effect.gen(function* result() {
        const sessions = yield* SessionAnalyticsService;
        const anthropicService = yield* AnthropicUsageService;

        const [totals, anthropicUsage] = yield* Effect.all([
          sessions.getTotals(dateFilter),
          anthropicService.getUsage(),
        ]);

        return { anthropicUsage, totals };
      })
    );

    const { totals, anthropicUsage } = result;

    // Cache usage for quick updates during sync
    cachedAnthropicUsage = anthropicUsage;

    return {
      activeSessions: 0,
      anthropicUsage,
      todayCost: totals.totalCost,
      todayEvents: totals.totalQueries + totals.totalToolUses,
      todaySessions: totals.totalSessions,
      todayTokens:
        totals.totalInputTokens +
        totals.totalOutputTokens +
        totals.totalCacheRead +
        totals.totalCacheWrite,
    };
  } catch {
    return {
      activeSessions: 0,
      todayCost: 0,
      todayEvents: 0,
      todaySessions: 0,
      todayTokens: 0,
    };
  }
};

/**
 * Quick tray stats - reuses cached Anthropic usage.
 * Use during sync start/end to update "Scanning..." label without
 * triggering expensive CLI probes.
 */
const getTrayStatsQuick = async (): Promise<TrayStats> => {
  const dateFilter = parseDateFilter("today");

  try {
    const totals = await runEffect(
      Effect.gen(function* totals() {
        const sessions = yield* SessionAnalyticsService;
        return yield* sessions.getTotals(dateFilter);
      })
    );

    return {
      activeSessions: 0,
      anthropicUsage: cachedAnthropicUsage ?? undefined,
      todayCost: totals.totalCost,
      todayEvents: totals.totalQueries + totals.totalToolUses,
      todaySessions: totals.totalSessions,
      todayTokens:
        totals.totalInputTokens +
        totals.totalOutputTokens +
        totals.totalCacheRead +
        totals.totalCacheWrite,
    };
  } catch {
    return {
      activeSessions: 0,
      anthropicUsage: cachedAnthropicUsage ?? undefined,
      todayCost: 0,
      todayEvents: 0,
      todaySessions: 0,
      todayTokens: 0,
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
    if (parent === current) {
      break;
    }
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
    log.warn("rpc", "Failed to send message to webview", error);
  }
};

const flushPendingWebviewMessages = () => {
  if (!isMainViewReady || !mainWindow) {
    return;
  }

  const queued = pendingWebviewMessages.splice(0);
  for (const send of queued) {
    try {
      send();
    } catch (error) {
      log.warn("rpc", "Failed to send queued message to webview", error);
    }
  }
};

// ─── Tray Menu ──────────────────────────────────────────────────────────────

const getTrayMenuState = () => ({
  isScanning,
  updateAvailable,
  updateVersion,
});

const updateTrayMenu = async () => {
  if (!tray) {
    return;
  }

  try {
    const stats = await getTrayStats();
    tray.setMenu(buildTrayMenu(stats, getTrayMenuState()));

    // Push usage data to frontend cache so settings page renders instantly
    if (stats.anthropicUsage) {
      dispatchToWebview(() => {
        rpc.send.usageUpdated(stats.anthropicUsage!);
      });
    }
  } catch (error) {
    log.warn("tray", "Failed to update stats", error);
  }
};

/**
 * Quick tray menu update - reuses cached Anthropic usage.
 * Use during sync to update "Scanning..." label without triggering CLI probes.
 */
const updateTrayMenuQuick = async () => {
  if (!tray) {
    return;
  }

  try {
    const stats = await getTrayStatsQuick();
    tray.setMenu(buildTrayMenu(stats, getTrayMenuState()));
  } catch (error) {
    log.warn("tray", "Failed to update stats (quick)", error);
  }
};

// ─── Window Management ──────────────────────────────────────────────────────

const createMainWindow = () => {
  const devUrl =
    process.env.ELECTROBUN_RENDERER_URL ??
    process.env.VITE_DEV_SERVER_URL ??
    null;
  const url =
    devUrl && devUrl.trim().length > 0 ? devUrl : "views://mainview/index.html";
  isMainViewReady = false;

  const window = new BrowserWindow({
    title: "Daedux",
    frame: {
      height: 860,
      width: 1320,
      x: 64,
      y: 64,
    },
    url,
    renderer: "native",
    rpc,
    // macOS: Use hidden inset title bar with native traffic lights, and enable transparency for vibrancy
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          transparent: true,
        }
      : {
          titleBarStyle: "default" as const,
        }),
  });

  // Apply native macOS vibrancy effects
  if (isMac) {
    nativeLib = applyMacOSWindowEffects(
      window,
      import.meta.dir,
      (isFullscreen) => {
        rpc.send.fullscreenChanged({ isFullscreen });
      }
    );
  }

  const webviewWithEvents = window.webview as unknown as {
    on?: (event: string, handler: () => void) => void;
  };

  if (typeof webviewWithEvents.on === "function") {
    webviewWithEvents.on("dom-ready", () => {
      if (mainWindow !== window) {
        return;
      }
      isMainViewReady = true;
      flushPendingWebviewMessages();
    });
  } else {
    queueMicrotask(() => {
      if (mainWindow !== window) {
        return;
      }
      isMainViewReady = true;
      flushPendingWebviewMessages();
    });
  }

  // Fallback: if dom-ready is lost (e.g. FFI bridge garbles the event during
  // a message burst), flush pending messages after a timeout so the app still loads.
  setTimeout(() => {
    if (!isMainViewReady && mainWindow === window) {
      log.warn(
        "webview",
        "dom-ready not received within 5s, flushing pending messages"
      );
      isMainViewReady = true;
      flushPendingWebviewMessages();
    }
  }, 5000);

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
    return { created: false, window: mainWindow };
  }

  mainWindow = createMainWindow();
  return { created: true, window: mainWindow };
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

// ─── Background Task Helpers ────────────────────────────────────────────────

const resetBackgroundScan = (intervalMinutes: number) => {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
  scanIntervalId = configureBackgroundScan(intervalMinutes, () => {
    void runSyncWithNotifications(false);
  });
};

const resetScheduler = (enabled: boolean) => {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }
  schedulerIntervalId = configureScheduler(enabled, runEffect);
};

const resetUsageRefresh = (intervalMinutes = 20) => {
  usageRefreshHandle?.cancel();
  usageRefreshHandle = configureUsageRefresh(intervalMinutes, runEffect, () => {
    void updateTrayMenu();
  });
};

// ─── RPC Definition ─────────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<UsageMonitorRPC>({
  handlers: {
    messages: {
      log: ({ msg, level }) => {
        if (level === "warn") {
          log.warn("webview", msg);
        } else if (level === "error") {
          log.error("webview", msg);
        } else {
          log.info("webview", msg);
        }
      },

      openExternal: ({ url }) => {
        // Only allow specific URL patterns
        if (!url.startsWith("https://")) {
          log.warn("rpc", `Rejected openExternal for non-HTTPS URL: ${url}`);
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
            stderr: "ignore",
            stdin: "ignore",
            stdout: "ignore",
          });
        } catch (error) {
          log.warn("rpc", `Failed to open URL: ${url}`, error);
        }
      },
    },

    requests: {
      getDashboardData: async ({ filter, harness }) => {
        const dateFilter: DateFilter = {
          ...parseDateFilter(filter),
          harness,
        };
        return runEffect(loadDashboardData(dateFilter));
      },

      getAnalytics: async ({ category, filter }) => {
        const dateFilter = parseDateFilter(filter);
        // Return category-specific analytics
        return runEffect(
          Effect.gen(function* getAnalytics() {
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
                const [
                  toolUsage,
                  toolHealth,
                  bashCommands,
                  hookStats,
                  apiErrors,
                  agentStats,
                  skillROI,
                ] = yield* Effect.all([
                  tools.getToolUsage(dateFilter),
                  tools.getToolHealth(dateFilter),
                  tools.getBashCommandStats(dateFilter),
                  agents.getHookStats(dateFilter),
                  tools.getApiErrors(dateFilter),
                  agents.getAgentStats(dateFilter),
                  agents.getSkillROI(dateFilter),
                ]);
                return {
                  agentStats,
                  apiErrors,
                  bashCommands,
                  hookStats,
                  skillROI,
                  toolHealth,
                  toolUsage,
                };
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
                const [
                  contextHeatmap,
                  cacheEfficiencyCurve,
                  compactionAnalysis,
                  contextWindowFill,
                ] = yield* Effect.all([
                  context.getContextHeatmap(dateFilter),
                  context.getCacheEfficiencyCurve(dateFilter),
                  context.getCompactionAnalysis(dateFilter),
                  context.getContextWindowFill(dateFilter),
                ]);
                return {
                  cacheEfficiencyCurve,
                  compactionAnalysis,
                  contextHeatmap,
                  contextWindowFill,
                };
              }
              default: {
                return {};
              }
            }
          })
        );
      },

      getSessionDetail: async ({ sessionId }) =>
        runEffect(
          Effect.gen(function* getSessionDetail() {
            const sessions = yield* SessionAnalyticsService;
            const list = yield* sessions.getSessionSummaries({
              dateFilter: {},
              includeSubagents: true,
            });
            const session = list.find((s) => s.sessionId === sessionId);
            if (!session) {
              return null;
            }

            // Transform to SessionSummary format
            return {
              bashCommandCount: 0,
              cacheCreation: session.totalCacheWrite ?? 0,
              cacheRead: session.totalCacheRead ?? 0,
              compactions: session.compactions ?? 0,
              date: toDateString(session.startTime),
              displayName: session.displayName,
              durationMs: session.durationMs ?? 0,
              fileActivityDetails: [],
              fileEditCount: 0,
              fileReadCount: 0,
              fileWriteCount: 0,
              firstPrompt: session.displayName ?? "Session",
              harness: (session.harness ?? "claude-code") as
                | "claude-code"
                | "codex"
                | "opencode"
                | "unknown",
              isSubagent: session.isSubagent ?? false,
              model: "claude-sonnet-4-5-20251022",
              modelShort: "Sonnet",
              output: session.totalOutputTokens ?? 0,
              project: session.projectPath,
              queries: [],
              queryCount: session.queryCount ?? 0,
              savedByCaching: session.savedByCaching ?? 0,
              sessionId: session.sessionId,
              startTime: session.startTime,
              subagentCount: 0,
              toolCounts: {},
              toolErrorCount: 0,
              toolUseCount: session.toolUseCount ?? 0,
              totalCost: session.totalCost ?? 0,
              totalTokens:
                (session.totalInputTokens ?? 0) +
                (session.totalOutputTokens ?? 0),
              turnCount: session.turnCount ?? 0,
              uncachedInput: session.totalInputTokens ?? 0,
            } satisfies SessionSummary;
          })
        ),

      triggerSync: async ({ fullResync }) =>
        runSyncWithNotifications(fullResync ?? false),

      getSyncStatus: async () => {
        const sessionCount = await runEffect(
          Effect.gen(function* sessionCount() {
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

      getTrayStats: async () => getTrayStats(),

      getSettings: async () => settings,

      updateSettings: async (patch) => {
        settings = { ...settings, ...patch };

        if (patch.scanIntervalMinutes !== undefined) {
          resetBackgroundScan(patch.scanIntervalMinutes);
        }

        if (patch.schedulerEnabled !== undefined) {
          resetScheduler(patch.schedulerEnabled);
        }

        if (patch.theme !== undefined) {
          dispatchToWebview(() => {
            rpc.send.themeChanged({ theme: patch.theme! });
          });
        }

        return true;
      },

      // ─── Schedule Management ────────────────────────────────────────────
      getSchedules: async () =>
        runEffect(
          Effect.gen(function* getSchedules() {
            const scheduler = yield* SchedulerService;
            const schedules = yield* scheduler.getSchedules();

            // Transform DB records to RPC format
            return schedules.map(
              (s): SessionSchedule => ({
                createdAt: s.createdAt,
                daysOfWeek: parseDaysOfWeek(s.daysOfWeek),
                enabled: s.enabled ?? true,
                hour: s.hour,
                id: s.id,
                lastRunAt: s.lastRunAt,
                minute: s.minute,
                name: s.name,
                nextRunAt: s.nextRunAt,
              })
            );
          })
        ),

      createSchedule: async (input) =>
        runEffect(
          Effect.gen(function* createSchedule() {
            const scheduler = yield* SchedulerService;
            const schedule = yield* scheduler.createSchedule(input);

            return {
              createdAt: schedule.createdAt,
              daysOfWeek: parseDaysOfWeek(schedule.daysOfWeek),
              enabled: schedule.enabled ?? true,
              hour: schedule.hour,
              id: schedule.id,
              lastRunAt: schedule.lastRunAt,
              minute: schedule.minute,
              name: schedule.name,
              nextRunAt: schedule.nextRunAt,
            } satisfies SessionSchedule;
          })
        ),

      updateSchedule: async ({ id, patch }) =>
        runEffect(
          Effect.gen(function* updateSchedule() {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.updateSchedule(id, patch);
          })
        ),

      deleteSchedule: async ({ id }) =>
        runEffect(
          Effect.gen(function* deleteSchedule() {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.deleteSchedule(id);
          })
        ),

      runScheduleNow: async ({ id }) => {
        const result = await runEffect(
          Effect.gen(function* result() {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.runScheduleNow(id);
          })
        );

        // Notify webview of execution result
        dispatchToWebview(() => {
          rpc.send.scheduleExecuted({ result, scheduleId: id });
        });

        return result;
      },

      getScheduleHistory: async ({ scheduleId, limit }) =>
        runEffect(
          Effect.gen(function* getScheduleHistory() {
            const scheduler = yield* SchedulerService;
            const history = yield* scheduler.getScheduleHistory(
              scheduleId,
              limit ?? 20
            );

            // Cast status to union type (DB stores as string)
            return history.map((h) => ({
              ...h,
              status: h.status as "success" | "error" | "skipped",
            }));
          })
        ),

      getAuthStatus: async () =>
        runEffect(
          Effect.gen(function* getAuthStatus() {
            const scheduler = yield* SchedulerService;
            return yield* scheduler.checkAuthStatus();
          })
        ),

      getAnthropicUsage: async () =>
        runEffect(
          Effect.gen(function* getAnthropicUsage() {
            const anthropicService = yield* AnthropicUsageService;
            return yield* anthropicService.getUsage();
          })
        ),

      getAppInfo: async (): Promise<AppInfo> => {
        // Read version from package.json
        const packageJson = await Bun.file(
          join(import.meta.dir, "../../package.json")
        ).json();
        const version = packageJson.version ?? "0.0.0";

        // Construct ARM64 DMG download URL for macOS
        const downloadUrl = `https://github.com/agentika-labs/daedux/releases/download/v${version}/daedux-${version}-darwin-arm64.dmg`;

        return {
          downloadUrl,
          updateAvailable,
          updateVersion,
          version,
        };
      },

      // ─── OTEL Endpoints ────────────────────────────────────────────────
      getOtelStatus: async (): Promise<OtelStatus> =>
        runEffect(getOtelStatus()),

      getOtelAnalytics: async ({
        filter,
        harness,
      }): Promise<OtelDashboardData> => {
        const dateFilter = parseDateFilter(filter);
        return runEffect(getOtelDashboardData({ ...dateFilter, harness }));
      },

      updateDragExclusionZones: async ({ zones }) => {
        if (!mainWindow || !nativeLib) {
          return { success: false };
        }
        const success = updateDragExclusionZones(
          zones,
          mainWindow.ptr,
          nativeLib
        );
        return { success };
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
            label: "Daedux",
            submenu: [
              {
                action: "show-dashboard",
                label: "Show Dashboard",
              },
              {
                action: "rescan-sessions",
                enabled: !isScanning,
                label: "Rescan Sessions",
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
          action: "rescan-sessions",
          enabled: !isScanning,
          label: "Rescan Sessions",
        },
        { type: "separator" as const },
        { role: "quit" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          action: "toggle-dark-mode",
          label:
            settings.theme === "dark"
              ? "Switch to Light Mode"
              : "Switch to Dark Mode",
          type: "normal" as const,
        },
      ],
    },
  ]);
};

const toggleDarkMode = () => {
  const nextTheme: AppSettings["theme"] =
    settings.theme === "dark" ? "light" : "dark";
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
    log.warn("tray", "Icon not found; creating tray without an image");
  }

  tray = new Tray({
    ...(trayIconPath ? { image: trayIconPath } : {}),
    height: 18,
    template: true,
    width: 18,
  });

  // Set initial menu immediately so tray is responsive while stats load
  tray.setMenu([
    { enabled: false, label: "Loading...", type: "normal" as const },
    { type: "separator" as const },
    {
      action: "show-dashboard",
      label: "Show Dashboard",
      type: "normal" as const,
    },
    {
      action: "rescan-sessions",
      label: "Rescan Sessions",
      type: "normal" as const,
    },
    { type: "separator" as const },
    { action: "quit-app", label: "Quit", type: "normal" as const },
  ]);

  tray.on("tray-clicked", (event: unknown) => {
    const getAction = (e: unknown): string => {
      if (!e || typeof e !== "object") {
        return "";
      }
      const { data } = e as { data?: unknown };
      if (!data || typeof data !== "object") {
        return "";
      }
      const { action } = data as { action?: unknown };
      return typeof action === "string" ? action : "";
    };

    const action = getAction(event);

    switch (action) {
      case "show-dashboard": {
        showMainWindow();
        break;
      }
      case "rescan-sessions": {
        void runSyncWithNotifications(false);
        break;
      }
      case "check-for-updates": {
        void checkForUpdates(false);
        break;
      }
      case "install-update": {
        void downloadAndApplyUpdate();
        break;
      }
      case "quit-app": {
        quitApp();
        break;
      }
      default: {
        showMainWindow();
        break;
      }
    }
  });

  void updateTrayMenu();
};

// ─── Application Menu Events ────────────────────────────────────────────────

ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
  const getAction = (e: unknown): string => {
    if (!e || typeof e !== "object") {
      return "";
    }
    const { data } = e as { data?: unknown };
    if (!data || typeof data !== "object") {
      return "";
    }
    const { action } = data as { action?: unknown };
    return typeof action === "string" ? action : "";
  };

  const action = getAction(event);

  switch (action) {
    case "show-dashboard": {
      showMainWindow();
      break;
    }
    case "rescan-sessions": {
      void runSyncWithNotifications(false);
      break;
    }
    case "toggle-dark-mode": {
      toggleDarkMode();
      break;
    }
  }
});

// ─── Auto-Updates ───────────────────────────────────────────────────────────

/**
 * Check for app updates and update tray menu if available.
 * Silently fails in dev mode or if update check fails.
 */
const checkForUpdates = async (silent = true) => {
  try {
    const result = await Updater.checkForUpdate();

    if (result.updateAvailable) {
      updateAvailable = true;
      updateVersion = result.version;
      log.info("update", `Update available: ${result.version}`);

      // Refresh tray to show update indicator
      void updateTrayMenuQuick();

      // Show notification unless silent
      if (!silent) {
        Utils.showNotification({
          body: `Version ${result.version} is available. Click "Check for Updates" in the tray menu to install.`,
          title: "Update Available",
        });
      }
    } else if (!silent) {
      Utils.showNotification({
        body: "You're running the latest version.",
        title: "No Updates Available",
      });
    }
  } catch (error) {
    // Silently fail - updates are optional
    log.warn("update", "Failed to check for updates:", error);
  }
};

/**
 * Download and apply update, then restart the app.
 */
const downloadAndApplyUpdate = async () => {
  try {
    Utils.showNotification({
      body: "Downloading update... The app will restart when ready.",
      title: "Downloading Update",
    });

    await Updater.downloadUpdate();

    const info = Updater.updateInfo();
    if (info?.updateReady) {
      Utils.showNotification({
        body: "Update downloaded. Restarting...",
        title: "Installing Update",
      });
      await Updater.applyUpdate();
    } else {
      Utils.showNotification({
        body:
          info?.error || "Failed to download update. Please try again later.",
        title: "Update Failed",
      });
    }
  } catch (error) {
    log.error("update", "Failed to apply update:", error);
    Utils.showNotification({
      body: "Failed to apply update. Please try again later.",
      title: "Update Failed",
    });
  }
};

// ─── OTEL HTTP Server ───────────────────────────────────────────────────────

const OTEL_PORT = 4318; // Standard OTLP HTTP port

let otelServer: ReturnType<typeof Bun.serve> | null = null;

const startOtelServer = () => {
  if (!settings.otel?.enabled) {
    return;
  }

  otelServer = Bun.serve({
    port: OTEL_PORT,
    fetch: async (req) => {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (url.pathname === "/v1/metrics" && req.method === "POST") {
        try {
          const body = await req.json();
          await runEffect(handleMetrics(body));
          return Response.json(buildSuccessResponse());
        } catch (error) {
          const errorStr = String(error);
          const isParseError = errorStr.includes("ParseError");
          return Response.json(
            isParseError
              ? buildClientErrorResponse(errorStr)
              : buildServerErrorResponse(errorStr),
            { status: isParseError ? 400 : 500 }
          );
        }
      }

      if (url.pathname === "/v1/logs" && req.method === "POST") {
        try {
          const body = await req.json();
          await runEffect(handleLogs(body));
          return Response.json(buildSuccessResponse());
        } catch (error) {
          const errorStr = String(error);
          const isParseError = errorStr.includes("ParseError");
          return Response.json(
            isParseError
              ? buildClientErrorResponse(errorStr)
              : buildServerErrorResponse(errorStr),
            { status: isParseError ? 400 : 500 }
          );
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  log.info("otel", `OTEL receiver listening on port ${OTEL_PORT}`);
};

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const bootstrap = async () => {
  // Force all Effect layers to build NOW, before the webview can make RPC calls.
  // ManagedRuntime.make() is lazy — layers only construct on first runPromise call.
  await getRuntime().runPromise(Effect.void);

  // Initialize database schema
  initializeDatabase();

  // Run OTEL data cleanup on startup if enabled
  if (settings.otel?.enabled) {
    const retentionDays = settings.otel.retentionDays ?? 30;
    void runEffect(cleanupOtelData(retentionDays));
  }

  // Start OTEL HTTP receiver if enabled
  startOtelServer();

  // Set up application menu
  refreshApplicationMenu();

  // Configure background scan
  resetBackgroundScan(settings.scanIntervalMinutes);

  // Configure periodic usage refresh (dynamically adjusts based on retry-after)
  resetUsageRefresh(20);

  // Configure scheduler if enabled
  if (settings.schedulerEnabled) {
    resetScheduler(true);
  }

  // Initial sync if enabled
  if (settings.scanOnLaunch) {
    await runSyncWithNotifications(false);
  }

  // Check for updates in background (silent)
  void checkForUpdates(true);
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

  usageRefreshHandle?.cancel();
  usageRefreshHandle = null;

  if (tray) {
    tray.remove();
    tray = null;
  }

  // Stop OTEL server
  if (otelServer) {
    otelServer.stop();
    otelServer = null;
  }

  // Dispose the managed runtime to clean up Effect fibers
  if (managedRuntime) {
    managedRuntime.dispose();
    managedRuntime = null;
  }
});
