import type { TrayStats } from "../../shared/rpc-types";
import { formatCost } from "../utils/formatting";

type TrayMenuItem =
  | { label: string; type: "normal"; enabled?: boolean; action?: string }
  | { type: "separator" };

export interface TrayMenuState {
  isScanning: boolean;
  updateAvailable: boolean;
  updateVersion: string | null;
}

/**
 * Build the tray menu items from stats and app state.
 * Pure function — all mutable state is passed in via `state`.
 */
export const buildTrayMenu = (
  stats: TrayStats,
  state: TrayMenuState
): TrayMenuItem[] => {
  const items: TrayMenuItem[] = [];

  // ── Daily Stats Section ──
  items.push({
    enabled: false,
    label: "Today",
    type: "normal" as const,
  });
  items.push({
    enabled: false,
    label: `${stats.todaySessions} sessions · ${formatCost(stats.todayCost)}`,
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
      enabled: !state.isScanning,
      label: state.isScanning ? "Scanning..." : "Rescan Sessions",
      type: "normal" as const,
    }
  );

  // ── Update Actions ──
  if (state.updateAvailable && state.updateVersion) {
    items.push({
      action: "install-update",
      label: `Install Update (v${state.updateVersion})`,
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
