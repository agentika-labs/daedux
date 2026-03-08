import { Schema } from "effect";

// ─── OTLP Common Types ───────────────────────────────────────────────────────

/**
 * OTLP key-value attribute.
 * Values can be string, int, double, bool, or nested types.
 */
const AnyValue = Schema.Struct({
  stringValue: Schema.optional(Schema.String),
  intValue: Schema.optional(Schema.String), // OTLP sends int64 as string
  doubleValue: Schema.optional(Schema.Number),
  boolValue: Schema.optional(Schema.Boolean),
});

const KeyValue = Schema.Struct({
  key: Schema.String,
  value: AnyValue,
});

const Resource = Schema.Struct({
  attributes: Schema.optional(Schema.Array(KeyValue)),
});

const InstrumentationScope = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
});

// ─── OTLP Metrics Types ──────────────────────────────────────────────────────

const NumberDataPoint = Schema.Struct({
  attributes: Schema.optional(Schema.Array(KeyValue)),
  startTimeUnixNano: Schema.optional(Schema.String),
  timeUnixNano: Schema.String,
  asDouble: Schema.optional(Schema.Number),
  asInt: Schema.optional(Schema.String), // int64 as string
});

const Sum = Schema.Struct({
  dataPoints: Schema.Array(NumberDataPoint),
  aggregationTemporality: Schema.optional(Schema.Number),
  isMonotonic: Schema.optional(Schema.Boolean),
});

const Gauge = Schema.Struct({
  dataPoints: Schema.Array(NumberDataPoint),
});

const Metric = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  unit: Schema.optional(Schema.String),
  sum: Schema.optional(Sum),
  gauge: Schema.optional(Gauge),
});

const ScopeMetrics = Schema.Struct({
  scope: Schema.optional(InstrumentationScope),
  metrics: Schema.Array(Metric),
});

const ResourceMetrics = Schema.Struct({
  resource: Schema.optional(Resource),
  scopeMetrics: Schema.Array(ScopeMetrics),
});

/**
 * OTLP ExportMetricsServiceRequest - root payload for POST /v1/metrics
 */
export const OtlpMetricsRequest = Schema.Struct({
  resourceMetrics: Schema.Array(ResourceMetrics),
});

export type OtlpMetricsRequest = typeof OtlpMetricsRequest.Type;

// ─── OTLP Logs Types ─────────────────────────────────────────────────────────

const LogRecord = Schema.Struct({
  timeUnixNano: Schema.optional(Schema.String),
  observedTimeUnixNano: Schema.optional(Schema.String),
  severityNumber: Schema.optional(Schema.Number),
  severityText: Schema.optional(Schema.String),
  body: Schema.optional(AnyValue),
  attributes: Schema.optional(Schema.Array(KeyValue)),
  traceId: Schema.optional(Schema.String),
  spanId: Schema.optional(Schema.String),
});

const ScopeLogs = Schema.Struct({
  scope: Schema.optional(InstrumentationScope),
  logRecords: Schema.Array(LogRecord),
});

const ResourceLogs = Schema.Struct({
  resource: Schema.optional(Resource),
  scopeLogs: Schema.Array(ScopeLogs),
});

/**
 * OTLP ExportLogsServiceRequest - root payload for POST /v1/logs
 */
export const OtlpLogsRequest = Schema.Struct({
  resourceLogs: Schema.Array(ResourceLogs),
});

export type OtlpLogsRequest = typeof OtlpLogsRequest.Type;

// ─── Attribute Extraction Helpers ────────────────────────────────────────────

type Attributes = (typeof KeyValue.Type)[];

/**
 * Extract a string attribute from OTLP attributes array.
 */
export const getStringAttr = (
  attrs: Attributes,
  key: string
): string | null => {
  const kv = attrs.find((a) => a.key === key);
  if (!kv?.value) {
    return null;
  }
  return kv.value.stringValue ?? null;
};

/**
 * Extract a number attribute from OTLP attributes array.
 * Handles both intValue (string) and doubleValue (number).
 */
export const getNumberAttr = (
  attrs: Attributes,
  key: string
): number | null => {
  const kv = attrs.find((a) => a.key === key);
  if (!kv?.value) {
    return null;
  }
  if (kv.value.doubleValue !== undefined) {
    return kv.value.doubleValue;
  }
  if (kv.value.intValue !== undefined) {
    return Number.parseInt(kv.value.intValue, 10);
  }
  return null;
};

/**
 * Extract a boolean attribute from OTLP attributes array.
 */
export const getBoolAttr = (attrs: Attributes, key: string): boolean | null => {
  const kv = attrs.find((a) => a.key === key);
  if (!kv?.value) {
    return null;
  }
  return kv.value.boolValue ?? null;
};

/**
 * Parse OTLP nanosecond timestamp to JavaScript milliseconds.
 */
export const parseNanoTimestamp = (nanoStr: string): number => {
  const nanos = BigInt(nanoStr);
  return Number(nanos / 1_000_000n); // Convert to ms
};

// ─── Claude Code Attribute Keys ──────────────────────────────────────────────

/**
 * Standard attribute keys exported by Claude Code OTEL.
 */
export const CLAUDE_ATTRS = {
  // Session identifiers
  SESSION_ID: "session.id",
  USER_ACCOUNT_UUID: "user.account_uuid",
  ORGANIZATION_ID: "organization.id",
  USER_EMAIL: "user.email",
  APP_VERSION: "app.version",
  TERMINAL_TYPE: "terminal.type",
  PROMPT_ID: "prompt.id",

  // Metric-specific attributes
  TYPE: "type", // token type, time type, loc type
  MODEL: "model",
  TOOL_NAME: "tool_name",
  DECISION: "decision",
  DECISION_SOURCE: "source",
  LANGUAGE: "language",

  // Event-specific attributes
  COST_USD: "cost_usd",
  DURATION_MS: "duration_ms",
  INPUT_TOKENS: "input_tokens",
  OUTPUT_TOKENS: "output_tokens",
  CACHE_READ_TOKENS: "cache_read_tokens",
  CACHE_CREATION_TOKENS: "cache_creation_tokens",
  SPEED: "speed",
  ERROR: "error",
  STATUS_CODE: "status_code",
  ATTEMPT: "attempt",
  SUCCESS: "success",
  PROMPT_LENGTH: "prompt_length",
  PROMPT: "prompt",
} as const;
