import { Schema } from "effect";

// ─── Domain Errors ──────────────────────────────────────────────────────────
//
// All errors use Schema.TaggedError for:
// - JSON serialization/deserialization (RPC, logging, persistence)
// - Runtime validation of error properties
// - Self-documenting error structure

/** Database operation failed */
export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  {
    operation: Schema.String,
    cause: Schema.Defect,
  }
) {}

/** File system operation failed */
export class FileSystemError extends Schema.TaggedError<FileSystemError>()(
  "FileSystemError",
  {
    path: Schema.String,
    cause: Schema.Defect,
  }
) {}

/** JSONL parsing failed */
export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  filePath: Schema.String,
  line: Schema.optional(Schema.Number),
  cause: Schema.Defect,
}) {}

/** Session not found */
export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    sessionId: Schema.String,
  }
) {}

/** Anthropic usage fetch failed */
export class AnthropicUsageError extends Schema.TaggedError<AnthropicUsageError>()(
  "AnthropicUsageError",
  {
    reason: Schema.Literal(
      "no_credentials",
      "api_error",
      "token_expired",
      "parse_error",
      "not_supported",
      "rate_limited"
    ),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {}

/** OTEL storage operation failed */
export class OtelStorageError extends Schema.TaggedError<OtelStorageError>()(
  "OtelStorageError",
  {
    operation: Schema.String,
    cause: Schema.Defect,
  }
) {}
