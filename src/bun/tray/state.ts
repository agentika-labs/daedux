import { Effect } from "effect";

import { CostUsd } from "../../shared/branded";
import { parseDateFilter } from "../../shared/date-filter";
import type { TrayStats } from "../../shared/rpc-types";
import { SessionAnalyticsService } from "../analytics/session-analytics";
import { runEffect } from "../app/runtime";
import {
  getIsScanning,
  getUpdateAvailable,
  getUpdateVersion,
} from "../app/state";

// ─── Tray Menu State ────────────────────────────────────────────────────────

export const getTrayMenuState = () => ({
  isScanning: getIsScanning(),
  updateAvailable: getUpdateAvailable(),
  updateVersion: getUpdateVersion(),
});

// ─── Tray Stats ─────────────────────────────────────────────────────────────

/**
 * Full tray stats - fetches fresh Anthropic usage data.
 * Use for initial load and periodic refresh (every 5 min).
 */
export const getTrayStats = async (): Promise<TrayStats> => {
  const dateFilter = parseDateFilter("today");

  try {
    const result = await runEffect(
      Effect.gen(function* result() {
        const sessions = yield* SessionAnalyticsService;
        const totals = yield* sessions.getTotals(dateFilter);

        return { totals };
      })
    );

    const { totals } = result;

    return {
      activeSessions: 0,
      todayCost: CostUsd(totals.totalCost),
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
      todayCost: CostUsd(0),
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
export const getTrayStatsQuick = async (): Promise<TrayStats> => {
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
      todayCost: CostUsd(totals.totalCost),
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
      todayCost: CostUsd(0),
      todayEvents: 0,
      todaySessions: 0,
      todayTokens: 0,
    };
  }
};
