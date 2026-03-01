import { sql, desc, eq, and, count } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import type { DateFilter } from "./shared";
import {
  buildDateConditions,
  sessionsTable,
  sessionJoinOn,
  withDateFilter,
} from "./shared";

export interface FileActivityStat {
  readonly filePath: string;
  readonly fileExtension: string;
  readonly reads: number;
  readonly writes: number;
  readonly edits: number;
  readonly totalOps: number;
}

export interface FileExtensionStat {
  readonly extension: string;
  readonly count: number;
  readonly percentage: number;
}

export interface SessionFileOperation {
  readonly filePath: string;
  readonly tool: string;
  readonly extension: string;
}

/**
 * FileAnalyticsService provides file operation statistics.
 * Tracks file activity, extensions, and per-session operations.
 */
export class FileAnalyticsService extends Effect.Service<FileAnalyticsService>()(
  "FileAnalyticsService",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      return {
        getFileActivity: (limit = 50, dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getFileActivity" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      edits:
                        sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'edit' THEN 1 ELSE 0 END)`.as(
                          "edits"
                        ),
                      fileExtension: schema.fileOperations.fileExtension,
                      filePath: schema.fileOperations.filePath,
                      reads:
                        sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'read' THEN 1 ELSE 0 END)`.as(
                          "reads"
                        ),
                      totalOps: count(),
                      writes:
                        sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'write' THEN 1 ELSE 0 END)`.as(
                          "writes"
                        ),
                    })
                    .from(schema.fileOperations)
                    .groupBy(schema.fileOperations.filePath)
                    .orderBy(desc(count()))
                    .limit(limit),
                () =>
                  db
                    .select({
                      edits:
                        sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'edit' THEN 1 ELSE 0 END)`.as(
                          "edits"
                        ),
                      fileExtension: schema.fileOperations.fileExtension,
                      filePath: schema.fileOperations.filePath,
                      reads:
                        sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'read' THEN 1 ELSE 0 END)`.as(
                          "reads"
                        ),
                      totalOps: count(),
                      writes:
                        sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'write' THEN 1 ELSE 0 END)`.as(
                          "writes"
                        ),
                    })
                    .from(schema.fileOperations)
                    .innerJoin(
                      sessionsTable,
                      sessionJoinOn(schema.fileOperations)
                    )
                    .where(and(...dateConditions))
                    .groupBy(schema.fileOperations.filePath)
                    .orderBy(desc(count()))
                    .limit(limit)
              );

              return result.map((row) => ({
                edits: row.edits ?? 0,
                fileExtension: row.fileExtension ?? "",
                filePath: row.filePath,
                reads: row.reads ?? 0,
                totalOps: row.totalOps,
                writes: row.writes ?? 0,
              }));
            },
          }),

        getFileExtensions: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getFileExtensions",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);
              const extensionNotEmpty = sql`${schema.fileOperations.fileExtension} IS NOT NULL AND ${schema.fileOperations.fileExtension} != ''`;

              // Limit to top 100 extensions to avoid unbounded result sets
              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      count: count(),
                      extension: schema.fileOperations.fileExtension,
                    })
                    .from(schema.fileOperations)
                    .where(extensionNotEmpty)
                    .groupBy(schema.fileOperations.fileExtension)
                    .orderBy(desc(count()))
                    .limit(100),
                () =>
                  db
                    .select({
                      count: count(),
                      extension: schema.fileOperations.fileExtension,
                    })
                    .from(schema.fileOperations)
                    .innerJoin(
                      sessionsTable,
                      sessionJoinOn(schema.fileOperations)
                    )
                    .where(and(extensionNotEmpty, ...dateConditions))
                    .groupBy(schema.fileOperations.fileExtension)
                    .orderBy(desc(count()))
                    .limit(100)
              );

              const total = result.reduce((sum, row) => sum + row.count, 0);
              return result.map((row) => ({
                count: row.count,
                extension: row.extension ?? "unknown",
                percentage: total > 0 ? (row.count / total) * 100 : 0,
              }));
            },
          }),

        getSessionFileOperations: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getSessionFileOperations",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);
              const operationCondition = sql`${schema.fileOperations.operation} IN ('read', 'write', 'edit')`;

              // Defensive limit to avoid memory issues with large datasets
              const MAX_FILE_OPS = 100_000;
              const result = await withDateFilter(
                dateConditions,
                () =>
                  db
                    .select({
                      fileExtension: schema.fileOperations.fileExtension,
                      filePath: schema.fileOperations.filePath,
                      operation: schema.fileOperations.operation,
                      sessionId: schema.fileOperations.sessionId,
                    })
                    .from(schema.fileOperations)
                    .where(operationCondition)
                    .limit(MAX_FILE_OPS),
                () =>
                  db
                    .select({
                      fileExtension: schema.fileOperations.fileExtension,
                      filePath: schema.fileOperations.filePath,
                      operation: schema.fileOperations.operation,
                      sessionId: schema.fileOperations.sessionId,
                    })
                    .from(schema.fileOperations)
                    .innerJoin(
                      sessionsTable,
                      sessionJoinOn(schema.fileOperations)
                    )
                    .where(and(operationCondition, ...dateConditions))
                    .limit(MAX_FILE_OPS)
              );

              // Group by sessionId
              const sessionMap = new Map<string, SessionFileOperation[]>();
              for (const row of result) {
                if (!sessionMap.has(row.sessionId)) {
                  sessionMap.set(row.sessionId, []);
                }
                // Convert lowercase operation to capitalized tool name for dashboard compatibility
                const tool =
                  row.operation === "read"
                    ? "Read"
                    : row.operation === "edit"
                      ? "Edit"
                      : row.operation === "write"
                        ? "Write"
                        : row.operation;
                sessionMap.get(row.sessionId)!.push({
                  extension: row.fileExtension ?? "",
                  filePath: row.filePath,
                  tool,
                });
              }
              return sessionMap;
            },
          }),
      } as const;
    }),
  }
) {}
