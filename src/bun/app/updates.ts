import { Updater, Utils } from "electrobun/bun";

import { log } from "../utils/log";
import { setUpdateAvailable, setUpdateVersion } from "./state";

// ─── Auto-Updates ───────────────────────────────────────────────────────────

/**
 * Check for app updates and update tray menu if available.
 * Silently fails in dev mode or if update check fails.
 */
export const checkForUpdates = async (
  silent = true,
  onUpdateAvailable?: () => void
): Promise<void> => {
  try {
    const result = await Updater.checkForUpdate();

    if (result.updateAvailable) {
      setUpdateAvailable(true);
      setUpdateVersion(result.version);
      log.info("update", `Update available: ${result.version}`);

      // Notify caller to refresh UI
      onUpdateAvailable?.();

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
export const downloadAndApplyUpdate = async (): Promise<void> => {
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
