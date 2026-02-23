import { Layer } from "effect";
import { DatabaseServiceLive } from "./db";
import { SyncServiceLive } from "./sync";
import { AllAnalyticsServicesLive } from "./analytics/index";
import { SchedulerServiceLive } from "./services/scheduler";

// ─── Composed Application Layer ─────────────────────────────────────────────

/**
 * Full application layer with all services.
 * DatabaseService is the base, SyncService and domain analytics services depend on it.
 */
export const AppLive = Layer.mergeAll(
  SyncServiceLive,
  AllAnalyticsServicesLive,
  SchedulerServiceLive
).pipe(Layer.provideMerge(DatabaseServiceLive));
