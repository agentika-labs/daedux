import { sql, desc, eq, and, count } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { Effect } from "effect";
import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import {
  type ConfidenceLevel,
  getConfidenceLevel,
  percentile,
  wilsonScoreInterval,
} from "../utils/statistics";
import type { DateFilter } from "./shared";
import { buildDateConditions } from "./shared";

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
  readonly topErrors: { message: string; count: number }[];
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
  readonly topErrors: { message: string; count: number }[];
  readonly fixSuggestions: string[];
}

export interface ToolHealthReportCard {
  readonly reliableTools: {
    name: string;
    successRate: number;
    totalCalls: number;
    /** Wilson lower bound of success rate × 100 */
    reliabilityScore: number;
    confidence: ConfidenceLevel;
  }[];
  readonly frictionPoints: {
    name: string;
    errorRate: number;
    topError: string;
    totalCalls: number;
    /** Wilson upper bound of error rate × 100 */
    frictionScore: number;
    confidence: ConfidenceLevel;
  }[];
  readonly bashDeepDive: BashCategoryHealth[];
  readonly headline: string;
  readonly recommendation: string;
  /** Population statistics for context */
  readonly populationStats?: {
    totalTools: number;
    reliableThreshold: number;
    frictionThreshold: number;
  };
}

export interface ApiErrorStat {
  readonly errorType: string;
  readonly count: number;
  readonly lastOccurred: number;
}

// ─── Fix Suggestions Pattern Matching ────────────────────────────────────────

const FIX_SUGGESTIONS: Record<
  string,
  { pattern: RegExp; suggestion: string }[]
> = {
  build_test: [
    {
      pattern: /command not found/i,
      suggestion: "Install missing dependencies with `bun add -D <package>`",
    },
    {
      pattern: /ENOENT.*package\.json/i,
      suggestion: "Run from project root or initialize with `bun init`",
    },
    {
      pattern: /test.*failed|failing|failure/i,
      suggestion: "Check test output for specific assertion failures",
    },
    {
      pattern: /typescript|tsc|type.*error/i,
      suggestion: "Run `bun run typecheck` to see all type errors",
    },
    {
      pattern: /Cannot find module/i,
      suggestion: "Verify import paths and run `bun install`",
    },
    {
      pattern: /EPERM|permission denied/i,
      suggestion: "Check file permissions or avoid writing to protected paths",
    },
  ],
  file_ops: [
    {
      pattern: /ENOENT|no such file/i,
      suggestion: "Verify file path exists before operation",
    },
    {
      pattern: /EACCES|permission denied/i,
      suggestion: "Check file/directory permissions",
    },
    {
      pattern: /EEXIST|already exists/i,
      suggestion:
        "File already exists; use overwrite flag or choose different name",
    },
    {
      pattern: /EISDIR|is a directory/i,
      suggestion: "Use recursive flag for directory operations",
    },
  ],
  git: [
    {
      pattern: /not a git repository/i,
      suggestion: "Initialize with `git init` or navigate to repo root",
    },
    {
      pattern: /merge conflict/i,
      suggestion:
        "Resolve conflicts in marked files, then `git add` and commit",
    },
    {
      pattern: /nothing to commit/i,
      suggestion: "Stage changes with `git add` before committing",
    },
    {
      pattern: /already exists/i,
      suggestion: "Delete or rename existing branch before creating new one",
    },
    {
      pattern: /rejected.*non-fast-forward/i,
      suggestion: "Pull latest changes first: `git pull --rebase`",
    },
    {
      pattern: /failed to push/i,
      suggestion: "Check remote permissions and branch protection rules",
    },
  ],
  other: [
    {
      pattern: /command not found/i,
      suggestion: "Install missing command or check PATH",
    },
    {
      pattern: /timeout|timed out/i,
      suggestion: "Increase timeout or check for deadlocks",
    },
    {
      pattern: /memory|heap|out of memory/i,
      suggestion: "Increase Node memory with `--max-old-space-size`",
    },
  ],
  package_manager: [
    {
      pattern: /EACCES|permission denied/i,
      suggestion: "Avoid sudo; use a node version manager (fnm, nvm)",
    },
    {
      pattern: /ERESOLVE|peer dep/i,
      suggestion: "Try `--legacy-peer-deps` or update conflicting packages",
    },
    {
      pattern: /ENOENT.*package\.json/i,
      suggestion:
        "Initialize project with `bun init` or navigate to project root",
    },
    {
      pattern: /network|ETIMEDOUT|ENOTFOUND/i,
      suggestion:
        "Check network connection; try `--offline` if packages are cached",
    },
    {
      pattern: /integrity|checksum/i,
      suggestion: "Clear cache with `bun pm cache rm` and reinstall",
    },
  ],
};

// ─── Helper Functions ────────────────────────────────────────────────────────

function categorizeErrorsByPattern(
  errors: { errorMessage: string | null; count: number }[],
): Record<string, { message: string; count: number }[]> {
  const result: Record<string, { message: string; count: number }[]> = {
    build_test: [],
    file_ops: [],
    git: [],
    other: [],
    package_manager: [],
  };

  for (const err of errors) {
    const msg = err.errorMessage ?? "Unknown error";
    let categorized = false;

    if (/npm|yarn|bun|pnpm|package|install|add|remove/i.test(msg)) {
      result.package_manager!.push({ count: err.count, message: msg });
      categorized = true;
    } else if (/git|commit|push|pull|merge|branch|checkout/i.test(msg)) {
      result.git!.push({ count: err.count, message: msg });
      categorized = true;
    } else if (
      /test|jest|vitest|mocha|build|compile|tsc|typescript/i.test(msg)
    ) {
      result.build_test!.push({ count: err.count, message: msg });
      categorized = true;
    } else if (/ENOENT|EACCES|EEXIST|file|directory|path/i.test(msg)) {
      result.file_ops!.push({ count: err.count, message: msg });
      categorized = true;
    }

    if (!categorized) {
      result.other!.push({ count: err.count, message: msg });
    }
  }

  return result;
}

function getFixSuggestions(
  category: string,
  errors: { message: string; count: number }[],
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
  dateConditions: SQL[],
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
      .innerJoin(
        schema.sessions,
        eq(schema.bashCommands.sessionId, schema.sessions.sessionId),
      )
      .where(and(...dateConditions))
      .groupBy(schema.bashCommands.category)
      .orderBy(desc(count()));
  }

  // Get Bash tool errors
  let bashErrors;
  if (dateConditions.length === 0) {
    bashErrors = await db
      .select({
        count: count(),
        errorMessage: schema.toolUses.errorMessage,
      })
      .from(schema.toolUses)
      .where(
        and(
          eq(schema.toolUses.toolName, "Bash"),
          eq(schema.toolUses.hasError, true),
        ),
      )
      .groupBy(schema.toolUses.errorMessage)
      .orderBy(desc(count()))
      .limit(20);
  } else {
    bashErrors = await db
      .select({
        count: count(),
        errorMessage: schema.toolUses.errorMessage,
      })
      .from(schema.toolUses)
      .innerJoin(
        schema.sessions,
        eq(schema.toolUses.sessionId, schema.sessions.sessionId),
      )
      .where(
        and(
          eq(schema.toolUses.toolName, "Bash"),
          eq(schema.toolUses.hasError, true),
          ...dateConditions,
        ),
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
        errors:
          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
            "errors",
          ),
        total: count(),
      })
      .from(schema.toolUses)
      .where(eq(schema.toolUses.toolName, "Bash"));
  } else {
    bashTotalStats = await db
      .select({
        errors:
          sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
            "errors",
          ),
        total: count(),
      })
      .from(schema.toolUses)
      .innerJoin(
        schema.sessions,
        eq(schema.toolUses.sessionId, schema.sessions.sessionId),
      )
      .where(and(eq(schema.toolUses.toolName, "Bash"), ...dateConditions));
  }

  const totalBashUses = bashTotalStats[0]?.total ?? 0;
  const totalBashErrors = bashTotalStats[0]?.errors ?? 0;
  const overallBashErrorRate =
    totalBashUses > 0 ? totalBashErrors / totalBashUses : 0;

  const errorsByCategory = categorizeErrorsByPattern(bashErrors);

  return categoryData.map((cat) => {
    const categoryErrors = errorsByCategory[cat.category] ?? [];
    const categoryErrorCount = categoryErrors.reduce(
      (sum: number, e: { count: number }) => sum + e.count,
      0,
    );
    const categoryErrorRate =
      cat.totalCommands > 0
        ? Math.min(
            categoryErrorCount / cat.totalCommands,
            overallBashErrorRate * 2,
          )
        : 0;

    return {
      category: cat.category,
      errorCount: categoryErrorCount,
      errorRate: categoryErrorRate,
      fixSuggestions: getFixSuggestions(cat.category, categoryErrors),
      topErrors: categoryErrors.slice(0, 3),
      totalCommands: cat.totalCommands,
    };
  });
}

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * ToolAnalyticsService provides tool usage and health analytics.
 * Tracks tool invocations, error rates, bash commands, and API errors.
 */
export class ToolAnalyticsService extends Effect.Service<ToolAnalyticsService>()(
  "ToolAnalyticsService",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      return {
        getApiErrors: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getApiErrors" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    count: count(),
                    errorType: schema.apiErrors.errorType,
                    lastOccurred:
                      sql<number>`MAX(${schema.apiErrors.timestamp})`.as(
                        "last_occurred",
                      ),
                  })
                  .from(schema.apiErrors)
                  .groupBy(schema.apiErrors.errorType)
                  .orderBy(desc(count()));
              } else {
                result = await db
                  .select({
                    count: count(),
                    errorType: schema.apiErrors.errorType,
                    lastOccurred:
                      sql<number>`MAX(${schema.apiErrors.timestamp})`.as(
                        "last_occurred",
                      ),
                  })
                  .from(schema.apiErrors)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.apiErrors.sessionId, schema.sessions.sessionId),
                  )
                  .where(and(...dateConditions))
                  .groupBy(schema.apiErrors.errorType)
                  .orderBy(desc(count()));
              }

              return result.map((row) => ({
                count: row.count,
                errorType: row.errorType,
                lastOccurred: row.lastOccurred ?? 0,
              }));
            },
          }),

        getBashCategoryHealth: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getBashCategoryHealth",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);
              return getBashCategoryHealthInternal(db, dateConditions);
            },
          }),

        getBashCommandStats: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getBashCommandStats",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              // Use SUBSTR to cap GROUP_CONCAT at 10KB to prevent memory issues
              // We only need ~5 unique commands, and each command is typically <200 chars
              // Deduplication happens in TypeScript since SQLite DISTINCT doesn't work with separators
              const boundedGroupConcat =
                sql<string>`SUBSTR(GROUP_CONCAT(${schema.bashCommands.command}, '|||'), 1, 10000)`.as(
                  "commands",
                );

              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    category: schema.bashCommands.category,
                    commands: boundedGroupConcat,
                    count: count(),
                  })
                  .from(schema.bashCommands)
                  .groupBy(schema.bashCommands.category)
                  .orderBy(desc(count()));
              } else {
                result = await db
                  .select({
                    category: schema.bashCommands.category,
                    commands: boundedGroupConcat,
                    count: count(),
                  })
                  .from(schema.bashCommands)
                  .innerJoin(
                    schema.sessions,
                    eq(
                      schema.bashCommands.sessionId,
                      schema.sessions.sessionId,
                    ),
                  )
                  .where(and(...dateConditions))
                  .groupBy(schema.bashCommands.category)
                  .orderBy(desc(count()));
              }

              return result.map((row) => {
                const allCommands = (row.commands ?? "").split("|||");
                // Deduplicate and take top 5 unique commands
                const uniqueCommands = [...new Set(allCommands)].slice(0, 5);
                return {
                  category: row.category,
                  count: row.count,
                  topCommands: uniqueCommands,
                };
              });
            },
          }),

        getSessionToolCounts: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getSessionToolCounts",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    count: count(),
                    sessionId: schema.toolUses.sessionId,
                    toolName: schema.toolUses.toolName,
                  })
                  .from(schema.toolUses)
                  .groupBy(schema.toolUses.sessionId, schema.toolUses.toolName);
              } else {
                result = await db
                  .select({
                    count: count(),
                    sessionId: schema.toolUses.sessionId,
                    toolName: schema.toolUses.toolName,
                  })
                  .from(schema.toolUses)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.toolUses.sessionId, schema.sessions.sessionId),
                  )
                  .where(and(...dateConditions))
                  .groupBy(schema.toolUses.sessionId, schema.toolUses.toolName);
              }

              const sessionToolCounts = new Map<
                string,
                Record<string, number>
              >();
              for (const row of result) {
                if (!sessionToolCounts.has(row.sessionId)) {
                  sessionToolCounts.set(row.sessionId, {});
                }
                sessionToolCounts.get(row.sessionId)![row.toolName] = row.count;
              }
              return sessionToolCounts;
            },
          }),

        getSessionToolErrorCounts: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getSessionToolErrorCounts",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    errorCount:
                      sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                        "error_count",
                      ),
                    sessionId: schema.toolUses.sessionId,
                  })
                  .from(schema.toolUses)
                  .groupBy(schema.toolUses.sessionId);
              } else {
                result = await db
                  .select({
                    errorCount:
                      sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                        "error_count",
                      ),
                    sessionId: schema.toolUses.sessionId,
                  })
                  .from(schema.toolUses)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.toolUses.sessionId, schema.sessions.sessionId),
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
          }),

        getToolHealth: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getToolHealth" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    errorCount:
                      sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                        "error_count",
                      ),
                    sessions:
                      sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                        "sessions",
                      ),
                    toolName: schema.toolUses.toolName,
                    totalUses: count(),
                  })
                  .from(schema.toolUses)
                  .groupBy(schema.toolUses.toolName)
                  .orderBy(desc(count()));
              } else {
                result = await db
                  .select({
                    errorCount:
                      sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                        "error_count",
                      ),
                    sessions:
                      sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                        "sessions",
                      ),
                    toolName: schema.toolUses.toolName,
                    totalUses: count(),
                  })
                  .from(schema.toolUses)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.toolUses.sessionId, schema.sessions.sessionId),
                  )
                  .where(and(...dateConditions))
                  .groupBy(schema.toolUses.toolName)
                  .orderBy(desc(count()));
              }

              return result.map((row) => ({
                errorRate:
                  row.totalUses > 0 ? (row.errorCount ?? 0) / row.totalUses : 0,
                errors: row.errorCount ?? 0,
                name: row.toolName,
                sessions: row.sessions ?? 0,
                topErrors: [] as { message: string; count: number }[],
                totalCalls: row.totalUses,
              }));
            },
          }),

        getToolHealthReportCard: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({
                cause: error,
                operation: "getToolHealthReportCard",
              }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              // Get tool health stats
              let toolHealthData;
              if (dateConditions.length === 0) {
                toolHealthData = await db
                  .select({
                    errorCount:
                      sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                        "error_count",
                      ),
                    toolName: schema.toolUses.toolName,
                    totalUses: count(),
                  })
                  .from(schema.toolUses)
                  .groupBy(schema.toolUses.toolName)
                  .orderBy(desc(count()));
              } else {
                toolHealthData = await db
                  .select({
                    errorCount:
                      sql<number>`SUM(CASE WHEN ${schema.toolUses.hasError} = 1 THEN 1 ELSE 0 END)`.as(
                        "error_count",
                      ),
                    toolName: schema.toolUses.toolName,
                    totalUses: count(),
                  })
                  .from(schema.toolUses)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.toolUses.sessionId, schema.sessions.sessionId),
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
                    count: count(),
                    errorMessage: schema.toolUses.errorMessage,
                    toolName: schema.toolUses.toolName,
                  })
                  .from(schema.toolUses)
                  .where(eq(schema.toolUses.hasError, true))
                  .groupBy(
                    schema.toolUses.toolName,
                    schema.toolUses.errorMessage,
                  )
                  .orderBy(desc(count()))
                  .limit(100);
              } else {
                topErrorsData = await db
                  .select({
                    count: count(),
                    errorMessage: schema.toolUses.errorMessage,
                    toolName: schema.toolUses.toolName,
                  })
                  .from(schema.toolUses)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.toolUses.sessionId, schema.sessions.sessionId),
                  )
                  .where(
                    and(eq(schema.toolUses.hasError, true), ...dateConditions),
                  )
                  .groupBy(
                    schema.toolUses.toolName,
                    schema.toolUses.errorMessage,
                  )
                  .orderBy(desc(count()))
                  .limit(100);
              }

              // Group errors by tool
              const errorsByTool = new Map<
                string,
                { message: string; count: number }[]
              >();
              for (const err of topErrorsData) {
                const toolErrors = errorsByTool.get(err.toolName) ?? [];
                toolErrors.push({
                  count: err.count,
                  message: err.errorMessage ?? "Unknown error",
                });
                errorsByTool.set(err.toolName, toolErrors);
              }

              // Calculate metrics for each tool using Wilson score intervals
              const toolMetrics = toolHealthData.map((tool) => {
                const errorCount = tool.errorCount ?? 0;
                const successes = tool.totalUses - errorCount;

                // Wilson score intervals provide confidence bounds
                const successInterval = wilsonScoreInterval(
                  successes,
                  tool.totalUses,
                );
                const errorInterval = wilsonScoreInterval(
                  errorCount,
                  tool.totalUses,
                );

                return {
                  confidence: getConfidenceLevel(tool.totalUses),
                  errorCount,
                  errorRate:
                    tool.totalUses > 0 ? errorCount / tool.totalUses : 0,
                  // frictionScore: Wilson upper bound of error rate (worst-case error rate)
                  frictionScore: errorInterval.upper * 100,
                  name: tool.toolName,
                  // reliabilityScore: Wilson lower bound of success rate (conservative estimate)
                  reliabilityScore: successInterval.lower * 100,
                  successRate:
                    tool.totalUses > 0 ? successes / tool.totalUses : 1,
                  topError: errorsByTool.get(tool.toolName)?.[0]?.message ?? "",
                  totalCalls: tool.totalUses,
                };
              });

              // Percentile-based thresholds adapt to actual data distribution
              const reliabilityScores = toolMetrics.map(
                (t) => t.reliabilityScore,
              );
              const frictionScores = toolMetrics.map((t) => t.frictionScore);

              // Top 20% reliability score = 80th percentile threshold
              const reliableThreshold = percentile(reliabilityScores, 80);
              // Top 20% friction score (worst errors) = 80th percentile
              const frictionThreshold = percentile(frictionScores, 80);

              // Reliable tools: high reliability score, minimum sample size for credibility
              const reliableTools = toolMetrics
                .filter(
                  (t) =>
                    t.reliabilityScore >= reliableThreshold &&
                    t.totalCalls >= 10,
                )
                .toSorted((a, b) => b.reliabilityScore - a.reliabilityScore)
                .slice(0, 5)
                .map((t) => ({
                  confidence: t.confidence,
                  name: t.name,
                  reliabilityScore: t.reliabilityScore,
                  successRate: t.successRate,
                  totalCalls: t.totalCalls,
                }));

              // Friction points: high friction score OR any errors with small samples
              const frictionPoints = toolMetrics
                .filter(
                  (t) =>
                    (t.frictionScore >= frictionThreshold ||
                      t.errorCount > 0) &&
                    t.totalCalls >= 3,
                )
                .toSorted((a, b) => b.frictionScore - a.frictionScore)
                .slice(0, 5)
                .map((t) => ({
                  confidence: t.confidence,
                  errorRate: t.errorRate,
                  frictionScore: t.frictionScore,
                  name: t.name,
                  topError: t.topError.slice(0, 100),
                  totalCalls: t.totalCalls,
                }));

              // Get bash category health for deep dive
              const bashCategoryData = await getBashCategoryHealthInternal(
                db,
                dateConditions,
              );

              // Generate headline and recommendation
              const totalErrors = toolMetrics.reduce(
                (sum, t) => sum + t.errorCount,
                0,
              );

              const topFriction = frictionPoints[0];
              const bashFriction = bashCategoryData
                .filter((c) => c.errorRate > 0.1)
                .toSorted((a, b) => b.errorCount - a.errorCount)[0];

              let headline = "Your tools are running smoothly";
              let recommendation =
                "Keep up the great work! Your workflow has minimal friction.";

              if (frictionPoints.length > 0 && topFriction) {
                const frictionPercent =
                  Math.round(
                    (frictionPoints.reduce(
                      (sum, f) => sum + (f.errorRate / 100) * f.totalCalls,
                      0,
                    ) /
                      totalErrors) *
                      100,
                  ) || 0;
                headline = `${frictionPoints.length} tool${frictionPoints.length > 1 ? "s" : ""} ${frictionPoints.length > 1 ? "are" : "is"} causing ${frictionPercent > 50 ? "most" : "significant"} workflow friction`;

                if (topFriction.name === "Bash" && bashFriction) {
                  recommendation = `Focus on ${bashFriction.category.replace("_", " ")} commands - ${bashFriction.fixSuggestions[0] ?? "check error logs for patterns"}`;
                } else {
                  recommendation = `${topFriction.name} has ${topFriction.errorRate.toFixed(1)}% error rate. ${topFriction.topError ? `Common error: "${topFriction.topError.slice(0, 50)}..."` : "Review usage patterns."}`;
                }
              }

              return {
                bashDeepDive: bashCategoryData,
                frictionPoints,
                headline,
                populationStats: {
                  frictionThreshold,
                  reliableThreshold,
                  totalTools: toolMetrics.length,
                },
                recommendation,
                reliableTools,
              };
            },
          }),

        getToolUsage: (dateFilter: DateFilter = {}) =>
          Effect.tryPromise({
            catch: (error) =>
              new DatabaseError({ cause: error, operation: "getToolUsage" }),
            try: async () => {
              const dateConditions = buildDateConditions(dateFilter);

              let result;
              if (dateConditions.length === 0) {
                result = await db
                  .select({
                    count: count(),
                    name: schema.toolUses.toolName,
                    sessions:
                      sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                        "sessions",
                      ),
                  })
                  .from(schema.toolUses)
                  .groupBy(schema.toolUses.toolName)
                  .orderBy(desc(count()));
              } else {
                result = await db
                  .select({
                    count: count(),
                    name: schema.toolUses.toolName,
                    sessions:
                      sql<number>`COUNT(DISTINCT ${schema.toolUses.sessionId})`.as(
                        "sessions",
                      ),
                  })
                  .from(schema.toolUses)
                  .innerJoin(
                    schema.sessions,
                    eq(schema.toolUses.sessionId, schema.sessions.sessionId),
                  )
                  .where(and(...dateConditions))
                  .groupBy(schema.toolUses.toolName)
                  .orderBy(desc(count()));
              }

              return result.map((row) => ({
                count: row.count,
                name: row.name,
                sessions: row.sessions ?? 0,
              }));
            },
          }),
      } as const;
    }),
  },
) {}
