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

/** OTEL storage operation failed */
export class OtelStorageError extends Schema.TaggedError<OtelStorageError>()(
  "OtelStorageError",
  {
    operation: Schema.String,
    cause: Schema.Defect,
  }
) {}

/** Scheduler operation failed */
export class SchedulerError extends Schema.TaggedError<SchedulerError>()(
  "SchedulerError",
  {
    operation: Schema.String,
    cause: Schema.Defect,
  }
) {}

/** Auth check failed or not logged in */
export class AuthError extends Schema.TaggedError<AuthError>()(
  "AuthError",
  {}
) {}

/** Effect operation timed out */
export class TimeoutError extends Schema.TaggedError<TimeoutError>()(
  "TimeoutError",
  {
    durationMs: Schema.Number,
  }
) {}
