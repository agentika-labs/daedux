import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { PATHS, Tray } from "electrobun/bun";

import { getTray, setTray } from "../app/state";
import { log } from "../utils/log";
import { buildTrayMenu } from "./menu";
import { getTrayMenuState, getTrayStats, getTrayStatsQuick } from "./state";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrayCallbacks {
  onShowDashboard: () => void;
  onRescanSessions: () => void;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onQuitApp: () => void;
  onUsageUpdated?: (usage: unknown) => void;
}

// ─── Tray Icon Resolution ───────────────────────────────────────────────────

export const resolveTrayIconPath = (): string => {
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

// ─── Tray Menu Updates ──────────────────────────────────────────────────────

/**
 * Full tray menu update - fetches fresh Anthropic usage data.
 * Returns the usage data if available (for pushing to frontend).
 */
export const updateTrayMenu = async (): Promise<void> => {
  const tray = getTray();
  if (!tray) {
    return;
  }

  try {
    const stats = await getTrayStats();
    tray.setMenu(buildTrayMenu(stats, getTrayMenuState()));
  } catch (error) {
    log.warn("tray", "Failed to update stats", error);
  }
};

/**
 * Quick tray menu update used during sync to update the "Scanning..." label.
 */
export const updateTrayMenuQuick = async (): Promise<void> => {
  const tray = getTray();
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

// ─── Tray Creation ──────────────────────────────────────────────────────────

/**
 * Create the system tray with initial menu and click handlers.
 */
export const createTray = (callbacks: TrayCallbacks): void => {
  const trayIconPath = resolveTrayIconPath();
  if (!trayIconPath) {
    log.warn("tray", "Icon not found; creating tray without an image");
  }

  const tray = new Tray({
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
        callbacks.onShowDashboard();
        break;
      }
      case "rescan-sessions": {
        callbacks.onRescanSessions();
        break;
      }
      case "check-for-updates": {
        callbacks.onCheckForUpdates();
        break;
      }
      case "install-update": {
        callbacks.onInstallUpdate();
        break;
      }
      case "quit-app": {
        callbacks.onQuitApp();
        break;
      }
      default: {
        callbacks.onShowDashboard();
        break;
      }
    }
  });

  setTray(tray);

  // Start loading full stats in background
  void updateTrayMenu();
};
