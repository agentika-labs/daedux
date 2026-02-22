import { Data } from "effect";

// ─── Domain Errors ──────────────────────────────────────────────────────────

/** Database operation failed */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

/** File system operation failed */
export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

/** JSONL parsing failed */
export class ParseError extends Data.TaggedError("ParseError")<{
  readonly filePath: string;
  readonly line?: number;
  readonly cause: unknown;
}> {}

/** Session not found */
export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly sessionId: string;
}> {}
