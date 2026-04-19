import { Effect, Schema } from "effect";

import { AnthropicUsageError } from "../../errors";

/**
 * Schema for Claude Code credentials stored in macOS Keychain.
 * The keychain entry "Claude Code-credentials" contains OAuth tokens and metadata.
 */
export const KeychainCredentials = Schema.Struct({
  claudeAiOauth: Schema.Struct({
    accessToken: Schema.String,
    expiresAt: Schema.optional(Schema.Number),
    rateLimitTier: Schema.optional(Schema.String),
    refreshToken: Schema.String,
    scopes: Schema.optional(Schema.Array(Schema.String)),
    subscriptionType: Schema.optional(Schema.String),
  }),
});

export type KeychainCredentialsType = Schema.Schema.Type<
  typeof KeychainCredentials
>;

/**
 * Read Claude Code credentials from macOS Keychain.
 * Uses the `security` command to read from the login keychain.
 */
export const readKeychainCredentials = () =>
  Effect.gen(function* () {
    const proc = Bun.spawn(
      [
        "security",
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-w",
      ],
      {
        stderr: "pipe",
        stdout: "pipe",
      }
    );

    const exitCode = yield* Effect.promise(async () => proc.exited);

    if (exitCode !== 0) {
      return yield* new AnthropicUsageError({
        message: "No Claude Code credentials found in Keychain",
        reason: "no_credentials",
      });
    }

    const credentialsJson = yield* Effect.promise(async () =>
      new Response(proc.stdout).text()
    );

    const parseResult = yield* Effect.tryPromise({
      catch: () =>
        new AnthropicUsageError({
          message: "Failed to parse Keychain credentials JSON",
          reason: "parse_error",
        }),
      try: async () => JSON.parse(credentialsJson.trim()),
    });

    const credentials = yield* Schema.decodeUnknown(KeychainCredentials)(
      parseResult
    ).pipe(
      Effect.mapError(
        (error) =>
          new AnthropicUsageError({
            cause: error,
            message: "Keychain credentials don't match expected schema",
            reason: "parse_error",
          })
      )
    );

    return credentials;
  }).pipe(Effect.timeout("5 seconds"));
