import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Effect } from "effect";

import { FileSystemError } from "../../errors";
import type { SessionFileInfo } from "../types";

// ─── Constants ───────────────────────────────────────────────────────────────

const claudeDir = () => path.join(os.homedir(), ".claude");

// ─── Discovery Implementation ────────────────────────────────────────────────

/**
 * Discover all Claude Code session JSONL files.
 * Scans ~/.claude/projects/ for session files and their subagents.
 *
 * @param basePath - Optional override for the base claude directory
 * @returns Array of discovered session files with metadata
 */
export const discoverClaudeCodeSessions = (
  basePath?: string
): Effect.Effect<SessionFileInfo[], FileSystemError> =>
  Effect.try({
    catch: (error) =>
      new FileSystemError({
        cause: error,
        path: path.join(basePath ?? claudeDir(), "projects"),
      }),
    try: () => {
      const projectsDir = path.join(basePath ?? claudeDir(), "projects");
      const results: SessionFileInfo[] = [];

      let projectDirs: string[];
      try {
        projectDirs = [
          ...new Bun.Glob("*").scanSync({
            cwd: projectsDir,
            onlyFiles: false,
          }),
        ];
      } catch {
        return results;
      }

      for (const projectDir of projectDirs) {
        const projectPath = path.join(projectsDir, projectDir);

        let mainFiles: string[];
        try {
          mainFiles = [
            ...new Bun.Glob("*.jsonl").scanSync({
              cwd: projectPath,
              onlyFiles: true,
            }),
          ];
        } catch {
          continue;
        }

        for (const file of mainFiles) {
          const filePath = path.join(projectPath, file);
          const sessionId = path.basename(file, ".jsonl");

          try {
            const stat = fs.statSync(filePath);
            results.push({
              filePath,
              harness: "claude-code",
              isSubagent: false,
              mtimeMs: stat.mtimeMs,
              parentSessionId: null,
              project: projectDir,
              sessionId,
            });
          } catch {
            continue;
          }

          // Check for subagent files
          const subagentDir = path.join(projectPath, sessionId, "subagents");
          try {
            const subagentFiles = [
              ...new Bun.Glob("agent-*.jsonl").scanSync({
                cwd: subagentDir,
                onlyFiles: true,
              }),
            ];
            for (const subFile of subagentFiles) {
              const subFilePath = path.join(subagentDir, subFile);
              const subSessionId = path.basename(subFile, ".jsonl");
              try {
                const stat = fs.statSync(subFilePath);
                results.push({
                  filePath: subFilePath,
                  harness: "claude-code",
                  isSubagent: true,
                  mtimeMs: stat.mtimeMs,
                  parentSessionId: sessionId,
                  project: projectDir,
                  sessionId: subSessionId,
                });
              } catch {
                continue;
              }
            }
          } catch {
            // No subagent directory
          }
        }

        // Second pass: Scan for orphaned subagent directories (parent JSONL deleted)
        let sessionDirs: string[];
        try {
          sessionDirs = [
            ...new Bun.Glob("*/subagents").scanSync({
              cwd: projectPath,
              onlyFiles: false,
            }),
          ];
        } catch {
          sessionDirs = [];
        }

        for (const subagentPath of sessionDirs) {
          const parentSessionId = path.dirname(subagentPath);
          const parentJsonl = path.join(
            projectPath,
            `${parentSessionId}.jsonl`
          );

          // Skip if parent exists (already processed above)
          if (fs.existsSync(parentJsonl)) {
            continue;
          }

          // Process orphaned subagent files
          const subagentDir = path.join(projectPath, subagentPath);
          try {
            const subagentFiles = [
              ...new Bun.Glob("agent-*.jsonl").scanSync({
                cwd: subagentDir,
                onlyFiles: true,
              }),
            ];
            for (const subFile of subagentFiles) {
              const subFilePath = path.join(subagentDir, subFile);
              const subSessionId = path.basename(subFile, ".jsonl");
              try {
                const stat = fs.statSync(subFilePath);
                results.push({
                  filePath: subFilePath,
                  harness: "claude-code",
                  isSubagent: true,
                  mtimeMs: stat.mtimeMs,
                  parentSessionId: parentSessionId,
                  project: projectDir,
                  sessionId: subSessionId,
                });
              } catch {
                continue;
              }
            }
          } catch {
            // No subagent files
          }
        }
      }

      return results;
    },
  }).pipe(Effect.withSpan("claude-code.discoverSessions"));
