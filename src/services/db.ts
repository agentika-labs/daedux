import { Context, Effect, Layer } from "effect";
import { Database } from "bun:sqlite";
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../db/schema";
import { DatabaseError } from "./errors";

// ─── Service Interface ──────────────────────────────────────────────────────

export class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  {
    readonly db: SQLiteBunDatabase<typeof schema>;
    readonly sqlite: Database;
  }
>() {}

// ─── Live Implementation ────────────────────────────────────────────────────

const DB_PATH = `${process.env.HOME}/.claude/usage-monitor.db`;

export const DatabaseServiceLive = Layer.scoped(
  DatabaseService,
  Effect.acquireRelease(
    Effect.sync(() => {
      const sqlite = new Database(DB_PATH);

      // Optimize SQLite for our workload
      sqlite.exec("PRAGMA journal_mode = WAL");      // Better concurrent reads
      sqlite.exec("PRAGMA synchronous = NORMAL");    // Balanced durability/speed
      sqlite.exec("PRAGMA cache_size = -64000");     // 64MB cache
      sqlite.exec("PRAGMA foreign_keys = ON");       // Enforce FK constraints
      sqlite.exec("PRAGMA temp_store = MEMORY");     // Temp tables in memory

      const db = drizzle({ client: sqlite, schema });

      return { db, sqlite };
    }),
    ({ sqlite }) => Effect.sync(() => sqlite.close())
  )
);

// ─── Helper: Execute SQL with Effect Error Handling ─────────────────────────

/** Wrap raw SQL execution in Effect error handling */
const execSql = (sqlite: Database, sql: string): Effect.Effect<void, DatabaseError> =>
  Effect.try({
    try: () => sqlite.exec(sql),
    catch: (cause) => new DatabaseError({ operation: sql, cause }),
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
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    return yield* Effect.tryPromise({
      try: () => query(db),
      catch: (cause) => new DatabaseError({ operation, cause }),
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
  Effect.gen(function* () {
    const { sqlite } = yield* DatabaseService;

    yield* execSql(sqlite, "BEGIN IMMEDIATE");

    const result = yield* Effect.catchAll(effect, (error) =>
      execSql(sqlite, "ROLLBACK").pipe(
        Effect.flatMap(() => Effect.fail(error))
      )
    );

    yield* execSql(sqlite, "COMMIT");
    return result;
  });
