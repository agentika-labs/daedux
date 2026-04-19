import { Duration, Effect, Ref } from "effect";

import type { AnthropicUsage } from "../../../shared/rpc-types";
import { debugLog, log } from "../../utils/log";
import { loadSettings, updateSettingsEffect } from "../settings";
import { tryCliUsageWithRetry } from "./cli-probe";
import {
  readKeychainCredentials,
  type KeychainCredentialsType,
} from "./keychain-reader";
import {
  fetchUsageFromAPI,
  refreshOAuthToken,
  transformUsageResponse,
} from "./oauth-client";
import { METHOD_RECHECK_MS, type MethodState } from "./types";

const CACHE_TTL = Duration.seconds(30);

const createUnavailableUsage = (): AnthropicUsage => ({
  fetchedAt: Date.now(),
  opus: null,
  session: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
  sonnet: null,
  source: "unavailable",
  weekly: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
});

const createCredentialsOnlyUsage = (
  creds: KeychainCredentialsType
): AnthropicUsage => ({
  fetchedAt: Date.now(),
  opus: null,
  session: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
  sonnet: null,
  source: "credentials",
  subscription: {
    expiresAt: creds.claudeAiOauth.expiresAt ?? null,
    rateLimitTier: creds.claudeAiOauth.rateLimitTier ?? "unknown",
    type: creds.claudeAiOauth.subscriptionType ?? "unknown",
  },
  weekly: { limit: null, percentUsed: 0, resetAt: null, resetAtRaw: null },
});

const tryOAuthAPIWithMethodTracking = (methodRef: Ref.Ref<MethodState>) =>
  Effect.gen(function* () {
    log.info("usage", "Reading credentials from Keychain...");
    const credentials = yield* readKeychainCredentials().pipe(
      Effect.catchAll((err) => {
        log.info("usage", "Failed to read credentials:", err);
        return Effect.succeed(null);
      })
    );

    if (!credentials) {
      return null;
    }

    debugLog(
      "anthropic-usage",
      "Credentials found, subscription:",
      credentials.claudeAiOauth.subscriptionType
    );

    log.info("usage", "Trying OAuth API...");
    const apiResult = yield* fetchUsageFromAPI(
      credentials.claudeAiOauth.accessToken
    ).pipe(
      Effect.catchTag("AnthropicUsageError", (error) => {
        log.info("usage", "OAuth API error:", error.reason, error.message);

        if (error.reason === "not_supported") {
          debugLog(
            "anthropic-usage",
            "OAuth API not supported, switching to CLI-only mode"
          );
          const newState = { method: "cli" as const, determinedAt: Date.now() };
          return Ref.set(methodRef, newState).pipe(
            Effect.tap(() => updateSettingsEffect({ usageMethod: newState })),
            Effect.as(null)
          );
        }

        if (error.reason === "token_expired") {
          return Effect.gen(function* () {
            debugLog("anthropic-usage", "Token expired, attempting refresh...");
            yield* refreshOAuthToken().pipe(Effect.catchAll(() => Effect.void));
            const newCredentials = yield* readKeychainCredentials().pipe(
              Effect.catchAll(() => Effect.succeed(null))
            );
            if (!newCredentials) {
              return null;
            }
            return yield* fetchUsageFromAPI(
              newCredentials.claudeAiOauth.accessToken
            ).pipe(Effect.catchAll(() => Effect.succeed(null)));
          });
        }

        return Effect.succeed(null);
      }),
      Effect.catchAll(() => Effect.succeed(null))
    );

    if (apiResult) {
      log.info("usage", "OAuth API succeeded!");
      const newState = { method: "oauth" as const, determinedAt: Date.now() };
      yield* Ref.set(methodRef, newState);
      yield* updateSettingsEffect({ usageMethod: newState });
      const usage = transformUsageResponse(apiResult);
      return {
        ...usage,
        subscription: {
          expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier ?? "unknown",
          type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
        },
      };
    }

    return null;
  });

const tryCliUsageWithMethodTracking = (methodRef: Ref.Ref<MethodState>) =>
  Effect.gen(function* () {
    const credentials = yield* readKeychainCredentials().pipe(
      Effect.catchAll(() => Effect.succeed(null))
    );

    log.info("usage", "Trying CLI probe via native PTY...");
    const cliResult = yield* tryCliUsageWithRetry();

    if (cliResult) {
      log.info("usage", "CLI probe succeeded! Source:", cliResult.source);
      const newState = { method: "cli" as const, determinedAt: Date.now() };
      yield* Ref.set(methodRef, newState);
      yield* updateSettingsEffect({ usageMethod: newState });
      return {
        ...cliResult,
        subscription: credentials
          ? {
              expiresAt: credentials.claudeAiOauth.expiresAt ?? null,
              rateLimitTier:
                credentials.claudeAiOauth.rateLimitTier ?? "unknown",
              type: credentials.claudeAiOauth.subscriptionType ?? "unknown",
            }
          : undefined,
      };
    }

    if (credentials) {
      log.info("usage", "Falling back to credentials-only (no percentages)");
      return createCredentialsOnlyUsage(credentials);
    }

    return createUnavailableUsage();
  });

/**
 * AnthropicUsageService provides Anthropic API usage data.
 * Uses OAuth API with CLI fallback, caches results for 30s.
 *
 * Key behaviors:
 * - Learns which method works (OAuth vs CLI) and skips failing methods
 * - Periodically rechecks OAuth availability (every 30 minutes)
 * - Concurrent requests share the same computation (Effect's built-in cache)
 */
export class AnthropicUsageService extends Effect.Service<AnthropicUsageService>()(
  "AnthropicUsageService",
  {
    accessors: true,
    scoped: Effect.gen(function* () {
      const persisted = loadSettings();
      const initialMethod: MethodState = persisted.usageMethod ?? {
        method: "unknown",
        determinedAt: null,
      };
      const methodRef = yield* Ref.make(initialMethod);
      const retryAfterRef = yield* Ref.make<number | null>(null);

      const fetchUsage = Effect.gen(function* () {
        const state = yield* Ref.get(methodRef);
        const now = Date.now();

        const shouldTryOAuth =
          state.method === "unknown" ||
          state.method === "oauth" ||
          (state.determinedAt !== null &&
            now - state.determinedAt > METHOD_RECHECK_MS);

        if (shouldTryOAuth) {
          const result = yield* tryOAuthAPIWithMethodTracking(methodRef).pipe(
            Effect.timeout("12 seconds"),
            Effect.catchAll((err) =>
              Effect.logDebug("OAuth usage probe failed, falling back to CLI", {
                error: String(err),
              }).pipe(Effect.andThen(Effect.succeed(null)))
            )
          );
          if (result) {
            return result;
          }
        } else {
          debugLog(
            "anthropic-usage",
            "Skipping OAuth (CLI preferred), using CLI directly"
          );
        }

        return yield* tryCliUsageWithMethodTracking(methodRef).pipe(
          Effect.catchTag("AnthropicUsageError", (err) => {
            if (err.reason === "rate_limited") {
              const CLI_RATE_LIMIT_BACKOFF_SECONDS = 20 * 60;
              return Ref.set(
                retryAfterRef,
                CLI_RATE_LIMIT_BACKOFF_SECONDS
              ).pipe(Effect.andThen(Effect.succeed(createUnavailableUsage())));
            }
            return Effect.succeed(createUnavailableUsage());
          }),
          Effect.timeout("15 seconds"),
          Effect.catchAll((err) =>
            Effect.logWarning("CLI usage probe failed", {
              error: String(err),
            }).pipe(Effect.andThen(Effect.succeed(createUnavailableUsage())))
          )
        );
      }).pipe(
        Effect.catchAll((err) =>
          Effect.logWarning("Usage fetch failed unexpectedly", {
            error: String(err),
          }).pipe(Effect.andThen(Effect.succeed(createUnavailableUsage())))
        )
      );

      const [cachedFetch, invalidate] = yield* Effect.cachedInvalidateWithTTL(
        fetchUsage,
        CACHE_TTL
      );

      return {
        getUsage: () => cachedFetch,
        refreshUsage: () => invalidate.pipe(Effect.andThen(cachedFetch)),
        clearCache: () => invalidate,
        consumeRetryAfterSeconds: () => Ref.getAndSet(retryAfterRef, null),
        refreshWithBackoff: () =>
          invalidate.pipe(
            Effect.andThen(cachedFetch),
            Effect.zip(Ref.getAndSet(retryAfterRef, null))
          ),
      } as const;
    }),
  }
) {}

/** @deprecated Use AnthropicUsageService.Default instead */
export const AnthropicUsageServiceLive = AnthropicUsageService.Default;
