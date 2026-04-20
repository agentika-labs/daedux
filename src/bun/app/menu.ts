import { ApplicationMenu } from "electrobun/bun";

import { saveSettings } from "../services/settings";
import { getIsScanning, getSettings, isMac, updateSettings } from "./state";

// ─── Application Menu ───────────────────────────────────────────────────────

export const refreshApplicationMenu = (
  onShowDashboard: () => void,
  onRescanSessions: () => void,
  onToggleDarkMode: () => void
): void => {
  const settings = getSettings();
  const isScanning = getIsScanning();

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

  // Set up application menu event handler
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
        onShowDashboard();
        break;
      }
      case "rescan-sessions": {
        onRescanSessions();
        break;
      }
      case "toggle-dark-mode": {
        onToggleDarkMode();
        break;
      }
    }
  });
};

// ─── Theme Toggle ───────────────────────────────────────────────────────────

export const toggleDarkMode = (
  onThemeChanged: (theme: "light" | "dark") => void,
  refreshMenu: () => void
): void => {
  const settings = getSettings();
  const nextTheme = settings.theme === "dark" ? "light" : "dark";

  updateSettings({ theme: nextTheme });
  saveSettings({ ...settings, theme: nextTheme });

  onThemeChanged(nextTheme);
  refreshMenu();
};
