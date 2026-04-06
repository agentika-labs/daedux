import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Build augmented PATH for GUI app context.
 * macOS GUI apps launched from Finder/dock don't inherit the user's shell PATH,
 * they only get the minimal system PATH (/usr/bin:/bin:/usr/sbin:/sbin).
 * This prepends common user binary locations where tools like `claude` are installed.
 */
export const getAugmentedPath = (): string => {
  const home = homedir();
  const systemPath = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";

  // Directories to prepend (if they exist)
  const candidates = [
    join(home, ".local", "bin"), // claude default install location
    "/opt/homebrew/bin", // Homebrew (Apple Silicon)
    "/usr/local/bin", // Homebrew (Intel) / common utilities
    join(home, ".bun", "bin"), // Bun global installs
    join(home, ".cargo", "bin"), // Rust/Cargo tools
  ];

  const existing = candidates.filter(existsSync);
  return [...existing, systemPath].join(":");
};

/**
 * Get env object with augmented PATH for spawning CLI tools.
 * Also sets CLAUDECODE="" to prevent nested Claude Code session issues.
 */
export const getCliSpawnEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  CLAUDECODE: "",
  PATH: getAugmentedPath(),
});
