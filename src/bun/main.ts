import { Layer, Logger, LogLevel } from "effect";

import { AllAnalyticsServicesLive } from "./analytics/index";
import { DatabaseService } from "./db";
import { ParserRegistry } from "./parsers";
import { AnthropicUsageService } from "./services/anthropic-usage";
import { SchedulerService } from "./services/scheduler";
import { SyncService } from "./sync";

// Configure log level based on environment
// When DAEDUX_DEBUG=1, show Debug logs; otherwise only Info and above
const LoggerLive =
  process.env.DAEDUX_DEBUG === "1"
    ? Logger.minimumLogLevel(LogLevel.Debug)
    : Logger.minimumLogLevel(LogLevel.Info);

// ─── Composed Application Layer ─────────────────────────────────────────────

/**
 * Full application layer with all services.
 *
 * Composition:
 * 1. Merge all services that depend on DatabaseService and ParserRegistry
 * 2. Provide ParserRegistry first (SyncService depends on it)
 * 3. Provide DatabaseService to satisfy remaining dependencies
 * 4. Add AnthropicUsageService (no deps) to the final layer
 */
export const AppLive = Layer.mergeAll(
  SyncService.Default,
  AllAnalyticsServicesLive,
  SchedulerService.Default,
  AnthropicUsageService.Default
).pipe(
  Layer.provideMerge(ParserRegistry.Default),
  Layer.provideMerge(DatabaseService.Default),
  Layer.provideMerge(LoggerLive)
);
