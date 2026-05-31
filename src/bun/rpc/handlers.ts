import { Effect } from "effect";

import {
  CostUsd,
  ProjectPath,
  SessionId,
  UnixTimestampMs,
} from "../../shared/branded";
import { parseDateFilter } from "../../shared/date-filter";
import type {
  DateFilter,
  SessionSummary,
  SessionSchedule,
  AppInfo,
  OtelStatus,
  OtelDashboardData,
  HarnessId,
  ScheduleInput,
  ScheduleExecution,
  ExecutionResult,
  AppSettings,
  AgentHarnessConfigId,
} from "../../shared/rpc-types";
import { AgentAnalyticsService } from "../analytics/agent-analytics";
import { ContextAnalyticsService } from "../analytics/context-analytics";
import { FileAnalyticsService } from "../analytics/file-analytics";
import { ModelAnalyticsService } from "../analytics/model-analytics";
import { SessionAnalyticsService } from "../analytics/session-analytics";
import { ToolAnalyticsService } from "../analytics/tool-analytics";
import { runEffect } from "../app/runtime";
import {
  getIsScanning,
  getLastScanAt,
  getMainWindow,
  getNativeLib,
  getSettings,
  getUpdateAvailable,
  getUpdateVersion,
  setSettings,
} from "../app/state";
import { updateDragExclusionZones } from "../native/macos-effects";
import { getOtelStatus, getOtelDashboardData } from "../otel/analytics";
import {
  copyAgentSkill,
  getAgentHarnessesSnapshot,
  updateAgentConfigFile,
} from "../services/agent-harnesses";
import { AnalyticsOrchestrator } from "../services/analytics-orchestrator";
import { SchedulerService, parseDaysOfWeek } from "../services/scheduler";
import { saveSettings } from "../services/settings";
import { toDateString } from "../utils/formatting";
import { log } from "../utils/log";
import { APP_VERSION } from "../version";

// ─── Message Handlers ───────────────────────────────────────────────────────

export const handleLog = ({
  msg,
  level,
}: {
  msg: string;
  level?: "info" | "warn" | "error";
}): void => {
  if (level === "warn") {
    log.warn("webview", msg);
  } else if (level === "error") {
    log.error("webview", msg);
  } else {
    log.info("webview", msg);
  }
};

export const handleOpenExternal = ({ url }: { url: string }): void => {
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
};

// ─── Dashboard Handlers ─────────────────────────────────────────────────────

export const handleGetDashboardData = async ({
  filter,
  harness,
}: {
  filter?: "today" | "7d" | "30d" | "all";
  projectPath?: string;
  harness?: HarnessId;
}) => {
  const dateFilter: DateFilter = {
    ...parseDateFilter(filter ?? "all"),
    harness,
  };
  return runEffect(
    Effect.gen(function* () {
      const orchestrator = yield* AnalyticsOrchestrator;
      return yield* orchestrator.getDashboard({ dateFilter });
    })
  );
};

export const handleGetAnalytics = async ({
  category,
  filter,
}: {
  category: string;
  filter?: string;
  projectPath?: string;
}) => {
  const dateFilter = parseDateFilter(filter ?? "all");
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
};

export const handleGetSessionDetail = async ({
  sessionId,
}: {
  sessionId: string;
}): Promise<SessionSummary | null> =>
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
        project: ProjectPath(session.projectPath),
        queries: [],
        queryCount: session.queryCount ?? 0,
        savedByCaching: CostUsd(session.savedByCaching ?? 0),
        sessionId: SessionId(session.sessionId),
        startTime: UnixTimestampMs(session.startTime),
        subagentCount: 0,
        toolCounts: {},
        toolErrorCount: 0,
        toolUseCount: session.toolUseCount ?? 0,
        totalCost: CostUsd(session.totalCost ?? 0),
        totalTokens:
          (session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0),
        turnCount: session.turnCount ?? 0,
        uncachedInput: session.totalInputTokens ?? 0,
      } satisfies SessionSummary;
    })
  );

// ─── Sync Handlers ──────────────────────────────────────────────────────────

export const handleGetSyncStatus = async () => {
  const sessionCount = await runEffect(
    Effect.gen(function* sessionCount() {
      const sessions = yield* SessionAnalyticsService;
      const totals = yield* sessions.getTotals({});
      return totals.totalSessions;
    })
  );

  return {
    isScanning: getIsScanning(),
    lastScanAt: getLastScanAt(),
    sessionCount,
  };
};

// ─── Settings Handlers ──────────────────────────────────────────────────────

export const handleGetSettings = async () => getSettings();

export interface SettingsUpdateCallbacks {
  onScanIntervalChanged: (minutes: number) => void;
  onSchedulerEnabledChanged: (enabled: boolean) => void;
  onThemeChanged: (theme: "system" | "light" | "dark") => void;
}

export const handleUpdateSettings = async (
  patch: Partial<AppSettings>,
  callbacks: SettingsUpdateCallbacks
): Promise<boolean> => {
  const currentSettings = getSettings();
  const newSettings = { ...currentSettings, ...patch };
  setSettings(newSettings);
  saveSettings(newSettings);

  if (patch.scanIntervalMinutes !== undefined) {
    callbacks.onScanIntervalChanged(patch.scanIntervalMinutes);
  }

  if (patch.schedulerEnabled !== undefined) {
    callbacks.onSchedulerEnabledChanged(patch.schedulerEnabled);
  }

  if (patch.theme !== undefined) {
    callbacks.onThemeChanged(patch.theme);
  }

  return true;
};

// ─── Schedule Handlers ──────────────────────────────────────────────────────

export const handleGetSchedules = async (): Promise<SessionSchedule[]> =>
  runEffect(
    Effect.gen(function* getSchedules() {
      const scheduler = yield* SchedulerService;
      const schedules = yield* scheduler.getSchedules();

      return schedules.map(
        (s): SessionSchedule => ({
          createdAt: s.createdAt,
          daysOfWeek: parseDaysOfWeek(s.daysOfWeek),
          enabled: s.enabled ?? true,
          hour: s.hour,
          id: String(s.id),
          lastRunAt: s.lastRunAt,
          minute: s.minute,
          name: s.name,
          nextRunAt: s.nextRunAt,
        })
      );
    })
  );

export const handleCreateSchedule = async (
  input: ScheduleInput
): Promise<SessionSchedule> =>
  runEffect(
    Effect.gen(function* createSchedule() {
      const scheduler = yield* SchedulerService;
      const schedule = yield* scheduler.createSchedule(input);

      return {
        createdAt: schedule.createdAt,
        daysOfWeek: parseDaysOfWeek(schedule.daysOfWeek),
        enabled: schedule.enabled ?? true,
        hour: schedule.hour,
        id: String(schedule.id),
        lastRunAt: schedule.lastRunAt,
        minute: schedule.minute,
        name: schedule.name,
        nextRunAt: schedule.nextRunAt,
      } satisfies SessionSchedule;
    })
  );

export const handleUpdateSchedule = async ({
  id,
  patch,
}: {
  id: string;
  patch: Partial<ScheduleInput>;
}): Promise<boolean> =>
  runEffect(
    Effect.gen(function* updateSchedule() {
      const scheduler = yield* SchedulerService;
      return yield* scheduler.updateSchedule(id, patch);
    })
  );

export const handleDeleteSchedule = async ({
  id,
}: {
  id: string;
}): Promise<boolean> =>
  runEffect(
    Effect.gen(function* deleteSchedule() {
      const scheduler = yield* SchedulerService;
      return yield* scheduler.deleteSchedule(id);
    })
  );

export const handleRunScheduleNow = async (
  { id }: { id: string },
  onScheduleExecuted: (scheduleId: string, result: ExecutionResult) => void
): Promise<ExecutionResult> => {
  const result = await runEffect(
    Effect.gen(function* result() {
      const scheduler = yield* SchedulerService;
      return yield* scheduler.runScheduleNow(id);
    })
  );

  onScheduleExecuted(id, result);
  return result;
};

export const handleGetScheduleHistory = async ({
  scheduleId,
  limit,
}: {
  scheduleId: string;
  limit?: number;
}): Promise<ScheduleExecution[]> =>
  runEffect(
    Effect.gen(function* getScheduleHistory() {
      const scheduler = yield* SchedulerService;
      const history = yield* scheduler.getScheduleHistory(
        scheduleId,
        limit ?? 20
      );

      return history.map(
        (h): ScheduleExecution => ({
          id: h.id,
          scheduleId: String(h.scheduleId),
          executedAt: h.executedAt,
          status: h.status as "success" | "error" | "skipped",
          errorMessage: h.errorMessage,
          sessionId: h.sessionId,
          durationMs: h.durationMs,
        })
      );
    })
  );

export const handleGetAuthStatus = async () =>
  runEffect(
    Effect.gen(function* getAuthStatus() {
      const scheduler = yield* SchedulerService;
      return yield* scheduler.checkAuthStatus();
    })
  );

// ─── Anthropic Usage Handler ────────────────────────────────────────────────

export const handleGetAppInfo = async (): Promise<AppInfo> => {
  const downloadUrl = `https://github.com/agentika-labs/daedux/releases/download/v${APP_VERSION}/daedux-${APP_VERSION}-darwin-arm64.dmg`;

  return {
    downloadUrl,
    updateAvailable: getUpdateAvailable(),
    updateVersion: getUpdateVersion(),
    version: APP_VERSION,
  };
};

// ─── OTEL Handlers ──────────────────────────────────────────────────────────

export const handleGetOtelStatus = async (): Promise<OtelStatus> =>
  runEffect(getOtelStatus());

export const handleGetOtelAnalytics = async ({
  filter,
  harness,
}: {
  filter?: "today" | "7d" | "30d" | "all";
  harness?: HarnessId;
}): Promise<OtelDashboardData> => {
  const dateFilter = parseDateFilter(filter ?? "all");
  return runEffect(getOtelDashboardData({ ...dateFilter, harness }));
};

// ─── Drag Exclusion Zones Handler ───────────────────────────────────────────

export const handleUpdateDragExclusionZones = async ({
  zones,
}: {
  zones: { x: number; y: number; width: number; height: number }[];
}): Promise<{ success: boolean }> => {
  const mainWindow = getMainWindow();
  const nativeLib = getNativeLib();

  if (!mainWindow || !nativeLib) {
    return { success: false };
  }

  const success = updateDragExclusionZones(zones, mainWindow.ptr, nativeLib);
  return { success };
};

// ─── Agent Harness Config Handlers ─────────────────────────────────────────

export const handleGetAgentHarnesses = async () => getAgentHarnessesSnapshot();

export const handleUpdateAgentConfigFile = async ({
  harnessId,
  path,
  content,
}: {
  harnessId: AgentHarnessConfigId;
  path: string;
  content: string;
}) => updateAgentConfigFile({ content, harnessId, path });

export const handleCopyAgentSkill = async ({
  sourcePath,
  targetHarnessId,
  overwrite,
}: {
  sourcePath: string;
  targetHarnessId: AgentHarnessConfigId;
  overwrite?: boolean;
}) => copyAgentSkill({ overwrite, sourcePath, targetHarnessId });
