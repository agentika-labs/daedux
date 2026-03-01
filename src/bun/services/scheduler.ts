import { eq, desc } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { DatabaseService } from "../db";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";

// ─── CLI Response Schemas ───────────────────────────────────────────────────

/**
 * Schema for `claude auth status --json` response.
 * Validates and transforms CLI output into a typed AuthStatus.
 */
const ClaudeAuthStatusResponse = Schema.Struct({
  apiProvider: Schema.optional(Schema.String),
  authMethod: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  loggedIn: Schema.Boolean,
  orgId: Schema.optional(Schema.String),
  orgName: Schema.optional(Schema.NullOr(Schema.String)),
  subscriptionType: Schema.optional(Schema.String),
});

// ─── Error Types ─────────────────────────────────────────────────────────────

/** Scheduler operation failed */
export class SchedulerError extends Error {
  readonly _tag = "SchedulerError";
  constructor(
    readonly operation: string,
    readonly cause: unknown
  ) {
    super(`Scheduler operation failed: ${operation}`);
  }
}

/** Auth check failed or not logged in */
export class AuthError extends Error {
  readonly _tag = "AuthError";
}

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
}

export interface ExecutionResult {
  status: "success" | "error" | "skipped";
  error?: string;
  sessionId?: string;
  durationMs?: number;
}

export interface ScheduleInput {
  name: string;
  enabled?: boolean;
  hour: number;
  minute: number;
  daysOfWeek: number[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Hardcoded warm-up command - always use cheapest/fastest option
const WARMUP_COMMAND = [
  "claude",
  "--print",
  "--model",
  "haiku",
  "--no-session-persistence",
  "hi",
];

// Minimum gap between scheduled runs (5 minutes)
const MIN_RUN_GAP_MS = 5 * 60 * 1000;

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Calculate the next run time for a schedule.
 * Finds the next occurrence based on hour, minute, and days of week.
 */
export const calculateNextRunTime = (
  hour: number,
  minute: number,
  daysOfWeek: number[],
  fromTime: number = Date.now()
): number | null => {
  if (daysOfWeek.length === 0) {
    return null;
  }

  const now = new Date(fromTime);
  const sortedDays = new Set([...daysOfWeek].toSorted((a, b) => a - b));

  // Try each day in the next 8 days (covers a full week plus today)
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + dayOffset);
    candidate.setHours(hour, minute, 0, 0);

    const candidateDay = candidate.getDay();

    // Check if this day is in our schedule
    if (sortedDays.has(candidateDay)) {
      // For today, only if the time hasn't passed
      if (dayOffset === 0 && candidate.getTime() <= fromTime) {
        continue;
      }
      return candidate.getTime();
    }
  }

  return null;
};

/**
 * Check if a schedule is due to run.
 */
export const isScheduleDue = (
  nextRunAt: number | null,
  now: number = Date.now()
): boolean => {
  if (nextRunAt === null) {
    return false;
  }
  return nextRunAt <= now;
};

/**
 * Parse days of week from JSON string.
 */
export const parseDaysOfWeek = (daysJson: string): number[] => {
  try {
    const parsed = JSON.parse(daysJson);
    if (
      Array.isArray(parsed) &&
      parsed.every((d) => typeof d === "number" && d >= 0 && d <= 6)
    ) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
};

// ─── Service Definition ──────────────────────────────────────────────────────

/**
 * SchedulerService manages scheduled session warm-ups.
 * Handles CRUD for schedules, execution tracking, and CLI interactions.
 */
export class SchedulerService extends Effect.Service<SchedulerService>()(
  "SchedulerService",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* DatabaseService;

      /**
       * Record an execution in the database.
       */
      const recordExecution = (
        scheduleId: string,
        result: ExecutionResult,
        executedAt: number
      ): Effect.Effect<void, DatabaseError> =>
        Effect.tryPromise({
          catch: (cause) =>
            new DatabaseError({ cause, operation: "recordExecution" }),
          try: async () => {
            await db.insert(schema.scheduleExecutions).values({
              durationMs: result.durationMs ?? null,
              errorMessage: result.error ?? null,
              executedAt,
              scheduleId,
              sessionId: result.sessionId ?? null,
              status: result.status,
            });
          },
        });

      /**
       * Update schedule tracking fields after a run.
       */
      const updateScheduleAfterRun = (
        schedule: schema.SessionSchedule,
        now: number
      ): Effect.Effect<void, DatabaseError> =>
        Effect.tryPromise({
          catch: (cause) =>
            new DatabaseError({ cause, operation: "updateScheduleAfterRun" }),
          try: async () => {
            const daysOfWeek = parseDaysOfWeek(schedule.daysOfWeek);
            const nextRunAt = calculateNextRunTime(
              schedule.hour,
              schedule.minute,
              daysOfWeek,
              now
            );

            await db
              .update(schema.sessionSchedules)
              .set({
                lastRunAt: now,
                nextRunAt,
              })
              .where(eq(schema.sessionSchedules.id, schedule.id));
          },
        });

      /**
       * Execute the warm-up CLI command.
       */
      const executeWarmup = (): Effect.Effect<
        ExecutionResult,
        SchedulerError
      > =>
        Effect.tryPromise({
          catch: (cause) => new SchedulerError("executeWarmup", cause),
          try: async () => {
            const startTime = Date.now();

            const proc = Bun.spawn(WARMUP_COMMAND, {
              stderr: "pipe",
              stdout: "pipe",
            });

            const exitCode = await proc.exited;
            const durationMs = Date.now() - startTime;
            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();

            if (exitCode !== 0) {
              return {
                durationMs,
                error: stderr || `Exit code: ${exitCode}`,
                status: "error" as const,
              };
            }

            // Try to extract session ID from output (if available)
            const sessionIdMatch = stdout.match(
              /session[_-]?id[:\s]+([a-f0-9-]+)/i
            );
            const sessionId = sessionIdMatch?.[1];

            return {
              durationMs,
              sessionId,
              status: "success" as const,
            };
          },
        });

      /**
       * Check Claude CLI auth status using Schema parsing.
       * Returns { loggedIn: false } on any error or parse failure.
       */
      const checkAuth = (): Effect.Effect<{ loggedIn: boolean }, never> =>
        Effect.gen(function* checkAuth() {
          const proc = Bun.spawn(["claude", "auth", "status", "--json"], {
            stderr: "pipe",
            stdout: "pipe",
          });

          const exitCode = yield* Effect.promise(() => proc.exited);

          if (exitCode !== 0) {
            return { loggedIn: false };
          }

          const stdout = yield* Effect.promise(() =>
            new Response(proc.stdout).text()
          );

          // Parse with Schema - returns null on failure
          const parseResult = yield* Schema.decodeUnknown(
            Schema.parseJson(ClaudeAuthStatusResponse)
          )(stdout).pipe(Effect.catchAll(() => Effect.succeed(null)));

          return { loggedIn: parseResult?.loggedIn ?? false };
        }).pipe(Effect.catchAll(() => Effect.succeed({ loggedIn: false })));

      return {
        checkAuthStatus: () =>
          Effect.gen(function* checkAuthStatus() {
            const proc = Bun.spawn(["claude", "auth", "status", "--json"], {
              stderr: "pipe",
              stdout: "pipe",
            });

            const exitCode = yield* Effect.tryPromise({
              catch: (cause) =>
                new SchedulerError("checkAuthStatus:spawn", cause),
              try: () => proc.exited,
            });

            if (exitCode !== 0) {
              return { loggedIn: false };
            }

            const stdout = yield* Effect.tryPromise({
              catch: (cause) =>
                new SchedulerError("checkAuthStatus:readStdout", cause),
              try: () => new Response(proc.stdout).text(),
            });

            // Parse and validate with Schema
            const parseResult = yield* Schema.decodeUnknown(
              Schema.parseJson(ClaudeAuthStatusResponse)
            )(stdout).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (!parseResult) {
              return { loggedIn: false };
            }

            return {
              email: parseResult.email,
              loggedIn: parseResult.loggedIn,
              subscriptionType: parseResult.subscriptionType,
            };
          }),

        checkMissedSchedules: (windowMs: number = 60 * 60 * 1000) =>
          Effect.gen(function* checkMissedSchedules() {
            const now = Date.now();
            const windowStart = now - windowMs;
            const results: ExecutionResult[] = [];

            // Get all enabled schedules
            const schedules = yield* Effect.tryPromise({
              catch: (cause) =>
                new DatabaseError({
                  cause,
                  operation: "checkMissedSchedules:getSchedules",
                }),
              try: async () =>
                db
                  .select()
                  .from(schema.sessionSchedules)
                  .where(eq(schema.sessionSchedules.enabled, true)),
            });

            // Check each schedule for missed runs
            for (const schedule of schedules) {
              // Skip if nextRunAt is in the future or null
              if (!schedule.nextRunAt || schedule.nextRunAt > now) {
                continue;
              }

              // Skip if nextRunAt is too old (outside our window)
              if (schedule.nextRunAt < windowStart) {
                // Just update the nextRunAt to skip past old times
                yield* updateScheduleAfterRun(schedule, now);
                continue;
              }

              // This schedule was missed - run it now
              const result = yield* Effect.gen(function* result() {
                // Check auth
                const authStatus = yield* checkAuth();

                if (!authStatus.loggedIn) {
                  const result: ExecutionResult = {
                    error: "Not logged in to Claude CLI",
                    status: "skipped",
                  };
                  yield* recordExecution(schedule.id, result, now);
                  yield* updateScheduleAfterRun(schedule, now);
                  return result;
                }

                // Execute warm-up
                const execResult = yield* executeWarmup();

                // Record execution and update schedule
                yield* recordExecution(schedule.id, execResult, now);
                yield* updateScheduleAfterRun(schedule, now);

                return execResult;
              });

              results.push(result);
            }

            return results;
          }),

        checkSchedules: () =>
          Effect.gen(function* checkSchedules() {
            const now = Date.now();

            // Get all enabled schedules
            const schedules = yield* Effect.tryPromise({
              catch: (cause) =>
                new DatabaseError({
                  cause,
                  operation: "checkSchedules:getSchedules",
                }),
              try: async () =>
                db
                  .select()
                  .from(schema.sessionSchedules)
                  .where(eq(schema.sessionSchedules.enabled, true)),
            });

            // Check each schedule
            for (const schedule of schedules) {
              if (!isScheduleDue(schedule.nextRunAt, now)) {
                continue;
              }

              // Rate limiting check
              if (
                schedule.lastRunAt &&
                now - schedule.lastRunAt < MIN_RUN_GAP_MS
              ) {
                continue;
              }

              // Execute the schedule
              yield* Effect.gen(function* checkSchedules() {
                // Check auth
                const authStatus = yield* checkAuth();

                if (!authStatus.loggedIn) {
                  const result: ExecutionResult = {
                    error: "Not logged in to Claude CLI",
                    status: "skipped",
                  };
                  yield* recordExecution(schedule.id, result, now);
                  yield* updateScheduleAfterRun(schedule, now);
                  return;
                }

                // Execute warm-up
                const result = yield* executeWarmup();

                // Record execution and update schedule
                yield* recordExecution(schedule.id, result, now);
                yield* updateScheduleAfterRun(schedule, now);
              });
            }
          }),

        createSchedule: (input: ScheduleInput) =>
          Effect.tryPromise({
            catch: (cause) =>
              new DatabaseError({ cause, operation: "createSchedule" }),
            try: async () => {
              const id = crypto.randomUUID();
              const now = Date.now();
              const daysOfWeekJson = JSON.stringify(input.daysOfWeek);
              const nextRunAt = calculateNextRunTime(
                input.hour,
                input.minute,
                input.daysOfWeek,
                now
              );

              const newSchedule: schema.NewSessionSchedule = {
                createdAt: now,
                daysOfWeek: daysOfWeekJson,
                enabled: input.enabled ?? true,
                hour: input.hour,
                id,
                minute: input.minute,
                name: input.name,
                nextRunAt,
              };

              await db.insert(schema.sessionSchedules).values(newSchedule);

              // Return the created schedule
              const results = await db
                .select()
                .from(schema.sessionSchedules)
                .where(eq(schema.sessionSchedules.id, id))
                .limit(1);

              return results[0]!;
            },
          }),

        deleteSchedule: (id: string) =>
          Effect.tryPromise({
            catch: (cause) =>
              new DatabaseError({ cause, operation: "deleteSchedule" }),
            try: async () => {
              // Check if schedule exists first
              const existing = await db
                .select()
                .from(schema.sessionSchedules)
                .where(eq(schema.sessionSchedules.id, id))
                .limit(1);

              if (!existing[0]) {
                return false;
              }

              await db
                .delete(schema.sessionSchedules)
                .where(eq(schema.sessionSchedules.id, id));
              return true;
            },
          }),

        getSchedule: (id: string) =>
          Effect.tryPromise({
            catch: (cause) =>
              new DatabaseError({ cause, operation: "getSchedule" }),
            try: async () => {
              const results = await db
                .select()
                .from(schema.sessionSchedules)
                .where(eq(schema.sessionSchedules.id, id))
                .limit(1);
              return results[0] ?? null;
            },
          }),

        getScheduleHistory: (scheduleId: string, limit: number = 20) =>
          Effect.tryPromise({
            catch: (cause) =>
              new DatabaseError({ cause, operation: "getScheduleHistory" }),
            try: async () =>
              await db
                .select()
                .from(schema.scheduleExecutions)
                .where(eq(schema.scheduleExecutions.scheduleId, scheduleId))
                .orderBy(desc(schema.scheduleExecutions.executedAt))
                .limit(limit),
          }),

        getSchedules: () =>
          Effect.tryPromise({
            catch: (cause) =>
              new DatabaseError({ cause, operation: "getSchedules" }),
            try: async () =>
              await db
                .select()
                .from(schema.sessionSchedules)
                .orderBy(desc(schema.sessionSchedules.createdAt)),
          }),

        runScheduleNow: (scheduleId: string) =>
          Effect.gen(function* runScheduleNow() {
            const now = Date.now();

            // Get the schedule
            const schedules = yield* Effect.tryPromise({
              catch: (cause) =>
                new DatabaseError({
                  cause,
                  operation: "runScheduleNow:getSchedule",
                }),
              try: async () =>
                db
                  .select()
                  .from(schema.sessionSchedules)
                  .where(eq(schema.sessionSchedules.id, scheduleId))
                  .limit(1),
            });

            const schedule = schedules[0];
            if (!schedule) {
              const result: ExecutionResult = {
                error: "Schedule not found",
                status: "error",
              };
              return result;
            }

            // Check rate limiting (minimum gap between runs)
            if (
              schedule.lastRunAt &&
              now - schedule.lastRunAt < MIN_RUN_GAP_MS
            ) {
              const result: ExecutionResult = {
                error: "Rate limited - minimum 5 minute gap between runs",
                status: "skipped",
              };
              yield* recordExecution(scheduleId, result, now);
              return result;
            }

            // Check auth status
            const authStatus = yield* checkAuth();

            if (!authStatus.loggedIn) {
              const result: ExecutionResult = {
                error: "Not logged in to Claude CLI",
                status: "skipped",
              };
              yield* recordExecution(scheduleId, result, now);
              yield* updateScheduleAfterRun(schedule, now);
              return result;
            }

            // Execute warm-up
            const result = yield* executeWarmup();

            // Record execution and update schedule
            yield* recordExecution(scheduleId, result, now);
            yield* updateScheduleAfterRun(schedule, now);

            return result;
          }),

        updateSchedule: (id: string, patch: Partial<ScheduleInput>) =>
          Effect.tryPromise({
            catch: (cause) =>
              new DatabaseError({ cause, operation: "updateSchedule" }),
            try: async () => {
              // Get current schedule to compute new nextRunAt if time changed
              const current = await db
                .select()
                .from(schema.sessionSchedules)
                .where(eq(schema.sessionSchedules.id, id))
                .limit(1);

              if (!current[0]) {
                return false;
              }

              const schedule = current[0];
              const now = Date.now();

              // Compute updated fields
              const hour = patch.hour ?? schedule.hour;
              const minute = patch.minute ?? schedule.minute;
              const daysOfWeek =
                patch.daysOfWeek ?? parseDaysOfWeek(schedule.daysOfWeek);

              const updates: Partial<schema.NewSessionSchedule> = {};

              if (patch.name !== undefined) {
                updates.name = patch.name;
              }
              if (patch.enabled !== undefined) {
                updates.enabled = patch.enabled;
              }
              if (patch.hour !== undefined) {
                updates.hour = patch.hour;
              }
              if (patch.minute !== undefined) {
                updates.minute = patch.minute;
              }
              if (patch.daysOfWeek !== undefined) {
                updates.daysOfWeek = JSON.stringify(patch.daysOfWeek);
              }

              // Recalculate nextRunAt if time settings changed
              if (
                patch.hour !== undefined ||
                patch.minute !== undefined ||
                patch.daysOfWeek !== undefined
              ) {
                updates.nextRunAt = calculateNextRunTime(
                  hour,
                  minute,
                  daysOfWeek,
                  now
                );
              }

              if (Object.keys(updates).length === 0) {
                return true;
              }

              await db
                .update(schema.sessionSchedules)
                .set(updates)
                .where(eq(schema.sessionSchedules.id, id));

              return true;
            },
          }),
      } as const;
    }),
  }
) {}

