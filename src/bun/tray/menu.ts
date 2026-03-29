import type { TrayStats } from "../../shared/rpc-types";
import {
  formatRateLimitItem,
  formatExtraUsage,
  formatSubscriptionHeader,
  formatDailyStats,
} from "../utils/tray-formatting";

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
  const { anthropicUsage } = stats;

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
    label: "Today",
    type: "normal" as const,
  });
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
