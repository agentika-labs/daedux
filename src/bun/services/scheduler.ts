import { Context, Effect, Layer, Schema } from "effect";
import { eq, desc } from "drizzle-orm";
import { DatabaseService } from "../db";
import { DatabaseError } from "../errors";
import * as schema from "../db/schema";

// ─── CLI Response Schemas ───────────────────────────────────────────────────

/**
 * Schema for `claude auth status --json` response.
 * Validates and transforms CLI output into a typed AuthStatus.
 */
const ClaudeAuthStatusResponse = Schema.Struct({
  loggedIn: Schema.Boolean,
  authMethod: Schema.optional(Schema.String),
  apiProvider: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
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
  constructor(readonly message: string) {
    super(message);
  }
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
const WARMUP_COMMAND = ["claude", "--print", "--model", "haiku", "--no-session-persistence", "hi"];

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
  if (daysOfWeek.length === 0) return null;

  const now = new Date(fromTime);
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);

  // Try each day in the next 8 days (covers a full week plus today)
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + dayOffset);
    candidate.setHours(hour, minute, 0, 0);

    const candidateDay = candidate.getDay();

    // Check if this day is in our schedule
    if (sortedDays.includes(candidateDay)) {
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
export const isScheduleDue = (nextRunAt: number | null, now: number = Date.now()): boolean => {
  if (nextRunAt === null) return false;
  return nextRunAt <= now;
};

/**
 * Parse days of week from JSON string.
 */
export const parseDaysOfWeek = (daysJson: string): number[] => {
  try {
    const parsed = JSON.parse(daysJson);
    if (Array.isArray(parsed) && parsed.every((d) => typeof d === "number" && d >= 0 && d <= 6)) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
};

// ─── Service Interface ───────────────────────────────────────────────────────

export class SchedulerService extends Context.Tag("SchedulerService")<
  SchedulerService,
  {
    /** Get all schedules */
    readonly getSchedules: () => Effect.Effect<schema.SessionSchedule[], DatabaseError>;

    /** Get a single schedule by ID */
    readonly getSchedule: (id: string) => Effect.Effect<schema.SessionSchedule | null, DatabaseError>;

    /** Create a new schedule */
    readonly createSchedule: (
      input: ScheduleInput
    ) => Effect.Effect<schema.SessionSchedule, DatabaseError>;

    /** Update an existing schedule */
    readonly updateSchedule: (
      id: string,
      patch: Partial<ScheduleInput>
    ) => Effect.Effect<boolean, DatabaseError>;

    /** Delete a schedule */
    readonly deleteSchedule: (id: string) => Effect.Effect<boolean, DatabaseError>;

    /** Get execution history for a schedule */
    readonly getScheduleHistory: (
      scheduleId: string,
      limit?: number
    ) => Effect.Effect<schema.ScheduleExecution[], DatabaseError>;

    /** Check Claude CLI auth status */
    readonly checkAuthStatus: () => Effect.Effect<AuthStatus, SchedulerError>;

    /** Run a schedule immediately (manual trigger) */
    readonly runScheduleNow: (scheduleId: string) => Effect.Effect<ExecutionResult, DatabaseError | SchedulerError>;

    /** Check all schedules and run any that are due */
    readonly checkSchedules: () => Effect.Effect<void, DatabaseError | SchedulerError>;

    /** Check for missed schedules (e.g., after system wake) */
    readonly checkMissedSchedules: (
      windowMs?: number
    ) => Effect.Effect<ExecutionResult[], DatabaseError | SchedulerError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const SchedulerServiceLive = Layer.effect(
  SchedulerService,
  Effect.gen(function* () {
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
        try: async () => {
          await db.insert(schema.scheduleExecutions).values({
            scheduleId,
            executedAt,
            status: result.status,
            errorMessage: result.error ?? null,
            sessionId: result.sessionId ?? null,
            durationMs: result.durationMs ?? null,
          });
        },
        catch: (cause) => new DatabaseError({ operation: "recordExecution", cause }),
      });

    /**
     * Update schedule tracking fields after a run.
     */
    const updateScheduleAfterRun = (
      schedule: schema.SessionSchedule,
      now: number
    ): Effect.Effect<void, DatabaseError> =>
      Effect.tryPromise({
        try: async () => {
          const daysOfWeek = parseDaysOfWeek(schedule.daysOfWeek);
          const nextRunAt = calculateNextRunTime(schedule.hour, schedule.minute, daysOfWeek, now);

          await db
            .update(schema.sessionSchedules)
            .set({
              lastRunAt: now,
              nextRunAt,
            })
            .where(eq(schema.sessionSchedules.id, schedule.id));
        },
        catch: (cause) => new DatabaseError({ operation: "updateScheduleAfterRun", cause }),
      });

    /**
     * Execute the warm-up CLI command.
     */
    const executeWarmup = (): Effect.Effect<ExecutionResult, SchedulerError> =>
      Effect.tryPromise({
        try: async () => {
          const startTime = Date.now();

          const proc = Bun.spawn(WARMUP_COMMAND, {
            stdout: "pipe",
            stderr: "pipe",
          });

          const exitCode = await proc.exited;
          const durationMs = Date.now() - startTime;
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();

          if (exitCode !== 0) {
            return {
              status: "error" as const,
              error: stderr || `Exit code: ${exitCode}`,
              durationMs,
            };
          }

          // Try to extract session ID from output (if available)
          const sessionIdMatch = stdout.match(/session[_-]?id[:\s]+([a-f0-9-]+)/i);
          const sessionId = sessionIdMatch?.[1];

          return {
            status: "success" as const,
            sessionId,
            durationMs,
          };
        },
        catch: (cause) => new SchedulerError("executeWarmup", cause),
      });

    /**
     * Check Claude CLI auth status using Schema parsing.
     * Returns { loggedIn: false } on any error or parse failure.
     */
    const checkAuth = (): Effect.Effect<{ loggedIn: boolean }, never> =>
      Effect.gen(function* () {
        const proc = Bun.spawn(["claude", "auth", "status", "--json"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const exitCode = yield* Effect.promise(() => proc.exited);

        if (exitCode !== 0) {
          return { loggedIn: false };
        }

        const stdout = yield* Effect.promise(() => new Response(proc.stdout).text());

        // Parse with Schema - returns null on failure
        const parseResult = yield* Schema.decodeUnknown(Schema.parseJson(ClaudeAuthStatusResponse))(stdout).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        );

        return { loggedIn: parseResult?.loggedIn ?? false };
      }).pipe(Effect.catchAll(() => Effect.succeed({ loggedIn: false })));

    return {
      getSchedules: () =>
        Effect.tryPromise({
          try: async () => {
            return await db
              .select()
              .from(schema.sessionSchedules)
              .orderBy(desc(schema.sessionSchedules.createdAt));
          },
          catch: (cause) => new DatabaseError({ operation: "getSchedules", cause }),
        }),

      getSchedule: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(schema.sessionSchedules)
              .where(eq(schema.sessionSchedules.id, id))
              .limit(1);
            return results[0] ?? null;
          },
          catch: (cause) => new DatabaseError({ operation: "getSchedule", cause }),
        }),

      createSchedule: (input: ScheduleInput) =>
        Effect.tryPromise({
          try: async () => {
            const id = crypto.randomUUID();
            const now = Date.now();
            const daysOfWeekJson = JSON.stringify(input.daysOfWeek);
            const nextRunAt = calculateNextRunTime(input.hour, input.minute, input.daysOfWeek, now);

            const newSchedule: schema.NewSessionSchedule = {
              id,
              name: input.name,
              enabled: input.enabled ?? true,
              hour: input.hour,
              minute: input.minute,
              daysOfWeek: daysOfWeekJson,
              nextRunAt,
              createdAt: now,
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
          catch: (cause) => new DatabaseError({ operation: "createSchedule", cause }),
        }),

      updateSchedule: (id: string, patch: Partial<ScheduleInput>) =>
        Effect.tryPromise({
          try: async () => {
            // Get current schedule to compute new nextRunAt if time changed
            const current = await db
              .select()
              .from(schema.sessionSchedules)
              .where(eq(schema.sessionSchedules.id, id))
              .limit(1);

            if (!current[0]) return false;

            const schedule = current[0];
            const now = Date.now();

            // Compute updated fields
            const hour = patch.hour ?? schedule.hour;
            const minute = patch.minute ?? schedule.minute;
            const daysOfWeek = patch.daysOfWeek ?? parseDaysOfWeek(schedule.daysOfWeek);

            const updates: Partial<schema.NewSessionSchedule> = {};

            if (patch.name !== undefined) updates.name = patch.name;
            if (patch.enabled !== undefined) updates.enabled = patch.enabled;
            if (patch.hour !== undefined) updates.hour = patch.hour;
            if (patch.minute !== undefined) updates.minute = patch.minute;
            if (patch.daysOfWeek !== undefined) {
              updates.daysOfWeek = JSON.stringify(patch.daysOfWeek);
            }

            // Recalculate nextRunAt if time settings changed
            if (patch.hour !== undefined || patch.minute !== undefined || patch.daysOfWeek !== undefined) {
              updates.nextRunAt = calculateNextRunTime(hour, minute, daysOfWeek, now);
            }

            if (Object.keys(updates).length === 0) return true;

            await db.update(schema.sessionSchedules).set(updates).where(eq(schema.sessionSchedules.id, id));

            return true;
          },
          catch: (cause) => new DatabaseError({ operation: "updateSchedule", cause }),
        }),

      deleteSchedule: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            // Check if schedule exists first
            const existing = await db
              .select()
              .from(schema.sessionSchedules)
              .where(eq(schema.sessionSchedules.id, id))
              .limit(1);

            if (!existing[0]) return false;

            await db.delete(schema.sessionSchedules).where(eq(schema.sessionSchedules.id, id));
            return true;
          },
          catch: (cause) => new DatabaseError({ operation: "deleteSchedule", cause }),
        }),

      getScheduleHistory: (scheduleId: string, limit: number = 20) =>
        Effect.tryPromise({
          try: async () => {
            return await db
              .select()
              .from(schema.scheduleExecutions)
              .where(eq(schema.scheduleExecutions.scheduleId, scheduleId))
              .orderBy(desc(schema.scheduleExecutions.executedAt))
              .limit(limit);
          },
          catch: (cause) => new DatabaseError({ operation: "getScheduleHistory", cause }),
        }),

      checkAuthStatus: () =>
        Effect.gen(function* () {
          const proc = Bun.spawn(["claude", "auth", "status", "--json"], {
            stdout: "pipe",
            stderr: "pipe",
          });

          const exitCode = yield* Effect.tryPromise({
            try: () => proc.exited,
            catch: (cause) => new SchedulerError("checkAuthStatus:spawn", cause),
          });

          if (exitCode !== 0) {
            return { loggedIn: false };
          }

          const stdout = yield* Effect.tryPromise({
            try: () => new Response(proc.stdout).text(),
            catch: (cause) => new SchedulerError("checkAuthStatus:readStdout", cause),
          });

          // Parse and validate with Schema
          const parseResult = yield* Schema.decodeUnknown(Schema.parseJson(ClaudeAuthStatusResponse))(stdout).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          );

          if (!parseResult) {
            return { loggedIn: false };
          }

          return {
            loggedIn: parseResult.loggedIn,
            email: parseResult.email,
            subscriptionType: parseResult.subscriptionType,
          };
        }),

      runScheduleNow: (scheduleId: string) =>
        Effect.gen(function* () {
          const now = Date.now();

          // Get the schedule
          const schedules = yield* Effect.tryPromise({
            try: async () =>
              db
                .select()
                .from(schema.sessionSchedules)
                .where(eq(schema.sessionSchedules.id, scheduleId))
                .limit(1),
            catch: (cause) => new DatabaseError({ operation: "runScheduleNow:getSchedule", cause }),
          });

          const schedule = schedules[0];
          if (!schedule) {
            const result: ExecutionResult = {
              status: "error",
              error: "Schedule not found",
            };
            return result;
          }

          // Check rate limiting (minimum gap between runs)
          if (schedule.lastRunAt && now - schedule.lastRunAt < MIN_RUN_GAP_MS) {
            const result: ExecutionResult = {
              status: "skipped",
              error: "Rate limited - minimum 5 minute gap between runs",
            };
            yield* recordExecution(scheduleId, result, now);
            return result;
          }

          // Check auth status
          const authStatus = yield* checkAuth();

          if (!authStatus.loggedIn) {
            const result: ExecutionResult = {
              status: "skipped",
              error: "Not logged in to Claude CLI",
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

      checkSchedules: () =>
        Effect.gen(function* () {
          const now = Date.now();

          // Get all enabled schedules
          const schedules = yield* Effect.tryPromise({
            try: async () =>
              db.select().from(schema.sessionSchedules).where(eq(schema.sessionSchedules.enabled, true)),
            catch: (cause) => new DatabaseError({ operation: "checkSchedules:getSchedules", cause }),
          });

          // Check each schedule
          for (const schedule of schedules) {
            if (!isScheduleDue(schedule.nextRunAt, now)) continue;

            // Rate limiting check
            if (schedule.lastRunAt && now - schedule.lastRunAt < MIN_RUN_GAP_MS) continue;

            // Execute the schedule
            yield* Effect.gen(function* () {
              // Check auth
              const authStatus = yield* checkAuth();

              if (!authStatus.loggedIn) {
                const result: ExecutionResult = {
                  status: "skipped",
                  error: "Not logged in to Claude CLI",
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

      checkMissedSchedules: (windowMs: number = 60 * 60 * 1000) =>
        Effect.gen(function* () {
          const now = Date.now();
          const windowStart = now - windowMs;
          const results: ExecutionResult[] = [];

          // Get all enabled schedules
          const schedules = yield* Effect.tryPromise({
            try: async () =>
              db.select().from(schema.sessionSchedules).where(eq(schema.sessionSchedules.enabled, true)),
            catch: (cause) => new DatabaseError({ operation: "checkMissedSchedules:getSchedules", cause }),
          });

          // Check each schedule for missed runs
          for (const schedule of schedules) {
            // Skip if nextRunAt is in the future or null
            if (!schedule.nextRunAt || schedule.nextRunAt > now) continue;

            // Skip if nextRunAt is too old (outside our window)
            if (schedule.nextRunAt < windowStart) {
              // Just update the nextRunAt to skip past old times
              yield* updateScheduleAfterRun(schedule, now);
              continue;
            }

            // This schedule was missed - run it now
            const result = yield* Effect.gen(function* () {
              // Check auth
              const authStatus = yield* checkAuth();

              if (!authStatus.loggedIn) {
                const result: ExecutionResult = {
                  status: "skipped",
                  error: "Not logged in to Claude CLI",
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
    };
  })
);
