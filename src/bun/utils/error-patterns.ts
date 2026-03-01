/**
 * Error pattern definitions and categorization utilities.
 * Used by tool-analytics and insights-analytics for bash error analysis.
 */

/** Category for bash command error classification */
export type ErrorCategory =
  | "build_test"
  | "file_ops"
  | "git"
  | "other"
  | "package_manager";

/** Error with count for aggregation */
export interface ErrorCount {
  readonly message: string;
  readonly count: number;
}

/** Raw error data from database */
export interface RawErrorCount {
  readonly errorMessage: string | null;
  readonly count: number;
}

/** Pattern and suggestion pair for fix recommendations */
interface FixPattern {
  readonly pattern: RegExp;
  readonly suggestion: string;
}

/**
 * Pattern-based fix suggestions for common bash errors by category.
 */
export const FIX_SUGGESTIONS: Record<ErrorCategory, FixPattern[]> = {
  build_test: [
    {
      pattern: /command not found/i,
      suggestion: "Install missing dependencies with `bun add -D <package>`",
    },
    {
      pattern: /ENOENT.*package\.json/i,
      suggestion: "Run from project root or initialize with `bun init`",
    },
    {
      pattern: /test.*failed|failing|failure/i,
      suggestion: "Check test output for specific assertion failures",
    },
    {
      pattern: /typescript|tsc|type.*error/i,
      suggestion: "Run `bun run typecheck` to see all type errors",
    },
    {
      pattern: /Cannot find module/i,
      suggestion: "Verify import paths and run `bun install`",
    },
    {
      pattern: /EPERM|permission denied/i,
      suggestion: "Check file permissions or avoid writing to protected paths",
    },
  ],
  file_ops: [
    {
      pattern: /ENOENT|no such file/i,
      suggestion: "Verify file path exists before operation",
    },
    {
      pattern: /EACCES|permission denied/i,
      suggestion: "Check file/directory permissions",
    },
    {
      pattern: /EEXIST|already exists/i,
      suggestion:
        "File already exists; use overwrite flag or choose different name",
    },
    {
      pattern: /EISDIR|is a directory/i,
      suggestion: "Use recursive flag for directory operations",
    },
  ],
  git: [
    {
      pattern: /not a git repository/i,
      suggestion: "Initialize with `git init` or navigate to repo root",
    },
    {
      pattern: /merge conflict/i,
      suggestion:
        "Resolve conflicts in marked files, then `git add` and commit",
    },
    {
      pattern: /nothing to commit/i,
      suggestion: "Stage changes with `git add` before committing",
    },
    {
      pattern: /already exists/i,
      suggestion: "Delete or rename existing branch before creating new one",
    },
    {
      pattern: /rejected.*non-fast-forward/i,
      suggestion: "Pull latest changes first: `git pull --rebase`",
    },
    {
      pattern: /failed to push/i,
      suggestion: "Check remote permissions and branch protection rules",
    },
  ],
  other: [
    {
      pattern: /command not found/i,
      suggestion: "Install missing command or check PATH",
    },
    {
      pattern: /timeout|timed out/i,
      suggestion: "Increase timeout or check for deadlocks",
    },
    {
      pattern: /memory|heap|out of memory/i,
      suggestion: "Increase Node memory with `--max-old-space-size`",
    },
  ],
  package_manager: [
    {
      pattern: /EACCES|permission denied/i,
      suggestion: "Avoid sudo; use a node version manager (fnm, nvm)",
    },
    {
      pattern: /ERESOLVE|peer dep/i,
      suggestion: "Try `--legacy-peer-deps` or update conflicting packages",
    },
    {
      pattern: /ENOENT.*package\.json/i,
      suggestion:
        "Initialize project with `bun init` or navigate to project root",
    },
    {
      pattern: /network|ETIMEDOUT|ENOTFOUND/i,
      suggestion:
        "Check network connection; try `--offline` if packages are cached",
    },
    {
      pattern: /integrity|checksum/i,
      suggestion: "Clear cache with `bun pm cache rm` and reinstall",
    },
  ],
};

/** Result of error categorization with all error categories */
export type CategorizedErrors = Record<ErrorCategory, ErrorCount[]>;

/**
 * Categorize errors by bash command category based on error message patterns.
 * Returns a Record<string, ErrorCount[]> to allow string indexing from database results.
 */
export function categorizeErrorsByPattern(
  errors: RawErrorCount[]
): Record<string, ErrorCount[]> {
  const result: CategorizedErrors = {
    build_test: [],
    file_ops: [],
    git: [],
    other: [],
    package_manager: [],
  };

  for (const err of errors) {
    const msg = err.errorMessage ?? "Unknown error";
    let categorized = false;

    // Try to categorize based on patterns
    if (/npm|yarn|bun|pnpm|package|install|add|remove/i.test(msg)) {
      result.package_manager.push({ count: err.count, message: msg });
      categorized = true;
    } else if (/git|commit|push|pull|merge|branch|checkout/i.test(msg)) {
      result.git.push({ count: err.count, message: msg });
      categorized = true;
    } else if (
      /test|jest|vitest|mocha|build|compile|tsc|typescript/i.test(msg)
    ) {
      result.build_test.push({ count: err.count, message: msg });
      categorized = true;
    } else if (/ENOENT|EACCES|EEXIST|file|directory|path/i.test(msg)) {
      result.file_ops.push({ count: err.count, message: msg });
      categorized = true;
    }

    if (!categorized) {
      result.other.push({ count: err.count, message: msg });
    }
  }

  return result;
}

/**
 * Get fix suggestions for errors in a category.
 * Returns up to 3 unique suggestions based on error pattern matching.
 */
export function getFixSuggestions(
  category: string,
  errors: ErrorCount[]
): string[] {
  const patterns =
    FIX_SUGGESTIONS[category as ErrorCategory] ?? FIX_SUGGESTIONS.other;
  const suggestions: string[] = [];

  for (const err of errors.slice(0, 5)) {
    for (const { pattern, suggestion } of patterns) {
      if (pattern.test(err.message) && !suggestions.includes(suggestion)) {
        suggestions.push(suggestion);
        break;
      }
    }
  }

  return suggestions.slice(0, 3);
}
