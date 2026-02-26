#!/usr/bin/env bun
/**
 * CLI entry point for `npx daedux`
 *
 * Starts an HTTP server serving the dashboard at localhost:3456
 */
import { parseArgs } from "util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { startServer, outputJson } from "./server";

const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");

const VERSION = "0.1.0";

const HELP = `
daedux - Claude Code token usage dashboard

Usage:
  npx daedux [options]

Options:
  -p, --port <port>  Port to run the server on (default: 3456)
  -j, --json         Output JSON to stdout and exit (no server)
  -f, --filter       Date filter for --json mode: today, 7d, 30d, all (default: 7d)
  -r, --resync       Full resync before starting (clears and re-parses all files)
  -n, --no-open      Don't open browser automatically
  -v, --verbose      Enable verbose logging
  -h, --help         Show this help message
  --version          Show version number

Examples:
  npx daedux              # Start dashboard on http://localhost:3456
  npx daedux -p 8080      # Use custom port
  npx daedux --json       # Output JSON data and exit
  npx daedux -j -f today  # JSON output for today only
`;

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p", default: "3456" },
      json: { type: "boolean", short: "j" },
      filter: { type: "string", short: "f", default: "7d" },
      resync: { type: "boolean", short: "r" },
      "no-open": { type: "boolean", short: "n" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
    strict: true,
  });

  if (values.version) {
    console.log(`daedux v${VERSION}`);
    return;
  }

  if (values.help) {
    console.log(HELP);
    return;
  }

  // Check if Claude projects directory exists
  if (!existsSync(CLAUDE_PROJECTS)) {
    console.error("Error: No Claude Code projects found at ~/.claude/projects/");
    console.error(
      "Make sure you have Claude Code installed and have run some sessions."
    );
    process.exit(1);
  }

  // JSON mode: output data and exit
  if (values.json) {
    await outputJson(values.filter);
    return;
  }

  // Server mode
  const port = parseInt(values.port ?? "3456", 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port number: ${values.port}`);
    process.exit(1);
  }

  // Open browser unless --no-open is specified
  if (!values["no-open"]) {
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

  await startServer({
    port,
    verbose: values.verbose,
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
