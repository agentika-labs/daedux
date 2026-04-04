import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { drizzle } from "drizzle-orm/bun-sqlite";
import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { Effect } from "effect";

import * as schema from "./db/schema";
import { DatabaseError } from "./errors";

// ─── Database Path Resolution ───────────────────────────────────────────────

/**
 * Get the app-specific database path.
 * Uses macOS Application Support pattern for production.
 */
const getDbPath = (): string => {
  const home = homedir();

  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Daedux", "daedux.db");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Daedux", "daedux.db");
  }
  // Linux and others
  return join(home, ".local", "share", "daedux", "daedux.db");
};

const DB_PATH = getDbPath();

/**
 * Get legacy database paths to check for migration.
 * Returns paths in order of preference (most recent first).
 */
const getLegacyDbPaths = (): string[] => {
  const home = homedir();
  const paths: string[] = [];

  if (process.platform === "darwin") {
    // Old app name in Application Support (most recent legacy)
    paths.push(
      join(
        home,
        "Library",
        "Application Support",
        "Claude Usage Monitor",
        "usage-monitor.db"
      )
    );
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    paths.push(join(appData, "Claude Usage Monitor", "usage-monitor.db"));
  } else {
    paths.push(
      join(home, ".local", "share", "claude-usage-monitor", "usage-monitor.db")
    );
  }

  // Oldest legacy location (all platforms)
  paths.push(join(home, ".claude", "usage-monitor.db"));

  return paths;
};

/**
 * Migrate database from legacy location if needed.
 * Checks multiple legacy paths and migrates from the first one found.
 * Only runs once on first app launch.
 */
const migrateFromLegacyLocation = (): void => {
  // If new DB already exists, nothing to do
  if (existsSync(DB_PATH)) {
    return;
  }

  // Create parent directory
  const dbDir = dirname(DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Check legacy paths in order and migrate from first found
  for (const legacyPath of getLegacyDbPaths()) {
    if (existsSync(legacyPath)) {
      console.log(`[db] Migrating database from ${legacyPath} to ${DB_PATH}`);
      copyFileSync(legacyPath, DB_PATH);

      // Also copy WAL files if they exist
      const walPath = `${legacyPath}-wal`;
      const shmPath = `${legacyPath}-shm`;
      if (existsSync(walPath)) {
        copyFileSync(walPath, `${DB_PATH}-wal`);
      }
      if (existsSync(shmPath)) {
        copyFileSync(shmPath, `${DB_PATH}-shm`);
      }

      return; // Stop after first successful migration
    }
  }
};

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * DatabaseService provides SQLite database access via Drizzle ORM.
 *
 * Uses Effect.Service pattern with scoped lifecycle for automatic cleanup.
 * The .Default layer handles connection setup, pragma configuration, and
 * migration from legacy database locations.
 */
export class DatabaseService extends Effect.Service<DatabaseService>()(
  "DatabaseService",
  {
    accessors: true,
    scoped: Effect.acquireRelease(
      Effect.sync(() => {
        // Migrate from legacy location if needed
        migrateFromLegacyLocation();

        const sqlite = new Database(DB_PATH, { strict: true });

        // Optimize SQLite for our workload
        sqlite.exec("PRAGMA journal_mode = WAL"); // Better concurrent reads
        sqlite.exec("PRAGMA synchronous = NORMAL"); // Balanced durability/speed
        sqlite.exec("PRAGMA cache_size = -64000"); // 64MB cache
        sqlite.exec("PRAGMA foreign_keys = ON"); // Enforce FK constraints
        sqlite.exec("PRAGMA temp_store = MEMORY"); // Temp tables in memory

        const db = drizzle({ client: sqlite, schema });

        return { db, sqlite } as const;
      }),
      ({ sqlite }) => Effect.sync(() => sqlite.close())
    ),
  }
) {}

// ─── Helper: Execute SQL with Effect Error Handling ─────────────────────────

/** Wrap raw SQL execution in Effect error handling */
const execSql = (
  sqlite: Database,
  sql: string
): Effect.Effect<void, DatabaseError> =>
  Effect.try({
    catch: (cause) => new DatabaseError({ cause, operation: sql }),
    try: () => sqlite.exec(sql),
  });

// ─── Helper: Reusable Database Query ─────────────────────────────────────────

/**
 * Wrap a database query in Effect error handling.
 * Reduces boilerplate for analytics queries.
 *
 * @param operation - Name of the operation (for error reporting)
 * @param query - Async function that executes the query
 * @returns Effect that yields the query result or DatabaseError
 */
export const dbQuery = <A>(
  operation: string,
  query: (db: SQLiteBunDatabase<typeof schema>) => Promise<A>
): Effect.Effect<A, DatabaseError, DatabaseService> =>
  Effect.gen(function* dbQuery() {
    const { db } = yield* DatabaseService;
    return yield* Effect.tryPromise({
      catch: (cause) => new DatabaseError({ cause, operation }),
      try: () => query(db),
    });
  });

// ─── Helper: Run in Transaction ─────────────────────────────────────────────

/**
 * Run an effect inside a database transaction.
 * Automatically rolls back on error and commits on success.
 * SQL commands are wrapped in Effect for proper error propagation.
 */
export const runInTransaction = <A, E>(
  effect: Effect.Effect<A, E, DatabaseService>
): Effect.Effect<A, E | DatabaseError, DatabaseService> =>
  Effect.gen(function* runInTransaction() {
    const { sqlite } = yield* DatabaseService;

    yield* execSql(sqlite, "BEGIN IMMEDIATE");

    const result = yield* Effect.catchAll(effect, (error) =>
      execSql(sqlite, "ROLLBACK").pipe(
        Effect.catchAll(() => Effect.void),
        Effect.andThen(Effect.fail(error))
      )
    );

    yield* execSql(sqlite, "COMMIT");
    return result;
  });
