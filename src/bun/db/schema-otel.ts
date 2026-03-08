import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

// ─── OTEL Sessions ───────────────────────────────────────────────────────────

/**
 * Sessions discovered via OTEL telemetry.
 * Separate from JSONL-based sessions to keep data sources independent.
 */
export const otelSessions = sqliteTable(
  "otel_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userAccountUuid: text("user_account_uuid"),
    organizationId: text("organization_id"),
    userEmail: text("user_email"),
    appVersion: text("app_version"),
    terminalType: text("terminal_type"),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    totalTokens: integer("total_tokens").default(0),
    totalCostUsd: real("total_cost_usd").default(0),
    eventCount: integer("event_count").default(0),
  },
  (table) => [index("otel_sessions_time_idx").on(table.firstSeenAt)]
);

// ─── OTEL Metrics ────────────────────────────────────────────────────────────

/**
 * Metrics received via OTLP /v1/metrics endpoint.
 * Wide table with nullable attribute columns for different metric types.
 */
export const otelMetrics = sqliteTable(
  "otel_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => otelSessions.sessionId, { onDelete: "cascade" }),
    timestampNs: integer("timestamp_ns").notNull(),
    metricName: text("metric_name").notNull(),
    value: real("value").notNull(),
    // Attribute columns (nullable, varies by metric type)
    model: text("model"),
    tokenType: text("token_type"), // input, output, cache_read, cache_creation
    timeType: text("time_type"), // user, cli (for active_time)
    toolName: text("tool_name"),
    decision: text("decision"), // accept, reject
    decisionSource: text("decision_source"), // user, automatic
    language: text("language"),
    locType: text("loc_type"), // added, removed
  },
  (table) => [
    index("otel_metrics_session_idx").on(table.sessionId),
    index("otel_metrics_name_idx").on(table.metricName),
    index("otel_metrics_time_idx").on(table.timestampNs),
  ]
);

// ─── OTEL Events ─────────────────────────────────────────────────────────────

/**
 * Events (logs) received via OTLP /v1/logs endpoint.
 * Wide table covering all Claude Code event types.
 */
export const otelEvents = sqliteTable(
  "otel_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => otelSessions.sessionId, { onDelete: "cascade" }),
    timestampNs: integer("timestamp_ns").notNull(),
    eventName: text("event_name").notNull(),
    promptId: text("prompt_id"),
    // API fields
    model: text("model"),
    costUsd: real("cost_usd"),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    speed: text("speed"),
    errorMessage: text("error_message"),
    statusCode: text("status_code"),
    attempt: integer("attempt"),
    // Tool fields
    toolName: text("tool_name"),
    toolSuccess: integer("tool_success", { mode: "boolean" }),
    toolDurationMs: integer("tool_duration_ms"),
    toolDecision: text("tool_decision"),
    toolDecisionSource: text("tool_decision_source"),
    // Prompt fields
    promptLength: integer("prompt_length"),
    promptContent: text("prompt_content"),
  },
  (table) => [
    index("otel_events_session_idx").on(table.sessionId),
    index("otel_events_name_idx").on(table.eventName),
    index("otel_events_prompt_idx").on(table.promptId),
    index("otel_events_tool_idx").on(table.toolName),
  ]
);

// ─── Type exports ────────────────────────────────────────────────────────────

export type OtelSession = typeof otelSessions.$inferSelect;
export type NewOtelSession = typeof otelSessions.$inferInsert;

export type OtelMetric = typeof otelMetrics.$inferSelect;
export type NewOtelMetric = typeof otelMetrics.$inferInsert;

export type OtelEvent = typeof otelEvents.$inferSelect;
export type NewOtelEvent = typeof otelEvents.$inferInsert;
