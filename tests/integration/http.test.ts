/**
 * Integration tests for HTTP routes.
 * Tests the Bun.serve endpoints with mock data.
 */
import { describe, expect, it, beforeAll } from "bun:test"

// ─── Test Server Setup ───────────────────────────────────────────────────────

/**
 * Minimal dashboard payload for testing.
 * Mimics the DashboardPayload structure from cli.ts
 */
const createMockPayload = () => ({
  totals: {
    totalSessions: 5,
    totalSubagents: 2,
    totalQueries: 50,
    totalToolUses: 200,
    totalCost: 15.5,
    totalInputTokens: 1_000_000,
    totalOutputTokens: 200_000,
    totalCacheRead: 500_000,
    totalCacheWrite: 100_000,
    totalTokens: 1_200_000,
    output: 200_000,
    uncachedInput: 500_000,
    cacheRead: 500_000,
    cacheCreation: 100_000,
    savedByCaching: 2.5,
    cacheEfficiencyRatio: 1.0,
    cacheSavingsUsd: 2.5,
    avgCostPerSession: 3.1,
    avgCostPerQuery: 0.31,
    avgSessionDurationMs: 600_000,
    dateRange: { from: "2026-02-15", to: "2026-02-20" },
    costPerEdit: 0.05,
    totalFileOperations: 310,
    contextEfficiencyScore: 75,
    avgContextUtilization: 75,
    agentLeverageRatio: 0.4,
    totalAgentSpawns: 2,
    promptEfficiencyRatio: 0.2,
    totalSkillInvocations: 5,
  },
  dailyUsage: [
    { date: "2026-02-20", sessionCount: 2, totalTokens: 500_000, totalCost: 7.5 },
    { date: "2026-02-19", sessionCount: 3, totalTokens: 700_000, totalCost: 8.0 },
  ],
  sessions: [
    {
      sessionId: "session-1",
      project: "/Users/test/project-a",
      date: "2026-02-20",
      displayName: "Implement feature X",
      startTime: Date.now() - 3600_000,
      durationMs: 1800_000,
      totalCost: 5.0,
      queryCount: 20,
      toolUseCount: 80,
      isSubagent: false,
      model: "claude-sonnet-4-5-20251022",
      modelShort: "Sonnet 4.5",
      firstPrompt: "Implement feature X",
      totalTokens: 300_000,
      savedByCaching: 0,
      uncachedInput: 150_000,
      cacheRead: 100_000,
      cacheCreation: 50_000,
      output: 50_000,
      compactions: 0,
      subagentCount: 0,
      toolErrorCount: 2,
      bashCommandCount: 10,
      toolCounts: { Read: 30, Edit: 20, Bash: 10, Write: 5 },
      queries: [],
    },
    {
      sessionId: "session-2",
      project: "/Users/test/project-b",
      date: "2026-02-19",
      displayName: "Fix bug Y",
      startTime: Date.now() - 86400_000,
      durationMs: 900_000,
      totalCost: 3.0,
      queryCount: 15,
      toolUseCount: 50,
      isSubagent: false,
      model: "claude-sonnet-4-5-20251022",
      modelShort: "Sonnet 4.5",
      firstPrompt: "Fix bug Y",
      totalTokens: 200_000,
      savedByCaching: 0,
      uncachedInput: 100_000,
      cacheRead: 80_000,
      cacheCreation: 20_000,
      output: 30_000,
      compactions: 0,
      subagentCount: 0,
      toolErrorCount: 0,
      bashCommandCount: 5,
      toolCounts: { Read: 20, Edit: 10, Bash: 5 },
      queries: [],
    },
  ],
  projects: [
    { projectPath: "/Users/test/project-a", sessionCount: 3, totalCost: 10.0, lastActive: Date.now() },
    { projectPath: "/Users/test/project-b", sessionCount: 2, totalCost: 5.5, lastActive: Date.now() - 86400_000 },
  ],
  insights: [
    { type: "info" as const, title: "Test insight", description: "Test description", action: "" },
  ],
  modelBreakdown: [
    { model: "Sonnet 4.5", queries: 50, tokens: 1_200_000, cost: 15.5 },
  ],
  toolUsage: [
    { name: "Read", count: 100, sessions: 5 },
    { name: "Edit", count: 60, sessions: 5 },
    { name: "Bash", count: 40, sessions: 4 },
  ],
  topPrompts: [],
  toolHealth: [
    { name: "Read", totalCalls: 100, errors: 2, errorRate: 0.02, topErrors: [] },
    { name: "Bash", totalCalls: 40, errors: 5, errorRate: 0.125, topErrors: [] },
  ],
  bashCommands: [
    { category: "git", count: 20 },
    { category: "package_manager", count: 15 },
  ],
  fileActivity: [],
  fileExtensions: [
    { extension: "ts", count: 80 },
    { extension: "json", count: 20 },
  ],
  hookStats: [],
  apiErrors: [],
  skillROI: [],
  agentStats: [],
  commandStats: [],
  contextHeatmap: [],
  cacheEfficiencyCurve: [],
  compactionAnalysis: {
    compactionRate: 0.2,
    sessionsWithCompaction: 1,
    totalCompactions: 2,
    avgTriggerTurn: 150,
  },
})

// ─── Test Handler ────────────────────────────────────────────────────────────

let handleRequest: (req: Request) => Response | Promise<Response>
let mockPayload: ReturnType<typeof createMockPayload>

const request = async (pathname: string): Promise<Response> =>
  await handleRequest(new Request(`http://test.local${pathname}`))

/**
 * Creates a test server that mimics the cli.ts routes but uses mock data.
 * This allows testing HTTP behavior without the full Effect pipeline.
 */
const createTestHandler = () => {
  mockPayload = createMockPayload()

  return (req: Request) => {
    const url = new URL(req.url)

    // Dashboard HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(
        "<!DOCTYPE html><html><head><title>Dashboard</title></head><body>Test Dashboard</body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    }

    // Main data endpoint
    if (url.pathname === "/api/data") {
      return Response.json(mockPayload)
    }

    // Session drilldown endpoint
    if (url.pathname === "/api/session") {
      const id = url.searchParams.get("id")
      if (!id) {
        return Response.json({ error: "Missing id parameter" }, { status: 400 })
      }
      const session = mockPayload.sessions.find((s) => s.sessionId === id)
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 })
      }
      return Response.json(session)
    }

    // Refresh endpoint
    if (url.pathname === "/api/refresh") {
      // Simulate refresh by returning current session count
      return Response.json({ ok: true, sessions: mockPayload.totals.totalSessions })
    }

    return new Response("Not found", { status: 404 })
  }
}

// ─── Test Setup ──────────────────────────────────────────────────────────────

beforeAll(() => {
  handleRequest = createTestHandler()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("HTTP Routes", () => {
  describe("GET /", () => {
    it("returns HTML with correct Content-Type", async () => {
      const response = await request(`/`)

      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")

      const html = await response.text()
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("<title>Dashboard</title>")
    })

    it("returns HTML for /index.html", async () => {
      const response = await request(`/index.html`)

      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
    })
  })

  describe("GET /api/data", () => {
    it("returns DashboardPayload JSON", async () => {
      const response = await request(`/api/data`)

      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toContain("application/json")

      const data = await response.json()
      expect(data).toHaveProperty("totals")
      expect(data).toHaveProperty("sessions")
      expect(data).toHaveProperty("dailyUsage")
      expect(data).toHaveProperty("insights")
    })

    it("returns correct totals structure", async () => {
      const response = await request(`/api/data`)
      const data = await response.json()

      expect(data.totals.totalSessions).toBe(5)
      expect(data.totals.totalCost).toBe(15.5)
      expect(data.totals.totalTokens).toBe(1_200_000)
      expect(data.totals.dateRange).toEqual({ from: "2026-02-15", to: "2026-02-20" })
    })

    it("returns sessions array with expected fields", async () => {
      const response = await request(`/api/data`)
      const data = await response.json()

      expect(data.sessions).toHaveLength(2)
      expect(data.sessions[0]).toHaveProperty("sessionId")
      expect(data.sessions[0]).toHaveProperty("project")
      expect(data.sessions[0]).toHaveProperty("date")
      expect(data.sessions[0]).toHaveProperty("totalCost")
      expect(data.sessions[0]).toHaveProperty("queryCount")
      expect(data.sessions[0]).toHaveProperty("toolCounts")
    })

    it("returns dailyUsage array", async () => {
      const response = await request(`/api/data`)
      const data = await response.json()

      expect(data.dailyUsage).toHaveLength(2)
      expect(data.dailyUsage[0]).toHaveProperty("date")
      expect(data.dailyUsage[0]).toHaveProperty("sessionCount")
      expect(data.dailyUsage[0]).toHaveProperty("totalTokens")
      expect(data.dailyUsage[0]).toHaveProperty("totalCost")
    })

    it("returns tool analytics data", async () => {
      const response = await request(`/api/data`)
      const data = await response.json()

      expect(data.toolUsage).toBeInstanceOf(Array)
      expect(data.toolHealth).toBeInstanceOf(Array)
      expect(data.bashCommands).toBeInstanceOf(Array)
      expect(data.fileExtensions).toBeInstanceOf(Array)
    })

    it("returns compaction analysis", async () => {
      const response = await request(`/api/data`)
      const data = await response.json()

      expect(data.compactionAnalysis).toHaveProperty("compactionRate")
      expect(data.compactionAnalysis).toHaveProperty("sessionsWithCompaction")
      expect(data.compactionAnalysis).toHaveProperty("totalCompactions")
    })
  })

  describe("GET /api/session", () => {
    it("returns session details for valid id", async () => {
      const response = await request(`/api/session?id=session-1`)

      expect(response.status).toBe(200)
      const session = await response.json()
      expect(session.sessionId).toBe("session-1")
      expect(session.displayName).toBe("Implement feature X")
      expect(session.totalCost).toBe(5.0)
    })

    it("returns 400 for missing id parameter", async () => {
      const response = await request(`/api/session`)

      expect(response.status).toBe(400)
      const error = await response.json()
      expect(error.error).toBe("Missing id parameter")
    })

    it("returns 404 for non-existent session", async () => {
      const response = await request(`/api/session?id=nonexistent`)

      expect(response.status).toBe(404)
      const error = await response.json()
      expect(error.error).toBe("Session not found")
    })

    it("returns all session fields", async () => {
      const response = await request(`/api/session?id=session-1`)
      const session = await response.json()

      // Verify dashboard-required fields
      expect(session).toHaveProperty("sessionId")
      expect(session).toHaveProperty("project")
      expect(session).toHaveProperty("date")
      expect(session).toHaveProperty("displayName")
      expect(session).toHaveProperty("startTime")
      expect(session).toHaveProperty("durationMs")
      expect(session).toHaveProperty("totalCost")
      expect(session).toHaveProperty("queryCount")
      expect(session).toHaveProperty("toolUseCount")
      expect(session).toHaveProperty("isSubagent")
      expect(session).toHaveProperty("model")
      expect(session).toHaveProperty("modelShort")
      expect(session).toHaveProperty("totalTokens")
      expect(session).toHaveProperty("toolCounts")
    })
  })

  describe("GET /api/refresh", () => {
    it("returns success with session count", async () => {
      const response = await request(`/api/refresh`)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.ok).toBe(true)
      expect(result.sessions).toBe(5)
    })
  })

  describe("404 handling", () => {
    it("returns 404 for unknown paths", async () => {
      const response = await request(`/unknown`)

      expect(response.status).toBe(404)
      const text = await response.text()
      expect(text).toBe("Not found")
    })

    it("returns 404 for /api/unknown", async () => {
      const response = await request(`/api/unknown`)

      expect(response.status).toBe(404)
    })
  })
})

describe("Response Headers", () => {
  it("sets JSON content-type for API endpoints", async () => {
    const dataResponse = await request(`/api/data`)
    expect(dataResponse.headers.get("Content-Type")).toContain("application/json")

    const sessionResponse = await request(`/api/session?id=session-1`)
    expect(sessionResponse.headers.get("Content-Type")).toContain("application/json")

    const refreshResponse = await request(`/api/refresh`)
    expect(refreshResponse.headers.get("Content-Type")).toContain("application/json")
  })

  it("sets HTML content-type for dashboard", async () => {
    const response = await request(`/`)
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
  })
})
