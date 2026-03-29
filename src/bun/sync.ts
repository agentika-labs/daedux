import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseService, runInTransaction } from "./db";
import * as schema from "./db/schema";
import type { ParseError } from "./errors";
import { DatabaseError } from "./errors";
import { ParserRegistry } from "./parsers";
import type { ParsedRecords, SessionFileInfo } from "./parsers";

// ─── Types ──────────────────────────────────────────────────────────────────

export type { SessionFileInfo as FileInfo } from "./parsers";

export interface SyncResult {
  readonly synced: number;
  readonly total: number;
  readonly unchanged: number;
  readonly errors: number;
}

export interface SyncOptions {
  readonly verbose?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** SQLite has a ~999 parameter limit per statement */
const SQLITE_PARAM_LIMIT = 999;

/**
 * Column counts for each table, used to calculate safe batch sizes.
 * SQLite limit is ~999 params, so max batch = floor(999 / columnCount).
 */
const TABLE_COLUMN_COUNTS: Record<string, number> = {
  sessions: 21, // Safe batch: 47 (added harness column)
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

    // Delete existing session - ON DELETE CASCADE handles all child tables
    yield* Effect.tryPromise({
      catch: (cause) =>
        new DatabaseError({ cause, operation: "deleteSession" }),
      try: () =>
        db
          .delete(schema.sessions)
          .where(eq(schema.sessions.sessionId, session.sessionId)),
    });

    // Insert fresh session (we deleted any existing one above)
    yield* Effect.tryPromise({
      catch: (cause) =>
        new DatabaseError({ cause, operation: "insertSession" }),
      try: () => db.insert(schema.sessions).values(session),
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
  fileInfo: SessionFileInfo
): Effect.Effect<
  "empty" | "synced",
  ParseError | DatabaseError,
  DatabaseService | ParserRegistry
> =>
  Effect.gen(function* processFile() {
    const registry = yield* ParserRegistry;

    // Parse file using the appropriate parser
    const parsed = yield* registry.parseSession({
      filePath: fileInfo.filePath,
      harness: fileInfo.harness,
      isSubagent: fileInfo.isSubagent,
      parentSessionId: fileInfo.parentSessionId,
      project: fileInfo.project,
      sessionId: fileInfo.sessionId,
    });

    // Persist records + file mtime atomically per file.
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
      attributes: { sessionId: fileInfo.sessionId, harness: fileInfo.harness },
    })
  );

/** Update file mtime tracking */
const updateFileMtime = (
  fileInfo: SessionFileInfo
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

/** Execute ANALYZE to update query planner statistics */
const runAnalyze = (): Effect.Effect<void, DatabaseError, DatabaseService> =>
  Effect.gen(function* runAnalyze() {
    const { sqlite } = yield* DatabaseService;
    yield* Effect.try({
      catch: (cause) => new DatabaseError({ cause, operation: "ANALYZE" }),
      try: () => sqlite.exec("ANALYZE"),
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

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * SyncService handles JSONL file discovery and incremental sync to database.
 *
 * Uses Effect.Service pattern with DatabaseService and ParserRegistry dependencies.
 * Discovers session files from all registered parsers and stores aggregated data.
 */
export class SyncService extends Effect.Service<SyncService>()("SyncService", {
  scoped: Effect.gen(function* () {
    const registry = yield* ParserRegistry;

    return {
      discoverFiles: () => registry.discoverAllSessions(),

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

          // Discover and sync all files from all registered parsers
          const currentFiles = yield* registry.discoverAllSessions();
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

          // Update query planner statistics after bulk operations
          yield* runAnalyze();

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

          // 1. Discover current files from all registered parsers
          const currentFiles = yield* registry.discoverAllSessions();

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

          // Update query planner statistics after significant bulk operations
          if (synced > 10) {
            yield* runAnalyze();
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
    } as const;
  }),
  dependencies: [ParserRegistry.Default],
}) {}
