import Electrobun, { BrowserView } from "electrobun/bun";

import type { UsageMonitorRPC } from "../shared/rpc-types";
import {
  bootstrap,
  resetBackgroundScan,
  resetScheduler,
} from "./app/bootstrap";
import { registerCleanupHandler } from "./app/lifecycle";
import { refreshApplicationMenu, toggleDarkMode } from "./app/menu";
import { setIsQuitting, setMainWindow } from "./app/state";
import type { SyncCallbacks } from "./app/sync-operations";
import { runSyncWithNotifications } from "./app/sync-operations";
import { checkForUpdates, downloadAndApplyUpdate } from "./app/updates";
import {
  handleMetrics,
  handleLogs,
  buildSuccessResponse,
  buildClientErrorResponse,
  buildServerErrorResponse,
} from "./otel/receiver";
import {
  handleLog,
  handleOpenExternal,
  handleGetDashboardData,
  handleGetAnalytics,
  handleGetSessionDetail,
  handleGetSyncStatus,
  handleGetSettings,
  handleUpdateSettings,
  handleGetSchedules,
  handleCreateSchedule,
  handleUpdateSchedule,
  handleDeleteSchedule,
  handleRunScheduleNow,
  handleGetScheduleHistory,
  handleGetAuthStatus,
  handleGetAppInfo,
  handleGetOtelStatus,
  handleGetOtelAnalytics,
  handleUpdateDragExclusionZones,
  handleGetAgentHarnesses,
  handleUpdateAgentConfigFile,
  handleCopyAgentSkill,
} from "./rpc/handlers";
import {
  createTray,
  updateTrayMenu,
  updateTrayMenuQuick,
} from "./tray/manager";
import { getTrayStats } from "./tray/state";
import { createMainWindow, showMainWindow, quitApp } from "./window/manager";
import { dispatchToWebview } from "./window/messaging";

// ─── Handle Quit Event ──────────────────────────────────────────────────────

Electrobun.events.on("before-quit", () => {
  setIsQuitting(true);
});

// ─── Sync Callbacks ─────────────────────────────────────────────────────────

const syncCallbacks: SyncCallbacks = {
  onSyncStarted: () => {
    dispatchToWebview(() => {
      rpc.send.syncStarted({});
    });
  },
  onSyncCompleted: (errors, synced) => {
    dispatchToWebview(() => {
      rpc.send.syncCompleted({ errors, synced });
    });
  },
  onSessionsUpdated: (scanned, total) => {
    dispatchToWebview(() => {
      rpc.send.sessionsUpdated({
        scanResult: { scanned, total },
      });
    });
  },
  onTrayUpdateQuick: updateTrayMenuQuick,
};

// ─── Menu Refresh ───────────────────────────────────────────────────────────

const doRefreshApplicationMenu = () => {
  refreshApplicationMenu(
    () => {
      showMainWindow({ rpc, onWindowClose: () => void updateTrayMenu() });
    },
    () => void runSyncWithNotifications(false, syncCallbacks),
    () => {
      toggleDarkMode((theme) => {
        dispatchToWebview(() => {
          rpc.send.themeChanged({ theme });
        });
      }, doRefreshApplicationMenu);
    }
  );
};

// ─── RPC Definition ─────────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<UsageMonitorRPC>({
  handlers: {
    messages: {
      log: handleLog,
      openExternal: handleOpenExternal,
    },
    requests: {
      getDashboardData: handleGetDashboardData,
      getAnalytics: handleGetAnalytics,
      getSessionDetail: handleGetSessionDetail,
      triggerSync: async ({ fullResync }) =>
        runSyncWithNotifications(fullResync ?? false, syncCallbacks),
      getSyncStatus: handleGetSyncStatus,
      getTrayStats: async () => getTrayStats(),
      getSettings: handleGetSettings,
      updateSettings: async (patch) =>
        handleUpdateSettings(patch, {
          onScanIntervalChanged: (minutes) => {
            resetBackgroundScan(minutes, syncCallbacks);
          },
          onSchedulerEnabledChanged: (enabled) => {
            resetScheduler(enabled);
          },
          onThemeChanged: (theme) => {
            dispatchToWebview(() => {
              rpc.send.themeChanged({ theme });
            });
          },
        }),
      getSchedules: handleGetSchedules,
      createSchedule: handleCreateSchedule,
      updateSchedule: handleUpdateSchedule,
      deleteSchedule: handleDeleteSchedule,
      runScheduleNow: async ({ id }) =>
        handleRunScheduleNow({ id }, (scheduleId, result) => {
          dispatchToWebview(() => {
            rpc.send.scheduleExecuted({ result, scheduleId });
          });
        }),
      getScheduleHistory: handleGetScheduleHistory,
      getAuthStatus: handleGetAuthStatus,
      getAppInfo: handleGetAppInfo,
      getOtelStatus: handleGetOtelStatus,
      getOtelAnalytics: handleGetOtelAnalytics,
      updateDragExclusionZones: handleUpdateDragExclusionZones,
      getAgentHarnesses: handleGetAgentHarnesses,
      updateAgentConfigFile: handleUpdateAgentConfigFile,
      copyAgentSkill: handleCopyAgentSkill,
    },
  },
});

// ─── Window Dependencies ────────────────────────────────────────────────────

const windowDeps = {
  rpc,
  onWindowClose: () => void updateTrayMenu(),
  onFullscreenChanged: (isFullscreen: boolean) => {
    rpc.send.fullscreenChanged({ isFullscreen });
  },
};

// ─── Tray Callbacks ─────────────────────────────────────────────────────────

const trayCallbacks = {
  onShowDashboard: () => {
    showMainWindow(windowDeps);
  },
  onRescanSessions: () => void runSyncWithNotifications(false, syncCallbacks),
  onCheckForUpdates: () =>
    void checkForUpdates(false, () => void updateTrayMenuQuick()),
  onInstallUpdate: () => void downloadAndApplyUpdate(),
  onQuitApp: quitApp,
};

// ─── Initialize ─────────────────────────────────────────────────────────────



const mainWindow = createMainWindow(windowDeps);
setMainWindow(mainWindow);

createTray(trayCallbacks);

void bootstrap({
  syncCallbacks,
  onTrayRefresh: () => void updateTrayMenu(),
  handleMetrics,
  handleLogs,
  buildSuccessResponse,
  buildClientErrorResponse,
  buildServerErrorResponse,
  refreshApplicationMenu: doRefreshApplicationMenu,
  checkForUpdates: async () =>
    checkForUpdates(true, () => void updateTrayMenuQuick()),
});

registerCleanupHandler();
