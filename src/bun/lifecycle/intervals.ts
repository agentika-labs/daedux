import { Effect } from "effect";

import { AnthropicUsageService } from "../services/anthropic-usage";
import { SchedulerService } from "../services/scheduler";
import { log } from "../utils/log";

/** Callback that runs an Effect against the app's shared ManagedRuntime */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RunEffectFn = (effect: Effect.Effect<any, any, any>) => Promise<any>;

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
  runEffectFn: RunEffectFn
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
 * Uses dynamic scheduling: respects retry-after from 429 responses
 * instead of blindly polling at a fixed interval.
 *
 * @param runEffectFn - Callback that runs an Effect with the app's shared runtime.
 * @returns Handle with cancel() to stop the refresh loop.
 */
export const configureUsageRefresh = (
  defaultIntervalMinutes: number,
  runEffectFn: RunEffectFn,
  onRefreshed: () => void
): { cancel: () => void } => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const MIN_INTERVAL_MS = 5 * 60_000; // 5 minutes floor
  const MAX_INTERVAL_MS = 65 * 60_000; // 65 minutes ceiling

  const scheduleNext = (delayMs: number) => {
    if (cancelled) {
      return;
    }
    timeoutId = setTimeout(tick, delayMs);
  };

  const tick = () => {
    void runEffectFn(
      Effect.gen(function* usageRefresh() {
        const service = yield* AnthropicUsageService;
        yield* service.refreshUsage();
        return yield* service.consumeRetryAfterSeconds();
      })
    )
      .then((retryAfter: number | null) => {
        onRefreshed();
        if (typeof retryAfter === "number" && retryAfter > 0) {
          const delayMs = Math.min(
            Math.max((retryAfter + 5) * 1000, MIN_INTERVAL_MS),
            MAX_INTERVAL_MS
          );
          log.info(
            "usage",
            `Rate limited, next poll in ${Math.round(delayMs / 60_000)}m (retry-after: ${retryAfter}s)`
          );
          scheduleNext(delayMs);
        } else {
          scheduleNext(defaultIntervalMinutes * 60_000);
        }
      })
      .catch((error: unknown) => {
        log.warn("usage", "Refresh failed:", error);
        scheduleNext(defaultIntervalMinutes * 60_000);
      });
  };

  log.info(
    "usage",
    `Starting usage refresh (every ${defaultIntervalMinutes}m)`
  );
  // Immediate first poll
  scheduleNext(0);

  return {
    cancel: () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    },
  };
};
