import { Context, Effect, Layer } from "effect";
import * as path from "node:path";
import * as os from "node:os";
import { eq } from "drizzle-orm";
import { DatabaseService, runInTransaction } from "./db";
import { FileSystemError, ParseError, DatabaseError } from "./errors";
import * as schema from "../db/schema";
import { parseSessionFile, type ParsedRecords, type FileInfo as ParserFileInfo } from "./parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileInfo {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly sessionId: string;
  readonly project: string;
  readonly isSubagent: boolean;
  readonly parentSessionId: string | null;
}

export interface SyncResult {
  readonly synced: number;
  readonly total: number;
  readonly unchanged: number;
  readonly errors: number;
}

export interface SyncOptions {
  readonly verbose?: boolean;
}

// ─── Service Interface ──────────────────────────────────────────────────────

export class SyncService extends Context.Tag("SyncService")<
  SyncService,
  {
    readonly discoverFiles: () => Effect.Effect<FileInfo[], FileSystemError>;
    readonly syncIncremental: (options?: SyncOptions) => Effect.Effect<
      SyncResult,
      FileSystemError | ParseError | DatabaseError,
      DatabaseService
    >;
    readonly fullResync: (options?: SyncOptions) => Effect.Effect<
      SyncResult,
      FileSystemError | ParseError | DatabaseError,
      DatabaseService
    >;
  }
>() {}

// ─── Constants ──────────────────────────────────────────────────────────────

/** SQLite has a ~999 parameter limit per statement */
const SQLITE_PARAM_LIMIT = 999;

/**
 * Column counts for each table, used to calculate safe batch sizes.
 * SQLite limit is ~999 params, so max batch = floor(999 / columnCount).
 */
const TABLE_COLUMN_COUNTS: Record<string, number> = {
  sessions: 19,           // Safe batch: 52 (added ephemeral columns)
  queries: 15,            // Safe batch: 66 (added ephemeral columns)
  toolUses: 10,           // Safe batch: 99 (added callerType)
  fileOperations: 6,      // Safe batch: 166
  hookEvents: 9,          // Safe batch: 110
  bashCommands: 6,        // Safe batch: 166
  apiErrors: 5,           // Safe batch: 199
  skillInvocations: 5,    // Safe batch: 199
  agentSpawns: 5,         // Safe batch: 199
  slashCommands: 3,       // Safe batch: 333
  contextWindowUsage: 5,  // Safe batch: 199
  prLinks: 6,             // Safe batch: 166
};

/** Calculate safe batch size for a table based on its column count */
const getSafeBatchSize = (tableName: string): number => {
  const columns = TABLE_COLUMN_COUNTS[tableName] ?? 10;
  return Math.floor(SQLITE_PARAM_LIMIT / columns);
};

// ─── Implementation ─────────────────────────────────────────────────────────

const claudeDir = () => path.join(os.homedir(), ".claude");

/** Discover all session JSONL files with mtime info */
const discoverFilesImpl = (): Effect.Effect<FileInfo[], FileSystemError> =>
  Effect.try({
    try: () => {
      const projectsDir = path.join(claudeDir(), "projects");
      const results: FileInfo[] = [];
      const fs = require("node:fs") as typeof import("node:fs");

      let projectDirs: string[];
      try {
        projectDirs = Array.from(
          new Bun.Glob("*").scanSync({ cwd: projectsDir, onlyFiles: false })
        );
      } catch {
        return results;
      }

      for (const projectDir of projectDirs) {
        const projectPath = path.join(projectsDir, projectDir);

        let mainFiles: string[];
        try {
          mainFiles = Array.from(
            new Bun.Glob("*.jsonl").scanSync({ cwd: projectPath, onlyFiles: true })
          );
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
              mtimeMs: stat.mtimeMs,
              sessionId,
              project: projectDir,
              isSubagent: false,
              parentSessionId: null,
            });
          } catch {
            continue;
          }

          // Check for subagent files
          const subagentDir = path.join(projectPath, sessionId, "subagents");
          try {
            const subagentFiles = Array.from(
              new Bun.Glob("agent-*.jsonl").scanSync({
                cwd: subagentDir,
                onlyFiles: true,
              })
            );
            for (const subFile of subagentFiles) {
              const subFilePath = path.join(subagentDir, subFile);
              const subSessionId = path.basename(subFile, ".jsonl");
              try {
                const stat = fs.statSync(subFilePath);
                results.push({
                  filePath: subFilePath,
                  mtimeMs: stat.mtimeMs,
                  sessionId: subSessionId,
                  project: projectDir,
                  isSubagent: true,
                  parentSessionId: sessionId,
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
        // These are session folders that contain subagents/ but no corresponding .jsonl
        let sessionDirs: string[];
        try {
          sessionDirs = Array.from(
            new Bun.Glob("*/subagents").scanSync({ cwd: projectPath, onlyFiles: false })
          );
        } catch {
          sessionDirs = [];
        }

        for (const subagentPath of sessionDirs) {
          const parentSessionId = path.dirname(subagentPath);
          const parentJsonl = path.join(projectPath, `${parentSessionId}.jsonl`);

          // Skip if parent exists (already processed above)
          if (fs.existsSync(parentJsonl)) continue;

          // Process orphaned subagent files
          const subagentDir = path.join(projectPath, subagentPath);
          try {
            const subagentFiles = Array.from(
              new Bun.Glob("agent-*.jsonl").scanSync({
                cwd: subagentDir,
                onlyFiles: true,
              })
            );
            for (const subFile of subagentFiles) {
              const subFilePath = path.join(subagentDir, subFile);
              const subSessionId = path.basename(subFile, ".jsonl");
              try {
                const stat = fs.statSync(subFilePath);
                results.push({
                  filePath: subFilePath,
                  mtimeMs: stat.mtimeMs,
                  sessionId: subSessionId,
                  project: projectDir,
                  isSubagent: true,
                  parentSessionId: parentSessionId, // Parent session was deleted
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
    catch: (error) =>
      new FileSystemError({
        path: path.join(claudeDir(), "projects"),
        cause: error,
      }),
  });

// ─── Database Operations ────────────────────────────────────────────────────

/**
 * Generic batch insert with Effect error handling.
 * Uses dynamic batch sizing based on table column count to stay within SQLite's ~999 param limit.
 */
const insertBatch = <T>(
  name: string,
  items: readonly T[],
  insert: (batch: T[]) => Promise<unknown>
): Effect.Effect<void, DatabaseError> =>
  Effect.gen(function* () {
    const batchSize = getSafeBatchSize(name);
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize) as T[];
      yield* Effect.tryPromise({
        try: () => insert(batch),
        catch: (cause) => new DatabaseError({ operation: `insertBatch:${name}`, cause }),
      });
    }
  });

/**
 * Insert all records for a session in one transaction.
 * Deletes existing children first to handle re-syncs cleanly.
 */
const insertRecords = (
  records: ParsedRecords
): Effect.Effect<void, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const {
      session,
      queries,
      toolUses,
      fileOperations,
      hookEvents,
      bashCommands,
      apiErrors,
      skillInvocations,
      agentSpawns,
      slashCommands,
      contextWindowUsage,
      prLinks,
    } = records;

    // Delete existing children (cascade handles tool_uses via foreign key)
    // Delete all related records for clean re-sync
    yield* Effect.tryPromise({
      try: async () => {
        await db.delete(schema.queries).where(eq(schema.queries.sessionId, session.sessionId));
        await db.delete(schema.fileOperations).where(eq(schema.fileOperations.sessionId, session.sessionId));
        await db.delete(schema.hookEvents).where(eq(schema.hookEvents.sessionId, session.sessionId));
        await db.delete(schema.bashCommands).where(eq(schema.bashCommands.sessionId, session.sessionId));
        await db.delete(schema.apiErrors).where(eq(schema.apiErrors.sessionId, session.sessionId));
        await db.delete(schema.skillInvocations).where(eq(schema.skillInvocations.sessionId, session.sessionId));
        await db.delete(schema.agentSpawns).where(eq(schema.agentSpawns.sessionId, session.sessionId));
        await db.delete(schema.slashCommands).where(eq(schema.slashCommands.sessionId, session.sessionId));
        await db.delete(schema.contextWindowUsage).where(eq(schema.contextWindowUsage.sessionId, session.sessionId));
        await db.delete(schema.prLinks).where(eq(schema.prLinks.sessionId, session.sessionId));
      },
      catch: (cause) => new DatabaseError({ operation: "deleteChildren", cause }),
    });

    // Upsert session
    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(schema.sessions)
          .values(session)
          .onConflictDoUpdate({
            target: schema.sessions.sessionId,
            set: {
              displayName: session.displayName,
              endTime: session.endTime,
              durationMs: session.durationMs,
              totalInputTokens: session.totalInputTokens,
              totalOutputTokens: session.totalOutputTokens,
              totalCacheRead: session.totalCacheRead,
              totalCacheWrite: session.totalCacheWrite,
              totalCost: session.totalCost,
              queryCount: session.queryCount,
              toolUseCount: session.toolUseCount,
              cwd: session.cwd,
              version: session.version,
              gitBranch: session.gitBranch,
              slug: session.slug,
              compactions: session.compactions,
              savedByCaching: session.savedByCaching,
              totalEphemeral5mTokens: session.totalEphemeral5mTokens,
              totalEphemeral1hTokens: session.totalEphemeral1hTokens,
            },
          }),
      catch: (cause) => new DatabaseError({ operation: "upsertSession", cause }),
    });

    // Batch insert queries
    if (queries.length > 0) {
      yield* insertBatch("queries", queries, (batch) =>
        db.insert(schema.queries).values(batch)
      );
    }

    // Batch insert tool uses
    if (toolUses.length > 0) {
      yield* insertBatch("toolUses", toolUses, (batch) =>
        db.insert(schema.toolUses).values(batch)
      );
    }

    // Batch insert file operations
    if (fileOperations.length > 0) {
      yield* insertBatch("fileOperations", fileOperations, (batch) =>
        db.insert(schema.fileOperations).values(batch)
      );
    }

    // Batch insert hook events
    if (hookEvents.length > 0) {
      yield* insertBatch("hookEvents", hookEvents, (batch) =>
        db.insert(schema.hookEvents).values(batch)
      );
    }

    // Batch insert bash commands
    if (bashCommands.length > 0) {
      yield* insertBatch("bashCommands", bashCommands, (batch) =>
        db.insert(schema.bashCommands).values(batch)
      );
    }

    // Batch insert API errors
    if (apiErrors.length > 0) {
      yield* insertBatch("apiErrors", apiErrors, (batch) =>
        db.insert(schema.apiErrors).values(batch)
      );
    }

    // Batch insert skill invocations
    if (skillInvocations.length > 0) {
      yield* insertBatch("skillInvocations", skillInvocations, (batch) =>
        db.insert(schema.skillInvocations).values(batch)
      );
    }

    // Batch insert agent spawns
    if (agentSpawns.length > 0) {
      yield* insertBatch("agentSpawns", agentSpawns, (batch) =>
        db.insert(schema.agentSpawns).values(batch)
      );
    }

    // Batch insert slash commands
    if (slashCommands.length > 0) {
      yield* insertBatch("slashCommands", slashCommands, (batch) =>
        db.insert(schema.slashCommands).values(batch)
      );
    }

    // Batch insert context window usage
    if (contextWindowUsage.length > 0) {
      yield* insertBatch("contextWindowUsage", contextWindowUsage, (batch) =>
        db.insert(schema.contextWindowUsage).values(batch)
      );
    }

    // Batch insert PR links
    if (prLinks.length > 0) {
      yield* insertBatch("prLinks", prLinks, (batch) =>
        db.insert(schema.prLinks).values(batch)
      );
    }
  });

/**
 * Process a single file: parse and insert all records.
 */
const processFile = (
  fileInfo: FileInfo
): Effect.Effect<"empty" | "synced", ParseError | DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    // Convert FileInfo to ParserFileInfo (drop mtimeMs which parser doesn't need)
    const parserInfo: ParserFileInfo = {
      filePath: fileInfo.filePath,
      sessionId: fileInfo.sessionId,
      project: fileInfo.project,
      isSubagent: fileInfo.isSubagent,
      parentSessionId: fileInfo.parentSessionId,
    };

    // Parse file
    const parsed = yield* parseSessionFile(parserInfo);

    // Persist records + file mtime atomically per file.
    // This prevents partial writes (records written but mtime not updated, or vice versa).
    yield* runInTransaction(
      parsed
        ? insertRecords(parsed).pipe(Effect.flatMap(() => updateFileMtime(fileInfo)))
        : updateFileMtime(fileInfo)
    );

    return parsed ? "synced" : "empty";
  });

/** Update file mtime tracking */
const updateFileMtime = (
  fileInfo: FileInfo
): Effect.Effect<void, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    yield* Effect.tryPromise({
      try: () =>
        db
          .insert(schema.sessionFiles)
          .values({
            filePath: fileInfo.filePath,
            mtimeMs: Math.floor(fileInfo.mtimeMs),
            sessionId: fileInfo.sessionId,
            syncedAt: Date.now(),
          })
          .onConflictDoUpdate({
            target: schema.sessionFiles.filePath,
            set: {
              mtimeMs: Math.floor(fileInfo.mtimeMs),
              syncedAt: Date.now(),
            },
          }),
      catch: (cause) => new DatabaseError({ operation: "updateFileMtime", cause }),
    });
  });

/** Get cached file mtimes from database */
const getCachedMtimes = (): Effect.Effect<
  Map<string, number>,
  DatabaseError,
  DatabaseService
> =>
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(schema.sessionFiles),
      catch: (cause) => new DatabaseError({ operation: "getCachedMtimes", cause }),
    });

    return new Map(rows.map((r) => [r.filePath, r.mtimeMs]));
  });

// ─── Live Layer ─────────────────────────────────────────────────────────────

export const SyncServiceLive = Layer.effect(
  SyncService,
  Effect.gen(function* () {
    return {
      discoverFiles: () => discoverFilesImpl(),

      syncIncremental: (options?: SyncOptions) =>
        Effect.gen(function* () {
          const verbose = options?.verbose ?? false;

          // 1. Discover current files
          const currentFiles = yield* discoverFilesImpl();

          // 2. Get cached mtimes
          const cachedMtimes = yield* getCachedMtimes();

          // 3. Find files that need syncing
          const toSync = currentFiles.filter((file) => {
            const cached = cachedMtimes.get(file.filePath);
            return !cached || Math.floor(cached) !== Math.floor(file.mtimeMs);
          });

          // 4. Parse and insert changed files
          let synced = 0;
          let errors = 0;

          for (const fileInfo of toSync) {
            yield* processFile(fileInfo).pipe(
              Effect.map(() => { synced++; }),
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  if (verbose) {
                    const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
                    console.error(`Failed to sync: ${fileInfo.filePath} - ${cause}`);
                  }
                  errors++;
                })
              )
            );
          }

          return {
            synced,
            total: currentFiles.length,
            unchanged: currentFiles.length - toSync.length,
            errors,
          };
        }),

      fullResync: (options?: SyncOptions) =>
        Effect.gen(function* () {
          const verbose = options?.verbose ?? false;
          const { db } = yield* DatabaseService;

          // Clear existing data (cascade will clean up dependent tables)
          yield* runInTransaction(
            Effect.tryPromise({
              try: async () => {
                await db.delete(schema.sessionFiles);
                // Delete from child tables first (some may not cascade)
                await db.delete(schema.prLinks);
                await db.delete(schema.contextWindowUsage);
                await db.delete(schema.slashCommands);
                await db.delete(schema.agentSpawns);
                await db.delete(schema.skillInvocations);
                await db.delete(schema.apiErrors);
                await db.delete(schema.bashCommands);
                await db.delete(schema.hookEvents);
                await db.delete(schema.fileOperations);
                await db.delete(schema.sessions);
              },
              catch: (cause) => new DatabaseError({ operation: "clearForResync", cause }),
            })
          );

          // Discover and sync all files
          const currentFiles = yield* discoverFilesImpl();

          let synced = 0;
          let errors = 0;

          for (const fileInfo of currentFiles) {
            yield* processFile(fileInfo).pipe(
              Effect.map(() => { synced++; }),
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  if (verbose) {
                    const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
                    console.error(`Failed to sync: ${fileInfo.filePath} - ${cause}`);
                  }
                  errors++;
                })
              )
            );
          }

          return {
            synced,
            total: currentFiles.length,
            unchanged: 0,
            errors,
          };
        }),
    };
  })
);
