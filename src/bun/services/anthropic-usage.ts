import { Context, Effect, Layer, Schema } from "effect";
import { AnthropicUsageError } from "../errors";
import type { AnthropicUsage, AnthropicUsageWindow } from "../../shared/rpc-types";

// ─── OAuth Response Schema ──────────────────────────────────────────────────

/**
 * Schema for the Anthropic OAuth usage API response.
 * The API returns usage windows with percent_used and reset_at timestamps.
 */
const OAuthUsageResponse = Schema.Struct({
  five_hour: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day_sonnet: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
  seven_day_opus: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
  extra_usage: Schema.optional(
    Schema.Struct({
      spent_usd: Schema.Number,
      limit_usd: Schema.NullOr(Schema.Number),
    })
  ),
});

// ─── Keychain Credential Schema ─────────────────────────────────────────────

/**
 * Schema for Claude Code credentials stored in macOS Keychain.
 * The keychain entry "Claude Code-credentials" contains OAuth tokens and metadata.
 */
const KeychainCredentials = Schema.Struct({
  claudeAiOauth: Schema.Struct({
    accessToken: Schema.String,
    refreshToken: Schema.String,
    expiresAt: Schema.optional(Schema.Number),
    subscriptionType: Schema.optional(Schema.String),
    rateLimitTier: Schema.optional(Schema.String),
    scopes: Schema.optional(Schema.Array(Schema.String)),
  }),
});

// ─── Cache Configuration ────────────────────────────────────────────────────

/** Cache duration in milliseconds (30 seconds for API) */
const CACHE_TTL_MS = 30_000;

/** Cached usage data with timestamp */
interface CachedUsage {
  data: AnthropicUsage;
  cachedAt: number;
}

let usageCache: CachedUsage | null = null;

// ─── Expect-Based CLI Probe ──────────────────────────────────────────────────
//
// NOTE: The CLI probe is a best-effort fallback when the OAuth API is unavailable.
// It uses `expect` to automate the Claude CLI's interactive TUI, which is inherently
// fragile (prompt format, ANSI codes, etc. can change). The parsing logic is unit
// tested separately in tests/unit/anthropic-usage-parser.test.ts.

/**
 * Parse "2h 30m" or "4d 12h" duration string to Unix timestamp.
 */
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

/**
 * Parse TUI output to extract usage percentages.
 * Strips ANSI escape codes and extracts numbers.
 *
 * Expected output format from /usage:
 * ```
 * Session usage: 45% (resets in 2h 30m)
 * Weekly usage: 62% (resets in 4d 12h)
 * Opus: 78% (resets in 4d 12h)
 * ```
 */
const parseUsageOutput = (output: string): AnthropicUsage => {
  // Strip ANSI escape codes
  const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

  // Extract percentages using regex
  const sessionMatch = clean.match(/Session.*?(\d+)%/i);
  const weeklyMatch = clean.match(/Weekly.*?(\d+)%/i);
  const opusMatch = clean.match(/Opus.*?(\d+)%/i);
  const sonnetMatch = clean.match(/Sonnet.*?(\d+)%/i);

  // Extract reset times (e.g., "resets in 2h 30m")
  const sessionResetMatch = clean.match(/Session.*?resets in ([^)]+)/i);
  const weeklyResetMatch = clean.match(/Weekly.*?resets in ([^)]+)/i);

  return {
    session: {
      percentUsed: sessionMatch?.[1] ? parseInt(sessionMatch[1], 10) : 0,
      resetAt: sessionResetMatch?.[1] ? parseResetTime(sessionResetMatch[1]) : null,
      limit: "5-hour window",
    },
    weekly: {
      percentUsed: weeklyMatch?.[1] ? parseInt(weeklyMatch[1], 10) : 0,
      resetAt: weeklyResetMatch?.[1] ? parseResetTime(weeklyResetMatch[1]) : null,
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
    fetchedAt: Date.now(),
    source: "cli",
  };
};

/**
 * Check if a command exists on the system.
 */
const commandExists = async (cmd: string): Promise<boolean> => {
  const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
  return (await proc.exited) === 0;
};

/**
 * Probe Claude CLI for /usage data using expect.
 * Uses the expect command to automate the interactive CLI.
 *
 * The CLI probe is disabled in test environments (BUN_TEST=1) because:
 * 1. It spawns real processes that are hard to clean up
 * 2. Tests should use the credentials-only fallback instead
 */
const tryCliUsage = () =>
  Effect.tryPromise({
    try: async () => {
      // Skip CLI probe in test environments to avoid dangling processes
      if (process.env.BUN_TEST === "1" || process.env.NODE_ENV === "test") {
        throw new Error("CLI probe disabled in test environment");
      }

      // Check if expect is available before attempting to spawn
      if (!(await commandExists("expect"))) {
        throw new Error("expect binary not found");
      }
      if (!(await commandExists("claude"))) {
        throw new Error("claude binary not found");
      }

      // Create expect script inline
      // log_user 0 suppresses echoing to stdout
      // spawn -noecho prevents spawn line from appearing in output
      // We wait for the prompt, send /usage, wait for percentage output, then exit
      const expectScript = `
        log_user 0
        set timeout 15
        spawn -noecho env CLAUDECODE= claude
        expect {
          "❯" { send "/usage\\r" }
          timeout { exit 1 }
        }
        expect {
          -re {.*[0-9]+%.*} { }
          timeout { exit 1 }
        }
        sleep 1
        send "/exit\\r"
        expect eof
        puts $expect_out(buffer)
      `;

      const proc = Bun.spawn(["expect", "-c", expectScript], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CLAUDECODE: "" },
      });

      // Race between process completion and 20s timeout
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          // Use SIGKILL to ensure process tree is terminated
          proc.kill("SIGKILL");
          reject(new Error("CLI probe timed out after 20s"));
        }, 20_000);
      });

      try {
        const exitCode = await Promise.race([proc.exited, timeoutPromise]);

        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text();
          throw new Error(`expect failed: ${stderr}`);
        }

        const output = await new Response(proc.stdout).text();
        return parseUsageOutput(output);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    catch: (e) =>
      new AnthropicUsageError({
        reason: "api_error",
        message: `CLI probe failed: ${e}`,
        cause: e,
      }),
  });

// ─── Service Interface ──────────────────────────────────────────────────────

export class AnthropicUsageService extends Context.Tag("AnthropicUsageService")<
  AnthropicUsageService,
  {
    /** Get current Anthropic usage (cached for 30s) */
    readonly getUsage: () => Effect.Effect<AnthropicUsage, AnthropicUsageError>;

    /** Force refresh usage data, bypassing cache */
    readonly refreshUsage: () => Effect.Effect<AnthropicUsage, AnthropicUsageError>;

    /** Clear the usage cache */
    readonly clearCache: () => Effect.Effect<void, never>;
  }
>() {}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Create an "unavailable" usage object when we can't fetch real data.
 */
const createUnavailableUsage = (): AnthropicUsage => ({
  session: { percentUsed: 0, resetAt: null, limit: null },
  weekly: { percentUsed: 0, resetAt: null, limit: null },
  sonnet: null,
  opus: null,
  fetchedAt: Date.now(),
  source: "unavailable",
});

/**
 * Create a usage object from credentials metadata (when API is unavailable).
 * This at least shows subscription info even without usage percentages.
 */
const createCredentialsOnlyUsage = (
  creds: Schema.Schema.Type<typeof KeychainCredentials>
): AnthropicUsage => ({
  session: { percentUsed: 0, resetAt: null, limit: null },
  weekly: { percentUsed: 0, resetAt: null, limit: null },
  sonnet: null,
  opus: null,
  subscription: {
    type: creds.claudeAiOauth.subscriptionType ?? "unknown",
    rateLimitTier: creds.claudeAiOauth.rateLimitTier ?? "unknown",
    expiresAt: creds.claudeAiOauth.expiresAt ?? null,
  },
  fetchedAt: Date.now(),
  source: "credentials",
});

/**
 * Read Claude Code credentials from macOS Keychain.
 */
const readKeychainCredentials = () =>
  Effect.gen(function* () {
    // Use macOS security command to read from Keychain
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const exitCode = yield* Effect.promise(() => proc.exited);

    if (exitCode !== 0) {
      return yield* new AnthropicUsageError({
        reason: "no_credentials",
        message: "No Claude Code credentials found in Keychain",
      });
    }

    const credentialsJson = yield* Effect.promise(() => new Response(proc.stdout).text());

    // Parse and validate the JSON
    const parseResult = yield* Effect.tryPromise({
      try: async () => JSON.parse(credentialsJson.trim()),
      catch: () =>
        new AnthropicUsageError({
          reason: "parse_error",
          message: "Failed to parse Keychain credentials JSON",
        }),
    });

    // Validate against schema
    const credentials = yield* Schema.decodeUnknown(KeychainCredentials)(parseResult).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            reason: "parse_error",
            message: "Keychain credentials don't match expected schema",
            cause: error,
          })
      )
    );

    return credentials;
  });

/**
 * Call the Anthropic OAuth usage API.
 */
const fetchUsageFromAPI = (accessToken: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://api.anthropic.com/api/oauth/usage", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }),
      catch: (cause) =>
        new AnthropicUsageError({
          reason: "api_error",
          message: "Failed to connect to Anthropic API",
          cause,
        }),
    });

    if (response.status === 401) {
      return yield* new AnthropicUsageError({
        reason: "token_expired",
        message: "OAuth access token has expired",
      });
    }

    if (!response.ok) {
      return yield* new AnthropicUsageError({
        reason: "api_error",
        message: `Anthropic API returned status ${response.status}`,
      });
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new AnthropicUsageError({
          reason: "parse_error",
          message: "Failed to parse API response JSON",
          cause,
        }),
    });

    // Validate against schema
    const usage = yield* Schema.decodeUnknown(OAuthUsageResponse)(data).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            reason: "parse_error",
            message: "API response doesn't match expected schema",
            cause: error,
          })
      )
    );

    return usage;
  });

/**
 * Transform API response to our internal AnthropicUsage type.
 */
const transformUsageResponse = (
  response: Schema.Schema.Type<typeof OAuthUsageResponse>
): AnthropicUsage => {
  const makeWindow = (
    data: { percent_used: number; reset_at: number | null },
    limitDesc: string
  ): AnthropicUsageWindow => ({
    percentUsed: data.percent_used,
    resetAt: data.reset_at,
    limit: limitDesc,
  });

  return {
    session: makeWindow(response.five_hour, "5-hour window"),
    weekly: makeWindow(response.seven_day, "7-day limit"),
    sonnet: response.seven_day_sonnet
      ? makeWindow(response.seven_day_sonnet, "Sonnet 7-day")
      : null,
    opus: response.seven_day_opus ? makeWindow(response.seven_day_opus, "Opus 7-day") : null,
    extraUsage: response.extra_usage
      ? {
          spentUsd: response.extra_usage.spent_usd,
          limitUsd: response.extra_usage.limit_usd,
        }
      : undefined,
    fetchedAt: Date.now(),
    source: "oauth",
  };
};

/**
 * Attempt to refresh OAuth token using Claude CLI.
 */
const refreshOAuthToken = () =>
  Effect.gen(function* () {
    const proc = Bun.spawn(["claude", "auth", "refresh"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = yield* Effect.promise(() => proc.exited);

    if (exitCode !== 0) {
      const stderr = yield* Effect.promise(() => new Response(proc.stderr).text());
      return yield* new AnthropicUsageError({
        reason: "api_error",
        message: `Failed to refresh OAuth token: ${stderr.trim()}`,
      });
    }
  });

/**
 * Full usage fetch strategy with fallback chain:
 * 1. OAuth API (instant, if/when Anthropic enables it)
 * 2. CLI /usage via expect (~3-5s, parses TUI output)
 * 3. Credentials metadata (instant, shows subscription tier only)
 */
const tryOAuthAPI = () =>
  Effect.gen(function* () {
    // Read credentials from Keychain
    const credentials = yield* readKeychainCredentials();

    // Try to fetch usage from API
    const apiResult = yield* fetchUsageFromAPI(credentials.claudeAiOauth.accessToken).pipe(
      Effect.catchTag("AnthropicUsageError", (error) => {
        // If token expired, try to refresh and retry
        if (error.reason === "token_expired") {
          return Effect.gen(function* () {
            yield* refreshOAuthToken();
            // Re-read credentials (token may have changed)
            const newCredentials = yield* readKeychainCredentials();
            return yield* fetchUsageFromAPI(newCredentials.claudeAiOauth.accessToken);
          });
        }
        // For other API errors, we'll fall back to CLI probe
        return Effect.fail(error);
      }),
      // If API fails, return null to signal fallback
      Effect.catchAll(() => Effect.succeed(null))
    );

    // If API succeeded, transform and return
    if (apiResult) {
      const usage = transformUsageResponse(apiResult);
      // Augment with subscription info from credentials
      return {
        ...usage,
        subscription: {
          type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier ?? "unknown",
          expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
        },
      };
    }

    // Fallback to CLI /usage probe
    const cliResult = yield* tryCliUsage().pipe(
      Effect.catchAll(() => Effect.succeed(null))
    );

    if (cliResult) {
      // Augment CLI result with subscription info from credentials
      return {
        ...cliResult,
        subscription: {
          type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier ?? "unknown",
          expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
        },
      };
    }

    // Final fallback: credentials-only usage (no usage percentages, but subscription info)
    return createCredentialsOnlyUsage(credentials);
  });

// ─── Live Implementation ────────────────────────────────────────────────────

export const AnthropicUsageServiceLive = Layer.succeed(AnthropicUsageService, {
  getUsage: () =>
    Effect.gen(function* () {
      // Check cache first
      const now = Date.now();
      if (usageCache && now - usageCache.cachedAt < CACHE_TTL_MS) {
        return usageCache.data;
      }

      // Try OAuth API, fall back to unavailable on any error
      const usage = yield* tryOAuthAPI().pipe(
        Effect.catchAll(() => Effect.succeed(createUnavailableUsage()))
      );

      // Update cache
      usageCache = { data: usage, cachedAt: now };

      return usage;
    }),

  refreshUsage: () =>
    Effect.gen(function* () {
      // Clear cache and fetch fresh data
      usageCache = null;

      const usage = yield* tryOAuthAPI().pipe(
        Effect.catchAll(() => Effect.succeed(createUnavailableUsage()))
      );

      usageCache = { data: usage, cachedAt: Date.now() };

      return usage;
    }),

  clearCache: () =>
    Effect.sync(() => {
      usageCache = null;
    }),
});
