/**
 * Integration tests for sync service database operations.
 * Tests the parse-to-database pipeline using in-memory SQLite.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import * as path from "node:path";

import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseService } from "../../src/bun/db";
import * as schema from "../../src/bun/db/schema";
import { parseSessionFile } from "../../src/bun/parser";
import type { FileInfo } from "../../src/bun/parser";
import {
  createTestDb,
  runWithTestDb,
  insertTestSession,
} from "../helpers/test-db";

// ─── Test Helpers ───────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/jsonl");

const createFileInfo = (
  filename: string,
  overrides?: Partial<FileInfo>
): FileInfo => ({
  filePath: path.join(FIXTURES_DIR, filename),
  isSubagent: false,
  parentSessionId: null,
  project: "/Users/test/project",
  sessionId: `test-${filename.replace(".jsonl", "")}`,
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Sync Database Operations", () => {
  describe("session insertion", () => {
    it("inserts a new session from parsed file", async () => {
      const { db, layer } = (() => {
        const testDb = createTestDb();
        return {
          db: testDb.db,
          layer: Effect.provideService(
            Effect.succeed(),
            DatabaseService,
            testDb
          ).pipe(Effect.map(() => testDb)),
        };
      })();

      // Parse and get records
      const fileInfo = createFileInfo("minimal-session.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      expect(parsed).not.toBeNull();

      // Insert session
      await db.insert(schema.sessions).values(parsed!.session);

      // Verify session was inserted
      const sessions = await db.select().from(schema.sessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.sessionId).toBe("test-minimal-session");
      expect(sessions[0]!.displayName).toBe("Hello Claude");
    });

    it("inserts queries with correct foreign key", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("multi-query-session.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      expect(parsed).not.toBeNull();

      // Insert session first (FK constraint)
      await db.insert(schema.sessions).values(parsed!.session);

      // Insert queries
      await db.insert(schema.queries).values(parsed!.queries);

      // Verify queries
      const queries = await db.select().from(schema.queries);
      expect(queries).toHaveLength(3);

      // Verify FK relationship
      const query = queries[0]!;
      expect(query.sessionId).toBe("test-multi-query-session");
    });

    it("inserts tool uses with query relationship", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("session-with-tools.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      expect(parsed).not.toBeNull();

      // Insert in correct order for FK constraints
      await db.insert(schema.sessions).values(parsed!.session);
      await db.insert(schema.queries).values(parsed!.queries);
      await db.insert(schema.toolUses).values(parsed!.toolUses);

      // Verify tool uses
      const toolUses = await db.select().from(schema.toolUses);
      expect(toolUses.length).toBeGreaterThan(0);

      // Verify Read tool was captured
      const readTools = toolUses.filter((t) => t.toolName === "Read");
      expect(readTools.length).toBeGreaterThan(0);

      // Verify Bash tool was captured
      const bashTools = toolUses.filter((t) => t.toolName === "Bash");
      expect(bashTools.length).toBeGreaterThan(0);
    });

    it("inserts file operations from parsed session", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("session-with-tools.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      expect(parsed).not.toBeNull();

      // Insert session
      await db.insert(schema.sessions).values(parsed!.session);

      // Insert file operations
      if (parsed!.fileOperations.length > 0) {
        await db.insert(schema.fileOperations).values(parsed!.fileOperations);
      }

      // Verify file operations
      const fileOps = await db.select().from(schema.fileOperations);
      expect(fileOps.length).toBeGreaterThan(0);

      // Verify extension extraction
      const tsFiles = fileOps.filter((f) => f.fileExtension === "ts");
      expect(tsFiles.length).toBeGreaterThan(0);
    });

    it("inserts bash commands with category", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("session-with-tools.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      expect(parsed).not.toBeNull();

      // Insert session
      await db.insert(schema.sessions).values(parsed!.session);

      // Insert bash commands
      if (parsed!.bashCommands.length > 0) {
        await db.insert(schema.bashCommands).values(parsed!.bashCommands);
      }

      // Verify bash commands
      const bashCmds = await db.select().from(schema.bashCommands);
      expect(bashCmds.length).toBeGreaterThan(0);

      // Verify category extraction (bun test → package_manager)
      const pkgMgrCmds = bashCmds.filter(
        (c) => c.category === "package_manager"
      );
      expect(pkgMgrCmds.length).toBeGreaterThan(0);
    });

    it("inserts API errors from parsed session", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("session-with-errors.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      expect(parsed).not.toBeNull();

      // Insert session
      await db.insert(schema.sessions).values(parsed!.session);

      // Insert API errors
      if (parsed!.apiErrors.length > 0) {
        await db.insert(schema.apiErrors).values(parsed!.apiErrors);
      }

      // Verify API errors
      const errors = await db.select().from(schema.apiErrors);
      expect(errors.length).toBeGreaterThan(0);

      // Verify rate limit error was captured
      const rateLimitErrors = errors.filter(
        (e) => e.errorType === "rate_limit"
      );
      expect(rateLimitErrors.length).toBeGreaterThan(0);
      expect(rateLimitErrors[0]!.statusCode).toBe(429);
    });

    it("inserts context window usage records", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("multi-query-session.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      expect(parsed).not.toBeNull();

      // Insert session
      await db.insert(schema.sessions).values(parsed!.session);

      // Insert context window usage
      if (parsed!.contextWindowUsage.length > 0) {
        await db
          .insert(schema.contextWindowUsage)
          .values(parsed!.contextWindowUsage);
      }

      // Verify context window usage
      const usages = await db.select().from(schema.contextWindowUsage);
      expect(usages).toHaveLength(3); // 3 queries in fixture
    });
  });

  describe("upsert behavior", () => {
    it("updates existing session on conflict", async () => {
      const { db } = createTestDb();

      // Insert initial session
      await db.insert(schema.sessions).values({
        displayName: "Old name",
        projectPath: "/old/path",
        queryCount: 1,
        sessionId: "test-session",
        startTime: 1000,
        toolUseCount: 0,
      });

      // Upsert with new data
      await db
        .insert(schema.sessions)
        .values({
          displayName: "New name",
          projectPath: "/new/path",
          queryCount: 5,
          sessionId: "test-session",
          startTime: 2000,
          toolUseCount: 10,
        })
        .onConflictDoUpdate({
          set: {
            displayName: "New name",
            queryCount: 5,
            toolUseCount: 10,
          },
          target: schema.sessions.sessionId,
        });

      // Verify update
      const sessions = await db.select().from(schema.sessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.displayName).toBe("New name");
      expect(sessions[0]!.queryCount).toBe(5);
      // startTime should NOT be updated (not in set clause)
      expect(sessions[0]!.startTime).toBe(1000);
    });

    it("updates parentSessionId and isSubagent on re-sync", async () => {
      const { db } = createTestDb();

      // Insert initial session as main session (not a subagent)
      await db.insert(schema.sessions).values({
        displayName: "Original session",
        isSubagent: false,
        parentSessionId: null,
        projectPath: "/test/project",
        queryCount: 1,
        sessionId: "resync-test-session",
        startTime: 1000,
        toolUseCount: 0,
      });

      // Verify initial state
      let sessions = await db.select().from(schema.sessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.isSubagent).toBe(false);
      expect(sessions[0]!.parentSessionId).toBeNull();

      // Re-sync with updated subagent info (simulating file re-parse)
      await db
        .insert(schema.sessions)
        .values({
          displayName: "Updated session",
          isSubagent: true,
          parentSessionId: "parent-session-id",
          projectPath: "/test/project",
          queryCount: 5,
          sessionId: "resync-test-session",
          startTime: 1000,
          toolUseCount: 10,
        })
        .onConflictDoUpdate({
          set: {
            displayName: "Updated session",
            isSubagent: true,
            parentSessionId: "parent-session-id",
            queryCount: 5,
            toolUseCount: 10,
          },
          target: schema.sessions.sessionId,
        });

      // Verify session was updated with subagent fields
      sessions = await db.select().from(schema.sessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.displayName).toBe("Updated session");
      expect(sessions[0]!.queryCount).toBe(5);
      expect(sessions[0]!.isSubagent).toBe(true);
      expect(sessions[0]!.parentSessionId).toBe("parent-session-id");
    });

    it("tracks file mtime for incremental sync", async () => {
      const { db } = createTestDb();

      const now = Date.now();

      // Insert file tracking record
      await db.insert(schema.sessionFiles).values({
        filePath: "/path/to/session.jsonl",
        mtimeMs: 1_000_000,
        sessionId: "session-1",
        syncedAt: now,
      });

      // Upsert with new mtime
      await db
        .insert(schema.sessionFiles)
        .values({
          filePath: "/path/to/session.jsonl",
          mtimeMs: 2_000_000,
          sessionId: "session-1",
          syncedAt: now + 1000,
        })
        .onConflictDoUpdate({
          set: {
            mtimeMs: 2_000_000,
            syncedAt: now + 1000,
          },
          target: schema.sessionFiles.filePath,
        });

      // Verify mtime was updated
      const files = await db.select().from(schema.sessionFiles);
      expect(files).toHaveLength(1);
      expect(files[0]!.mtimeMs).toBe(2_000_000);
      expect(files[0]!.syncedAt).toBe(now + 1000);
    });
  });

  describe("cascade deletes", () => {
    it("deletes queries when session is deleted", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("multi-query-session.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      // Insert session and queries
      await db.insert(schema.sessions).values(parsed!.session);
      await db.insert(schema.queries).values(parsed!.queries);

      // Verify queries exist
      let queries = await db.select().from(schema.queries);
      expect(queries.length).toBeGreaterThan(0);

      // Delete session
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.sessionId, "test-multi-query-session"));

      // Verify queries were cascaded
      queries = await db.select().from(schema.queries);
      expect(queries).toHaveLength(0);
    });

    it("deletes tool uses when query is deleted", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("session-with-tools.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      // Insert all records
      await db.insert(schema.sessions).values(parsed!.session);
      await db.insert(schema.queries).values(parsed!.queries);
      await db.insert(schema.toolUses).values(parsed!.toolUses);

      // Verify tool uses exist
      let toolUses = await db.select().from(schema.toolUses);
      expect(toolUses.length).toBeGreaterThan(0);

      // Delete queries (which should cascade to tool_uses)
      await db
        .delete(schema.queries)
        .where(eq(schema.queries.sessionId, "test-session-with-tools"));

      // Verify tool uses were cascaded
      toolUses = await db.select().from(schema.toolUses);
      expect(toolUses).toHaveLength(0);
    });
  });

  describe("batch insert handling", () => {
    it("handles large batch of queries without SQLite overflow", async () => {
      const { db } = createTestDb();

      // Insert session first
      await db.insert(schema.sessions).values({
        projectPath: "/test/project",
        queryCount: 150,
        sessionId: "large-session",
        startTime: Date.now(),
        toolUseCount: 0,
      });

      // Create 150 queries (exceeds typical SQLite parameter limit per statement)
      const queries: schema.NewQuery[] = [];
      for (let i = 0; i < 150; i++) {
        queries.push({
          id: `large-session:${i}`,
          inputTokens: 100,
          model: "claude-sonnet-4-5-20251022",
          outputTokens: 50,
          queryIndex: i,
          sessionId: "large-session",
          timestamp: Date.now() + i,
        });
      }

      // Insert in batches (mimicking sync service behavior)
      const BATCH_SIZE = 100;
      for (let i = 0; i < queries.length; i += BATCH_SIZE) {
        const batch = queries.slice(i, i + BATCH_SIZE);
        await db.insert(schema.queries).values(batch);
      }

      // Verify all were inserted
      const insertedQueries = await db.select().from(schema.queries);
      expect(insertedQueries).toHaveLength(150);
    });
  });

  describe("aggregated values", () => {
    it("stores pre-computed token totals on session", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("session-with-caching.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      await db.insert(schema.sessions).values(parsed!.session);

      const sessions = await db.select().from(schema.sessions);
      const session = sessions[0]!;

      // Verify aggregated values are stored
      expect(session.totalInputTokens).toBeGreaterThan(0);
      expect(session.totalOutputTokens).toBeGreaterThan(0);
      expect(session.totalCacheRead).toBeGreaterThan(0);
      expect(session.totalCacheWrite).toBeGreaterThan(0);
      expect(session.savedByCaching).toBeGreaterThan(0);
    });

    it("stores pre-computed cost on session", async () => {
      const { db } = createTestDb();

      const fileInfo = createFileInfo("minimal-session.jsonl");
      const parsed = await Effect.runPromise(parseSessionFile(fileInfo));

      await db.insert(schema.sessions).values(parsed!.session);

      const sessions = await db.select().from(schema.sessions);
      const session = sessions[0]!;

      // Sonnet: $3/MTok input, $15/MTok output
      // Cost = (10 * 3 / 1M) + (8 * 15 / 1M) = 0.00015
      expect(session.totalCost).toBeCloseTo(0.000_15, 6);
    });
  });

  describe("subagent handling", () => {
    it("marks subagent sessions correctly", async () => {
      const { db } = createTestDb();

      // Insert parent session
      await db.insert(schema.sessions).values({
        isSubagent: false,
        parentSessionId: null,
        projectPath: "/test/project",
        sessionId: "parent-session",
        startTime: Date.now(),
      });

      // Insert subagent session
      await db.insert(schema.sessions).values({
        isSubagent: true,
        parentSessionId: "parent-session",
        projectPath: "/test/project",
        sessionId: "agent-subagent-1",
        startTime: Date.now(),
      });

      // Query subagents
      const subagents = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.isSubagent, true));

      expect(subagents).toHaveLength(1);
      expect(subagents[0]!.parentSessionId).toBe("parent-session");
    });
  });

  describe("query methods", () => {
    it("can query sessions by project path", async () => {
      const { db } = createTestDb();

      // Insert sessions for different projects
      await db.insert(schema.sessions).values([
        { projectPath: "/project-a", sessionId: "s1", startTime: 1000 },
        { projectPath: "/project-a", sessionId: "s2", startTime: 2000 },
        { projectPath: "/project-b", sessionId: "s3", startTime: 3000 },
      ]);

      // Query by project
      const projectASessions = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.projectPath, "/project-a"));

      expect(projectASessions).toHaveLength(2);
    });

    it("can query tool uses by tool name", async () => {
      const { db } = createTestDb();

      // Setup
      await db.insert(schema.sessions).values({
        projectPath: "/test",
        sessionId: "test-session",
        startTime: Date.now(),
      });
      await db.insert(schema.queries).values({
        id: "test-session:0",
        queryIndex: 0,
        sessionId: "test-session",
        timestamp: Date.now(),
      });
      await db.insert(schema.toolUses).values([
        {
          id: "t1",
          queryId: "test-session:0",
          sessionId: "test-session",
          toolName: "Read",
        },
        {
          id: "t2",
          queryId: "test-session:0",
          sessionId: "test-session",
          toolName: "Read",
        },
        {
          id: "t3",
          queryId: "test-session:0",
          sessionId: "test-session",
          toolName: "Bash",
        },
      ]);

      // Query by tool name
      const readTools = await db
        .select()
        .from(schema.toolUses)
        .where(eq(schema.toolUses.toolName, "Read"));

      expect(readTools).toHaveLength(2);
    });
  });
});
