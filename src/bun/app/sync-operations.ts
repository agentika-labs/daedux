import { Effect } from "effect";

import type { SyncResult } from "../../shared/rpc-types";
import { SyncService } from "../sync";
import { log } from "../utils/log";
import { runEffect } from "./runtime";
import { getIsScanning, setIsScanning, setLastScanAt } from "./state";

// ─── Sync Effects ───────────────────────────────────────────────────────────

export const runSync = (fullResync = false) =>
  Effect.gen(function* runSync() {
    const syncService = yield* SyncService;
    return fullResync
      ? yield* syncService.fullResync({ verbose: false })
      : yield* syncService.syncIncremental({ verbose: false });
  }).pipe(Effect.withSpan("rpc.runSync", { attributes: { fullResync } }));

// ─── Sync Callbacks ─────────────────────────────────────────────────────────

export interface SyncCallbacks {
  onSyncStarted: () => void;
  onSyncCompleted: (errors: number, synced: number) => void;
  onSessionsUpdated: (scanned: number, total: number) => void;
  onTrayUpdateQuick: () => Promise<void>;
}

// ─── Sync with Notifications ────────────────────────────────────────────────

/**
 * Run sync with UI notifications and tray updates.
 */
export const runSyncWithNotifications = async (
  fullScan: boolean,
  callbacks: SyncCallbacks
): Promise<SyncResult> => {
  if (getIsScanning()) {
    return { errors: 0, synced: 0, total: 0, unchanged: 0 };
  }

  setIsScanning(true);
  // Use quick update to show "Scanning..." without triggering CLI probe
  void callbacks.onTrayUpdateQuick();
  callbacks.onSyncStarted();

  try {
    const result = await runEffect(runSync(fullScan));
    setLastScanAt(new Date().toISOString());

    callbacks.onSyncCompleted(result.errors, result.synced);
    callbacks.onSessionsUpdated(result.synced, result.total);

    return result;
  } catch (error) {
    log.error("scan", "Failed", error);
    return { errors: 1, synced: 0, total: 0, unchanged: 0 };
  } finally {
    setIsScanning(false);
    // Use quick update here too - we'll get fresh usage from periodic refresh
    void callbacks.onTrayUpdateQuick();
  }
};
