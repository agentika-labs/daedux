/**
 * RPC Test Harness
 *
 * Provides utilities for testing RPC handlers and services with an in-memory database.
 * Creates a complete test runtime with all services properly wired.
 */
import { Effect, Layer, ManagedRuntime } from "effect";

import { AllAnalyticsServicesLive } from "../../src/bun/analytics/index";
import { DatabaseService } from "../../src/bun/db";
import { SchedulerService } from "../../src/bun/services/scheduler";
import { SyncService } from "../../src/bun/sync";
import { createTestDatabaseLayer } from "./test-db";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Type alias for the test context (all services) */
export type TestAppContext = Layer.Layer.Success<typeof TestAppLive>;

// ─── Test Layer Composition ──────────────────────────────────────────────────

/**
 * Test application layer with in-memory database.
 * Mirrors the production AppLive but uses test database.
 */
export const TestAppLive = Layer.mergeAll(
  SyncService.Default,
  AllAnalyticsServicesLive,
  SchedulerService.Default
);

// ─── Test Harness Factory ────────────────────────────────────────────────────

/**
 * Creates a test harness with fresh in-memory database.
 * Each harness is isolated - use one per test for clean state.
 *
 * @example
 * ```ts
 * const { runEffect, db, cleanup } = createRpcTestHarness();
 *
 * // Run effects with test services
 * const result = await runEffect(
 *   Effect.gen(function* () {
 *     const sessions = yield* SessionAnalyticsService;
 *     return yield* sessions.getTotals({});
 *   })
 * );
 *
 * // Direct DB access for assertions
 * expect(db.select().from(sessions).all()).toHaveLength(0);
 *
 * // Clean up when done
 * await cleanup();
 * ```
 */
export const createRpcTestHarness = () => {
  // Create isolated test database
  const { db, sqlite, layer: dbLayer } = createTestDatabaseLayer();

  // Compose full test layer with test database
  const fullTestLayer = TestAppLive.pipe(Layer.provideMerge(dbLayer));

  // Create managed runtime for this harness
  const runtime = ManagedRuntime.make(fullTestLayer);

  return {
    /** Direct database access for setup/assertions */
    db,

    /** Raw SQLite connection for low-level operations */
    sqlite,

    /** Run an Effect with the test runtime */
    runEffect: <A, E>(
      effect: Effect.Effect<A, E, TestAppContext | DatabaseService>
    ): Promise<A> => runtime.runPromise(effect),

    /** Clean up runtime and database resources */
    cleanup: async () => {
      await runtime.dispose();
      sqlite.close();
    },
  };
};

// ─── Effect Test Utilities ───────────────────────────────────────────────────

/**
 * Run an Effect with a fresh test harness that auto-cleans up.
 * Simpler alternative when you don't need direct DB access.
 *
 * @example
 * ```ts
 * const totals = await runWithTestHarness(
 *   Effect.gen(function* () {
 *     const sessions = yield* SessionAnalyticsService;
 *     return yield* sessions.getTotals({});
 *   })
 * );
 * ```
 */
export const runWithTestHarness = async <A, E>(
  effect: Effect.Effect<A, E, TestAppContext | DatabaseService>
): Promise<A> => {
  const harness = createRpcTestHarness();
  try {
    return await harness.runEffect(effect);
  } finally {
    await harness.cleanup();
  }
};
