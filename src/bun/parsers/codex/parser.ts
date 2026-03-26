import { Effect } from "effect";

import type { FileSystemError, ParseError } from "../../errors";
import type {
  HarnessParser,
  ParserInput,
  ParsedRecords,
  SessionFileInfo,
} from "../types";

// ─── Codex Parser Service ───────────────────────────────────────────────────

/**
 * Effect Service for Codex (OpenAI's coding CLI) session files.
 * Currently a stub implementation - disabled by default.
 *
 * Codex stores sessions in ~/.codex/sessions/ as JSONL files.
 * This parser will be implemented when Codex format is documented.
 */
export class CodexParserService extends Effect.Service<CodexParserService>()(
  "CodexParser",
  {
    effect: Effect.gen(function* () {
      return {
        harness: "codex" as const,
        name: "Codex",

        discoverSessions(
          _basePath?: string
        ): Effect.Effect<SessionFileInfo[], FileSystemError> {
          // Stub: will implement when Codex format is documented
          // Expected location: ~/.codex/sessions/**/*.jsonl
          return Effect.succeed([]);
        },

        canHandle(filePath: string): boolean {
          return (
            filePath.includes("/.codex/sessions/") &&
            filePath.endsWith(".jsonl")
          );
        },

        parseSession(
          _input: ParserInput
        ): Effect.Effect<ParsedRecords | null, ParseError> {
          // Stub: will implement when Codex format is documented
          return Effect.succeed(null);
        },
      } satisfies HarnessParser;
    }),
  }
) {}
