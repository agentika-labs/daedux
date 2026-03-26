import { Effect } from "effect";

import type { FileSystemError, ParseError } from "../errors";
import { ClaudeCodeParserService } from "./claude-code/parser";
import type {
  HarnessId,
  HarnessParser,
  ParsedRecords,
  ParserInput,
  SessionFileInfo,
} from "./types";

// ─── Parser Registry ─────────────────────────────────────────────────────────

/**
 * ParserRegistry manages registered harness parsers and routes files.
 *
 * The registry:
 * 1. Discovers files from all registered parsers
 * 2. Routes files to appropriate parsers based on path patterns
 * 3. Provides harness detection from file paths
 */
export class ParserRegistry extends Effect.Service<ParserRegistry>()(
  "ParserRegistry",
  {
    dependencies: [ClaudeCodeParserService.Default],
    effect: Effect.gen(function* () {
      // Yield parser from Effect context (injected via dependencies)
      const ccParser = yield* ClaudeCodeParserService;
      const parsers = new Map<HarnessId, HarnessParser>([
        [ccParser.harness, ccParser],
      ]);

      return {
        /**
         * Register a new parser.
         */
        register: (parser: HarnessParser): void => {
          parsers.set(parser.harness, parser);
        },

        /**
         * Get all registered parser IDs.
         */
        getRegisteredHarnesses: (): HarnessId[] => [...parsers.keys()],

        /**
         * Detect harness from a file path.
         * Returns the first parser that can handle the file.
         */
        detectHarness: (filePath: string): HarnessId => {
          for (const parser of parsers.values()) {
            if (parser.canHandle(filePath)) {
              return parser.harness;
            }
          }
          return "unknown";
        },

        /**
         * Discover all session files from all registered parsers.
         */
        discoverAllSessions: (): Effect.Effect<
          SessionFileInfo[],
          FileSystemError
        > =>
          Effect.gen(function* () {
            const allFiles: SessionFileInfo[] = [];

            for (const parser of parsers.values()) {
              const files = yield* parser.discoverSessions();
              allFiles.push(...files);
            }

            return allFiles;
          }),

        /**
         * Parse a session file using the appropriate parser.
         */
        parseSession: (
          input: ParserInput
        ): Effect.Effect<ParsedRecords | null, ParseError> => {
          const parser = parsers.get(input.harness);
          if (!parser) {
            // Fall back to Claude Code parser for unknown harnesses
            return ccParser.parseSession(input);
          }
          return parser.parseSession(input);
        },

        /**
         * Get a parser by harness ID.
         */
        getParser: (harness: HarnessId): HarnessParser | undefined =>
          parsers.get(harness),
      } as const;
    }),
  }
) {}
