import { Layer } from "effect";

import { AllAnalyticsServicesLive } from "./analytics/index";
import { DatabaseService } from "./db";
import { AnthropicUsageService } from "./services/anthropic-usage";
import { SchedulerService } from "./services/scheduler";
import { SyncService } from "./sync";

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
  SyncService.Default,
  AllAnalyticsServicesLive,
  SchedulerService.Default,
  AnthropicUsageService.Default
).pipe(Layer.provideMerge(DatabaseService.Default));
