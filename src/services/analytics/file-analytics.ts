import { Context, Effect, Layer } from "effect";
import { sql, desc, eq, and, count } from "drizzle-orm";
import { DatabaseService } from "../db";
import { DatabaseError } from "../errors";
import * as schema from "../../db/schema";
import { DateFilter, buildDateConditions } from "./shared";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Service Interface ───────────────────────────────────────────────────────

export class FileAnalyticsService extends Context.Tag("FileAnalyticsService")<
  FileAnalyticsService,
  {
    readonly getFileActivity: (
      limit?: number,
      dateFilter?: DateFilter
    ) => Effect.Effect<FileActivityStat[], DatabaseError>;
    readonly getFileExtensions: (
      dateFilter?: DateFilter
    ) => Effect.Effect<FileExtensionStat[], DatabaseError>;
    readonly getSessionFileOperations: (
      dateFilter?: DateFilter
    ) => Effect.Effect<Map<string, SessionFileOperation[]>, DatabaseError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const FileAnalyticsServiceLive = Layer.effect(
  FileAnalyticsService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      getFileActivity: (limit = 50, dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  filePath: schema.fileOperations.filePath,
                  fileExtension: schema.fileOperations.fileExtension,
                  reads: sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'read' THEN 1 ELSE 0 END)`.as(
                    "reads"
                  ),
                  writes: sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'write' THEN 1 ELSE 0 END)`.as(
                    "writes"
                  ),
                  edits: sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'edit' THEN 1 ELSE 0 END)`.as(
                    "edits"
                  ),
                  totalOps: count(),
                })
                .from(schema.fileOperations)
                .groupBy(schema.fileOperations.filePath)
                .orderBy(desc(count()))
                .limit(limit);
            } else {
              result = await db
                .select({
                  filePath: schema.fileOperations.filePath,
                  fileExtension: schema.fileOperations.fileExtension,
                  reads: sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'read' THEN 1 ELSE 0 END)`.as(
                    "reads"
                  ),
                  writes: sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'write' THEN 1 ELSE 0 END)`.as(
                    "writes"
                  ),
                  edits: sql<number>`SUM(CASE WHEN ${schema.fileOperations.operation} = 'edit' THEN 1 ELSE 0 END)`.as(
                    "edits"
                  ),
                  totalOps: count(),
                })
                .from(schema.fileOperations)
                .innerJoin(
                  schema.sessions,
                  eq(schema.fileOperations.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.fileOperations.filePath)
                .orderBy(desc(count()))
                .limit(limit);
            }

            return result.map((row) => ({
              filePath: row.filePath,
              fileExtension: row.fileExtension ?? "",
              reads: row.reads ?? 0,
              writes: row.writes ?? 0,
              edits: row.edits ?? 0,
              totalOps: row.totalOps,
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getFileActivity", cause: error }),
        }),

      getFileExtensions: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);
            const extensionNotEmpty = sql`${schema.fileOperations.fileExtension} IS NOT NULL AND ${schema.fileOperations.fileExtension} != ''`;

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  extension: schema.fileOperations.fileExtension,
                  count: count(),
                })
                .from(schema.fileOperations)
                .where(extensionNotEmpty)
                .groupBy(schema.fileOperations.fileExtension)
                .orderBy(desc(count()));
            } else {
              result = await db
                .select({
                  extension: schema.fileOperations.fileExtension,
                  count: count(),
                })
                .from(schema.fileOperations)
                .innerJoin(
                  schema.sessions,
                  eq(schema.fileOperations.sessionId, schema.sessions.sessionId)
                )
                .where(and(extensionNotEmpty, ...dateConditions))
                .groupBy(schema.fileOperations.fileExtension)
                .orderBy(desc(count()));
            }

            const total = result.reduce((sum, row) => sum + row.count, 0);
            return result.map((row) => ({
              extension: row.extension ?? "unknown",
              count: row.count,
              percentage: total > 0 ? (row.count / total) * 100 : 0,
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getFileExtensions", cause: error }),
        }),

      getSessionFileOperations: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);
            const operationCondition = sql`${schema.fileOperations.operation} IN ('read', 'write', 'edit')`;

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  sessionId: schema.fileOperations.sessionId,
                  filePath: schema.fileOperations.filePath,
                  operation: schema.fileOperations.operation,
                  fileExtension: schema.fileOperations.fileExtension,
                })
                .from(schema.fileOperations)
                .where(operationCondition);
            } else {
              result = await db
                .select({
                  sessionId: schema.fileOperations.sessionId,
                  filePath: schema.fileOperations.filePath,
                  operation: schema.fileOperations.operation,
                  fileExtension: schema.fileOperations.fileExtension,
                })
                .from(schema.fileOperations)
                .innerJoin(
                  schema.sessions,
                  eq(schema.fileOperations.sessionId, schema.sessions.sessionId)
                )
                .where(and(operationCondition, ...dateConditions));
            }

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
                filePath: row.filePath,
                tool,
                extension: row.fileExtension ?? "",
              });
            }
            return sessionMap;
          },
          catch: (error) =>
            new DatabaseError({
              operation: "getSessionFileOperations",
              cause: error,
            }),
        }),
    };
  })
);
