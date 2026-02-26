import { sql, desc, eq, and, count } from "drizzle-orm";
import { Effect } from "effect";

import {
  modelDisplayNameWithVersion,
  modelFamily,
} from "../../shared/model-utils";
import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";
import type { DateFilter } from "./shared";
import { buildDateConditions } from "./shared";

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

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * ModelAnalyticsService provides model usage breakdowns.
 * Aggregates token/cost metrics by model with date filtering.
 */
export class ModelAnalyticsService extends Effect.Service<ModelAnalyticsService>()(
  "ModelAnalyticsService",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      return {
      getModelBreakdown: (dateFilter: DateFilter = {}) =>
        Effect.tryPromise({
          catch: (error) =>
            new DatabaseError({
              cause: error,
              operation: "getModelBreakdown",
            }),
          try: async () => {
            const dateConditions = buildDateConditions(dateFilter);

            let result;
            if (dateConditions.length === 0) {
              // Original query without date filter - no join needed
              result = await db
                .select({
                  model: schema.queries.model,
                  queryCount: count(),
                  sessionCount:
                    sql<number>`COUNT(DISTINCT ${schema.queries.sessionId})`.as(
                      "session_count"
                    ),
                  totalCost: sql<number>`SUM(${schema.queries.cost})`.as(
                    "total_cost"
                  ),
                  totalTokens: sql<number>`SUM(
                    COALESCE(${schema.queries.inputTokens}, 0) +
                    COALESCE(${schema.queries.outputTokens}, 0) +
                    COALESCE(${schema.queries.cacheRead}, 0) +
                    COALESCE(${schema.queries.cacheWrite}, 0)
                  )`.as("total_tokens"),
                })
                .from(schema.queries)
                .where(
                  sql`${schema.queries.model} IS NOT NULL AND ${schema.queries.model} != '<synthetic>'`
                )
                .groupBy(schema.queries.model)
                .orderBy(desc(sql`SUM(${schema.queries.cost})`));
            } else {
              // Filtered query - join with sessions for date range
              const conditions = [
                sql`${schema.queries.model} IS NOT NULL AND ${schema.queries.model} != '<synthetic>'`,
                ...dateConditions,
              ];

              result = await db
                .select({
                  model: schema.queries.model,
                  queryCount: count(),
                  sessionCount:
                    sql<number>`COUNT(DISTINCT ${schema.queries.sessionId})`.as(
                      "session_count"
                    ),
                  totalCost: sql<number>`SUM(${schema.queries.cost})`.as(
                    "total_cost"
                  ),
                  totalTokens: sql<number>`SUM(
                    COALESCE(${schema.queries.inputTokens}, 0) +
                    COALESCE(${schema.queries.outputTokens}, 0) +
                    COALESCE(${schema.queries.cacheRead}, 0) +
                    COALESCE(${schema.queries.cacheWrite}, 0)
                  )`.as("total_tokens"),
                })
                .from(schema.queries)
                .innerJoin(
                  schema.sessions,
                  eq(schema.queries.sessionId, schema.sessions.sessionId)
                )
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
                  queries: row.queryCount,
                  rawModelIds: [rawModel],
                  sessions: row.sessionCount ?? 0,
                  totalCost: row.totalCost ?? 0,
                  totalTokens: row.totalTokens ?? 0,
                });
              }
            }

            // Convert to array and sort by cost descending
            const breakdowns: ModelBreakdown[] = [];
            for (const [shortName, data] of modelMap) {
              const primaryModelId = data.rawModelIds[0]!;
              breakdowns.push({
                model: primaryModelId,
                modelFamily: modelFamily(primaryModelId),
                modelShort: shortName,
                queries: data.queries,
                rawModelIds: data.rawModelIds,
                sessions: data.sessions,
                totalCost: data.totalCost,
                totalTokens: data.totalTokens,
              });
            }

            return breakdowns.toSorted((a, b) => b.totalCost - a.totalCost);
          },
        }),
      } as const;
    }),
  }
) {}

/** @deprecated Use ModelAnalyticsService.Default instead */
export const ModelAnalyticsServiceLive = ModelAnalyticsService.Default;
