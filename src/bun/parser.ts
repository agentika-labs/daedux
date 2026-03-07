/**
 * Backward compatibility re-exports from the new parsers module.
 *
 * @deprecated Import directly from "./parsers" instead
 */

// Re-export types for API compatibility
export type { ParsedRecords, ParserInput as FileInfo } from "./parsers";

// Re-export the parsing function with a shim
import { Effect } from "effect";

import type { ParseError } from "./errors";
import { claudeCodeParser } from "./parsers";
import type { ParsedRecords, ParserInput } from "./parsers";

/**
 * @deprecated Use ParserRegistry.parseSession instead
 */
export const parseSessionFile = (
  fileInfo: Omit<ParserInput, "harness">
): Effect.Effect<ParsedRecords | null, ParseError> =>
  claudeCodeParser.parseSession({
    ...fileInfo,
    harness: "claude-code",
  });
