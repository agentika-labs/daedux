import { Effect } from "effect";

import { parseDateFilter } from "../../shared/date-filter";
import type { TrayStats } from "../../shared/rpc-types";
import { SessionAnalyticsService } from "../analytics/session-analytics";
import { runEffect } from "../app/runtime";
import {
  getCachedAnthropicUsage,
  getIsScanning,
  getUpdateAvailable,
  getUpdateVersion,
  setCachedAnthropicUsage,
} from "../app/state";
import { AnthropicUsageService } from "../services/anthropic-usage/service";

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
        const anthropicService = yield* AnthropicUsageService;

        const [totals, anthropicUsage] = yield* Effect.all([
          sessions.getTotals(dateFilter),
          anthropicService.getUsage(),
        ]);

        return { anthropicUsage, totals };
      })
    );

    const { totals, anthropicUsage } = result;

    // Cache usage for quick updates during sync
    setCachedAnthropicUsage(anthropicUsage);

    return {
      activeSessions: 0,
      anthropicUsage,
      todayCost: totals.totalCost,
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
      todayCost: 0,
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

    const cachedAnthropicUsage = getCachedAnthropicUsage();

    return {
      activeSessions: 0,
      anthropicUsage: cachedAnthropicUsage ?? undefined,
      todayCost: totals.totalCost,
      todayEvents: totals.totalQueries + totals.totalToolUses,
      todaySessions: totals.totalSessions,
      todayTokens:
        totals.totalInputTokens +
        totals.totalOutputTokens +
        totals.totalCacheRead +
        totals.totalCacheWrite,
    };
  } catch {
    const cachedAnthropicUsage = getCachedAnthropicUsage();

    return {
      activeSessions: 0,
      anthropicUsage: cachedAnthropicUsage ?? undefined,
      todayCost: 0,
      todayEvents: 0,
      todaySessions: 0,
      todayTokens: 0,
    };
  }
};
