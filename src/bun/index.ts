import { dlopen, FFIType } from "bun:ffi";
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

import { modelDisplayNameWithVersion } from "../shared/model-utils";
import type {
  UsageMonitorRPC,
  DashboardData,
  TrayStats,
  AppSettings,
  SyncResult,
  DateFilter,
  SessionSummary,
  SessionSchedule,
  AnthropicUsage,
  AppInfo,
} from "../shared/rpc-types";
import { SessionAnalyticsService } from "./analytics/session-analytics";
import { ModelAnalyticsService } from "./analytics/model-analytics";
import { ToolAnalyticsService } from "./analytics/tool-analytics";
import { FileAnalyticsService } from "./analytics/file-analytics";
import { AgentAnalyticsService } from "./analytics/agent-analytics";
import { ContextAnalyticsService } from "./analytics/context-analytics";
import { InsightsAnalyticsService } from "./analytics/insights-analytics";
import { initializeDatabase } from "./db/migrate";
import { AppLive } from "./main";
import { AnthropicUsageService } from "./services/anthropic-usage";
import { SchedulerService, parseDaysOfWeek } from "./services/scheduler";
import { SyncService } from "./sync";
import { toDateString } from "./utils/formatting";
import {
  formatRateLimitItem,
  formatExtraUsage,
  formatSubscriptionHeader,
  formatDailyStats,
} from "./utils/tray-formatting";

// ─── App State ──────────────────────────────────────────────────────────────

const isMac = process.platform === "darwin";

// macOS native window effect constants
const MAC_TRAFFIC_LIGHTS_X = 14;
const MAC_TRAFFIC_LIGHTS_Y = 22; // Vertically centered with header content

// Header height for native drag region (matches py-3 padding + content)
const MAC_HEADER_HEIGHT = 60;

// Reference to the loaded native library for drag exclusion zones
let nativeLib: ReturnType<
  typeof dlopen<{
    enableWindowVibrancy: {
      args: [typeof FFIType.ptr];
      returns: typeof FFIType.bool;
    };
    ensureWindowShadow: {
      args: [typeof FFIType.ptr];
      returns: typeof FFIType.bool;
    };
    setWindowTrafficLightsPosition: {
      args: [typeof FFIType.ptr, typeof FFIType.f64, typeof FFIType.f64];
      returns: typeof FFIType.bool;
    };
    setNativeWindowDragRegion: {
      args: [typeof FFIType.ptr, typeof FFIType.f64, typeof FFIType.f64];
      returns: typeof FFIType.bool;
    };
    setDragExclusionZones: {
      args: [typeof FFIType.ptr, typeof FFIType.ptr, typeof FFIType.i32];
      returns: typeof FFIType.bool;
    };
    extendTitlebarWithToolbar: {
      args: [typeof FFIType.ptr];
      returns: typeof FFIType.bool;
    };
  }>
> | null = null;

/**
 * Update drag exclusion zones - areas where clicks pass through to the WebView.
 * Called from renderer when button positions change.
 */
function updateDragExclusionZones(
  zones: { x: number; y: number; width: number; height: number }[]
) {
  if (!mainWindow || !nativeLib) {
    return false;
  }

  // Flatten zones to contiguous Float64Array: [x1, y1, w1, h1, x2, y2, w2, h2, ...]
  const flatArray = new Float64Array(zones.length * 4);
  zones.forEach((zone, i) => {
    flatArray[i * 4] = zone.x;
    flatArray[i * 4 + 1] = zone.y;
    flatArray[i * 4 + 2] = zone.width;
    flatArray[i * 4 + 3] = zone.height;
  });

  return nativeLib.symbols.setDragExclusionZones(
    mainWindow.ptr,
    flatArray,
    zones.length
  );
}

/**
 * Apply native macOS vibrancy, traffic light positioning, and drag region.
 * Uses FFI to call into libMacWindowEffects.dylib.
 *
 * The native drag view captures mouse events for window dragging, but uses
 * exclusion zones to pass clicks through to buttons in the header.
 */
function applyMacOSWindowEffects(window: BrowserWindow) {
  if (!isMac) {
    return;
  }

  const dylibPath = join(import.meta.dir, "libMacWindowEffects.dylib");

  if (!existsSync(dylibPath)) {
    console.warn(
      `[macos] Native effects lib not found at ${dylibPath}. Falling back to transparent-only mode.`
    );
    return;
  }

  try {
    nativeLib = dlopen(dylibPath, {
      enableWindowVibrancy: {
        args: [FFIType.ptr],
        returns: FFIType.bool,
      },
      ensureWindowShadow: {
        args: [FFIType.ptr],
        returns: FFIType.bool,
      },
      extendTitlebarWithToolbar: {
        args: [FFIType.ptr],
        returns: FFIType.bool,
      },
      setDragExclusionZones: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
        returns: FFIType.bool,
      },
      setNativeWindowDragRegion: {
        args: [FFIType.ptr, FFIType.f64, FFIType.f64],
        returns: FFIType.bool,
      },
      setWindowTrafficLightsPosition: {
        args: [FFIType.ptr, FFIType.f64, FFIType.f64],
        returns: FFIType.bool,
      },
    });

    const vibrancyEnabled = nativeLib.symbols.enableWindowVibrancy(window.ptr);
    const shadowEnabled = nativeLib.symbols.ensureWindowShadow(window.ptr);
    const toolbarExtended = nativeLib.symbols.extendTitlebarWithToolbar(
      window.ptr
    );

    const alignButtons = () =>
      nativeLib!.symbols.setWindowTrafficLightsPosition(
        window.ptr,
        MAC_TRAFFIC_LIGHTS_X,
        MAC_TRAFFIC_LIGHTS_Y
      );

    const buttonsAlignedNow = alignButtons();

    // Set up native drag region for header area
    // X offset accounts for traffic lights area
    const dragRegionEnabled = nativeLib.symbols.setNativeWindowDragRegion(
      window.ptr,
      0, // Start from left edge - exclusion zones handle traffic lights
      MAC_HEADER_HEIGHT
    );

    // Re-align after brief delay (window may still be setting up)
    setTimeout(() => {
      alignButtons();
    }, 120);

    // Re-align on resize
    window.on("resize", () => {
      alignButtons();
    });

    console.log(
      `[macos] Native effects applied (vibrancy=${vibrancyEnabled}, shadow=${shadowEnabled}, toolbar=${toolbarExtended}, trafficLights=${buttonsAlignedNow}, dragRegion=${dragRegionEnabled})`
    );
  } catch (error) {
    console.warn("[macos] Failed to apply native window effects:", error);
  }
}

let isScanning = false;
let isQuitting = false;
let lastScanAt: string | null = null;
let scanIntervalId: ReturnType<typeof setInterval> | null = null;
let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
let usageIntervalId: ReturnType<typeof setInterval> | null = null;
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
      return { endTime: now, startTime: start.getTime() };
    }
    case "7d": {
      return { endTime: now, startTime: now - 7 * 86_400_000 };
    }
    case "30d": {
      return { endTime: now, startTime: now - 30 * 86_400_000 };
    }
    case "all": {
      // Explicit full range: epoch to now
      // This ensures buildComparisonWindows detects hasFilter=true
      // and uses our bounds instead of defaulting to 7 days
      return { startTime: 0, endTime: now };
    }
    default: {
      // No filter specified (undefined/null) - returns empty
      return {};
    }
  }
};

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
        onTimeout: () => new Error(`Operation timed out after ${timeoutMs}ms`),
      })
    )
  );

// ─── Dashboard Data Loading ─────────────────────────────────────────────────

const loadDashboardData = (dateFilter: DateFilter = {}) =>
  Effect.gen(function* loadDashboardData() {
    yield* Effect.logDebug("Loading dashboard data");
    // DEBUG: Log incoming dateFilter
    console.log("[dashboard] dateFilter input:", JSON.stringify(dateFilter));
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
      efficiencyScoreBase,
      weeklyComparison,
      agentROI,
      toolHealthReportCard,
      skillROI,
      hookStats,
      skillImpact,
      outcomeMetrics,
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
      insightsService.getOutcomeMetrics(dateFilter),
    ]);

    // Merge outcome metrics into efficiency score
    const efficiencyScore = {
      ...efficiencyScoreBase,
      ...outcomeMetrics,
    };

    // DEBUG: Log outcome metrics to diagnose zero values
    console.log("[dashboard] outcomeMetrics:", JSON.stringify(outcomeMetrics));
    console.log(
      "[dashboard] efficiencyScore.vcsActivityCount:",
      efficiencyScore.vcsActivityCount
    );
    console.log(
      "[dashboard] efficiencyScore.prsCreated:",
      efficiencyScore.prsCreated
    );

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
        // Exclude cacheRead - we want output relative to NEW tokens sent
        // (fresh input + newly cached content), not efficiently reused cached context
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
      topPrompts,
      totals: dashboardTotals,
      weeklyComparison,
    } as DashboardData;
  }).pipe(Effect.withSpan("rpc.loadDashboardData"));

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
    console.error("[scan] Failed", error);
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
    console.warn("[rpc] Failed to send message to webview", error);
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
      console.warn("[rpc] Failed to send queued message to webview", error);
    }
  }
};

// ─── Tray Menu ──────────────────────────────────────────────────────────────

const buildTrayMenu = (stats: TrayStats) => {
  const { anthropicUsage } = stats;

  type TrayMenuItem =
    | { label: string; type: "normal"; enabled?: boolean; action?: string }
    | { type: "separator" };

  const items: TrayMenuItem[] = [];

  // ── Subscription Header ──
  if (anthropicUsage && anthropicUsage.source !== "unavailable") {
    if (anthropicUsage.subscription) {
      items.push({
        enabled: false,
        label: formatSubscriptionHeader(anthropicUsage.subscription.type),
        type: "normal" as const,
      });
    }

    // ── Rate Limits Section ── (only with real API data)
    if (anthropicUsage.source === "oauth" || anthropicUsage.source === "cli") {
      // Session usage (5-hour window)
      items.push({
        enabled: false,
        label: formatRateLimitItem(
          "Session",
          anthropicUsage.session.percentUsed,
          "5h"
        ),
        type: "normal" as const,
      });

      // Weekly usage (7-day window)
      items.push({
        enabled: false,
        label: formatRateLimitItem(
          "Weekly",
          anthropicUsage.weekly.percentUsed,
          "7d"
        ),
        type: "normal" as const,
      });

      // Model-specific limits if available
      if (anthropicUsage.opus) {
        items.push({
          enabled: false,
          label: formatRateLimitItem("Opus", anthropicUsage.opus.percentUsed),
          type: "normal" as const,
        });
      }

      if (anthropicUsage.sonnet) {
        items.push({
          enabled: false,
          label: formatRateLimitItem(
            "Sonnet",
            anthropicUsage.sonnet.percentUsed
          ),
          type: "normal" as const,
        });
      }

      // ── Extra Usage Section ── (Max subscribers overage)
      if (anthropicUsage.extraUsage) {
        items.push({ type: "separator" as const });
        items.push({
          enabled: false,
          label: formatExtraUsage(
            anthropicUsage.extraUsage.spentUsd,
            anthropicUsage.extraUsage.limitUsd
          ),
          type: "normal" as const,
        });
      }
    }

    items.push({ type: "separator" as const });
  }

  // ── Daily Stats Section ──
  items.push({
    enabled: false,
    label: formatDailyStats(stats.todaySessions, stats.todayCost),
    type: "normal" as const,
  });

  // ── Actions ──
  items.push(
    { type: "separator" as const },
    {
      action: "show-dashboard",
      label: "Show Dashboard",
      type: "normal" as const,
    },
    {
      action: "rescan-sessions",
      enabled: !isScanning,
      label: isScanning ? "Scanning..." : "Rescan Sessions",
      type: "normal" as const,
    }
  );

  // ── Update Actions ──
  if (updateAvailable && updateVersion) {
    items.push({
      action: "install-update",
      label: `Install Update (v${updateVersion})`,
      type: "normal" as const,
    });
  } else {
    items.push({
      action: "check-for-updates",
      label: "Check for Updates",
      type: "normal" as const,
    });
  }

  items.push(
    { type: "separator" as const },
    {
      action: "quit-app",
      label: "Quit",
      type: "normal" as const,
    }
  );

  return items;
};

const updateTrayMenu = async () => {
  if (!tray) {
    return;
  }

  try {
    const stats = await getTrayStats();
    tray.setMenu(buildTrayMenu(stats));
  } catch (error) {
    console.warn("[tray] Failed to update stats", error);
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
    tray.setMenu(buildTrayMenu(stats));
  } catch (error) {
    console.warn("[tray] Failed to update stats (quick)", error);
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
    applyMacOSWindowEffects(window);
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

// ─── Background Scan ────────────────────────────────────────────────────────

const configureBackgroundScan = (intervalMinutes: number) => {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }

  const safeMinutes = Number.isFinite(intervalMinutes)
    ? Math.max(1, Math.floor(intervalMinutes))
    : 5;
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
      Effect.gen(function* schedulerIntervalId() {
        const scheduler = yield* SchedulerService;
        yield* scheduler.checkSchedules();
      })
    ).catch((error) => {
      console.warn("[scheduler] Check failed:", error);
    });
  }, 60_000);

  // Also run an immediate check for any missed schedules
  void runEffect(
    Effect.gen(function* configureScheduler() {
      const scheduler = yield* SchedulerService;
      const missed = yield* scheduler.checkMissedSchedules();
      if (missed.length > 0) {
        console.log(`[scheduler] Executed ${missed.length} missed schedule(s)`);
      }
    })
  ).catch((error) => {
    console.warn("[scheduler] Missed check failed:", error);
  });
};

// ─── Usage Refresh Configuration ─────────────────────────────────────────────

/**
 * Configure periodic refresh of Anthropic usage data.
 * Keeps tray menu usage limits up-to-date without relying on user actions.
 */
const configureUsageRefresh = (intervalMinutes = 5) => {
  if (usageIntervalId) {
    clearInterval(usageIntervalId);
    usageIntervalId = null;
  }

  console.log(`[usage] Starting usage refresh (every ${intervalMinutes}m)`);

  usageIntervalId = setInterval(() => {
    void runEffect(
      Effect.gen(function* usageIntervalId() {
        const anthropicService = yield* AnthropicUsageService;
        // refreshUsage bypasses cache, forcing a fresh CLI probe
        yield* anthropicService.refreshUsage();
      })
    )
      .then(() => {
        void updateTrayMenu();
      })
      .catch((error) => {
        console.warn("[usage] Refresh failed:", error);
      });
  }, intervalMinutes * 60_000);
};

// ─── RPC Definition ─────────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<UsageMonitorRPC>({
  handlers: {
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
            stderr: "ignore",
            stdin: "ignore",
            stdout: "ignore",
          });
        } catch (error) {
          console.warn(`[rpc] Failed to open URL: ${url}`, error);
        }
      },
    },

    requests: {
      getDashboardData: async ({ filter }) => {
        const dateFilter = parseDateFilter(filter);
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

      updateDragExclusionZones: async ({ zones }) => {
        const success = updateDragExclusionZones(zones);
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
    console.warn("[tray] Icon not found; creating tray without an image");
  }

  tray = new Tray({
    ...(trayIconPath ? { image: trayIconPath } : {}),
    height: 18,
    template: false,
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
      console.log(`[update] Update available: ${result.version}`);

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
    console.warn("[update] Failed to check for updates:", error);
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
    console.error("[update] Failed to apply update:", error);
    Utils.showNotification({
      body: "Failed to apply update. Please try again later.",
      title: "Update Failed",
    });
  }
};

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const bootstrap = async () => {
  // Initialize database schema
  initializeDatabase();

  // Set up application menu
  refreshApplicationMenu();

  // Configure background scan
  configureBackgroundScan(settings.scanIntervalMinutes);

  // Configure periodic usage refresh (every 5 minutes)
  configureUsageRefresh(5);

  // Configure scheduler if enabled
  if (settings.schedulerEnabled) {
    configureScheduler(true);
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

  if (usageIntervalId) {
    clearInterval(usageIntervalId);
    usageIntervalId = null;
  }

  if (tray) {
    tray.remove();
    tray = null;
  }

  // Dispose the managed runtime to clean up Effect fibers
  if (managedRuntime) {
    managedRuntime.dispose();
    managedRuntime = null;
  }
});
