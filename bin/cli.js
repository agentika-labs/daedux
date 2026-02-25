#!/usr/bin/env bun
// CLI entry point for npx claude-usage-monitor
// This script provides a terminal-based interface to view usage stats

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DB_PATH = join(homedir(), ".claude", "usage-monitor.db");
const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");

async function main() {
  const args = process.argv.slice(2);
  const showHelp = args.includes("--help") || args.includes("-h");
  const showVersion = args.includes("--version") || args.includes("-v");

  if (showVersion) {
    const pkg = await import("../package.json");
    console.log(`claude-usage-monitor v${pkg.version}`);
    return;
  }

  if (showHelp) {
    console.log(`
claude-usage-monitor - Claude Code token usage dashboard

Usage:
  npx claude-usage-monitor [options]

Options:
  -h, --help     Show this help message
  -v, --version  Show version number
  --info         Show database and session info

For the full dashboard experience, download the desktop app from:
https://github.com/adamferguson/claude-usage-monitor/releases

The desktop app provides:
  - Interactive dashboard with charts and insights
  - System tray integration with quick stats
  - Real-time usage tracking
  - Auto-updates
`);
    return;
  }

  const showInfo = args.includes("--info");

  console.log("Claude Usage Monitor\n");

  // Check if Claude projects directory exists
  if (!existsSync(CLAUDE_PROJECTS)) {
    console.log("No Claude Code projects found at ~/.claude/projects/");
    console.log("Make sure you have Claude Code installed and have run some sessions.");
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
    console.log("\nRun the desktop app to initialize the database and sync your sessions.");
  }

  if (showInfo) {
    console.log("\nFor detailed analytics, use the desktop app.");
  }

  console.log("\nDownload the desktop app:");
  console.log("https://github.com/adamferguson/claude-usage-monitor/releases");
}

main().catch(console.error);
