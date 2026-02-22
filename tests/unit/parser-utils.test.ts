import { describe, expect, test } from "bun:test"
import {
  categorizeBashCommand,
  countThinkingChars,
  extractErrorContent,
  extractFileExtension,
  extractPreview,
  extractSlashCommand,
  extractTargetPath,
  safeJsonParse,
  toolToOperation,
} from "../../src/utils/parser-utils"

describe("extractPreview", () => {
  test("extracts text from first text block", () => {
    const content = [{ type: "text", text: "Hello world" }]
    expect(extractPreview(content)).toBe("Hello world")
  })

  test("skips non-text blocks", () => {
    const content = [
      { type: "tool_use", id: "123" },
      { type: "text", text: "Found it" },
    ]
    expect(extractPreview(content)).toBe("Found it")
  })

  test("returns null for empty array", () => {
    expect(extractPreview([])).toBeNull()
  })

  test("returns null when no text blocks", () => {
    const content = [
      { type: "tool_use", id: "123" },
      { type: "thinking", thinking: "Hmm..." },
    ]
    expect(extractPreview(content)).toBeNull()
  })

  test("truncates text to 500 characters", () => {
    const longText = "x".repeat(600)
    const content = [{ type: "text", text: longText }]
    expect(extractPreview(content)).toHaveLength(500)
  })

  test("handles text exactly at 500 characters", () => {
    const exactText = "x".repeat(500)
    const content = [{ type: "text", text: exactText }]
    expect(extractPreview(content)).toHaveLength(500)
  })

  test("returns first text block only", () => {
    const content = [
      { type: "text", text: "First" },
      { type: "text", text: "Second" },
    ]
    expect(extractPreview(content)).toBe("First")
  })

  test("handles non-string text field", () => {
    const content = [{ type: "text", text: 12345 }]
    expect(extractPreview(content)).toBeNull()
  })
})

describe("countThinkingChars", () => {
  test("counts characters in single thinking block", () => {
    const content = [{ type: "thinking", thinking: "Let me think..." }]
    expect(countThinkingChars(content)).toBe(15)
  })

  test("sums characters across multiple thinking blocks", () => {
    const content = [
      { type: "thinking", thinking: "First thought" }, // 13
      { type: "text", text: "Some output" },
      { type: "thinking", thinking: "Second thought" }, // 14
    ]
    expect(countThinkingChars(content)).toBe(27)
  })

  test("returns 0 for no thinking blocks", () => {
    const content = [
      { type: "text", text: "Just text" },
      { type: "tool_use", id: "123" },
    ]
    expect(countThinkingChars(content)).toBe(0)
  })

  test("returns 0 for empty array", () => {
    expect(countThinkingChars([])).toBe(0)
  })

  test("handles empty thinking string", () => {
    const content = [{ type: "thinking", thinking: "" }]
    expect(countThinkingChars(content)).toBe(0)
  })

  test("ignores non-string thinking field", () => {
    const content = [{ type: "thinking", thinking: 12345 }]
    expect(countThinkingChars(content)).toBe(0)
  })
})

describe("extractTargetPath", () => {
  describe("Read/Edit/Write tools", () => {
    test("extracts file_path for Read", () => {
      const input = { file_path: "/path/to/file.ts" }
      expect(extractTargetPath("Read", input)).toBe("/path/to/file.ts")
    })

    test("extracts file_path for Edit", () => {
      const input = { file_path: "/path/to/file.ts", old_string: "x" }
      expect(extractTargetPath("Edit", input)).toBe("/path/to/file.ts")
    })

    test("extracts file_path for Write", () => {
      const input = { file_path: "/path/to/file.ts", content: "..." }
      expect(extractTargetPath("Write", input)).toBe("/path/to/file.ts")
    })

    test("returns null when file_path missing", () => {
      const input = { content: "..." }
      expect(extractTargetPath("Read", input)).toBeNull()
    })
  })

  describe("Glob tool", () => {
    test("extracts pattern for Glob", () => {
      const input = { pattern: "**/*.ts" }
      expect(extractTargetPath("Glob", input)).toBe("**/*.ts")
    })

    test("returns null when pattern missing", () => {
      const input = { path: "/some/path" }
      expect(extractTargetPath("Glob", input)).toBeNull()
    })
  })

  describe("Grep tool", () => {
    test("extracts path for Grep", () => {
      const input = { pattern: "TODO", path: "/src" }
      expect(extractTargetPath("Grep", input)).toBe("/src")
    })

    test("returns null when path missing", () => {
      const input = { pattern: "TODO" }
      expect(extractTargetPath("Grep", input)).toBeNull()
    })
  })

  describe("edge cases", () => {
    test("returns null for unknown tool", () => {
      const input = { file_path: "/path/to/file.ts" }
      expect(extractTargetPath("Unknown", input)).toBeNull()
    })

    test("returns null for null input", () => {
      expect(extractTargetPath("Read", null)).toBeNull()
    })

    test("returns null for non-object input", () => {
      expect(extractTargetPath("Read", "string")).toBeNull()
      expect(extractTargetPath("Read", 123)).toBeNull()
      expect(extractTargetPath("Read", undefined)).toBeNull()
    })

    test("returns null for non-string file_path", () => {
      const input = { file_path: 12345 }
      expect(extractTargetPath("Read", input)).toBeNull()
    })
  })
})

describe("extractErrorContent", () => {
  test("extracts string content directly", () => {
    expect(extractErrorContent("Error message")).toBe("Error message")
  })

  test("truncates long string to 500 chars", () => {
    const longError = "e".repeat(600)
    expect(extractErrorContent(longError)).toHaveLength(500)
  })

  test("extracts text from array of objects", () => {
    const content = [{ type: "text", text: "Error details" }]
    expect(extractErrorContent(content)).toBe("Error details")
  })

  test("returns undefined for empty array", () => {
    expect(extractErrorContent([])).toBeUndefined()
  })

  test("returns undefined for null", () => {
    expect(extractErrorContent(null)).toBeUndefined()
  })

  test("returns undefined for object without text", () => {
    const content = [{ type: "other", value: "something" }]
    expect(extractErrorContent(content)).toBeUndefined()
  })

  test("handles nested array with multiple items", () => {
    const content = [
      { type: "tool_use", id: "123" },
      { type: "text", text: "Found error" },
    ]
    expect(extractErrorContent(content)).toBe("Found error")
  })

  test("truncates text from array to 500 chars", () => {
    const content = [{ type: "text", text: "x".repeat(600) }]
    expect(extractErrorContent(content)).toHaveLength(500)
  })
})

describe("safeJsonParse", () => {
  test("parses valid JSON", () => {
    const result = safeJsonParse('{"key": "value"}')
    expect(result).toEqual({ key: "value" })
  })

  test("parses nested JSON", () => {
    const result = safeJsonParse('{"a": {"b": [1, 2, 3]}}')
    expect(result).toEqual({ a: { b: [1, 2, 3] } })
  })

  test("returns null for malformed JSON", () => {
    expect(safeJsonParse("not json")).toBeNull()
    expect(safeJsonParse("{invalid}")).toBeNull()
    expect(safeJsonParse('{"unterminated')).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(safeJsonParse("")).toBeNull()
  })

  test("parses JSON arrays as Record", () => {
    // Note: Arrays are valid JSON but the return type is Record<string, unknown>
    // The type coercion works because arrays are objects in JS
    const result = safeJsonParse("[1, 2, 3]")
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(3)
  })

  test("parses JSON primitives", () => {
    // null parses correctly
    expect(safeJsonParse("null")).toBeNull()
    // Numbers and strings parse but aren't Record<string, unknown>
    // These are technically type-unsafe but work at runtime
    const num = safeJsonParse("123")
    expect(num).toBe(123)
    const str = safeJsonParse('"string"')
    expect(str).toBe("string")
  })
})

describe("extractFileExtension", () => {
  test("extracts .ts extension", () => {
    expect(extractFileExtension("/path/to/file.ts")).toBe("ts")
  })

  test("extracts .js extension", () => {
    expect(extractFileExtension("/path/to/file.js")).toBe("js")
  })

  test("extracts complex extensions", () => {
    expect(extractFileExtension("file.test.ts")).toBe("ts")
    expect(extractFileExtension("file.d.ts")).toBe("ts")
  })

  test("returns empty string for no extension", () => {
    expect(extractFileExtension("/path/to/Makefile")).toBe("")
    expect(extractFileExtension("README")).toBe("")
  })

  test("converts extension to lowercase", () => {
    expect(extractFileExtension("/path/to/file.TS")).toBe("ts")
    expect(extractFileExtension("/path/to/file.JSON")).toBe("json")
  })

  test("handles dot files", () => {
    // path.extname(".gitignore") returns "" (no extension)
    expect(extractFileExtension(".gitignore")).toBe("")
    // path.extname(".env.local") returns ".local"
    expect(extractFileExtension(".env.local")).toBe("local")
  })

  test("handles paths with dots in directories", () => {
    expect(extractFileExtension("/path.with.dots/file.ts")).toBe("ts")
  })

  test("handles empty string", () => {
    expect(extractFileExtension("")).toBe("")
  })
})

describe("categorizeBashCommand", () => {
  describe("git category", () => {
    test("categorizes git commands", () => {
      expect(categorizeBashCommand("git status")).toBe("git")
      expect(categorizeBashCommand("git commit -m 'message'")).toBe("git")
      expect(categorizeBashCommand("git push origin main")).toBe("git")
    })

    test("categorizes jj commands", () => {
      expect(categorizeBashCommand("jj log")).toBe("git")
      expect(categorizeBashCommand("jj new -m 'message'")).toBe("git")
      expect(categorizeBashCommand("jj squash")).toBe("git")
    })

    test("categorizes gh commands", () => {
      expect(categorizeBashCommand("gh pr list")).toBe("git")
      expect(categorizeBashCommand("gh issue create")).toBe("git")
    })
  })

  describe("package_manager category", () => {
    test("categorizes npm commands", () => {
      expect(categorizeBashCommand("npm install lodash")).toBe("package_manager")
      expect(categorizeBashCommand("npm run build")).toBe("package_manager")
    })

    test("categorizes yarn commands", () => {
      expect(categorizeBashCommand("yarn add react")).toBe("package_manager")
      expect(categorizeBashCommand("yarn install")).toBe("package_manager")
    })

    test("categorizes pnpm commands", () => {
      expect(categorizeBashCommand("pnpm add effect")).toBe("package_manager")
    })

    test("categorizes bun commands", () => {
      expect(categorizeBashCommand("bun add effect")).toBe("package_manager")
      expect(categorizeBashCommand("bun install")).toBe("package_manager")
    })

    test("categorizes pip commands", () => {
      expect(categorizeBashCommand("pip install requests")).toBe(
        "package_manager",
      )
    })

    test("categorizes cargo as package_manager", () => {
      expect(categorizeBashCommand("cargo add serde")).toBe("package_manager")
    })

    test("categorizes brew commands", () => {
      expect(categorizeBashCommand("brew install node")).toBe("package_manager")
    })

    test("categorizes apt commands", () => {
      expect(categorizeBashCommand("apt install vim")).toBe("package_manager")
      expect(categorizeBashCommand("apt-get update")).toBe("package_manager")
    })
  })

  describe("build_test category", () => {
    test("categorizes make commands", () => {
      expect(categorizeBashCommand("make build")).toBe("build_test")
      expect(categorizeBashCommand("cmake ..")).toBe("build_test")
    })

    test("categorizes tsc commands", () => {
      expect(categorizeBashCommand("tsc --noEmit")).toBe("build_test")
    })

    test("categorizes bundler commands", () => {
      expect(categorizeBashCommand("webpack --mode production")).toBe(
        "build_test",
      )
      expect(categorizeBashCommand("vite build")).toBe("build_test")
      expect(categorizeBashCommand("esbuild src/index.ts")).toBe("build_test")
    })

    test("categorizes test runner commands", () => {
      expect(categorizeBashCommand("jest")).toBe("build_test")
      expect(categorizeBashCommand("vitest run")).toBe("build_test")
      expect(categorizeBashCommand("pytest tests/")).toBe("build_test")
    })

    test("categorizes by keyword 'test' (when first word is not package manager)", () => {
      // Note: "bun test" and "npm test" are categorized as package_manager
      // because the first word matches first. Keyword matching is fallback.
      expect(categorizeBashCommand("./run-tests.sh")).toBe("build_test")
      expect(categorizeBashCommand("go test ./...")).toBe("build_test")
    })

    test("categorizes by keyword 'build' (when first word is not package manager)", () => {
      // Note: "npm run build" is categorized as package_manager
      // because npm matches first. Keyword matching is fallback.
      expect(categorizeBashCommand("./build.sh")).toBe("build_test")
    })

    test("categorizes by keyword 'compile'", () => {
      expect(categorizeBashCommand("./compile.sh")).toBe("build_test")
    })
  })

  describe("file_ops category", () => {
    test("categorizes ls commands", () => {
      expect(categorizeBashCommand("ls -la")).toBe("file_ops")
      expect(categorizeBashCommand("ls /path")).toBe("file_ops")
    })

    test("categorizes cat commands", () => {
      expect(categorizeBashCommand("cat file.txt")).toBe("file_ops")
    })

    test("categorizes head/tail commands", () => {
      expect(categorizeBashCommand("head -n 10 file.txt")).toBe("file_ops")
      expect(categorizeBashCommand("tail -f log.txt")).toBe("file_ops")
    })

    test("categorizes find commands", () => {
      expect(categorizeBashCommand("find . -name '*.ts'")).toBe("file_ops")
    })

    test("categorizes grep/rg commands", () => {
      expect(categorizeBashCommand("grep -r 'pattern' .")).toBe("file_ops")
      expect(categorizeBashCommand("rg 'TODO' src/")).toBe("file_ops")
    })

    test("categorizes file manipulation commands", () => {
      expect(categorizeBashCommand("cp src dest")).toBe("file_ops")
      expect(categorizeBashCommand("mv old new")).toBe("file_ops")
      expect(categorizeBashCommand("rm file.txt")).toBe("file_ops")
      expect(categorizeBashCommand("mkdir -p dir/subdir")).toBe("file_ops")
      expect(categorizeBashCommand("touch newfile.txt")).toBe("file_ops")
    })
  })

  describe("other category", () => {
    test("categorizes echo commands", () => {
      expect(categorizeBashCommand("echo hello")).toBe("other")
    })

    test("categorizes curl commands", () => {
      expect(categorizeBashCommand("curl https://api.example.com")).toBe(
        "other",
      )
    })

    test("categorizes unknown commands", () => {
      expect(categorizeBashCommand("./custom-script.sh")).toBe("other")
      expect(categorizeBashCommand("docker run nginx")).toBe("other")
    })
  })

  describe("edge cases", () => {
    test("is case insensitive", () => {
      expect(categorizeBashCommand("GIT status")).toBe("git")
      expect(categorizeBashCommand("NPM install")).toBe("package_manager")
    })

    test("trims whitespace", () => {
      expect(categorizeBashCommand("  git status  ")).toBe("git")
    })

    test("handles empty string", () => {
      expect(categorizeBashCommand("")).toBe("other")
    })
  })
})

describe("extractSlashCommand", () => {
  test("extracts simple command", () => {
    expect(extractSlashCommand("/help")).toBe("help")
  })

  test("extracts command with arguments", () => {
    expect(extractSlashCommand("/commit -m 'message'")).toBe("commit")
  })

  test("extracts command with dashes", () => {
    expect(extractSlashCommand("/review-pr")).toBe("review-pr")
  })

  test("extracts command with underscores", () => {
    expect(extractSlashCommand("/my_command")).toBe("my_command")
  })

  test("extracts command with numbers", () => {
    expect(extractSlashCommand("/test123")).toBe("test123")
  })

  test("returns empty string for no slash", () => {
    expect(extractSlashCommand("no slash here")).toBe("")
  })

  test("returns empty string for slash in middle", () => {
    expect(extractSlashCommand("path/to/file")).toBe("")
  })

  test("returns empty string for slash at end", () => {
    expect(extractSlashCommand("text/")).toBe("")
  })

  test("returns empty string for just slash", () => {
    expect(extractSlashCommand("/")).toBe("")
  })

  test("returns empty string for empty string", () => {
    expect(extractSlashCommand("")).toBe("")
  })

  test("handles slash with special chars after name", () => {
    expect(extractSlashCommand("/cmd!invalid")).toBe("cmd")
  })
})

describe("toolToOperation", () => {
  test("maps Read to read", () => {
    expect(toolToOperation("Read")).toBe("read")
  })

  test("maps Write to write", () => {
    expect(toolToOperation("Write")).toBe("write")
  })

  test("maps Edit to edit", () => {
    expect(toolToOperation("Edit")).toBe("edit")
  })

  test("maps Glob to glob", () => {
    expect(toolToOperation("Glob")).toBe("glob")
  })

  test("maps Grep to grep", () => {
    expect(toolToOperation("Grep")).toBe("grep")
  })

  test("returns null for unknown tools", () => {
    expect(toolToOperation("Bash")).toBeNull()
    expect(toolToOperation("WebFetch")).toBeNull()
    expect(toolToOperation("Unknown")).toBeNull()
  })

  test("is case sensitive", () => {
    expect(toolToOperation("read")).toBeNull()
    expect(toolToOperation("READ")).toBeNull()
  })
})
