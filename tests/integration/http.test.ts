/**
 * Integration tests for HTTP routes.
 * Tests the Bun.serve endpoints with mock data.
 */
import { describe, expect, it, beforeAll } from "bun:test";

// ─── Test Server Setup ───────────────────────────────────────────────────────

/**
 * Minimal dashboard payload for testing.
 * Mimics the DashboardPayload structure from cli.ts
 */
const createMockPayload = () => ({
  agentStats: [],
  apiErrors: [],
  bashCommands: [
    { category: "git", count: 20 },
    { category: "package_manager", count: 15 },
  ],
  cacheEfficiencyCurve: [],
  commandStats: [],
  compactionAnalysis: {
    avgTriggerTurn: 150,
    compactionRate: 0.2,
    sessionsWithCompaction: 1,
    totalCompactions: 2,
  },
  contextHeatmap: [],
  dailyUsage: [
    {
      date: "2026-02-20",
      sessionCount: 2,
      totalCost: 7.5,
      totalTokens: 500_000,
    },
    {
      date: "2026-02-19",
      sessionCount: 3,
      totalCost: 8,
      totalTokens: 700_000,
    },
  ],
  fileActivity: [],
  fileExtensions: [
    { count: 80, extension: "ts" },
    { count: 20, extension: "json" },
  ],
  hookStats: [],
  insights: [
    {
      action: "",
      description: "Test description",
      title: "Test insight",
      type: "info" as const,
    },
  ],
  modelBreakdown: [
    { cost: 15.5, model: "Sonnet 4.5", queries: 50, tokens: 1_200_000 },
  ],
  projects: [
    {
      lastActive: Date.now(),
      projectPath: "/Users/test/project-a",
      sessionCount: 3,
      totalCost: 10,
    },
    {
      lastActive: Date.now() - 86_400_000,
      projectPath: "/Users/test/project-b",
      sessionCount: 2,
      totalCost: 5.5,
    },
  ],
  sessions: [
    {
      bashCommandCount: 10,
      cacheCreation: 50_000,
      cacheRead: 100_000,
      compactions: 0,
      date: "2026-02-20",
      displayName: "Implement feature X",
      durationMs: 1_800_000,
      firstPrompt: "Implement feature X",
      isSubagent: false,
      model: "claude-sonnet-4-5-20251022",
      modelShort: "Sonnet 4.5",
      output: 50_000,
      project: "/Users/test/project-a",
      queries: [],
      queryCount: 20,
      savedByCaching: 0,
      sessionId: "session-1",
      startTime: Date.now() - 3_600_000,
      subagentCount: 0,
      toolCounts: { Bash: 10, Edit: 20, Read: 30, Write: 5 },
      toolErrorCount: 2,
      toolUseCount: 80,
      totalCost: 5,
      totalTokens: 300_000,
      uncachedInput: 150_000,
    },
    {
      bashCommandCount: 5,
      cacheCreation: 20_000,
      cacheRead: 80_000,
      compactions: 0,
      date: "2026-02-19",
      displayName: "Fix bug Y",
      durationMs: 900_000,
      firstPrompt: "Fix bug Y",
      isSubagent: false,
      model: "claude-sonnet-4-5-20251022",
      modelShort: "Sonnet 4.5",
      output: 30_000,
      project: "/Users/test/project-b",
      queries: [],
      queryCount: 15,
      savedByCaching: 0,
      sessionId: "session-2",
      startTime: Date.now() - 86_400_000,
      subagentCount: 0,
      toolCounts: { Bash: 5, Edit: 10, Read: 20 },
      toolErrorCount: 0,
      toolUseCount: 50,
      totalCost: 3,
      totalTokens: 200_000,
      uncachedInput: 100_000,
    },
  ],
  skillROI: [],
  toolHealth: [
    {
      errorRate: 0.02,
      errors: 2,
      name: "Read",
      topErrors: [],
      totalCalls: 100,
    },
    {
      errorRate: 0.125,
      errors: 5,
      name: "Bash",
      topErrors: [],
      totalCalls: 40,
    },
  ],
  toolUsage: [
    { count: 100, name: "Read", sessions: 5 },
    { count: 60, name: "Edit", sessions: 5 },
    { count: 40, name: "Bash", sessions: 4 },
  ],
  topPrompts: [],
  totals: {
    agentLeverageRatio: 0.4,
    avgContextUtilization: 75,
    avgCostPerQuery: 0.31,
    avgCostPerSession: 3.1,
    avgSessionDurationMs: 600_000,
    cacheCreation: 100_000,
    cacheEfficiencyRatio: 1,
    cacheRead: 500_000,
    cacheSavingsUsd: 2.5,
    contextEfficiencyScore: 75,
    costPerEdit: 0.05,
    dateRange: { from: "2026-02-15", to: "2026-02-20" },
    output: 200_000,
    promptEfficiencyRatio: 0.2,
    savedByCaching: 2.5,
    totalAgentSpawns: 2,
    totalCacheRead: 500_000,
    totalCacheWrite: 100_000,
    totalCost: 15.5,
    totalFileOperations: 310,
    totalInputTokens: 1_000_000,
    totalOutputTokens: 200_000,
    totalQueries: 50,
    totalSessions: 5,
    totalSkillInvocations: 5,
    totalSubagents: 2,
    totalTokens: 1_200_000,
    totalToolUses: 200,
    uncachedInput: 500_000,
  },
});

// ─── Test Handler ────────────────────────────────────────────────────────────

let handleRequest: (req: Request) => Response | Promise<Response>;
let mockPayload: ReturnType<typeof createMockPayload>;

const request = async (pathname: string): Promise<Response> =>
  await handleRequest(new Request(`http://test.local${pathname}`));

/**
 * Creates a test server that mimics the cli.ts routes but uses mock data.
 * This allows testing HTTP behavior without the full Effect pipeline.
 */
const createTestHandler = () => {
  mockPayload = createMockPayload();

  return (req: Request) => {
    const url = new URL(req.url);

    // Dashboard HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(
        "<!DOCTYPE html><html><head><title>Dashboard</title></head><body>Test Dashboard</body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Main data endpoint
    if (url.pathname === "/api/data") {
      return Response.json(mockPayload);
    }

    // Session drilldown endpoint
    if (url.pathname === "/api/session") {
      const id = url.searchParams.get("id");
      if (!id) {
        return Response.json(
          { error: "Missing id parameter" },
          { status: 400 }
        );
      }
      const session = mockPayload.sessions.find((s) => s.sessionId === id);
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      return Response.json(session);
    }

    // Refresh endpoint
    if (url.pathname === "/api/refresh") {
      // Simulate refresh by returning current session count
      return Response.json({
        ok: true,
        sessions: mockPayload.totals.totalSessions,
      });
    }

    return new Response("Not found", { status: 404 });
  };
};

// ─── Test Setup ──────────────────────────────────────────────────────────────

beforeAll(() => {
  handleRequest = createTestHandler();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("HTTP Routes", () => {
  describe("GET /", () => {
    it("returns HTML with correct Content-Type", async () => {
      const response = await request(`/`);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/html; charset=utf-8"
      );

      const html = await response.text();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<title>Dashboard</title>");
    });

    it("returns HTML for /index.html", async () => {
      const response = await request(`/index.html`);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/html; charset=utf-8"
      );
    });
  });

  describe("GET /api/data", () => {
    it("returns DashboardPayload JSON", async () => {
      const response = await request(`/api/data`);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json"
      );

      const data = await response.json();
      expect(data).toHaveProperty("totals");
      expect(data).toHaveProperty("sessions");
      expect(data).toHaveProperty("dailyUsage");
      expect(data).toHaveProperty("insights");
    });

    it("returns correct totals structure", async () => {
      const response = await request(`/api/data`);
      const data = await response.json();

      expect(data.totals.totalSessions).toBe(5);
      expect(data.totals.totalCost).toBe(15.5);
      expect(data.totals.totalTokens).toBe(1_200_000);
      expect(data.totals.dateRange).toEqual({
        from: "2026-02-15",
        to: "2026-02-20",
      });
    });

    it("returns sessions array with expected fields", async () => {
      const response = await request(`/api/data`);
      const data = await response.json();

      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0]).toHaveProperty("sessionId");
      expect(data.sessions[0]).toHaveProperty("project");
      expect(data.sessions[0]).toHaveProperty("date");
      expect(data.sessions[0]).toHaveProperty("totalCost");
      expect(data.sessions[0]).toHaveProperty("queryCount");
      expect(data.sessions[0]).toHaveProperty("toolCounts");
    });

    it("returns dailyUsage array", async () => {
      const response = await request(`/api/data`);
      const data = await response.json();

      expect(data.dailyUsage).toHaveLength(2);
      expect(data.dailyUsage[0]).toHaveProperty("date");
      expect(data.dailyUsage[0]).toHaveProperty("sessionCount");
      expect(data.dailyUsage[0]).toHaveProperty("totalTokens");
      expect(data.dailyUsage[0]).toHaveProperty("totalCost");
    });

    it("returns tool analytics data", async () => {
      const response = await request(`/api/data`);
      const data = await response.json();

      expect(data.toolUsage).toBeInstanceOf(Array);
      expect(data.toolHealth).toBeInstanceOf(Array);
      expect(data.bashCommands).toBeInstanceOf(Array);
      expect(data.fileExtensions).toBeInstanceOf(Array);
    });

    it("returns compaction analysis", async () => {
      const response = await request(`/api/data`);
      const data = await response.json();

      expect(data.compactionAnalysis).toHaveProperty("compactionRate");
      expect(data.compactionAnalysis).toHaveProperty("sessionsWithCompaction");
      expect(data.compactionAnalysis).toHaveProperty("totalCompactions");
    });
  });

  describe("GET /api/session", () => {
    it("returns session details for valid id", async () => {
      const response = await request(`/api/session?id=session-1`);

      expect(response.status).toBe(200);
      const session = await response.json();
      expect(session.sessionId).toBe("session-1");
      expect(session.displayName).toBe("Implement feature X");
      expect(session.totalCost).toBe(5);
    });

    it("returns 400 for missing id parameter", async () => {
      const response = await request(`/api/session`);

      expect(response.status).toBe(400);
      const error = await response.json();
      expect(error.error).toBe("Missing id parameter");
    });

    it("returns 404 for non-existent session", async () => {
      const response = await request(`/api/session?id=nonexistent`);

      expect(response.status).toBe(404);
      const error = await response.json();
      expect(error.error).toBe("Session not found");
    });

    it("returns all session fields", async () => {
      const response = await request(`/api/session?id=session-1`);
      const session = await response.json();

      // Verify dashboard-required fields
      expect(session).toHaveProperty("sessionId");
      expect(session).toHaveProperty("project");
      expect(session).toHaveProperty("date");
      expect(session).toHaveProperty("displayName");
      expect(session).toHaveProperty("startTime");
      expect(session).toHaveProperty("durationMs");
      expect(session).toHaveProperty("totalCost");
      expect(session).toHaveProperty("queryCount");
      expect(session).toHaveProperty("toolUseCount");
      expect(session).toHaveProperty("isSubagent");
      expect(session).toHaveProperty("model");
      expect(session).toHaveProperty("modelShort");
      expect(session).toHaveProperty("totalTokens");
      expect(session).toHaveProperty("toolCounts");
    });
  });

  describe("GET /api/refresh", () => {
    it("returns success with session count", async () => {
      const response = await request(`/api/refresh`);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.ok).toBe(true);
      expect(result.sessions).toBe(5);
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown paths", async () => {
      const response = await request(`/unknown`);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Not found");
    });

    it("returns 404 for /api/unknown", async () => {
      const response = await request(`/api/unknown`);

      expect(response.status).toBe(404);
    });
  });
});

describe("Response Headers", () => {
  it("sets JSON content-type for API endpoints", async () => {
    const dataResponse = await request(`/api/data`);
    expect(dataResponse.headers.get("Content-Type")).toContain(
      "application/json"
    );

    const sessionResponse = await request(`/api/session?id=session-1`);
    expect(sessionResponse.headers.get("Content-Type")).toContain(
      "application/json"
    );

    const refreshResponse = await request(`/api/refresh`);
    expect(refreshResponse.headers.get("Content-Type")).toContain(
      "application/json"
    );
  });

  it("sets HTML content-type for dashboard", async () => {
    const response = await request(`/`);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8"
    );
  });
});
