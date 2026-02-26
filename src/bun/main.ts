import { Layer } from "effect";

import { AllAnalyticsServicesLive } from "./analytics/index";
import { DatabaseServiceLive } from "./db";
import { AnthropicUsageServiceLive } from "./services/anthropic-usage";
import { SchedulerServiceLive } from "./services/scheduler";
import { SyncServiceLive } from "./sync";

// ─── Composed Application Layer ─────────────────────────────────────────────

/**
 * Full application layer with all services.
 *
 * Composition:
 * 1. Merge all services that depend on DatabaseService
 * 2. Provide DatabaseService to satisfy those dependencies
 * 3. Add AnthropicUsageService (no deps) to the final layer
 */
export const AppLive = Layer.mergeAll(
  SyncServiceLive,
  AllAnalyticsServicesLive,
  SchedulerServiceLive,
  AnthropicUsageServiceLive
).pipe(Layer.provideMerge(DatabaseServiceLive));
