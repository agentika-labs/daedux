import * as os from "node:os";
import * as path from "node:path";

import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseService, runInTransaction } from "./db";
import * as schema from "./db/schema";
import type { ParseError } from "./errors";
import { FileSystemError, DatabaseError } from "./errors";
import { parseSessionFile } from "./parser";
import type { ParsedRecords, FileInfo as ParserFileInfo } from "./parser";

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
    readonly syncIncremental: (
      options?: SyncOptions
    ) => Effect.Effect<
      SyncResult,
      FileSystemError | ParseError | DatabaseError,
      DatabaseService
    >;
    readonly fullResync: (
      options?: SyncOptions
    ) => Effect.Effect<
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
  sessions: 20, // Safe batch: 49 (added turnCount column)
  queries: 15, // Safe batch: 66 (added ephemeral columns)
  toolUses: 10, // Safe batch: 99 (added callerType)
  fileOperations: 6, // Safe batch: 166
  hookEvents: 9, // Safe batch: 110
  bashCommands: 6, // Safe batch: 166
  apiErrors: 5, // Safe batch: 199
  skillInvocations: 5, // Safe batch: 199
  agentSpawns: 5, // Safe batch: 199
  slashCommands: 3, // Safe batch: 333
  contextWindowUsage: 5, // Safe batch: 199
  prLinks: 6, // Safe batch: 166
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
    catch: (error) =>
      new FileSystemError({
        cause: error,
        path: path.join(claudeDir(), "projects"),
      }),
    try: () => {
      const projectsDir = path.join(claudeDir(), "projects");
      const results: FileInfo[] = [];
      const fs = require("node:fs") as typeof import("node:fs");

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
        // These are session folders that contain subagents/ but no corresponding .jsonl
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
                  isSubagent: true,
                  mtimeMs: stat.mtimeMs,
                  parentSessionId: parentSessionId,
                  project: projectDir,
                  sessionId: subSessionId, // Parent session was deleted
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
  }).pipe(Effect.withSpan("sync.discoverFiles"));

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
  Effect.gen(function* insertBatch() {
    const batchSize = getSafeBatchSize(name);
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize) as T[];
      yield* Effect.tryPromise({
        catch: (cause) =>
          new DatabaseError({ cause, operation: `insertBatch:${name}` }),
        try: () => insert(batch),
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
  Effect.gen(function* insertRecords() {
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
      catch: (cause) =>
        new DatabaseError({ cause, operation: "deleteChildren" }),
      try: async () => {
        await db
          .delete(schema.queries)
          .where(eq(schema.queries.sessionId, session.sessionId));
        await db
          .delete(schema.fileOperations)
          .where(eq(schema.fileOperations.sessionId, session.sessionId));
        await db
          .delete(schema.hookEvents)
          .where(eq(schema.hookEvents.sessionId, session.sessionId));
        await db
          .delete(schema.bashCommands)
          .where(eq(schema.bashCommands.sessionId, session.sessionId));
        await db
          .delete(schema.apiErrors)
          .where(eq(schema.apiErrors.sessionId, session.sessionId));
        await db
          .delete(schema.skillInvocations)
          .where(eq(schema.skillInvocations.sessionId, session.sessionId));
        await db
          .delete(schema.agentSpawns)
          .where(eq(schema.agentSpawns.sessionId, session.sessionId));
        await db
          .delete(schema.slashCommands)
          .where(eq(schema.slashCommands.sessionId, session.sessionId));
        await db
          .delete(schema.contextWindowUsage)
          .where(eq(schema.contextWindowUsage.sessionId, session.sessionId));
        await db
          .delete(schema.prLinks)
          .where(eq(schema.prLinks.sessionId, session.sessionId));
      },
    });

    // Upsert session
    yield* Effect.tryPromise({
      catch: (cause) =>
        new DatabaseError({ cause, operation: "upsertSession" }),
      try: () =>
        db
          .insert(schema.sessions)
          .values(session)
          .onConflictDoUpdate({
            set: {
              compactions: session.compactions,
              cwd: session.cwd,
              displayName: session.displayName,
              durationMs: session.durationMs,
              endTime: session.endTime,
              gitBranch: session.gitBranch,
              isSubagent: session.isSubagent,
              parentSessionId: session.parentSessionId,
              queryCount: session.queryCount,
              savedByCaching: session.savedByCaching,
              slug: session.slug,
              toolUseCount: session.toolUseCount,
              totalCacheRead: session.totalCacheRead,
              totalCacheWrite: session.totalCacheWrite,
              totalCost: session.totalCost,
              totalEphemeral1hTokens: session.totalEphemeral1hTokens,
              totalEphemeral5mTokens: session.totalEphemeral5mTokens,
              totalInputTokens: session.totalInputTokens,
              totalOutputTokens: session.totalOutputTokens,
              turnCount: session.turnCount,
              version: session.version,
            },
            target: schema.sessions.sessionId,
          }),
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
): Effect.Effect<
  "empty" | "synced",
  ParseError | DatabaseError,
  DatabaseService
> =>
  Effect.gen(function* processFile() {
    // Convert FileInfo to ParserFileInfo (drop mtimeMs which parser doesn't need)
    const parserInfo: ParserFileInfo = {
      filePath: fileInfo.filePath,
      isSubagent: fileInfo.isSubagent,
      parentSessionId: fileInfo.parentSessionId,
      project: fileInfo.project,
      sessionId: fileInfo.sessionId,
    };

    // Parse file
    const parsed = yield* parseSessionFile(parserInfo);

    // Persist records + file mtime atomically per file.
    // This prevents partial writes (records written but mtime not updated, or vice versa).
    yield* runInTransaction(
      parsed
        ? insertRecords(parsed).pipe(
            Effect.flatMap(() => updateFileMtime(fileInfo))
          )
        : updateFileMtime(fileInfo)
    );

    return parsed ? "synced" : "empty";
  }).pipe(
    Effect.withSpan("sync.processFile", {
      attributes: { sessionId: fileInfo.sessionId },
    })
  );

/** Update file mtime tracking */
const updateFileMtime = (
  fileInfo: FileInfo
): Effect.Effect<void, DatabaseError, DatabaseService> =>
  Effect.gen(function* updateFileMtime() {
    const { db } = yield* DatabaseService;

    yield* Effect.tryPromise({
      catch: (cause) =>
        new DatabaseError({ cause, operation: "updateFileMtime" }),
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
            set: {
              mtimeMs: Math.floor(fileInfo.mtimeMs),
              syncedAt: Date.now(),
            },
            target: schema.sessionFiles.filePath,
          }),
    });
  });

/** Get cached file mtimes from database */
const getCachedMtimes = (): Effect.Effect<
  Map<string, number>,
  DatabaseError,
  DatabaseService
> =>
  Effect.gen(function* getCachedMtimes() {
    const { db } = yield* DatabaseService;

    const rows = yield* Effect.tryPromise({
      catch: (cause) =>
        new DatabaseError({ cause, operation: "getCachedMtimes" }),
      try: () => db.select().from(schema.sessionFiles),
    });

    return new Map(rows.map((r) => [r.filePath, r.mtimeMs]));
  });

// ─── Live Layer ─────────────────────────────────────────────────────────────

export const SyncServiceLive = Layer.effect(
  SyncService,
  Effect.gen(function* SyncServiceLive() {
    return {
      discoverFiles: () => discoverFilesImpl(),

      fullResync: (options?: SyncOptions) =>
        Effect.gen(function* fullResync() {
          const verbose = options?.verbose ?? false;
          const { db } = yield* DatabaseService;

          yield* Effect.logInfo(
            "Starting full resync - clearing existing data"
          );

          // Clear existing data (cascade will clean up dependent tables)
          yield* runInTransaction(
            Effect.tryPromise({
              catch: (cause) =>
                new DatabaseError({ cause, operation: "clearForResync" }),
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
            })
          );

          // Discover and sync all files
          const currentFiles = yield* discoverFilesImpl();
          yield* Effect.logInfo(
            `Found ${currentFiles.length} files for full resync`
          );

          let synced = 0;
          let errors = 0;

          for (const fileInfo of currentFiles) {
            yield* processFile(fileInfo).pipe(
              Effect.map(() => {
                synced++;
              }),
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  if (verbose) {
                    const cause =
                      error.cause instanceof Error
                        ? error.cause.message
                        : String(error.cause);
                    console.error(
                      `Failed to sync: ${fileInfo.filePath} - ${cause}`
                    );
                  }
                  errors++;
                })
              )
            );
          }

          yield* Effect.logInfo(
            `Full resync complete: ${synced} synced, ${errors} errors`
          );

          return {
            errors,
            synced,
            total: currentFiles.length,
            unchanged: 0,
          };
        }).pipe(Effect.withSpan("sync.fullResync")),

      syncIncremental: (options?: SyncOptions) =>
        Effect.gen(function* syncIncremental() {
          const verbose = options?.verbose ?? false;
          yield* Effect.logInfo("Starting incremental sync");

          // 1. Discover current files
          const currentFiles = yield* discoverFilesImpl();

          // 2. Get cached mtimes
          const cachedMtimes = yield* getCachedMtimes();

          // 3. Find files that need syncing
          const toSync = currentFiles.filter((file) => {
            const cached = cachedMtimes.get(file.filePath);
            return !cached || Math.floor(cached) !== Math.floor(file.mtimeMs);
          });

          yield* Effect.logInfo(
            `Found ${toSync.length} files to sync out of ${currentFiles.length} total`
          );

          // 4. Parse and insert changed files
          let synced = 0;
          let errors = 0;

          for (const fileInfo of toSync) {
            yield* processFile(fileInfo).pipe(
              Effect.map(() => {
                synced++;
              }),
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  if (verbose) {
                    const cause =
                      error.cause instanceof Error
                        ? error.cause.message
                        : String(error.cause);
                    console.error(
                      `Failed to sync: ${fileInfo.filePath} - ${cause}`
                    );
                  }
                  errors++;
                })
              )
            );
          }

          yield* Effect.logInfo(
            `Sync complete: ${synced} synced, ${errors} errors`
          );

          return {
            errors,
            synced,
            total: currentFiles.length,
            unchanged: currentFiles.length - toSync.length,
          };
        }).pipe(Effect.withSpan("sync.incrementalSync")),
    };
  })
);
