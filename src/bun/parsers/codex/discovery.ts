import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Effect } from "effect";

import {
  FilePath,
  ProjectPath,
  SessionId,
  UnixTimestampMs,
} from "../../../shared/branded";
import { FileSystemError } from "../../errors";
import { safeJsonParse } from "../../utils/parsing";
import type { SessionFileInfo } from "../types";

// ─── Constants ───────────────────────────────────────────────────────────────

const codexDir = () => path.join(os.homedir(), ".codex");
const UUID_SUFFIX =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type JsonRecord = Record<string, unknown>;

interface CodexSessionMetadata {
  readonly sessionId: string | null;
  readonly cwd: string | null;
}

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readSessionMetadata = (filePath: string): CodexSessionMetadata => {
  try {
    const file = fs.readFileSync(filePath, "utf8");
    for (const line of file.split("\n")) {
      const obj = safeJsonParse(line.trim());
      if (obj === null || obj.type !== "session_meta") {
        continue;
      }

      const payload = isJsonRecord(obj.payload) ? obj.payload : null;
      return {
        cwd: typeof payload?.cwd === "string" ? payload.cwd : null,
        sessionId: typeof payload?.id === "string" ? payload.id : null,
      };
    }
  } catch {
    // Best-effort metadata. Discovery should still return the file if stat works.
  }

  return { cwd: null, sessionId: null };
};

const sessionIdFromFileName = (filePath: string): string => {
  const stem = path.basename(filePath, ".jsonl");
  const match = stem.match(UUID_SUFFIX);
  return match?.[1] ?? stem;
};

// ─── Discovery Implementation ────────────────────────────────────────────────

/**
 * Discover all Codex session JSONL files.
 * Scans ~/.codex/sessions/YYYY/MM/DD/*.jsonl.
 *
 * @param basePath - Optional override for the base Codex directory
 * @returns Array of discovered session files with metadata
 */
export const discoverCodexSessions = (
  basePath?: string
): Effect.Effect<SessionFileInfo[], FileSystemError> =>
  Effect.try({
    catch: (error) =>
      new FileSystemError({
        cause: error,
        path: path.join(basePath ?? codexDir(), "sessions"),
      }),
    try: () => {
      const sessionsDir = path.join(basePath ?? codexDir(), "sessions");
      const results: SessionFileInfo[] = [];

      let files: string[];
      try {
        files = [
          ...new Bun.Glob("**/*.jsonl").scanSync({
            cwd: sessionsDir,
            onlyFiles: true,
          }),
        ];
      } catch {
        return results;
      }

      for (const file of files) {
        const filePath = path.join(sessionsDir, file);
        try {
          const stat = fs.statSync(filePath);
          const metadata = readSessionMetadata(filePath);
          const sessionId =
            metadata.sessionId ?? sessionIdFromFileName(filePath);

          results.push({
            filePath: FilePath(filePath),
            harness: "codex",
            isSubagent: false,
            mtimeMs: UnixTimestampMs(stat.mtimeMs),
            parentSessionId: null,
            project: ProjectPath(metadata.cwd ?? "unknown"),
            sessionId: SessionId(sessionId),
          });
        } catch {
          continue;
        }
      }

      return results;
    },
  }).pipe(Effect.withSpan("codex.discoverSessions"));
