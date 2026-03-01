import { Layer } from "effect";

import { AgentAnalyticsService } from "./agent-analytics";
import { ContextAnalyticsService } from "./context-analytics";
import { FileAnalyticsService } from "./file-analytics";
import { InsightsAnalyticsService } from "./insights-analytics";
import { ModelAnalyticsService } from "./model-analytics";
import { SessionAnalyticsService } from "./session-analytics";
import { ToolAnalyticsService } from "./tool-analytics";

/**
 * Layer that provides all domain analytics services directly.
 * Use this when you want to access domain services individually rather than
 * through the facade.
 */
export const AllAnalyticsServicesLive = Layer.mergeAll(
  SessionAnalyticsService.Default,
  ModelAnalyticsService.Default,
  ToolAnalyticsService.Default,
  FileAnalyticsService.Default,
  AgentAnalyticsService.Default,
  ContextAnalyticsService.Default,
  InsightsAnalyticsService.Default
);
