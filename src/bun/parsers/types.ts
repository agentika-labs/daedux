import type { Effect } from "effect";

import type * as schema from "../db/schema";
import type { FileSystemError, ParseError } from "../errors";

// Import and re-export HarnessId from shared types (single source of truth)
import type { HarnessId } from "../../shared/rpc-types";
export type { HarnessId };

// ─── Session File Discovery ──────────────────────────────────────────────────

/**
 * Extended file info with harness detection.
 * Includes all metadata needed for incremental sync and parsing.
 */
export interface SessionFileInfo {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly sessionId: string;
  readonly project: string;
  readonly harness: HarnessId;
  readonly isSubagent: boolean;
  readonly parentSessionId: string | null;
}

// ─── Parser Input/Output ─────────────────────────────────────────────────────

/**
 * Input to the parser - file metadata without mtime (parser doesn't need it).
 */
export type ParserInput = Omit<SessionFileInfo, "mtimeMs">;

/**
 * Parsed records from a session file.
 * Contains all database records to be inserted for this session.
 */
export interface ParsedRecords {
  readonly session: schema.NewSession;
  readonly queries: schema.NewQuery[];
  readonly toolUses: schema.NewToolUse[];
  readonly fileOperations: schema.NewFileOperation[];
  readonly hookEvents: schema.NewHookEvent[];
  readonly bashCommands: schema.NewBashCommand[];
  readonly apiErrors: schema.NewApiError[];
  readonly skillInvocations: schema.NewSkillInvocation[];
  readonly agentSpawns: schema.NewAgentSpawn[];
  readonly slashCommands: schema.NewSlashCommand[];
  readonly contextWindowUsage: schema.NewContextWindowUsage[];
  readonly prLinks: schema.NewPrLink[];
}

// ─── Parser Interface ────────────────────────────────────────────────────────

/**
 * HarnessParser interface for pluggable parsers.
 *
 * Each parser handles a specific harness (Claude Code, Codex, OpenCode, etc.).
 * Parsers are stateless classes that can be registered with the ParserRegistry.
 */
export interface HarnessParser {
  /** Unique harness identifier */
  readonly harness: HarnessId;

  /** Human-readable name for this harness */
  readonly name: string;

  /**
   * Discover session files for this harness.
   * Scans the filesystem for JSONL files matching this harness's patterns.
   *
   * @param basePath - Optional base path override (defaults to harness-specific location)
   * @returns Array of discovered session files with metadata
   */
  discoverSessions(
    basePath?: string
  ): Effect.Effect<SessionFileInfo[], FileSystemError>;

  /**
   * Parse a session file into database records.
   *
   * @param input - File metadata and content
   * @returns Parsed records or null for empty files
   */
  parseSession(
    input: ParserInput
  ): Effect.Effect<ParsedRecords | null, ParseError>;

  /**
   * Check if this parser can handle a given file path.
   * Used by the registry for routing files to the appropriate parser.
   *
   * @param filePath - Absolute path to the file
   * @returns true if this parser can handle the file
   */
  canHandle(filePath: string): boolean;
}
