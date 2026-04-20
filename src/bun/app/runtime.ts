import { Duration, Effect, ManagedRuntime } from "effect";
import type { Layer } from "effect";

import { TimeoutError } from "../errors";
import { AppLive } from "../main";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Type alias for the services provided by AppLive */
export type AppContext = Layer.Layer.Success<typeof AppLive>;

// ─── Managed Runtime ────────────────────────────────────────────────────────

/**
 * Shared ManagedRuntime instance - ensures all Effect fibers share the same
 * synchronization context, making semaphores work correctly across calls.
 *
 * Without this, each Effect.runPromise() creates a new runtime, and semaphores
 * don't synchronize across different runtimes (causing race conditions).
 */
let managedRuntime: ManagedRuntime.ManagedRuntime<AppContext, never> | null =
  null;

export const getRuntime = () => {
  managedRuntime ??= ManagedRuntime.make(AppLive);
  return managedRuntime;
};

export const disposeRuntime = () => {
  if (managedRuntime) {
    managedRuntime.dispose();
    managedRuntime = null;
  }
};

// ─── Effect Runner ──────────────────────────────────────────────────────────

/**
 * Run an Effect with the shared ManagedRuntime.
 * Using a single runtime ensures semaphores work correctly across all calls.
 * Includes a 30-second timeout to prevent indefinite hangs from blocking the UI.
 */
export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E, AppContext>,
  timeoutMs = 30_000
): Promise<A> =>
  getRuntime().runPromise(
    effect.pipe(
      Effect.timeoutFail({
        duration: Duration.millis(timeoutMs),
        onTimeout: () => new TimeoutError({ durationMs: timeoutMs }),
      })
    )
  );
