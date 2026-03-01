#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const PLATFORMS = {
  "darwin-arm64": "@agentika/daedux-darwin-arm64",
  // Future: "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"
};

const platformKey = `${process.platform}-${process.arch}`;
const pkg = PLATFORMS[platformKey];

if (!pkg) {
  console.error(`Unsupported platform: ${platformKey}`);
  console.error(`Supported: ${Object.keys(PLATFORMS).join(", ")}`);
  process.exit(1);
}

let binPath;
try {
  binPath = path.join(
    require.resolve(`${pkg}/package.json`),
    "..",
    "bin",
    "cli.ts"
  );
} catch {
  console.error(`Could not find ${pkg}. Try reinstalling.`);
  process.exit(1);
}

// Execute with Bun (daedux requires Bun runtime)
try {
  execFileSync("bun", ["run", binPath, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
} catch (error) {
  if (error.code === "ENOENT") {
    console.error("Bun is required. Install: https://bun.sh");
    process.exit(1);
  }
  process.exit(error.status ?? 1);
}
