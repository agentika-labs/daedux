/**
 * Integration tests for parseSessionFile.
 * Uses JSONL fixtures to test the full parsing pipeline.
 */
import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import * as path from "node:path"
import { parseSessionFile, type FileInfo } from "../../src/bun/parser"

// ─── Test Helpers ───────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/jsonl")

const createFileInfo = (filename: string, overrides?: Partial<FileInfo>): FileInfo => ({
  filePath: path.join(FIXTURES_DIR, filename),
  sessionId: `test-${filename.replace(".jsonl", "")}`,
  project: "/Users/test/project",
  isSubagent: false,
  parentSessionId: null,
  ...overrides,
})

const runParser = (fileInfo: FileInfo) =>
  Effect.runPromise(parseSessionFile(fileInfo))

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("parseSessionFile", () => {
  describe("empty file handling", () => {
    it("returns null for empty file", async () => {
      const fileInfo = createFileInfo("empty.jsonl")
      const result = await runParser(fileInfo)
      expect(result).toBeNull()
    })
  })

  describe("minimal session", () => {
    it("parses a single user/assistant exchange", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result).not.toBeNull()
      expect(result!.session.queryCount).toBe(1)
      expect(result!.queries).toHaveLength(1)
    })

    it("extracts correct token counts", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      // From fixture: input_tokens: 10, output_tokens: 8
      expect(result!.session.totalInputTokens).toBe(10)
      expect(result!.session.totalOutputTokens).toBe(8)
      expect(result!.session.totalCacheRead).toBe(0)
      expect(result!.session.totalCacheWrite).toBe(0)
    })

    it("captures user message preview", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.queries[0]!.userMessagePreview).toBe("Hello Claude")
    })

    it("captures assistant response preview", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.queries[0]!.assistantPreview).toBe("Hello! How can I help you today?")
    })

    it("extracts cwd from entries", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.session.cwd).toBe("/Users/test/project")
    })

    it("calculates cost based on model pricing", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      // Sonnet 4.5: $3/MTok input, $15/MTok output
      // Cost = (10 * 3 / 1M) + (8 * 15 / 1M) = 0.00003 + 0.00012 = 0.00015
      expect(result!.session.totalCost).toBeCloseTo(0.00015, 6)
    })
  })

  describe("multi-query session", () => {
    it("counts all queries correctly", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.session.queryCount).toBe(3)
      expect(result!.queries).toHaveLength(3)
    })

    it("aggregates tokens across all queries", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      // Query 1: input=100, output=50, cacheRead=0
      // Query 2: input=150, output=75, cacheRead=50
      // Query 3: input=200, output=100, cacheRead=100
      expect(result!.session.totalInputTokens).toBe(450) // 100+150+200
      expect(result!.session.totalOutputTokens).toBe(225) // 50+75+100
      expect(result!.session.totalCacheRead).toBe(150) // 0+50+100
    })

    it("extracts init entry metadata", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.session.version).toBe("1.0.0")
      expect(result!.session.cwd).toBe("/Users/test/project")
    })

    it("calculates duration from timestamps", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      // First entry: 10:00:00, Last entry: 10:02:01
      // Duration = 2 minutes + 1 second = 121 seconds = 121000ms
      expect(result!.session.durationMs).toBe(121000)
    })

    it("tracks context window usage per query", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.contextWindowUsage).toHaveLength(3)
      // Cumulative tokens should increase
      const usages = result!.contextWindowUsage
      expect(usages[0]!.cumulativeTokens!).toBeLessThan(usages[1]!.cumulativeTokens!)
      expect(usages[1]!.cumulativeTokens!).toBeLessThan(usages[2]!.cumulativeTokens!)
    })
  })

  describe("session with tools", () => {
    it("extracts tool uses", async () => {
      const fileInfo = createFileInfo("session-with-tools.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.toolUses.length).toBeGreaterThan(0)
      const toolNames = result!.toolUses.map((t) => t.toolName)
      expect(toolNames).toContain("Read")
      expect(toolNames).toContain("Bash")
    })

    it("extracts file operations from Read tools", async () => {
      const fileInfo = createFileInfo("session-with-tools.jsonl")
      const result = await runParser(fileInfo)

      const readOps = result!.fileOperations.filter((f) => f.operation === "read")
      expect(readOps.length).toBeGreaterThan(0)
      expect(readOps[0]!.filePath).toBe("/Users/test/project/config.ts")
      expect(readOps[0]!.fileExtension).toBe("ts")
    })

    it("extracts bash commands with category", async () => {
      const fileInfo = createFileInfo("session-with-tools.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.bashCommands.length).toBeGreaterThan(0)
      const bunTest = result!.bashCommands.find((b) => b.command === "bun test")
      expect(bunTest).toBeDefined()
      expect(bunTest!.category).toBe("package_manager")
    })

    it("links tool uses to queries", async () => {
      const fileInfo = createFileInfo("session-with-tools.jsonl")
      const result = await runParser(fileInfo)

      // Each tool use should have a valid queryId
      for (const toolUse of result!.toolUses) {
        expect(toolUse.queryId).toMatch(/^test-session-with-tools:\d+$/)
      }
    })

    it("sets toolUseCount on session", async () => {
      const fileInfo = createFileInfo("session-with-tools.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.session.toolUseCount).toBe(result!.toolUses.length)
    })
  })

  describe("session with caching", () => {
    it("tracks cache read and write tokens", async () => {
      const fileInfo = createFileInfo("session-with-caching.jsonl")
      const result = await runParser(fileInfo)

      // From fixture:
      // Query 1: cache_creation=50000
      // Query 2: cache_read=50000
      // Query 3: cache_read=51000
      expect(result!.session.totalCacheWrite).toBe(50000)
      expect(result!.session.totalCacheRead).toBe(101000) // 50000+51000
    })

    it("calculates savings from caching", async () => {
      const fileInfo = createFileInfo("session-with-caching.jsonl")
      const result = await runParser(fileInfo)

      // With significant cache reads, savedByCaching should be positive
      expect(result!.session.savedByCaching).toBeGreaterThan(0)
    })

    it("calculates cache hit ratio in context window usage", async () => {
      const fileInfo = createFileInfo("session-with-caching.jsonl")
      const result = await runParser(fileInfo)

      // First query has cache_creation but no cache_read, so ratio = 0
      expect(result!.contextWindowUsage[0]!.cacheHitRatio).toBe(0)

      // Later queries should have high cache hit ratios
      const laterUsages = result!.contextWindowUsage.slice(1)
      for (const usage of laterUsages) {
        expect(usage.cacheHitRatio).toBeGreaterThan(0.5)
      }
    })

    it("calculates savedByCaching using per-query model pricing", async () => {
      const fileInfo = createFileInfo("multi-model-cache-session.jsonl")
      const result = await runParser(fileInfo)

      // Query 1 (Sonnet): saved = (200*3 - (100*3 + 100*3*0.1)) / 1e6 = 0.00027
      // Query 2 (Opus):   saved = (200*15 - (100*15 + 100*15*0.1)) / 1e6 = 0.00135
      // Total saved = 0.00162
      expect(result!.session.savedByCaching).toBeCloseTo(0.00162, 8)
    })
  })

  describe("session with errors", () => {
    it("captures API errors", async () => {
      const fileInfo = createFileInfo("session-with-errors.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.apiErrors.length).toBeGreaterThan(0)

      const rateLimitError = result!.apiErrors.find((e) => e.errorType === "rate_limit")
      expect(rateLimitError).toBeDefined()
      expect(rateLimitError!.statusCode).toBe(429)
      expect(rateLimitError!.errorMessage).toContain("Rate limit")
    })

    it("captures server errors", async () => {
      const fileInfo = createFileInfo("session-with-errors.jsonl")
      const result = await runParser(fileInfo)

      const serverError = result!.apiErrors.find((e) => e.errorType === "server_error")
      expect(serverError).toBeDefined()
      expect(serverError!.statusCode).toBe(500)
    })

    it("extracts tool uses and marks errors correctly", async () => {
      const fileInfo = createFileInfo("session-with-errors.jsonl")
      const result = await runParser(fileInfo)

      // Tool uses are extracted and error status is resolved
      // (tool_result with is_error=true appears AFTER tool_use in JSONL,
      // but the parser uses deferred error resolution to capture it)
      const bashToolUse = result!.toolUses.find((t) => t.toolName === "Bash")
      expect(bashToolUse).toBeDefined()
      expect(bashToolUse!.inputPreview).toContain("invalid-command")
      expect(bashToolUse!.hasError).toBe(true)
      expect(bashToolUse!.errorMessage).toContain("command not found")
    })

    it("still parses queries around errors", async () => {
      const fileInfo = createFileInfo("session-with-errors.jsonl")
      const result = await runParser(fileInfo)

      // Should have parsed the assistant responses despite errors
      expect(result!.queries.length).toBeGreaterThan(0)
    })
  })

  describe("malformed lines handling", () => {
    it("skips invalid JSON lines and parses valid ones", async () => {
      const fileInfo = createFileInfo("malformed-lines.jsonl")
      const result = await runParser(fileInfo)

      // Fixture has 2 valid user/assistant pairs and 2 invalid lines
      expect(result).not.toBeNull()
      expect(result!.queries).toHaveLength(2)
    })

    it("extracts correct tokens from valid lines only", async () => {
      const fileInfo = createFileInfo("malformed-lines.jsonl")
      const result = await runParser(fileInfo)

      // Valid lines: entry1 (10 input, 5 output), entry2 (20 input, 10 output)
      expect(result!.session.totalInputTokens).toBe(30)
      expect(result!.session.totalOutputTokens).toBe(15)
    })
  })

  describe("subagent sessions", () => {
    it("sets isSubagent from fileInfo", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl", {
        isSubagent: true,
        parentSessionId: "parent-session-123",
      })
      const result = await runParser(fileInfo)

      expect(result!.session.isSubagent).toBe(true)
      expect(result!.session.parentSessionId).toBe("parent-session-123")
    })
  })

  describe("display name extraction", () => {
    it("uses first user message as display name", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.session.displayName).toBe("Hello Claude")
    })

    it("truncates long display names", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      // Display name should be <= 200 chars
      expect(result!.session.displayName!.length).toBeLessThanOrEqual(200)
    })
  })

  describe("model tracking", () => {
    it("extracts model from assistant messages", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.queries[0]!.model).toBe("claude-sonnet-4-5-20251022")
    })
  })

  describe("query indexing", () => {
    it("assigns sequential query indices", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      const indices = result!.queries.map((q) => q.queryIndex)
      expect(indices).toEqual([0, 1, 2])
    })

    it("creates unique query IDs", async () => {
      const fileInfo = createFileInfo("multi-query-session.jsonl")
      const result = await runParser(fileInfo)

      const ids = result!.queries.map((q) => q.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe("tool caller type", () => {
    it("extracts direct caller type from tool uses", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      const directTool = result!.toolUses.find((t) => t.toolName === "Read")
      expect(directTool).toBeDefined()
      expect(directTool!.callerType).toBe("direct")
    })

    it("extracts inference caller type from tool uses", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      const inferenceTool = result!.toolUses.find((t) => t.toolName === "Glob")
      expect(inferenceTool).toBeDefined()
      expect(inferenceTool!.callerType).toBe("inference")
    })

    it("handles tools without caller type", async () => {
      // Existing fixtures don't have caller type
      const fileInfo = createFileInfo("session-with-tools.jsonl")
      const result = await runParser(fileInfo)

      // Tools without caller field should have null callerType
      for (const tool of result!.toolUses) {
        expect(tool.callerType).toBeNull()
      }
    })
  })

  describe("ephemeral cache tokens", () => {
    it("extracts ephemeral 5m tokens from queries", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      // Query 1: ephemeral_5m=1000, Query 2: ephemeral_5m=2000
      expect(result!.queries[0]!.ephemeral5mTokens).toBe(1000)
      expect(result!.queries[1]!.ephemeral5mTokens).toBe(2000)
    })

    it("extracts ephemeral 1h tokens from queries", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      // Query 1: ephemeral_1h=500, Query 2: ephemeral_1h=750
      expect(result!.queries[0]!.ephemeral1hTokens).toBe(500)
      expect(result!.queries[1]!.ephemeral1hTokens).toBe(750)
    })

    it("aggregates ephemeral tokens on session", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      // Total: 1000+2000=3000 for 5m, 500+750=1250 for 1h
      expect(result!.session.totalEphemeral5mTokens).toBe(3000)
      expect(result!.session.totalEphemeral1hTokens).toBe(1250)
    })

    it("defaults to 0 when cache_creation is missing", async () => {
      // Existing fixtures don't have cache_creation nested object
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.queries[0]!.ephemeral5mTokens).toBe(0)
      expect(result!.queries[0]!.ephemeral1hTokens).toBe(0)
      expect(result!.session.totalEphemeral5mTokens).toBe(0)
      expect(result!.session.totalEphemeral1hTokens).toBe(0)
    })
  })

  describe("PR link records", () => {
    it("extracts PR links from pr-link entries", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.prLinks).toHaveLength(2)
    })

    it("captures PR number, URL, and repository", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      const pr1 = result!.prLinks.find((p) => p.prNumber === 123)
      expect(pr1).toBeDefined()
      expect(pr1!.prUrl).toBe("https://github.com/test/repo/pull/123")
      expect(pr1!.prRepository).toBe("test/repo")

      const pr2 = result!.prLinks.find((p) => p.prNumber === 456)
      expect(pr2).toBeDefined()
      expect(pr2!.prUrl).toBe("https://github.com/other/repo/pull/456")
      expect(pr2!.prRepository).toBe("other/repo")
    })

    it("assigns correct sessionId to PR links", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      for (const prLink of result!.prLinks) {
        expect(prLink.sessionId).toBe("test-new-fields")
      }
    })

    it("captures timestamp for PR links", async () => {
      const fileInfo = createFileInfo("new-fields.jsonl")
      const result = await runParser(fileInfo)

      // Both PR links should have valid timestamps
      for (const prLink of result!.prLinks) {
        expect(prLink.timestamp).toBeGreaterThan(0)
      }
    })

    it("returns empty array when no PR links exist", async () => {
      const fileInfo = createFileInfo("minimal-session.jsonl")
      const result = await runParser(fileInfo)

      expect(result!.prLinks).toHaveLength(0)
    })
  })
})
