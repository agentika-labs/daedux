import { Effect } from "effect";

import { FileSystemError, ParseError } from "../../errors";
import type {
  HarnessParser,
  ParserInput,
  ParsedRecords,
  SessionFileInfo,
} from "../types";

// ─── Codex Parser (Stub) ─────────────────────────────────────────────────────

/**
 * Parser for Codex (OpenAI's coding CLI) session files.
 * Currently a stub implementation - disabled by default.
 *
 * Codex stores sessions in ~/.codex/sessions/ as JSONL files.
 * This parser will be implemented when Codex format is documented.
 */
export class CodexParser implements HarnessParser {
  readonly harness = "codex" as const;
  readonly name = "Codex";

  /**
   * Discover Codex session files.
   * Currently returns empty array (not implemented).
   */
  discoverSessions(
    _basePath?: string
  ): Effect.Effect<SessionFileInfo[], FileSystemError> {
    // TODO: Implement when Codex format is documented
    // Expected location: ~/.codex/sessions/**/*.jsonl
    return Effect.succeed([]);
  }

  /**
   * Check if this parser can handle a file based on its path.
   */
  canHandle(filePath: string): boolean {
    return filePath.includes("/.codex/sessions/") && filePath.endsWith(".jsonl");
  }

  /**
   * Parse a Codex session file.
   * Currently returns null (not implemented).
   */
  parseSession(
    _input: ParserInput
  ): Effect.Effect<ParsedRecords | null, ParseError> {
    // TODO: Implement when Codex format is documented
    return Effect.succeed(null);
  }
}

/** Singleton instance (disabled by default) */
export const codexParser = new CodexParser();
