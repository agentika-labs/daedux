import { Effect } from "effect";

import { AnthropicUsageService } from "../services/anthropic-usage";
import { SchedulerService } from "../services/scheduler";
import { log } from "../utils/log";

/**
 * Configure the background session scan interval.
 * Calls the provided `runSync` callback on each tick.
 */
export const configureBackgroundScan = (
  intervalMinutes: number,
  runSync: () => void
): ReturnType<typeof setInterval> => {
  const safeMinutes = Number.isFinite(intervalMinutes)
    ? Math.max(1, Math.floor(intervalMinutes))
    : 5;

  return setInterval(() => {
    runSync();
  }, safeMinutes * 60_000);
};

/**
 * Configure the scheduler interval (checks every 60s) and run missed schedules.
 *
 * @param runEffectFn - Callback that runs an Effect with the app's shared runtime.
 * @returns The interval ID, or null if scheduling was disabled.
 */
export const configureScheduler = (
  enabled: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runEffectFn: (effect: Effect.Effect<any, any, any>) => Promise<any>
): ReturnType<typeof setInterval> | null => {
  if (!enabled) {
    log.info("scheduler", "Disabled");
    return null;
  }

  log.info("scheduler", "Starting schedule checker (every 60s)");

  const intervalId = setInterval(() => {
    void runEffectFn(
      Effect.gen(function* schedulerTick() {
        const scheduler = yield* SchedulerService;
        yield* scheduler.checkSchedules();
      })
    ).catch((error: unknown) => {
      log.warn("scheduler", "Check failed:", error);
    });
  }, 60_000);

  // Also run an immediate check for any missed schedules
  void runEffectFn(
    Effect.gen(function* missedCheck() {
      const scheduler = yield* SchedulerService;
      const missed = yield* scheduler.checkMissedSchedules();
      if (missed.length > 0) {
        log.info("scheduler", `Executed ${missed.length} missed schedule(s)`);
      }
    })
  ).catch((error: unknown) => {
    log.warn("scheduler", "Missed check failed:", error);
  });

  return intervalId;
};

/**
 * Configure periodic refresh of Anthropic usage data.
 * Keeps tray menu usage limits up-to-date without relying on user actions.
 *
 * @param runEffectFn - Callback that runs an Effect with the app's shared runtime.
 * @returns The interval ID.
 */
export const configureUsageRefresh = (
  intervalMinutes: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runEffectFn: (effect: Effect.Effect<any, any, any>) => Promise<any>,
  onRefreshed: () => void
): ReturnType<typeof setInterval> => {
  log.info("usage", `Starting usage refresh (every ${intervalMinutes}m)`);

  return setInterval(() => {
    void runEffectFn(
      Effect.gen(function* usageRefresh() {
        const anthropicService = yield* AnthropicUsageService;
        // refreshUsage bypasses cache, forcing a fresh CLI probe
        yield* anthropicService.refreshUsage();
      })
    )
      .then(() => {
        onRefreshed();
      })
      .catch((error: unknown) => {
        log.warn("usage", "Refresh failed:", error);
      });
  }, intervalMinutes * 60_000);
};
