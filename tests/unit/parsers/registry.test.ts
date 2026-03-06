/**
 * Unit tests for ParserRegistry and harness detection.
 */
import { describe, expect, it } from "bun:test";

import { Effect } from "effect";

import { claudeCodeParser } from "../../../src/bun/parsers/claude-code/parser";
import { codexParser } from "../../../src/bun/parsers/codex/parser";
import { ParserRegistry } from "../../../src/bun/parsers/registry";

// ─── ParserRegistry Tests ────────────────────────────────────────────────────

describe("ParserRegistry", () => {
  // Create a fresh registry instance for testing
  const createRegistry = () =>
    Effect.runSync(ParserRegistry.pipe(Effect.provide(ParserRegistry.Default)));

  describe("harness detection", () => {
    it("detects Claude Code files by path pattern", () => {
      const registry = createRegistry();

      expect(registry.detectHarness("/Users/test/.claude/projects/foo/abc123.jsonl"))
        .toBe("claude-code");
      expect(registry.detectHarness("/home/user/.claude/projects/-test-project/session.jsonl"))
        .toBe("claude-code");
    });

    it("detects Claude Code subagent files", () => {
      const registry = createRegistry();

      expect(registry.detectHarness("/Users/test/.claude/projects/foo/abc123/subagents/agent-xyz.jsonl"))
        .toBe("claude-code");
    });

    it("returns unknown for unrecognized paths", () => {
      const registry = createRegistry();

      expect(registry.detectHarness("/Users/test/random/path/session.jsonl"))
        .toBe("unknown");
      expect(registry.detectHarness("/Users/test/.claude/sessions/foo.jsonl"))
        .toBe("unknown");
    });

    it("returns unknown for non-JSONL files", () => {
      const registry = createRegistry();

      expect(registry.detectHarness("/Users/test/.claude/projects/foo/config.json"))
        .toBe("unknown");
    });
  });

  describe("parser registration", () => {
    it("has Claude Code parser registered by default", () => {
      const registry = createRegistry();

      const harnesses = registry.getRegisteredHarnesses();
      expect(harnesses).toContain("claude-code");
    });

    it("can retrieve registered parser", () => {
      const registry = createRegistry();

      const parser = registry.getParser("claude-code");
      expect(parser).toBeDefined();
      expect(parser?.name).toBe("Claude Code");
    });

    it("returns undefined for unregistered harness", () => {
      const registry = createRegistry();

      const parser = registry.getParser("codex");
      expect(parser).toBeUndefined();
    });

    it("can register additional parsers", () => {
      const registry = createRegistry();

      registry.register(codexParser);

      const harnesses = registry.getRegisteredHarnesses();
      expect(harnesses).toContain("codex");

      const parser = registry.getParser("codex");
      expect(parser?.name).toBe("Codex");
    });
  });
});

// ─── ClaudeCodeParser Tests ──────────────────────────────────────────────────

describe("ClaudeCodeParser", () => {
  describe("canHandle", () => {
    it("returns true for Claude Code project files", () => {
      expect(claudeCodeParser.canHandle("/Users/test/.claude/projects/foo/session.jsonl"))
        .toBe(true);
    });

    it("returns true for Claude Code subagent files", () => {
      expect(claudeCodeParser.canHandle("/Users/test/.claude/projects/foo/abc/subagents/agent-xyz.jsonl"))
        .toBe(true);
    });

    it("returns false for non-Claude Code paths", () => {
      expect(claudeCodeParser.canHandle("/Users/test/.codex/sessions/foo.jsonl"))
        .toBe(false);
      expect(claudeCodeParser.canHandle("/Users/test/projects/foo.jsonl"))
        .toBe(false);
    });

    it("returns false for non-JSONL files in Claude Code path", () => {
      expect(claudeCodeParser.canHandle("/Users/test/.claude/projects/foo/config.json"))
        .toBe(false);
    });
  });

  describe("metadata", () => {
    it("has correct harness identifier", () => {
      expect(claudeCodeParser.harness).toBe("claude-code");
    });

    it("has human-readable name", () => {
      expect(claudeCodeParser.name).toBe("Claude Code");
    });
  });
});

// ─── CodexParser Tests ───────────────────────────────────────────────────────

describe("CodexParser", () => {
  describe("canHandle", () => {
    it("returns true for Codex session files", () => {
      expect(codexParser.canHandle("/Users/test/.codex/sessions/foo.jsonl"))
        .toBe(true);
    });

    it("returns false for Claude Code paths", () => {
      expect(codexParser.canHandle("/Users/test/.claude/projects/foo/session.jsonl"))
        .toBe(false);
    });
  });

  describe("metadata", () => {
    it("has correct harness identifier", () => {
      expect(codexParser.harness).toBe("codex");
    });

    it("has human-readable name", () => {
      expect(codexParser.name).toBe("Codex");
    });
  });

  describe("stub implementation", () => {
    it("discoverSessions returns empty array", async () => {
      const result = await Effect.runPromise(codexParser.discoverSessions());
      expect(result).toEqual([]);
    });

    it("parseSession returns null", async () => {
      const result = await Effect.runPromise(
        codexParser.parseSession({
          filePath: "/test/path.jsonl",
          harness: "codex",
          isSubagent: false,
          parentSessionId: null,
          project: "test",
          sessionId: "test-session",
        })
      );
      expect(result).toBeNull();
    });
  });
});
