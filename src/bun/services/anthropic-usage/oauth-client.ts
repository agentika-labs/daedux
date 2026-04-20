import { Effect, Schema } from "effect";

import type {
  AnthropicUsage,
  AnthropicUsageWindow,
} from "../../../shared/rpc-types";
import { AnthropicUsageError } from "../../errors";
import { debugLog } from "../../utils/log";
import { getCliSpawnEnv } from "../../utils/path";

/**
 * Schema for the Anthropic OAuth usage API response.
 * The API returns usage windows with percent_used and reset_at timestamps.
 */
export const OAuthUsageResponse = Schema.Struct({
  extra_usage: Schema.optional(
    Schema.Struct({
      limit_usd: Schema.NullOr(Schema.Number),
      spent_usd: Schema.Number,
    })
  ),
  five_hour: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day: Schema.Struct({
    percent_used: Schema.Number,
    reset_at: Schema.NullOr(Schema.Number),
  }),
  seven_day_opus: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
  seven_day_sonnet: Schema.optional(
    Schema.Struct({
      percent_used: Schema.Number,
      reset_at: Schema.NullOr(Schema.Number),
    })
  ),
});

export type OAuthUsageResponseType = Schema.Schema.Type<
  typeof OAuthUsageResponse
>;

/**
 * Call the Anthropic OAuth usage API.
 */
export const fetchUsageFromAPI = (accessToken: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new AnthropicUsageError({
          cause,
          message: "Failed to connect to Anthropic API",
          reason: "api_error",
        }),
      try: async (signal) =>
        fetch("https://api.anthropic.com/api/oauth/usage", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          signal,
        }),
    });

    if (!response.ok) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterParsed = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10)
        : undefined;
      const retryAfterSeconds = Number.isFinite(retryAfterParsed)
        ? retryAfterParsed
        : undefined;

      const errorResult = yield* Effect.tryPromise({
        catch: () => null,
        try: async () =>
          response.json() as Promise<{ error?: { message?: string } }>,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (response.status === 429) {
        return yield* new AnthropicUsageError({
          message: errorResult?.error?.message ?? "Rate limited",
          reason: "rate_limited",
          retryAfterSeconds,
        });
      }

      let errorMessage = `Anthropic API returned status ${response.status}`;
      let reason: "token_expired" | "api_error" | "not_supported" = "api_error";

      if (errorResult?.error?.message) {
        errorMessage = errorResult.error.message;
        if (errorMessage.includes("not supported")) {
          reason = "not_supported";
          debugLog(
            "anthropic-usage",
            "OAuth API not supported by Anthropic yet"
          );
        } else if (response.status === 401) {
          reason = "token_expired";
        }
      } else if (response.status === 401) {
        reason = "token_expired";
        errorMessage = "OAuth access token has expired";
      }

      return yield* new AnthropicUsageError({
        message: errorMessage,
        reason,
      });
    }

    const data = yield* Effect.tryPromise({
      catch: (cause) =>
        new AnthropicUsageError({
          cause,
          message: "Failed to parse API response JSON",
          reason: "parse_error",
        }),
      try: async () => response.json(),
    });

    const usage = yield* Schema.decodeUnknown(OAuthUsageResponse)(data).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            cause: error,
            message: "API response doesn't match expected schema",
            reason: "parse_error",
          })
      )
    );

    return usage;
  });

/**
 * Transform API response to our internal AnthropicUsage type.
 */
export const transformUsageResponse = (
  response: OAuthUsageResponseType
): AnthropicUsage => {
  const makeWindow = (
    data: { percent_used: number; reset_at: number | null },
    limitDesc: string
  ): AnthropicUsageWindow => ({
    percentUsed: data.percent_used,
    resetAt: data.reset_at,
    resetAtRaw: null,
    limit: limitDesc,
  });

  return {
    extraUsage: response.extra_usage
      ? {
          limitUsd: response.extra_usage.limit_usd,
          percentUsed: response.extra_usage.limit_usd
            ? Math.min(
                100,
                Math.round(
                  (response.extra_usage.spent_usd /
                    response.extra_usage.limit_usd) *
                    100
                )
              )
            : 0,
          resetAtRaw: null,
          spentUsd: response.extra_usage.spent_usd,
        }
      : undefined,
    fetchedAt: Date.now(),
    opus: response.seven_day_opus
      ? makeWindow(response.seven_day_opus, "Opus 7-day")
      : null,
    session: makeWindow(response.five_hour, "5-hour window"),
    sonnet: response.seven_day_sonnet
      ? makeWindow(response.seven_day_sonnet, "Sonnet 7-day")
      : null,
    source: "oauth",
    weekly: makeWindow(response.seven_day, "7-day limit"),
  };
};

/**
 * Attempt to refresh OAuth token by running a simple Claude command.
 * The CLI should auto-refresh the token when making authenticated requests.
 *
 * NOTE: `claude auth refresh` doesn't exist, so we run `claude auth status`
 * which triggers the OAuth flow and may refresh the token automatically.
 */
export const refreshOAuthToken = () =>
  Effect.gen(function* () {
    const proc = Bun.spawn(["claude", "auth", "status"], {
      env: getCliSpawnEnv(),
      stderr: "pipe",
      stdout: "pipe",
    });

    const exitCode = yield* Effect.promise(async () => proc.exited);

    if (exitCode !== 0) {
      const stderr = yield* Effect.promise(async () =>
        new Response(proc.stderr).text()
      );
      return yield* new AnthropicUsageError({
        message: `Failed to refresh OAuth token: ${stderr.trim()}`,
        reason: "api_error",
      });
    }

    yield* Effect.sleep("500 millis");
  }).pipe(Effect.timeout("5 seconds"));
