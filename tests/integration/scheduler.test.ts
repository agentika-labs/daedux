/**
 * SchedulerService Integration Tests
 *
 * Tests service methods that interact with the database.
 * Uses the test harness for isolated in-memory database.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import { Effect } from "effect";

import type { DatabaseService } from "../../src/bun/db";
import * as schema from "../../src/bun/db/schema";
import { SchedulerService } from "../../src/bun/services/scheduler";
import { createRpcTestHarness } from "../helpers/rpc-test-harness";
import type { TestAppContext } from "../helpers/rpc-test-harness";

// ─── Test Setup ──────────────────────────────────────────────────────────────

type Harness = ReturnType<typeof createRpcTestHarness>;
let harness: Harness;

beforeEach(() => {
  harness = createRpcTestHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

// ─── Helper Functions ────────────────────────────────────────────────────────

const runEffect = <A, E>(
  effect: Effect.Effect<A, E, TestAppContext | DatabaseService>
): Promise<A> => harness.runEffect(effect);

// ─── getSchedules Tests ──────────────────────────────────────────────────────

describe("SchedulerService.getSchedules", () => {
  test("returns empty array when no schedules exist", async () => {
    const schedules = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedules();
      })
    );

    expect(schedules).toEqual([]);
  });

  test("returns all schedules ordered by creation date descending", async () => {
    // Insert schedules directly
    const now = Date.now();
    await harness.db.insert(schema.sessionSchedules).values([
      {
        id: "sched-1",
        name: "Morning warmup",
        enabled: true,
        hour: 9,
        minute: 0,
        daysOfWeek: "[1,2,3,4,5]",
        createdAt: now - 2000,
        nextRunAt: now + 3_600_000,
      },
      {
        id: "sched-2",
        name: "Evening warmup",
        enabled: true,
        hour: 18,
        minute: 30,
        daysOfWeek: "[1,2,3,4,5]",
        createdAt: now - 1000, // More recent
        nextRunAt: now + 7_200_000,
      },
    ]);

    const schedules = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedules();
      })
    );

    expect(schedules).toHaveLength(2);
    // Most recent first
    expect(schedules[0]!.name).toBe("Evening warmup");
    expect(schedules[1]!.name).toBe("Morning warmup");
  });
});

// ─── getSchedule Tests ───────────────────────────────────────────────────────

describe("SchedulerService.getSchedule", () => {
  test("returns null for non-existent schedule", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule("non-existent-id");
      })
    );

    expect(schedule).toBeNull();
  });

  test("returns schedule by ID", async () => {
    const now = Date.now();
    await harness.db.insert(schema.sessionSchedules).values({
      id: "test-schedule",
      name: "Test Schedule",
      enabled: true,
      hour: 10,
      minute: 30,
      daysOfWeek: "[1,3,5]",
      createdAt: now,
      nextRunAt: now + 3_600_000,
    });

    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule("test-schedule");
      })
    );

    expect(schedule).not.toBeNull();
    expect(schedule!.name).toBe("Test Schedule");
    expect(schedule!.hour).toBe(10);
    expect(schedule!.minute).toBe(30);
    expect(schedule!.daysOfWeek).toBe("[1,3,5]");
  });
});

// ─── createSchedule Tests ────────────────────────────────────────────────────

describe("SchedulerService.createSchedule", () => {
  test("creates schedule with correct fields", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Daily warmup",
          hour: 8,
          minute: 0,
          daysOfWeek: [1, 2, 3, 4, 5],
        });
      })
    );

    expect(schedule.name).toBe("Daily warmup");
    expect(schedule.hour).toBe(8);
    expect(schedule.minute).toBe(0);
    expect(schedule.daysOfWeek).toBe("[1,2,3,4,5]");
    expect(schedule.enabled).toBe(true); // Default
    expect(schedule.id).toBeDefined();
    expect(schedule.createdAt).toBeDefined();
  });

  test("computes nextRunAt based on schedule", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Future schedule",
          hour: 23,
          minute: 59,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // Every day
        });
      })
    );

    // nextRunAt should be set to a future time
    expect(schedule.nextRunAt).not.toBeNull();
    expect(schedule.nextRunAt!).toBeGreaterThan(Date.now());
  });

  test("allows creating disabled schedule", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Disabled schedule",
          enabled: false,
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
      })
    );

    expect(schedule.enabled).toBe(false);
  });

  test("sets nextRunAt to null when daysOfWeek is empty", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "No days schedule",
          hour: 9,
          minute: 0,
          daysOfWeek: [],
        });
      })
    );

    expect(schedule.nextRunAt).toBeNull();
  });
});

// ─── updateSchedule Tests ────────────────────────────────────────────────────

describe("SchedulerService.updateSchedule", () => {
  test("returns false for non-existent schedule", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.updateSchedule("non-existent", { name: "New name" });
      })
    );

    expect(result).toBe(false);
  });

  test("updates name only", async () => {
    // Create schedule first
    const created = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Original name",
          hour: 9,
          minute: 0,
          daysOfWeek: [1, 2, 3],
        });
      })
    );

    // Update name
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.updateSchedule(created.id, { name: "Updated name" });
      })
    );

    expect(result).toBe(true);

    // Verify update
    const updated = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule(created.id);
      })
    );

    expect(updated!.name).toBe("Updated name");
    expect(updated!.hour).toBe(9); // Unchanged
    expect(updated!.minute).toBe(0); // Unchanged
  });

  test("recalculates nextRunAt when time changes", async () => {
    const created = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Schedule",
          hour: 9,
          minute: 0,
          daysOfWeek: [1, 2, 3, 4, 5],
        });
      })
    );

    const originalNextRunAt = created.nextRunAt;

    // Update hour
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.updateSchedule(created.id, { hour: 17 });
      })
    );

    const updated = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule(created.id);
      })
    );

    // nextRunAt should be different
    expect(updated!.hour).toBe(17);
    expect(updated!.nextRunAt).not.toBe(originalNextRunAt);
  });

  test("recalculates nextRunAt when daysOfWeek changes", async () => {
    const created = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Schedule",
          hour: 9,
          minute: 0,
          daysOfWeek: [1], // Monday only
        });
      })
    );

    // Change to weekends
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.updateSchedule(created.id, { daysOfWeek: [0, 6] });
      })
    );

    const updated = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule(created.id);
      })
    );

    expect(updated!.daysOfWeek).toBe("[0,6]");
    expect(updated!.nextRunAt).not.toBeNull();
  });

  test("updates enabled status", async () => {
    const created = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Schedule",
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
      })
    );

    expect(created.enabled).toBe(true);

    await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.updateSchedule(created.id, { enabled: false });
      })
    );

    const updated = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule(created.id);
      })
    );

    expect(updated!.enabled).toBe(false);
  });

  test("returns true when no changes needed", async () => {
    const created = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Schedule",
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
      })
    );

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.updateSchedule(created.id, {});
      })
    );

    expect(result).toBe(true);
  });
});

// ─── deleteSchedule Tests ────────────────────────────────────────────────────

describe("SchedulerService.deleteSchedule", () => {
  test("returns false for non-existent schedule", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.deleteSchedule("non-existent");
      })
    );

    expect(result).toBe(false);
  });

  test("deletes existing schedule and returns true", async () => {
    const created = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "To be deleted",
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
      })
    );

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.deleteSchedule(created.id);
      })
    );

    expect(result).toBe(true);

    // Verify deletion
    const deleted = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule(created.id);
      })
    );

    expect(deleted).toBeNull();
  });

  test("does not affect other schedules", async () => {
    const [sched1, sched2] = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        const s1 = yield* svc.createSchedule({
          name: "Keep me",
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
        const s2 = yield* svc.createSchedule({
          name: "Delete me",
          hour: 10,
          minute: 0,
          daysOfWeek: [2],
        });
        return [s1, s2];
      })
    );

    await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.deleteSchedule(sched2.id);
      })
    );

    // First schedule should still exist
    const remaining = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getSchedule(sched1.id);
      })
    );

    expect(remaining).not.toBeNull();
    expect(remaining!.name).toBe("Keep me");
  });
});

// ─── getScheduleHistory Tests ────────────────────────────────────────────────

describe("SchedulerService.getScheduleHistory", () => {
  test("returns empty array for schedule with no executions", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "No history",
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
      })
    );

    const history = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getScheduleHistory(schedule.id);
      })
    );

    expect(history).toEqual([]);
  });

  test("returns executions ordered by date descending", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "With history",
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
      })
    );

    // Insert execution history directly
    const now = Date.now();
    await harness.db.insert(schema.scheduleExecutions).values([
      {
        id: 1,
        scheduleId: schedule.id,
        executedAt: now - 3_600_000, // 1 hour ago
        status: "success",
        durationMs: 1200,
      },
      {
        id: 2,
        scheduleId: schedule.id,
        executedAt: now - 1_800_000, // 30 min ago (more recent)
        status: "error",
        errorMessage: "Connection failed",
        durationMs: 500,
      },
      {
        id: 3,
        scheduleId: schedule.id,
        executedAt: now - 7_200_000, // 2 hours ago (oldest)
        status: "skipped",
      },
    ]);

    const history = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getScheduleHistory(schedule.id);
      })
    );

    expect(history).toHaveLength(3);
    // Most recent first
    expect(history[0]!.status).toBe("error");
    expect(history[1]!.status).toBe("success");
    expect(history[2]!.status).toBe("skipped");
  });

  test("respects limit parameter", async () => {
    const schedule = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.createSchedule({
          name: "Many executions",
          hour: 9,
          minute: 0,
          daysOfWeek: [1],
        });
      })
    );

    // Insert 5 executions
    const now = Date.now();
    const executions = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      scheduleId: schedule.id,
      executedAt: now - i * 1000,
      status: "success" as const,
      durationMs: 1000,
    }));
    await harness.db.insert(schema.scheduleExecutions).values(executions);

    const history = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getScheduleHistory(schedule.id, 2);
      })
    );

    expect(history).toHaveLength(2);
  });

  test("returns empty for non-existent schedule", async () => {
    const history = await runEffect(
      Effect.gen(function* () {
        const svc = yield* SchedulerService;
        return yield* svc.getScheduleHistory("non-existent");
      })
    );

    expect(history).toEqual([]);
  });
});
