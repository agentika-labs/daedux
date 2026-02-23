import { Context, Effect, Layer } from "effect";
import { sql, desc, eq, and, count, type SQL } from "drizzle-orm";
import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { DatabaseService } from "../db";
import { DatabaseError } from "../errors";
import * as schema from "../db/schema";
import { DateFilter, buildDateConditions } from "./shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolUsageStat {
  readonly name: string;
  readonly count: number;
  readonly sessions: number;
}

export interface ToolHealthStat {
  readonly name: string;
  readonly totalCalls: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly sessions: number;
  readonly topErrors: Array<{ message: string; count: number }>;
}

export interface BashCommandStat {
  readonly category: string;
  readonly count: number;
  readonly topCommands: string[];
}

export interface BashCategoryHealth {
  readonly category: string;
  readonly totalCommands: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly topErrors: Array<{ message: string; count: number }>;
  readonly fixSuggestions: string[];
}

export interface ToolHealthReportCard {
  readonly reliableTools: Array<{ name: string; successRate: number; totalCalls: number }>;
  readonly frictionPoints: Array<{
    name: string;
    errorRate: number;
    topError: string;
    totalCalls: number;
  }>;
  readonly bashDeepDive: BashCategoryHealth[];
  readonly headline: string;
  readonly recommendation: string;
}

export interface ApiErrorStat {
  readonly errorType: string;
  readonly count: number;
  readonly lastOccurred: number;
}

// ─── Fix Suggestions Pattern Matching ────────────────────────────────────────

const FIX_SUGGESTIONS: Record<string, Array<{ pattern: RegExp; suggestion: string }>> = {
  build_test: [
    { pattern: /command not found/i, suggestion: "Install missing dependencies with `bun add -D <package>`" },
    { pattern: /ENOENT.*package\.json/i, suggestion: "Run from project root or initialize with `bun init`" },
    { pattern: /test.*failed|failing|failure/i, suggestion: "Check test output for specific assertion failures" },
    { pattern: /typescript|tsc|type.*error/i, suggestion: "Run `bun run typecheck` to see all type errors" },
    { pattern: /Cannot find module/i, suggestion: "Verify import paths and run `bun install`" },
    { pattern: /EPERM|permission denied/i, suggestion: "Check file permissions or avoid writing to protected paths" },
  ],
  package_manager: [
    { pattern: /EACCES|permission denied/i, suggestion: "Avoid sudo; use a node version manager (fnm, nvm)" },
    { pattern: /ERESOLVE|peer dep/i, suggestion: "Try `--legacy-peer-deps` or update conflicting packages" },
    { pattern: /ENOENT.*package\.json/i, suggestion: "Initialize project with `bun init` or navigate to project root" },
    { pattern: /network|ETIMEDOUT|ENOTFOUND/i, suggestion: "Check network connection; try `--offline` if packages are cached" },
    { pattern: /integrity|checksum/i, suggestion: "Clear cache with `bun pm cache rm` and reinstall" },
  ],
  git: [
    { pattern: /not a git repository/i, suggestion: "Initialize with `git init` or navigate to repo root" },
    { pattern: /merge conflict/i, suggestion: "Resolve conflicts in marked files, then `git add` and commit" },
    { pattern: /nothing to commit/i, suggestion: "Stage changes with `git add` before committing" },
    { pattern: /already exists/i, suggestion: "Delete or rename existing branch before creating new one" },
    { pattern: /rejected.*non-fast-forward/i, suggestion: "Pull latest changes first: `git pull --rebase`" },
    { pattern: /failed to push/i, suggestion: "Check remote permissions and branch protection rules" },
  ],
  file_ops: [
    { pattern: /ENOENT|no such file/i, suggestion: "Verify file path exists before operation" },
    { pattern: /EACCES|permission denied/i, suggestion: "Check file/directory permissions" },
    { pattern: /EEXIST|already exists/i, suggestion: "File already exists; use overwrite flag or choose different name" },
    { pattern: /EISDIR|is a directory/i, suggestion: "Use recursive flag for directory operations" },
  ],
  other: [
    { pattern: /command not found/i, suggestion: "Install missing command or check PATH" },
    { pattern: /timeout|timed out/i, suggestion: "Increase timeout or check for deadlocks" },
    { pattern: /memory|heap|out of memory/i, suggestion: "Increase Node memory with `--max-old-space-size`" },
  ],
};

// ─── Helper Functions ────────────────────────────────────────────────────────

function categorizeErrorsByPattern(
  errors: Array<{ errorMessage: string | null; count: number }>
): Record<string, Array<{ message: string; count: number }>> {
  const result: Record<string, Array<{ message: string; count: number }>> = {
    build_test: [],
    package_manager: [],
    git: [],
    file_ops: [],
    other: [],
  };

  for (const err of errors) {
    const msg = err.errorMessage ?? "Unknown error";
    let categorized = false;

    if (/npm|yarn|bun|pnpm|package|install|add|remove/i.test(msg)) {
      result.package_manager!.push({ message: msg, count: err.count });
      categorized = true;
    } else if (/git|commit|push|pull|merge|branch|checkout/i.test(msg)) {
      result.git!.push({ message: msg, count: err.count });
      categorized = true;
    } else if (/test|jest|vitest|mocha|build|compile|tsc|typescript/i.test(msg)) {
      result.build_test!.push({ message: msg, count: err.count });
      categorized = true;
    } else if (/ENOENT|EACCES|EEXIST|file|directory|path/i.test(msg)) {
      result.file_ops!.push({ message: msg, count: err.count });
      categorized = true;
    }

    if (!categorized) {
      result.other!.push({ message: msg, count: err.count });
    }
  }

  return result;
}

function getFixSuggestions(
  category: string,
  errors: Array<{ message: string; count: number }>
): string[] {
  const patterns = FIX_SUGGESTIONS[category] ?? FIX_SUGGESTIONS.other ?? [];
  const suggestions: string[] = [];

  for (const err of errors.slice(0, 5)) {
    for (const { pattern, suggestion } of patterns) {
      if (pattern.test(err.message) && !suggestions.includes(suggestion)) {
        suggestions.push(suggestion);
        break;
      }
    }
  }

  return suggestions.slice(0, 3);
}

async function getBashCategoryHealthInternal(
  db: SQLiteBunDatabase<typeof schema>,
  dateConditions: SQL[]
): Promise<BashCategoryHealth[]> {
  // Get category counts
  let categoryData;
  if (dateConditions.length === 0) {
    categoryData = await db
      .select({
        category: schema.bashCommands.category,
        totalCommands: count(),
      })
      .from(schema.bashCommands)
      .groupBy(schema.bashCommands.category)
      .orderBy(desc(count()));
  } else {
    categoryData = await db
      .select({
        category: schema.bashCommands.category,
        totalCommands: count(),
      })
      .from(schema.bashCommands)
      .innerJoin(schema.sessions, eq(schema.bashCommands.sessionId, schema.sessions.sessionId))
      .where(and(...dateConditions))
      .groupBy(schema.bashCommands.category)
      .orderBy(desc(count()));
  }

  // Get Bash tool errors
  let bashErrors;
  if (dateConditions.length === 0) {
    bashErrors = await db
      .select({
        errorMessage: schema.toolUses.errorMessage,
        count: count(),
      })
      .from(schema.toolUses)
      .where(and(eq(schema.toolUses.toolName, "Bash"), eq(schema.toolUses.hasError, true)))
      .groupBy(schema.toolUses.errorMessage)
      .orderBy(desc(count()))
      .limit(20);
  } else {
    bashErrors = await db
      .select({
        errorMessage: schema.toolUses.errorMessage,
        count: count(),
      })
      .from(schema.toolUses)
      .innerJoin(schema.sessions, eq(schema.toolUses.sessionId, schema.sessions.sessionId))
      .where(
        and(eq(schema.toolUses.toolName, "Bash"), eq(schema.toolUses.hasError, true), ...dateConditions)
      )
      .groupBy(schema.toolUses.errorMessage)
      .orderBy(desc(count()))
      .limit(20);
  }

  // Get overall bash error rate
  let bashTotalStats;
  if (dateConditions.length === 0) {
    bashTotalStats = await db
      .select({
        total: count(),
        errors: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
          "errors"
        ),
      })
      .from(schema.toolUses)
      .where(eq(schema.toolUses.toolName, "Bash"));
  } else {
    bashTotalStats = await db
      .select({
        total: count(),
        errors: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
          "errors"
        ),
      })
      .from(schema.toolUses)
      .innerJoin(schema.sessions, eq(schema.toolUses.sessionId, schema.sessions.sessionId))
      .where(and(eq(schema.toolUses.toolName, "Bash"), ...dateConditions));
  }

  const totalBashUses = bashTotalStats[0]?.total ?? 0;
  const totalBashErrors = bashTotalStats[0]?.errors ?? 0;
  const overallBashErrorRate = totalBashUses > 0 ? totalBashErrors / totalBashUses : 0;

  const errorsByCategory = categorizeErrorsByPattern(bashErrors);

  return categoryData.map((cat) => {
    const categoryErrors = errorsByCategory[cat.category] ?? [];
    const categoryErrorCount = categoryErrors.reduce(
      (sum: number, e: { count: number }) => sum + e.count,
      0
    );
    const categoryErrorRate =
      cat.totalCommands > 0
        ? Math.min(categoryErrorCount / cat.totalCommands, overallBashErrorRate * 2)
        : 0;

    return {
      category: cat.category,
      totalCommands: cat.totalCommands,
      errorCount: categoryErrorCount,
      errorRate: categoryErrorRate,
      topErrors: categoryErrors.slice(0, 3),
      fixSuggestions: getFixSuggestions(cat.category, categoryErrors),
    };
  });
}

// ─── Service Interface ───────────────────────────────────────────────────────

export class ToolAnalyticsService extends Context.Tag("ToolAnalyticsService")<
  ToolAnalyticsService,
  {
    readonly getToolUsage: (
      dateFilter?: DateFilter
    ) => Effect.Effect<ToolUsageStat[], DatabaseError>;
    readonly getToolHealth: (
      dateFilter?: DateFilter
    ) => Effect.Effect<ToolHealthStat[], DatabaseError>;
    readonly getBashCommandStats: (
      dateFilter?: DateFilter
    ) => Effect.Effect<BashCommandStat[], DatabaseError>;
    readonly getSessionToolCounts: (
      dateFilter?: DateFilter
    ) => Effect.Effect<Map<string, Record<string, number>>, DatabaseError>;
    readonly getSessionToolErrorCounts: (
      dateFilter?: DateFilter
    ) => Effect.Effect<Map<string, number>, DatabaseError>;
    readonly getBashCategoryHealth: (
      dateFilter?: DateFilter
    ) => Effect.Effect<BashCategoryHealth[], DatabaseError>;
    readonly getToolHealthReportCard: (
      dateFilter?: DateFilter
    ) => Effect.Effect<ToolHealthReportCard, DatabaseError>;
    readonly getApiErrors: (
      dateFilter?: DateFilter
    ) => Effect.Effect<ApiErrorStat[], DatabaseError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const ToolAnalyticsServiceLive = Layer.effect(
  ToolAnalyticsService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      getToolUsage: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  name: schema.toolUses.toolName,
                  count: count(),
                  sessions: sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as("sessions"),
                })
                .from(schema.toolUses)
                .groupBy(schema.toolUses.toolName)
                .orderBy(desc(count()));
            } else {
              result = await db
                .select({
                  name: schema.toolUses.toolName,
                  count: count(),
                  sessions: sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as("sessions"),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.toolUses.toolName)
                .orderBy(desc(count()));
            }

            return result.map((row) => ({
              name: row.name,
              count: row.count,
              sessions: row.sessions ?? 0,
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getToolUsage", cause: error }),
        }),

      getToolHealth: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  toolName: schema.toolUses.toolName,
                  totalUses: count(),
                  errorCount: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "error_count"
                  ),
                  sessions: sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as("sessions"),
                })
                .from(schema.toolUses)
                .groupBy(schema.toolUses.toolName)
                .orderBy(desc(count()));
            } else {
              result = await db
                .select({
                  toolName: schema.toolUses.toolName,
                  totalUses: count(),
                  errorCount: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "error_count"
                  ),
                  sessions: sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as("sessions"),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.toolUses.toolName)
                .orderBy(desc(count()));
            }

            return result.map((row) => ({
              name: row.toolName,
              totalCalls: row.totalUses,
              errors: row.errorCount ?? 0,
              errorRate: row.totalUses > 0 ? (row.errorCount ?? 0) / row.totalUses : 0,
              sessions: row.sessions ?? 0,
              topErrors: [] as Array<{ message: string; count: number }>,
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getToolHealth", cause: error }),
        }),

      getBashCommandStats: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  category: schema.bashCommands.category,
                  count: count(),
                  commands: sql<string>`GROUP_CONCAT(${schema.bashCommands.command}, '|||')`.as(
                    "commands"
                  ),
                })
                .from(schema.bashCommands)
                .groupBy(schema.bashCommands.category)
                .orderBy(desc(count()));
            } else {
              result = await db
                .select({
                  category: schema.bashCommands.category,
                  count: count(),
                  commands: sql<string>`GROUP_CONCAT(${schema.bashCommands.command}, '|||')`.as(
                    "commands"
                  ),
                })
                .from(schema.bashCommands)
                .innerJoin(
                  schema.sessions,
                  eq(schema.bashCommands.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.bashCommands.category)
                .orderBy(desc(count()));
            }

            return result.map((row) => {
              const allCommands = (row.commands ?? "").split("|||");
              const uniqueCommands = [...new Set(allCommands)].slice(0, 5);
              return {
                category: row.category,
                count: row.count,
                topCommands: uniqueCommands,
              };
            });
          },
          catch: (error) => new DatabaseError({ operation: "getBashCommandStats", cause: error }),
        }),

      getSessionToolCounts: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  sessionId: schema.toolUses.sessionId,
                  toolName: schema.toolUses.toolName,
                  count: count(),
                })
                .from(schema.toolUses)
                .groupBy(schema.toolUses.sessionId, schema.toolUses.toolName);
            } else {
              result = await db
                .select({
                  sessionId: schema.toolUses.sessionId,
                  toolName: schema.toolUses.toolName,
                  count: count(),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.toolUses.sessionId, schema.toolUses.toolName);
            }

            const sessionToolCounts = new Map<string, Record<string, number>>();
            for (const row of result) {
              if (!sessionToolCounts.has(row.sessionId)) {
                sessionToolCounts.set(row.sessionId, {});
              }
              sessionToolCounts.get(row.sessionId)![row.toolName] = row.count;
            }
            return sessionToolCounts;
          },
          catch: (error) => new DatabaseError({ operation: "getSessionToolCounts", cause: error }),
        }),

      getSessionToolErrorCounts: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  sessionId: schema.toolUses.sessionId,
                  errorCount: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "error_count"
                  ),
                })
                .from(schema.toolUses)
                .groupBy(schema.toolUses.sessionId);
            } else {
              result = await db
                .select({
                  sessionId: schema.toolUses.sessionId,
                  errorCount: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "error_count"
                  ),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.toolUses.sessionId);
            }

            const sessionToolErrors = new Map<string, number>();
            for (const row of result) {
              sessionToolErrors.set(row.sessionId, row.errorCount ?? 0);
            }
            return sessionToolErrors;
          },
          catch: (error) =>
            new DatabaseError({ operation: "getSessionToolErrorCounts", cause: error }),
        }),

      getBashCategoryHealth: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);
            return getBashCategoryHealthInternal(db, dateConditions);
          },
          catch: (error) => new DatabaseError({ operation: "getBashCategoryHealth", cause: error }),
        }),

      getToolHealthReportCard: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            // Get tool health stats
            let toolHealthData;
            if (dateConditions.length === 0) {
              toolHealthData = await db
                .select({
                  toolName: schema.toolUses.toolName,
                  totalUses: count(),
                  errorCount: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "error_count"
                  ),
                })
                .from(schema.toolUses)
                .groupBy(schema.toolUses.toolName)
                .orderBy(desc(count()));
            } else {
              toolHealthData = await db
                .select({
                  toolName: schema.toolUses.toolName,
                  totalUses: count(),
                  errorCount: sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                    "error_count"
                  ),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.toolUses.toolName)
                .orderBy(desc(count()));
            }

            // Get top errors per tool
            let topErrorsData;
            if (dateConditions.length === 0) {
              topErrorsData = await db
                .select({
                  toolName: schema.toolUses.toolName,
                  errorMessage: schema.toolUses.errorMessage,
                  count: count(),
                })
                .from(schema.toolUses)
                .where(eq(schema.toolUses.hasError, true))
                .groupBy(schema.toolUses.toolName, schema.toolUses.errorMessage)
                .orderBy(desc(count()))
                .limit(100);
            } else {
              topErrorsData = await db
                .select({
                  toolName: schema.toolUses.toolName,
                  errorMessage: schema.toolUses.errorMessage,
                  count: count(),
                })
                .from(schema.toolUses)
                .innerJoin(
                  schema.sessions,
                  eq(schema.toolUses.sessionId, schema.sessions.sessionId)
                )
                .where(and(eq(schema.toolUses.hasError, true), ...dateConditions))
                .groupBy(schema.toolUses.toolName, schema.toolUses.errorMessage)
                .orderBy(desc(count()))
                .limit(100);
            }

            // Group errors by tool
            const errorsByTool = new Map<string, Array<{ message: string; count: number }>>();
            for (const err of topErrorsData) {
              const toolErrors = errorsByTool.get(err.toolName) ?? [];
              toolErrors.push({ message: err.errorMessage ?? "Unknown error", count: err.count });
              errorsByTool.set(err.toolName, toolErrors);
            }

            // Calculate metrics for each tool
            const toolMetrics = toolHealthData.map((tool) => ({
              name: tool.toolName,
              totalCalls: tool.totalUses,
              errorCount: tool.errorCount ?? 0,
              errorRate: tool.totalUses > 0 ? (tool.errorCount ?? 0) / tool.totalUses : 0,
              successRate: tool.totalUses > 0 ? 1 - (tool.errorCount ?? 0) / tool.totalUses : 1,
              topError: errorsByTool.get(tool.toolName)?.[0]?.message ?? "",
            }));

            // Separate reliable tools from friction points
            const reliableTools = toolMetrics
              .filter((t) => t.successRate >= 0.98 && t.totalCalls >= 100)
              .slice(0, 5)
              .map((t) => ({
                name: t.name,
                successRate: t.successRate,
                totalCalls: t.totalCalls,
              }));

            const frictionPoints = toolMetrics
              .filter((t) => t.errorRate >= 0.03 && t.totalCalls >= 10)
              .sort((a, b) => b.errorCount - a.errorCount)
              .slice(0, 5)
              .map((t) => ({
                name: t.name,
                errorRate: t.errorRate,
                topError: t.topError.slice(0, 100),
                totalCalls: t.totalCalls,
              }));

            // Get bash category health for deep dive
            const bashCategoryData = await getBashCategoryHealthInternal(db, dateConditions);

            // Generate headline and recommendation
            const totalErrors = toolMetrics.reduce((sum, t) => sum + t.errorCount, 0);

            const topFriction = frictionPoints[0];
            const bashFriction = bashCategoryData
              .filter((c) => c.errorRate > 0.1)
              .sort((a, b) => b.errorCount - a.errorCount)[0];

            let headline = "Your tools are running smoothly";
            let recommendation = "Keep up the great work! Your workflow has minimal friction.";

            if (frictionPoints.length > 0 && topFriction) {
              const frictionPercent =
                Math.round(
                  (frictionPoints.reduce(
                    (sum, f) => sum + (f.errorRate / 100) * f.totalCalls,
                    0
                  ) /
                    totalErrors) *
                    100
                ) || 0;
              headline = `${frictionPoints.length} tool${frictionPoints.length > 1 ? "s" : ""} ${frictionPoints.length > 1 ? "are" : "is"} causing ${frictionPercent > 50 ? "most" : "significant"} workflow friction`;

              if (topFriction.name === "Bash" && bashFriction) {
                recommendation = `Focus on ${bashFriction.category.replace("_", " ")} commands - ${bashFriction.fixSuggestions[0] ?? "check error logs for patterns"}`;
              } else {
                recommendation = `${topFriction.name} has ${topFriction.errorRate.toFixed(1)}% error rate. ${topFriction.topError ? `Common error: "${topFriction.topError.slice(0, 50)}..."` : "Review usage patterns."}`;
              }
            }

            return {
              reliableTools,
              frictionPoints,
              bashDeepDive: bashCategoryData,
              headline,
              recommendation,
            };
          },
          catch: (error) =>
            new DatabaseError({ operation: "getToolHealthReportCard", cause: error }),
        }),

      getApiErrors: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              result = await db
                .select({
                  errorType: schema.apiErrors.errorType,
                  count: count(),
                  lastOccurred: sql<number>`MAX(${schema.apiErrors.timestamp})`.as("last_occurred"),
                })
                .from(schema.apiErrors)
                .groupBy(schema.apiErrors.errorType)
                .orderBy(desc(count()));
            } else {
              result = await db
                .select({
                  errorType: schema.apiErrors.errorType,
                  count: count(),
                  lastOccurred: sql<number>`MAX(${schema.apiErrors.timestamp})`.as("last_occurred"),
                })
                .from(schema.apiErrors)
                .innerJoin(
                  schema.sessions,
                  eq(schema.apiErrors.sessionId, schema.sessions.sessionId)
                )
                .where(and(...dateConditions))
                .groupBy(schema.apiErrors.errorType)
                .orderBy(desc(count()));
            }

            return result.map((row) => ({
              errorType: row.errorType,
              count: row.count,
              lastOccurred: row.lastOccurred ?? 0,
            }));
          },
          catch: (error) => new DatabaseError({ operation: "getApiErrors", cause: error }),
        }),
    };
  })
);
