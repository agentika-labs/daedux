import { clearIntervalIfActive } from "../utils/intervals";
import { stopOtelServer } from "./bootstrap";
import { disposeRuntime } from "./runtime";
import {
  getScanIntervalId,
  getSchedulerIntervalId,
  getTray,
  setScanIntervalId,
  setSchedulerIntervalId,
  setTray,
} from "./state";

// ─── Cleanup Handler ────────────────────────────────────────────────────────

/**
 * Clean up all resources on application exit.
 */
export const cleanup = (): void => {
  clearIntervalIfActive(getScanIntervalId, setScanIntervalId);
  clearIntervalIfActive(getSchedulerIntervalId, setSchedulerIntervalId);


  const tray = getTray();
  if (tray) {
    tray.remove();
    setTray(null);
  }

  // Stop OTEL server
  stopOtelServer();

  // Dispose the managed runtime to clean up Effect fibers
  disposeRuntime();
};

/**
 * Register the cleanup handler on process exit.
 */
export const registerCleanupHandler = (): void => {
  process.on("exit", cleanup);
};
