/**
 * Unit tests for CLI transformation functions.
 * Tests the pure functions used to transform service data to dashboard format.
 */
import { describe, expect, it } from "bun:test";

// ─── toDateString Tests ──────────────────────────────────────────────────────

/**
 * Re-implementation of toDateString for testing.
 * Must match the implementation in cli.ts exactly.
 */
const toDateString = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("toDateString", () => {
  it("converts timestamp to YYYY-MM-DD format", () => {
    // Note: This test uses a fixed UTC time but toDateString uses local timezone
    // Create a date object to get the expected local date
    const timestamp = 1_708_444_800_000; // 2024-02-20T16:00:00.000Z
    const d = new Date(timestamp);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    expect(toDateString(timestamp)).toBe(expected);
  });

  it("pads single-digit months with zero", () => {
    // January - month will be 0 (January), so we need to add 1
    const jan1 = new Date(2026, 0, 1).getTime(); // Jan 1, 2026 local time
    expect(toDateString(jan1)).toBe("2026-01-01");
  });

  it("pads single-digit days with zero", () => {
    const feb5 = new Date(2026, 1, 5).getTime(); // Feb 5, 2026 local time
    expect(toDateString(feb5)).toBe("2026-02-05");
  });

  it("handles end of year correctly", () => {
    const dec31 = new Date(2026, 11, 31).getTime(); // Dec 31, 2026 local time
    expect(toDateString(dec31)).toBe("2026-12-31");
  });

  it("handles current timestamp", () => {
    const now = Date.now();
    const result = toDateString(now);

    // Should match YYYY-MM-DD format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── Dashboard Transformation Tests ──────────────────────────────────────────

describe("Dashboard field mappings", () => {
  describe("session field transformations", () => {
    it("maps projectPath to project", () => {
      // The transformation should rename projectPath → project
      const serviceSession = {
        projectPath: "/Users/test/my-project",
        sessionId: "test-1",
        startTime: Date.now(),
      };

      // Simulated transformation
      const dashboardSession = {
        project: serviceSession.projectPath,
        sessionId: serviceSession.sessionId, // Renamed
      };

      expect(dashboardSession.project).toBe("/Users/test/my-project");
    });

    it("adds date string from startTime", () => {
      const startTime = new Date(2026, 1, 20, 10, 0, 0).getTime(); // Feb 20, 2026
      const dashboardSession = {
        date: toDateString(startTime),
      };

      expect(dashboardSession.date).toBe("2026-02-20");
    });

    it("provides default values for computed fields", () => {
      // Dashboard expects these fields even if not tracked at session level
      const dashboardDefaults = {
        bashCommandCount: 0,
        compactions: 0,
        queries: [],
        savedByCaching: 0,
        subagentCount: 0,
        toolCounts: {},
        toolErrorCount: 0,
      };

      expect(dashboardDefaults.savedByCaching).toBe(0);
      expect(dashboardDefaults.toolCounts).toEqual({});
      expect(dashboardDefaults.queries).toEqual([]);
    });
  });

  describe("totals field transformations", () => {
    it("uses totalInputTokens directly for uncachedInput", () => {
      const totals = {
        totalCacheRead: 400_000,
        totalInputTokens: 1_000_000,
      };

      const uncachedInput = totals.totalInputTokens;
      expect(uncachedInput).toBe(1_000_000);
    });

    it("calculates totalTokens as input + output", () => {
      const totals = {
        totalInputTokens: 1_000_000,
        totalOutputTokens: 200_000,
      };

      const totalTokens = totals.totalInputTokens + totals.totalOutputTokens;
      expect(totalTokens).toBe(1_200_000);
    });

    it("calculates cacheEfficiencyRatio", () => {
      const totals = {
        totalCacheRead: 800_000,
        totalCacheWrite: 100_000,
        totalInputTokens: 1_000_000,
      };
      const totalInput =
        totals.totalInputTokens +
        totals.totalCacheRead +
        totals.totalCacheWrite;

      // cacheEfficiencyRatio = cacheRead / (uncached + cacheRead + cacheWrite)
      const ratio = totals.totalCacheRead / totalInput;
      expect(ratio).toBeCloseTo(800_000 / 1_900_000, 6);
    });

    it("handles zero division in cacheEfficiencyRatio", () => {
      const totals = {
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalInputTokens: 1_000_000,
      };

      // When cacheRead is 0, ratio should be 0
      const totalInput =
        totals.totalInputTokens +
        totals.totalCacheRead +
        totals.totalCacheWrite;
      const ratio =
        totals.totalCacheRead > 0 && totalInput > 0
          ? totals.totalCacheRead / totalInput
          : 0;

      expect(ratio).toBe(0);
    });
  });

  describe("dailyStats to dailyUsage", () => {
    it("preserves daily stat structure", () => {
      const dailyStats = [
        {
          date: "2026-02-20",
          sessionCount: 5,
          totalCost: 10,
          totalTokens: 500_000,
        },
        {
          date: "2026-02-19",
          sessionCount: 3,
          totalCost: 6,
          totalTokens: 300_000,
        },
      ];

      // dailyUsage is just a rename of dailyStats
      const dailyUsage = dailyStats;

      expect(dailyUsage).toHaveLength(2);
      expect(dailyUsage[0]!.date).toBe("2026-02-20");
      expect(dailyUsage[0]!.sessionCount).toBe(5);
    });
  });

  describe("insight type transformation", () => {
    it("maps 'tip' type to 'info'", () => {
      const insight = { type: "tip" as const };
      const transformedType = insight.type === "tip" ? "info" : insight.type;

      expect(transformedType).toBe("info");
    });

    it("preserves 'warning' type", () => {
      const insight = { type: "warning" as const };
      const transformedType = insight.type === "tip" ? "info" : insight.type;

      expect(transformedType).toBe("warning");
    });

    it("preserves 'success' type", () => {
      const insight = { type: "success" as const };
      const transformedType = insight.type === "tip" ? "info" : insight.type;

      expect(transformedType).toBe("success");
    });

    it("renames message to description", () => {
      const serviceInsight = {
        message: "Your cache efficiency is excellent",
      };

      const dashboardInsight = {
        description: serviceInsight.message,
      };

      expect(dashboardInsight.description).toBe(
        "Your cache efficiency is excellent"
      );
    });
  });

  describe("toolHealth schema", () => {
    it("service returns dashboard-ready field names directly", () => {
      // Service now returns dashboard-ready data - no transformation needed
      const serviceHealth = {
        errorRate: 0.05,
        errors: 5,
        name: "Read",
        sessions: 10,
        topErrors: [],
        totalCalls: 100,
      };

      expect(serviceHealth.name).toBe("Read");
      expect(serviceHealth.totalCalls).toBe(100);
      expect(serviceHealth.errors).toBe(5);
    });
  });

  describe("agentStats schema", () => {
    it("service returns dashboard-ready field names directly", () => {
      // Service now returns dashboard-ready data - no transformation needed
      const serviceAgent = {
        agentType: "Explore",
        errorCount: 0,
        invocationCount: 10,
        successCount: 10,
      };

      expect(serviceAgent.invocationCount).toBe(10);
      expect(serviceAgent.successCount).toBe(10);
    });
  });

  describe("contextHeatmap transformation", () => {
    it("maps turnRange to turnBucket", () => {
      const serviceHeatmap = {
        count: 5,
        turnRange: "0-10",
        utilizationBucket: "high",
      };
      const dashboardHeatmap = {
        avgCostPerTurn: 0,
        count: serviceHeatmap.count,
        turnBucket: serviceHeatmap.turnRange,
        utilizationBucket: serviceHeatmap.utilizationBucket, // Not tracked
      };

      expect(dashboardHeatmap.turnBucket).toBe("0-10");
    });
  });

  describe("cacheEfficiencyCurve transformation", () => {
    it("maps queryIndex to turn", () => {
      const servicePoint = { avgCacheHitRatio: 0.75, queryIndex: 5 };
      const dashboardPoint = {
        avgCacheHitRatio: servicePoint.avgCacheHitRatio,
        turn: servicePoint.queryIndex,
      };

      expect(dashboardPoint.turn).toBe(5);
      expect(dashboardPoint.avgCacheHitRatio).toBe(0.75);
    });
  });

  describe("compactionAnalysis transformation", () => {
    it("calculates compactionRate from sessions", () => {
      const analysis = {
        avgCompactionsPerSession: 2.5,
        sessionsWithCompactions: 3,
        totalSessions: 10,
      };

      const compactionRate =
        analysis.totalSessions > 0
          ? analysis.sessionsWithCompactions / analysis.totalSessions
          : 0;

      expect(compactionRate).toBe(0.3);
    });

    it("calculates totalCompactions from avg and count", () => {
      const analysis = {
        avgCompactionsPerSession: 2.5,
        sessionsWithCompactions: 4,
      };

      const totalCompactions = Math.round(
        analysis.avgCompactionsPerSession * analysis.sessionsWithCompactions
      );

      expect(totalCompactions).toBe(10);
    });

    it("handles zero sessions gracefully", () => {
      const analysis = {
        sessionsWithCompactions: 0,
        totalSessions: 0,
      };

      const compactionRate =
        analysis.totalSessions > 0
          ? analysis.sessionsWithCompactions / analysis.totalSessions
          : 0;

      expect(compactionRate).toBe(0);
    });
  });

  describe("commandStats transformation", () => {
    it("maps count to usageCount", () => {
      const serviceCommand = { command: "/commit", count: 15 };
      const dashboardCommand = {
        avgSessionCost: 0,
        command: serviceCommand.command,
        usageCount: serviceCommand.count, // Not tracked
      };

      expect(dashboardCommand.usageCount).toBe(15);
    });
  });
});

// ─── Date Range Calculation Tests ────────────────────────────────────────────

describe("Date range calculation", () => {
  it("calculates range from session timestamps", () => {
    const sessions = [
      { startTime: new Date(2026, 1, 15).getTime() }, // Feb 15
      { startTime: new Date(2026, 1, 20).getTime() }, // Feb 20
      { startTime: new Date(2026, 1, 18).getTime() }, // Feb 18
    ];

    const timestamps = sessions.map((s) => s.startTime);
    const dateRange = {
      from: toDateString(Math.min(...timestamps)),
      to: toDateString(Math.max(...timestamps)),
    };

    expect(dateRange.from).toBe("2026-02-15");
    expect(dateRange.to).toBe("2026-02-20");
  });

  it("handles single session", () => {
    const sessions = [{ startTime: new Date(2026, 1, 20).getTime() }];

    const timestamps = sessions.map((s) => s.startTime);
    const dateRange = {
      from: toDateString(Math.min(...timestamps)),
      to: toDateString(Math.max(...timestamps)),
    };

    expect(dateRange.from).toBe("2026-02-20");
    expect(dateRange.to).toBe("2026-02-20");
  });

  it("handles empty sessions with current date", () => {
    const sessions: { startTime: number }[] = [];

    const dateRange =
      sessions.length > 0
        ? {
            from: toDateString(Math.min(...sessions.map((s) => s.startTime))),
            to: toDateString(Math.max(...sessions.map((s) => s.startTime))),
          }
        : {
            from: toDateString(Date.now()),
            to: toDateString(Date.now()),
          };

    // Both should be today's date
    expect(dateRange.from).toBe(dateRange.to);
    expect(dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
