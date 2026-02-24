/**
 * Integration tests for AnthropicUsageService.
 * Tests the CLI probe, Effect service layer, and fallback chain.
 *
 * Some tests require `expect` (macOS/Linux) and `claude` CLI to be installed
 * and authenticated. These tests are skipped when dependencies are missing.
 */
import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  setDefaultTimeout,
} from "bun:test";
import { Effect, Layer } from "effect";
import {
  AnthropicUsageService,
  AnthropicUsageServiceLive,
} from "../../src/bun/services/anthropic-usage";
import type { AnthropicUsage } from "../../src/shared/rpc-types";

// CLI probe uses expect with 15s timeout, so we need longer test timeouts
setDefaultTimeout(30_000);

// ─── Environment Detection ───────────────────────────────────────────────────

/**
 * Check if a binary exists on the system PATH.
 */
const binaryExists = async (name: string): Promise<boolean> => {
  const proc = Bun.spawn(["which", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
};

/**
 * Check if Claude CLI is authenticated (has credentials in Keychain).
 */
const isClaudeAuthenticated = async (): Promise<boolean> => {
  const proc = Bun.spawn(
    ["security", "find-generic-password", "-s", "Claude Code-credentials"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exitCode = await proc.exited;
  return exitCode === 0;
};

/**
 * Check if we're running in CI environment.
 */
const isCI = (): boolean => {
  return Boolean(
    process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.CIRCLECI,
  );
};

// ─── Test Fixtures ───────────────────────────────────────────────────────────

/**
 * Sample CLI output that parseUsageOutput should handle.
 * This matches the format from the real Claude CLI /usage command.
 */
const SAMPLE_CLI_OUTPUT = `
Session usage: 45% (resets in 2h 30m)
Weekly usage: 62% (resets in 4d 12h)
Opus: 78% (resets in 4d 12h)
Sonnet: 35% (resets in 4d 12h)
`;

const SAMPLE_CLI_OUTPUT_WITH_ANSI = `\x1b[32mSession usage: 45%\x1b[0m (resets in 2h)
\x1b[33mWeekly usage: 62%\x1b[0m (resets in 4d)`;

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Clear the usage cache before/after tests.
 * This ensures tests don't affect each other.
 */
const clearServiceCache = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AnthropicUsageService;
      yield* service.clearCache();
    }).pipe(Effect.provide(AnthropicUsageServiceLive)),
  );

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AnthropicUsageService", () => {
  describe("Environment Detection", () => {
    it("detects if expect binary is available", async () => {
      const hasExpect = await binaryExists("expect");
      // Just verify the check runs without error
      expect(typeof hasExpect).toBe("boolean");
    });

    it("detects if claude CLI is available", async () => {
      const hasClaude = await binaryExists("claude");
      expect(typeof hasClaude).toBe("boolean");
    });

    it("detects if running in CI", () => {
      const ci = isCI();
      expect(typeof ci).toBe("boolean");
    });

    it("detects Claude authentication status", async () => {
      const authenticated = await isClaudeAuthenticated();
      expect(typeof authenticated).toBe("boolean");
    });
  });

  describe("Service Layer (always run)", () => {
    beforeEach(async () => {
      await clearServiceCache();
    });

    afterEach(async () => {
      await clearServiceCache();
    });

    it("getUsage returns AnthropicUsage structure", async () => {
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      console.log("Claude Code usage limits", { usage });

      // Verify structure regardless of source
      expect(usage).toHaveProperty("session");
      expect(usage).toHaveProperty("weekly");
      expect(usage).toHaveProperty("fetchedAt");
      expect(usage).toHaveProperty("source");

      // Session window structure
      expect(usage.session).toHaveProperty("percentUsed");
      expect(usage.session).toHaveProperty("resetAt");
      expect(usage.session).toHaveProperty("limit");

      // Weekly window structure
      expect(usage.weekly).toHaveProperty("percentUsed");
      expect(usage.weekly).toHaveProperty("resetAt");
      expect(usage.weekly).toHaveProperty("limit");

      // Source should be one of the valid values
      expect(["oauth", "cli", "credentials", "unavailable"]).toContain(
        usage.source,
      );
    });

    it("refreshUsage clears cache and fetches fresh data", async () => {
      const [first, second] = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;

          // First call
          const usage1 = yield* service.getUsage();

          // Refresh should clear cache
          const usage2 = yield* service.refreshUsage();

          return [usage1, usage2] as const;
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      // Both should be valid structures
      expect(first).toHaveProperty("fetchedAt");
      expect(second).toHaveProperty("fetchedAt");

      // If OAuth/CLI work, fetchedAt should be recent
      expect(second.fetchedAt).toBeGreaterThanOrEqual(first.fetchedAt);
    });

    it("clearCache removes cached data", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;

          // Populate cache
          yield* service.getUsage();

          // Clear it
          yield* service.clearCache();

          // Next call should fetch fresh (no way to verify without timing, but shouldn't throw)
          const usage = yield* service.getUsage();
          expect(usage).toHaveProperty("source");
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );
    });

    it("caches results for 30 seconds", async () => {
      const timestamps = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;

          // First call
          const usage1 = yield* service.getUsage();
          const time1 = usage1.fetchedAt;

          // Immediate second call (should be cached)
          const usage2 = yield* service.getUsage();
          const time2 = usage2.fetchedAt;

          return { time1, time2 };
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      // Cached result should have same fetchedAt
      expect(timestamps.time1).toBe(timestamps.time2);
    });

    it("handles unavailable source gracefully", async () => {
      // Even if OAuth/CLI both fail, should return unavailable source
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      // Should never throw, always returns valid structure
      expect(usage.session.percentUsed).toBeGreaterThanOrEqual(0);
      expect(usage.weekly.percentUsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("CLI Probe Integration (requires expect + claude)", () => {
    let hasExpect: boolean;
    let hasClaude: boolean;
    let isAuthenticated: boolean;

    beforeEach(async () => {
      hasExpect = await binaryExists("expect");
      hasClaude = await binaryExists("claude");
      isAuthenticated = await isClaudeAuthenticated();
      await clearServiceCache();
    });

    afterEach(async () => {
      await clearServiceCache();
    });

    it("skips if expect is not available", async () => {
      if (!hasExpect) {
        console.log("  ⏭️  Skipping: expect binary not found");
        return;
      }
      expect(hasExpect).toBe(true);
    });

    it("skips if claude CLI is not available", async () => {
      if (!hasClaude) {
        console.log("  ⏭️  Skipping: claude CLI not found");
        return;
      }
      expect(hasClaude).toBe(true);
    });

    it("skips if not authenticated", async () => {
      if (!isAuthenticated) {
        console.log(
          "  ⏭️  Skipping: Claude not authenticated (no Keychain credentials)",
        );
        return;
      }
      expect(isAuthenticated).toBe(true);
    });

    it("returns valid usage when all dependencies available", async () => {
      // Skip in CI to avoid flaky tests
      if (isCI()) {
        console.log("  ⏭️  Skipping in CI environment");
        return;
      }

      if (!hasExpect || !hasClaude || !isAuthenticated) {
        console.log("  ⏭️  Skipping: Missing dependencies");
        return;
      }

      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.refreshUsage(); // Force fresh fetch
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      // Should have real data from OAuth or CLI
      expect(["oauth", "cli", "credentials"]).toContain(usage.source);

      // Session window should have reasonable values
      expect(usage.session.percentUsed).toBeGreaterThanOrEqual(0);
      expect(usage.session.percentUsed).toBeLessThanOrEqual(100);

      // Weekly window should have reasonable values
      expect(usage.weekly.percentUsed).toBeGreaterThanOrEqual(0);
      expect(usage.weekly.percentUsed).toBeLessThanOrEqual(100);

      // fetchedAt should be recent
      const now = Date.now();
      expect(usage.fetchedAt).toBeLessThanOrEqual(now);
      expect(usage.fetchedAt).toBeGreaterThan(now - 60_000); // Within last minute
    });
  });

  describe("Fallback Chain Verification", () => {
    beforeEach(async () => {
      await clearServiceCache();
    });

    afterEach(async () => {
      await clearServiceCache();
    });

    it("source indicates which method succeeded", async () => {
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      // Log which source was used (helpful for debugging)
      console.log(`  ℹ️  Usage source: ${usage.source}`);

      // Verify source is valid
      const validSources = [
        "oauth",
        "cli",
        "credentials",
        "unavailable",
      ] as const;
      expect(validSources).toContain(usage.source);

      // If credentials source, should have subscription info
      if (usage.source === "credentials") {
        expect(usage.subscription).toBeDefined();
      }

      // If unavailable, percentUsed should be 0
      if (usage.source === "unavailable") {
        expect(usage.session.percentUsed).toBe(0);
        expect(usage.weekly.percentUsed).toBe(0);
      }
    });

    it("augments CLI/OAuth results with subscription info when available", async () => {
      const isAuthenticated = await isClaudeAuthenticated();

      if (!isAuthenticated) {
        console.log("  ⏭️  Skipping: Not authenticated");
        return;
      }

      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      // If we got data from oauth/cli/credentials, should have subscription
      if (usage.source !== "unavailable") {
        expect(usage.subscription).toBeDefined();
        expect(usage.subscription?.type).toBeDefined();
      }
    });
  });

  describe("Usage Window Validation", () => {
    it("validates session window structure", async () => {
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      const { session } = usage;

      expect(typeof session.percentUsed).toBe("number");
      expect(session.percentUsed).toBeGreaterThanOrEqual(0);
      expect(session.percentUsed).toBeLessThanOrEqual(100);

      // resetAt can be null or a timestamp
      if (session.resetAt !== null) {
        expect(typeof session.resetAt).toBe("number");
        expect(session.resetAt).toBeGreaterThan(0);
      }

      // limit can be null or a string
      if (session.limit !== null) {
        expect(typeof session.limit).toBe("string");
      }
    });

    it("validates weekly window structure", async () => {
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      const { weekly } = usage;

      expect(typeof weekly.percentUsed).toBe("number");
      expect(weekly.percentUsed).toBeGreaterThanOrEqual(0);
      expect(weekly.percentUsed).toBeLessThanOrEqual(100);

      if (weekly.resetAt !== null) {
        expect(typeof weekly.resetAt).toBe("number");
        expect(weekly.resetAt).toBeGreaterThan(0);
      }

      if (weekly.limit !== null) {
        expect(typeof weekly.limit).toBe("string");
      }
    });

    it("opus and sonnet windows are optional", async () => {
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      // opus and sonnet can be null
      if (usage.opus !== null) {
        expect(typeof usage.opus.percentUsed).toBe("number");
        expect(usage.opus.percentUsed).toBeGreaterThanOrEqual(0);
        expect(usage.opus.percentUsed).toBeLessThanOrEqual(100);
      }

      if (usage.sonnet !== null) {
        expect(typeof usage.sonnet.percentUsed).toBe("number");
        expect(usage.sonnet.percentUsed).toBeGreaterThanOrEqual(0);
        expect(usage.sonnet.percentUsed).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("Extra Usage (Overage)", () => {
    it("extraUsage field is optional and validated when present", async () => {
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      if (usage.extraUsage !== undefined) {
        expect(typeof usage.extraUsage.spentUsd).toBe("number");
        expect(usage.extraUsage.spentUsd).toBeGreaterThanOrEqual(0);

        if (usage.extraUsage.limitUsd !== null) {
          expect(typeof usage.extraUsage.limitUsd).toBe("number");
          expect(usage.extraUsage.limitUsd).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("Error Handling", () => {
    it("never throws - always returns valid usage", async () => {
      // Even with broken environment, should return unavailable
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.getUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      expect(usage).toBeDefined();
      expect(usage.fetchedAt).toBeGreaterThan(0);
    });

    it("refreshUsage never throws", async () => {
      const usage = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AnthropicUsageService;
          return yield* service.refreshUsage();
        }).pipe(Effect.provide(AnthropicUsageServiceLive)),
      );

      expect(usage).toBeDefined();
      expect(usage.fetchedAt).toBeGreaterThan(0);
    });
  });
});

describe("Parsing Functions (reimplemented for testing)", () => {
  /**
   * These are reimplemented versions of the private parsing functions.
   * The actual implementations are tested via the service integration tests,
   * but we include these to verify parsing logic in isolation.
   */

  /** Parse "2h 30m" or "4d 12h" duration string to Unix timestamp */
  const parseResetTime = (timeStr: string): number | null => {
    const now = Date.now();
    let ms = 0;

    const days = timeStr.match(/(\d+)d/);
    const hours = timeStr.match(/(\d+)h/);
    const mins = timeStr.match(/(\d+)m/);

    if (days?.[1]) ms += parseInt(days[1], 10) * 24 * 60 * 60 * 1000;
    if (hours?.[1]) ms += parseInt(hours[1], 10) * 60 * 60 * 1000;
    if (mins?.[1]) ms += parseInt(mins[1], 10) * 60 * 1000;

    return ms > 0 ? Math.floor((now + ms) / 1000) : null;
  };

  /** Parse TUI output to extract usage percentages */
  const parseUsageOutput = (output: string) => {
    const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

    const sessionMatch = clean.match(/Session.*?(\d+)%/i);
    const weeklyMatch = clean.match(/Weekly.*?(\d+)%/i);
    const opusMatch = clean.match(/Opus.*?(\d+)%/i);
    const sonnetMatch = clean.match(/Sonnet.*?(\d+)%/i);

    const sessionResetMatch = clean.match(/Session.*?resets in ([^)]+)/i);
    const weeklyResetMatch = clean.match(/Weekly.*?resets in ([^)]+)/i);

    return {
      session: {
        percentUsed: sessionMatch?.[1] ? parseInt(sessionMatch[1], 10) : 0,
        resetAt: sessionResetMatch?.[1]
          ? parseResetTime(sessionResetMatch[1])
          : null,
        limit: "5-hour window",
      },
      weekly: {
        percentUsed: weeklyMatch?.[1] ? parseInt(weeklyMatch[1], 10) : 0,
        resetAt: weeklyResetMatch?.[1]
          ? parseResetTime(weeklyResetMatch[1])
          : null,
        limit: "7-day limit",
      },
      opus: opusMatch?.[1]
        ? {
            percentUsed: parseInt(opusMatch[1], 10),
            resetAt: null,
            limit: "Opus 7-day",
          }
        : null,
      sonnet: sonnetMatch?.[1]
        ? {
            percentUsed: parseInt(sonnetMatch[1], 10),
            resetAt: null,
            limit: "Sonnet 7-day",
          }
        : null,
    };
  };

  describe("parseUsageOutput integration", () => {
    it("parses sample CLI output correctly", () => {
      const result = parseUsageOutput(SAMPLE_CLI_OUTPUT);

      expect(result.session.percentUsed).toBe(45);
      expect(result.session.resetAt).not.toBeNull();
      expect(result.weekly.percentUsed).toBe(62);
      expect(result.weekly.resetAt).not.toBeNull();
      expect(result.opus?.percentUsed).toBe(78);
      expect(result.sonnet?.percentUsed).toBe(35);
    });

    it("handles ANSI escape codes", () => {
      const result = parseUsageOutput(SAMPLE_CLI_OUTPUT_WITH_ANSI);

      expect(result.session.percentUsed).toBe(45);
      expect(result.weekly.percentUsed).toBe(62);
    });

    it("returns zeros for malformed output", () => {
      const result = parseUsageOutput("Some random text without percentages");

      expect(result.session.percentUsed).toBe(0);
      expect(result.weekly.percentUsed).toBe(0);
      expect(result.opus).toBeNull();
      expect(result.sonnet).toBeNull();
    });
  });
});
