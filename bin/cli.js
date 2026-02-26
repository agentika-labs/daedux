#!/usr/bin/env bun
// CLI entry point for npx daedux
// This script provides a terminal-based interface to view usage stats

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".claude", "daedux.db");
const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");

async function main() {
  const args = new Set(process.argv.slice(2));
  const showHelp = args.has("--help") || args.has("-h");
  const showVersion = args.has("--version") || args.has("-v");

  if (showVersion) {
    const pkg = await import("../package.json");
    console.log(`daedux v${pkg.version}`);
    return;
  }

  if (showHelp) {
    console.log(`
daedux - Claude Code token usage dashboard

Usage:
  npx daedux [options]

Options:
  -h, --help     Show this help message
  -v, --version  Show version number
  --info         Show database and session info

For the full dashboard experience, download the desktop app from:
https://github.com/adamferguson/daedux/releases

The desktop app provides:
  - Interactive dashboard with charts and insights
  - System tray integration with quick stats
  - Real-time usage tracking
  - Auto-updates
`);
    return;
  }

  const showInfo = args.has("--info");

  console.log("Daedux\n");

  // Check if Claude projects directory exists
  if (!existsSync(CLAUDE_PROJECTS)) {
    console.log("No Claude Code projects found at ~/.claude/projects/");
    console.log(
      "Make sure you have Claude Code installed and have run some sessions."
    );
    return;
  }

  // Count session files
  const glob = new Bun.Glob("**/*.jsonl");
  let sessionCount = 0;
  for await (const _ of glob.scan(CLAUDE_PROJECTS)) {
    sessionCount++;
  }

  console.log(`Found ${sessionCount} session file(s) in ~/.claude/projects/`);

  if (existsSync(DB_PATH)) {
    const stats = await Bun.file(DB_PATH).stat();
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`Database: ${DB_PATH} (${sizeMB} MB)`);
  } else {
    console.log("Database: Not yet created");
    console.log(
      "\nRun the desktop app to initialize the database and sync your sessions."
    );
  }

  if (showInfo) {
    console.log("\nFor detailed analytics, use the desktop app.");
  }

  console.log("\nDownload the desktop app:");
  console.log("https://github.com/adamferguson/daedux/releases");
}

main().catch(console.error);
