import * as path from "node:path"

/**
 * Pure utility functions for parsing Claude JSONL data.
 * Extracted for testability.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type BashCommandCategory =
  | "git"
  | "package_manager"
  | "build_test"
  | "file_ops"
  | "other";

/** Extract text preview from content blocks, truncated to 500 chars */
export const extractPreview = (
  content: ReadonlyArray<Record<string, unknown>>,
): string | null => {
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text.slice(0, 500)
    }
  }
  return null
}

/** Count total characters in thinking blocks */
export const countThinkingChars = (
  content: ReadonlyArray<Record<string, unknown>>,
): number => {
  let total = 0
  for (const block of content) {
    if (block.type === "thinking" && typeof block.thinking === "string") {
      total += block.thinking.length
    }
  }
  return total
}

/** Extract target path from tool input based on tool name */
export const extractTargetPath = (
  toolName: string,
  input: unknown,
): string | null => {
  if (typeof input !== "object" || input === null) return null
  const obj = input as Record<string, unknown>
  if (toolName === "Read" || toolName === "Edit" || toolName === "Write") {
    return typeof obj.file_path === "string" ? obj.file_path : null
  }
  if (toolName === "Glob") {
    return typeof obj.pattern === "string" ? obj.pattern : null
  }
  if (toolName === "Grep") {
    return typeof obj.path === "string" ? obj.path : null
  }
  return null
}

/** Extract error content from various formats, truncated to 500 chars */
export const extractErrorContent = (content: unknown): string | undefined => {
  if (typeof content === "string") return content.slice(0, 500)
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "object" && item !== null && "text" in item) {
        return String(item.text).slice(0, 500)
      }
    }
  }
  return undefined
}

/** Safe JSON parse - returns null for malformed lines */
export const safeJsonParse = (
  line: string,
): Record<string, unknown> | null => {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Extract file extension from a file path */
export const extractFileExtension = (filePath: string): string => {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return ext || ""
}

/** Categorize a bash command by its primary purpose */
export const categorizeBashCommand = (command: string): BashCommandCategory => {
  const cmd = command.trim().toLowerCase()
  const firstWord = cmd.split(/\s+/)[0] ?? ""

  // Git commands
  if (firstWord === "git" || firstWord === "jj" || firstWord === "gh") {
    return "git"
  }

  // Package managers (comprehensive list) - note: go is in buildTest, not here
  const pkgManagers = ["npm", "yarn", "pnpm", "bun", "pip", "pip3", "cargo", "composer", "gem", "bundle", "brew", "apt", "apt-get"]
  if (pkgManagers.includes(firstWord)) {
    return "package_manager"
  }

  // Build/test commands
  const buildTest = ["make", "cmake", "ninja", "gradle", "mvn", "ant", "tsc", "esbuild", "vite", "webpack", "jest", "vitest", "pytest", "cargo", "go"]
  if (buildTest.includes(firstWord)) {
    return "build_test"
  }
  // Also check for test/build subcommands
  if (cmd.includes("test") || cmd.includes("build") || cmd.includes("lint") || cmd.includes("check") || cmd.includes("compile")) {
    return "build_test"
  }

  // File operations (that shouldn't use Bash but sometimes do)
  const fileOps = ["ls", "cat", "head", "tail", "cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown", "find", "locate", "tree", "du", "df", "grep", "rg"]
  if (fileOps.includes(firstWord)) {
    return "file_ops"
  }

  return "other"
}

/** Extract slash command name from user message text */
export const extractSlashCommand = (text: string): string => {
  const match = text.match(/^\/([a-zA-Z0-9_-]+)/)
  return match ? match[1]! : ""
}

/** Map tool name to file operation type */
export const toolToOperation = (toolName: string): string | null => {
  switch (toolName) {
    case "Read":
      return "read"
    case "Write":
      return "write"
    case "Edit":
      return "edit"
    case "Glob":
      return "glob"
    case "Grep":
      return "grep"
    default:
      return null
  }
}

/**
 * Detect system-injected content that shouldn't be treated as user prompts.
 * Claude Code uses the "user" role for tool results, system tags, and subagent
 * instructions - this filters those out to capture only genuine human prompts.
 *
 * Note: This is intentionally conservative to avoid false positives. We only
 * detect patterns that are definitively system-generated.
 *
 * Metadata-based filtering (isMeta, isCompactSummary) happens in parser.ts
 * before this function is called. This pattern matching is a fallback for
 * content not caught by metadata flags (e.g., task-notification tags).
 */
export const isSystemContent = (text: string): boolean => {
  const trimmed = text.trimStart()
  // XML-like system tags injected by Claude Code
  // (task-notification is NOT marked by isMeta flag, so we must detect it here)
  if (trimmed.startsWith("<task-notification>")) return true
  if (trimmed.startsWith("<system-reminder>")) return true
  if (trimmed.startsWith("<hook-output>")) return true
  if (trimmed.startsWith("<new-diagnostics>")) return true
  if (trimmed.startsWith("<auto-memory-update>")) return true
  // Context compaction continuation prefix (fallback if isCompactSummary not checked)
  if (trimmed.startsWith("This session is being continued from")) return true
  return false
}
