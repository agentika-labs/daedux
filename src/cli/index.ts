#!/usr/bin/env bun
/**
 * CLI entry point for `npx daedux`
 *
 * Starts an HTTP server serving the dashboard at localhost:3456
 * Uses @effect/cli for typed argument parsing and auto-generated help.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";

import { startServer, outputJson } from "./server";

const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");

const VERSION = "0.1.0";

// ─── CLI Options ─────────────────────────────────────────────────────────────

const portOption = Options.integer("port").pipe(
  Options.withAlias("p"),
  Options.withDescription("Port to run the server on"),
  Options.withDefault(3456)
);

const jsonOption = Options.boolean("json").pipe(
  Options.withAlias("j"),
  Options.withDescription("Output JSON to stdout and exit (no server)")
);

const filterOption = Options.choice("filter", ["today", "7d", "30d", "all"]).pipe(
  Options.withAlias("f"),
  Options.withDescription("Date filter for --json mode"),
  Options.withDefault("7d" as const)
);

const resyncOption = Options.boolean("resync").pipe(
  Options.withAlias("r"),
  Options.withDescription("Full resync before starting (clears and re-parses all files)")
);

const noOpenOption = Options.boolean("no-open").pipe(
  Options.withAlias("n"),
  Options.withDescription("Don't open browser automatically")
);

const verboseOption = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDescription("Enable verbose logging")
);

// ─── CLI Command ─────────────────────────────────────────────────────────────

const daeduxCommand = Command.make(
  "daedux",
  {
    filter: filterOption,
    json: jsonOption,
    noOpen: noOpenOption,
    port: portOption,
    resync: resyncOption,
    verbose: verboseOption,
  },
  ({ filter, json, noOpen, port, resync: _resync, verbose }) =>
    Effect.gen(function* () {
      // Check if Claude projects directory exists
      if (!existsSync(CLAUDE_PROJECTS)) {
        yield* Console.error(
          "Error: No Claude Code projects found at ~/.claude/projects/"
        );
        yield* Console.error(
          "Make sure you have Claude Code installed and have run some sessions."
        );
        return yield* Effect.fail(new Error("Claude projects directory not found"));
      }

      // Validate port
      if (port < 1 || port > 65535) {
        yield* Console.error(`Error: Invalid port number: ${port}`);
        return yield* Effect.fail(new Error("Invalid port number"));
      }

      // JSON mode: output data and exit
      if (json) {
        yield* Effect.promise(() => outputJson(filter));
        return;
      }

      // Server mode - open browser unless --no-open is specified
      if (!noOpen) {
        // Small delay to let server start
        setTimeout(() => {
          const url = `http://localhost:${port}`;
          const openCommand =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "start"
                : "xdg-open";

          Bun.spawn([openCommand, url], { stdout: "ignore", stderr: "ignore" });
        }, 500);
      }

      yield* Effect.promise(() =>
        startServer({
          port,
          verbose,
        })
      );
    })
);

// ─── Run CLI ─────────────────────────────────────────────────────────────────

const cli = Command.run(daeduxCommand, {
  name: "daedux",
  version: VERSION,
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
