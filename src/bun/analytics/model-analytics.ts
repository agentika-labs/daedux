import { Context, Effect, Layer } from "effect";
import { sql, desc, eq, and, count } from "drizzle-orm";
import { DatabaseService } from "../db";
import { DatabaseError } from "../errors";
import * as schema from "../db/schema";
import { modelDisplayNameWithVersion, modelFamily } from "../utils/pricing";
import { DateFilter, buildDateConditions } from "./shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelUsage {
  readonly model: string;
  readonly queryCount: number;
  readonly totalCost: number;
}

export interface ModelBreakdown {
  readonly model: string;
  readonly modelShort: string;
  readonly modelFamily: string;
  readonly rawModelIds: string[];
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly queries: number;
  readonly sessions: number;
}

// ─── Service Interface ───────────────────────────────────────────────────────

export class ModelAnalyticsService extends Context.Tag("ModelAnalyticsService")<
  ModelAnalyticsService,
  {
    readonly getModelBreakdown: (
      dateFilter?: DateFilter
    ) => Effect.Effect<ModelBreakdown[], DatabaseError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const ModelAnalyticsServiceLive = Layer.effect(
  ModelAnalyticsService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      getModelBreakdown: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              // Original query without date filter - no join needed
              result = await db
                .select({
                  model: schema.queries.model,
                  queryCount: count(),
                  totalCost: sql<number>`SUM(${schema.queries.cost})`.as("total_cost"),
                  totalTokens: sql<number>`SUM(
                    COALESCE(${schema.queries.inputTokens}, 0) +
                    COALESCE(${schema.queries.outputTokens}, 0) +
                    COALESCE(${schema.queries.cacheRead}, 0) +
                    COALESCE(${schema.queries.cacheWrite}, 0)
                  )`.as("total_tokens"),
                  sessionCount: sql<number>`COUNT(DISTINCT ${schema.queries.sessionId})`.as(
                    "session_count"
                  ),
                })
                .from(schema.queries)
                .where(sql`${schema.queries.model} IS NOT NULL AND ${schema.queries.model} != '<synthetic>'`)
                .groupBy(schema.queries.model)
                .orderBy(desc(sql`SUM(${schema.queries.cost})`));
            } else {
              // Filtered query - join with sessions for date range
              const conditions = [sql`${schema.queries.model} IS NOT NULL AND ${schema.queries.model} != '<synthetic>'`, ...dateConditions];

              result = await db
                .select({
                  model: schema.queries.model,
                  queryCount: count(),
                  totalCost: sql<number>`SUM(${schema.queries.cost})`.as("total_cost"),
                  totalTokens: sql<number>`SUM(
                    COALESCE(${schema.queries.inputTokens}, 0) +
                    COALESCE(${schema.queries.outputTokens}, 0) +
                    COALESCE(${schema.queries.cacheRead}, 0) +
                    COALESCE(${schema.queries.cacheWrite}, 0)
                  )`.as("total_tokens"),
                  sessionCount: sql<number>`COUNT(DISTINCT ${schema.queries.sessionId})`.as(
                    "session_count"
                  ),
                })
                .from(schema.queries)
                .innerJoin(schema.sessions, eq(schema.queries.sessionId, schema.sessions.sessionId))
                .where(and(...conditions))
                .groupBy(schema.queries.model)
                .orderBy(desc(sql`SUM(${schema.queries.cost})`));
            }

            // Group by normalized model name (e.g., all Opus 4.6 variants together)
            const modelMap = new Map<
              string,
              {
                rawModelIds: string[];
                totalTokens: number;
                totalCost: number;
                queries: number;
                sessions: number;
              }
            >();

            for (const row of result) {
              const rawModel = row.model ?? "unknown";
              const shortName = modelDisplayNameWithVersion(rawModel);

              const existing = modelMap.get(shortName);
              if (existing) {
                existing.rawModelIds.push(rawModel);
                existing.totalTokens += row.totalTokens ?? 0;
                existing.totalCost += row.totalCost ?? 0;
                existing.queries += row.queryCount;
                existing.sessions += row.sessionCount ?? 0;
              } else {
                modelMap.set(shortName, {
                  rawModelIds: [rawModel],
                  totalTokens: row.totalTokens ?? 0,
                  totalCost: row.totalCost ?? 0,
                  queries: row.queryCount,
                  sessions: row.sessionCount ?? 0,
                });
              }
            }

            // Convert to array and sort by cost descending
            const breakdowns: ModelBreakdown[] = [];
            for (const [shortName, data] of modelMap) {
              const primaryModelId = data.rawModelIds[0]!;
              breakdowns.push({
                model: primaryModelId,
                modelShort: shortName,
                modelFamily: modelFamily(primaryModelId),
                rawModelIds: data.rawModelIds,
                totalTokens: data.totalTokens,
                totalCost: data.totalCost,
                queries: data.queries,
                sessions: data.sessions,
              });
            }

            return breakdowns.sort((a, b) => b.totalCost - a.totalCost);
          },
          catch: (error) =>
            new DatabaseError({
              operation: "getModelBreakdown",
              cause: error,
            }),
        }),
    };
  })
);
