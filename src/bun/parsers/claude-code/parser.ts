import { Effect } from "effect";

import type * as schema from "../../db/schema";
import { ParseError } from "../../errors";
import { cacheHitRatio } from "../../metrics";
import {
  extractPreview,
  countThinkingChars,
  extractTargetPath,
  extractErrorContent,
  safeJsonParse,
  extractFileExtension,
  categorizeBashCommand,
  extractSlashCommand,
  toolToOperation,
  isSystemContent,
} from "../../utils/parsing";
import { getPricing } from "../../utils/pricing";
import type { HarnessParser, ParserInput, ParsedRecords } from "../types";
import { discoverClaudeCodeSessions } from "./discovery";

// ─── Streaming Line Reader ───────────────────────────────────────────────────

/**
 * Streams lines from a file without loading it all into memory.
 * Buffers partial lines across chunk boundaries and collects complete lines.
 * Memory: O(max line size) instead of O(file size).
 */
const streamLinesFromFile = async (filePath: string): Promise<string[]> => {
  const file = Bun.file(filePath);
  const stream = file.stream();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });

    // Collect complete lines
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        lines.push(line);
      }
    }
  }

  // Flush any remaining content
  const remaining = buffer.trim();
  if (remaining) {
    lines.push(remaining);
  }

  return lines;
};

// ─── Parse Session Implementation ───────────────────────────────────────────

/**
 * Parse a Claude Code session file into database records.
 * Single-pass streaming parser that builds all records efficiently.
 */
const parseClaudeCodeSession = (
  input: ParserInput
): Effect.Effect<ParsedRecords | null, ParseError> =>
  Effect.gen(function* () {
    // Stream lines from file (memory efficient - no full file load)
    const lines = yield* Effect.tryPromise({
      catch: (cause) => new ParseError({ cause, filePath: input.filePath }),
      try: () => streamLinesFromFile(input.filePath),
    });

    if (lines.length === 0) {
      return null;
    }

    // Accumulators - built directly as we stream
    const queries: schema.NewQuery[] = [];
    const toolUses: schema.NewToolUse[] = [];
    const fileOperations: schema.NewFileOperation[] = [];
    const hookEvents: schema.NewHookEvent[] = [];
    const bashCommands: schema.NewBashCommand[] = [];
    const apiErrors: schema.NewApiError[] = [];
    const skillInvocations: schema.NewSkillInvocation[] = [];
    const agentSpawns: schema.NewAgentSpawn[] = [];
    const slashCommands: schema.NewSlashCommand[] = [];
    const contextWindowUsage: schema.NewContextWindowUsage[] = [];
    const prLinks: schema.NewPrLink[] = [];
    const toolResultMap = new Map<
      string,
      { durationMs?: number; isError: boolean; errorContent?: string }
    >();

    // Track pending tool uses for deferred error resolution
    const pendingToolUses: {
      toolUse: schema.NewToolUse;
      apiToolId: string;
    }[] = [];

    // Session aggregates
    let startTime: number | null = null;
    let endTime: number | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let totalFullInputCost = 0;
    let totalActualInputCost = 0;
    let displayName: string | null = null;
    let cwd: string | null = null;
    let version: string | null = null;
    let queryIndex = 0;
    let lastUserPreview: string | null = null;

    // Extended tracking
    let compactions = 0;
    let cumulativeTokens = 0;
    let turnCount = 0;
    let totalEphemeral5mTokens = 0;
    let totalEphemeral1hTokens = 0;

    // Single pass through all entries
    for (const line of lines) {
      const obj = safeJsonParse(line);
      if (!obj) {
        continue;
      }

      const type = obj.type as string | undefined;
      const timestamp = obj.timestamp as string | undefined;
      const timestampMs = timestamp
        ? new Date(timestamp).getTime()
        : Date.now();

      // Track time range
      if (timestamp) {
        const ts = new Date(timestamp).getTime();
        if (!startTime || ts < startTime) {
          startTime = ts;
        }
        if (!endTime || ts > endTime) {
          endTime = ts;
        }
      }

      // Extract metadata from any entry that has it
      if (obj.cwd && !cwd) {
        cwd = obj.cwd as string;
      }
      if (obj.version && !version) {
        version = obj.version as string;
      }

      // ─── System entries (API errors, compactions) ──────────────────────────
      if (type === "system") {
        const subtype = obj.subtype as string | undefined;

        if (subtype === "compact_boundary") {
          compactions++;
        }

        if (subtype === "api_error") {
          apiErrors.push({
            errorMessage: (obj.message as string)?.slice(0, 500) ?? null,
            errorType: (obj.error_type as string) ?? "unknown",
            sessionId: input.sessionId,
            statusCode: (obj.status_code as number) ?? null,
            timestamp: timestampMs,
          });
        }
      }

      // ─── Progress entries (hooks) ──────────────────────────────────────────
      const progressData = (obj.data ?? obj.content) as
        | Record<string, unknown>
        | undefined;
      if (type === "progress" && progressData) {
        if (progressData.type === "hook_progress" && progressData.hookEvent) {
          hookEvents.push({
            command: (progressData.command as string) ?? null,
            durationMs: (progressData.durationMs as number) ?? null,
            exitCode: (progressData.exitCode as number) ?? null,
            hookName: (progressData.hookName as string) ?? null,
            hookType: (progressData.hookEvent as string) ?? "unknown",
            sessionId: input.sessionId,
            timestamp: timestampMs,
            toolName: (progressData.toolName as string) ?? null,
          });
        }
      }

      // ─── Human/user messages ───────────────────────────────────────────────
      if ((type === "user" || type === "human") && obj.message) {
        if (obj.isMeta === true || obj.isCompactSummary === true) {
          const message = obj.message as Record<string, unknown>;
          const rawContent = message.content;
          const content: Record<string, unknown>[] = Array.isArray(rawContent)
            ? (rawContent as Record<string, unknown>[])
            : [];

          for (const block of content) {
            if (block.type === "tool_result") {
              const toolUseId = block.tool_use_id as string;
              const isError = block.is_error === true;
              toolResultMap.set(toolUseId, {
                errorContent: isError
                  ? extractErrorContent(block.content)
                  : undefined,
                isError,
              });
            }
          }
          continue;
        }

        const message = obj.message as Record<string, unknown>;
        const rawContent = message.content;
        const content: Record<string, unknown>[] = Array.isArray(rawContent)
          ? (rawContent as Record<string, unknown>[])
          : typeof rawContent === "string"
            ? [{ type: "text", text: rawContent }]
            : [];

        const hasTextBlock = content.some((b) => b.type === "text");
        const hasOnlyToolResults =
          content.length > 0 && content.every((b) => b.type === "tool_result");

        if (hasTextBlock && !hasOnlyToolResults) {
          const preview = extractPreview(content);
          if (preview && !isSystemContent(preview)) {
            lastUserPreview = preview;
            turnCount++;
            if (!displayName) {
              displayName = preview.slice(0, 200);
            }
          }
        }

        const textContent = content.find((b) => b.type === "text");
        if (textContent && typeof textContent.text === "string") {
          const { text } = textContent;
          if (text.startsWith("/")) {
            const command = extractSlashCommand(text);
            if (command) {
              slashCommands.push({
                command,
                sessionId: input.sessionId,
                timestamp: timestampMs,
              });
            }
          }
        }

        for (const block of content) {
          if (block.type === "tool_result") {
            const toolUseId = block.tool_use_id as string;
            const isError = block.is_error === true;
            toolResultMap.set(toolUseId, {
              errorContent: isError
                ? extractErrorContent(block.content)
                : undefined,
              isError,
            });
          }
        }
      }

      // ─── Assistant responses ───────────────────────────────────────────────
      if (type === "assistant" && obj.message) {
        const message = obj.message as Record<string, unknown>;
        const usage = (message.usage ?? {}) as Record<string, number>;
        const content = (message.content ?? []) as Record<string, unknown>[];
        const model = (message.model ?? "unknown") as string;

        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheWrite = usage.cache_creation_input_tokens ?? 0;

        const cacheCreation = (usage.cache_creation ?? {}) as Record<
          string,
          number
        >;
        const ephemeral5m = cacheCreation.ephemeral_5m_input_tokens ?? 0;
        const ephemeral1h = cacheCreation.ephemeral_1h_input_tokens ?? 0;

        const pricing = getPricing(model);
        const cost =
          (inputTokens * pricing.inputPerMTok) / 1_000_000 +
          (outputTokens * pricing.outputPerMTok) / 1_000_000 +
          (cacheRead * pricing.inputPerMTok * pricing.cacheReadMultiplier) /
            1_000_000 +
          (cacheWrite * pricing.inputPerMTok * pricing.cacheWriteMultiplier) /
            1_000_000;
        const fullInputCost =
          ((inputTokens + cacheRead + cacheWrite) * pricing.inputPerMTok) /
          1_000_000;
        const actualInputCost =
          (inputTokens * pricing.inputPerMTok) / 1_000_000 +
          (cacheRead * pricing.inputPerMTok * pricing.cacheReadMultiplier) /
            1_000_000 +
          (cacheWrite * pricing.inputPerMTok * pricing.cacheWriteMultiplier) /
            1_000_000;

        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCacheRead += cacheRead;
        totalCacheWrite += cacheWrite;
        totalCost += cost;
        totalFullInputCost += fullInputCost;
        totalActualInputCost += actualInputCost;
        totalEphemeral5mTokens += ephemeral5m;
        totalEphemeral1hTokens += ephemeral1h;

        cumulativeTokens += inputTokens + cacheRead + cacheWrite;
        const hitRatio = cacheHitRatio({
          cacheRead,
          cacheWrite,
          uncachedInput: inputTokens,
        });

        contextWindowUsage.push({
          cacheHitRatio: hitRatio,
          costThisQuery: cost,
          cumulativeTokens,
          queryIndex,
          sessionId: input.sessionId,
        });

        const queryId = `${input.sessionId}:${queryIndex}`;
        queries.push({
          assistantPreview: extractPreview(content),
          cacheRead,
          cacheWrite,
          cost,
          ephemeral1hTokens: ephemeral1h,
          ephemeral5mTokens: ephemeral5m,
          id: queryId,
          inputTokens,
          model,
          outputTokens,
          queryIndex,
          sessionId: input.sessionId,
          thinkingChars: countThinkingChars(content),
          timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(),
          userMessagePreview: lastUserPreview,
        });

        for (const block of content) {
          if (block.type === "tool_use") {
            const apiToolId = block.id as string;
            const toolName = block.name as string;
            const toolInput = block.input as
              | Record<string, unknown>
              | undefined;

            const caller = block.caller as Record<string, unknown> | undefined;
            const callerType = (caller?.type as string) ?? null;

            const globalToolId = `${input.sessionId}:${apiToolId}`;
            const targetPath = extractTargetPath(toolName, toolInput);

            const toolUse: schema.NewToolUse = {
              id: globalToolId,
              queryId,
              sessionId: input.sessionId,
              toolName,
              inputPreview: JSON.stringify(toolInput).slice(0, 500),
              durationMs: null,
              hasError: false,
              errorMessage: null,
              targetPath,
              callerType,
            };
            toolUses.push(toolUse);
            pendingToolUses.push({ apiToolId, toolUse });

            const operation = toolToOperation(toolName);
            if (operation && targetPath) {
              fileOperations.push({
                fileExtension: extractFileExtension(targetPath),
                filePath: targetPath,
                operation,
                sessionId: input.sessionId,
                timestamp: timestampMs,
                toolUseId: globalToolId,
              });
            }

            if (toolName === "Bash" && toolInput?.command) {
              const command = String(toolInput.command);
              bashCommands.push({
                category: categorizeBashCommand(command),
                command: command.slice(0, 1000),
                description: toolInput.description
                  ? String(toolInput.description).slice(0, 200)
                  : null,
                queryId,
                sessionId: input.sessionId,
                timestamp: timestampMs,
              });
            }

            if (toolName === "Skill" && toolInput?.skill) {
              skillInvocations.push({
                args: toolInput.args
                  ? String(toolInput.args).slice(0, 500)
                  : null,
                queryIndex,
                sessionId: input.sessionId,
                skillName: String(toolInput.skill),
                timestamp: timestampMs,
              });
            }

            if (toolName === "Task" && toolInput?.subagent_type) {
              agentSpawns.push({
                agentType: String(toolInput.subagent_type),
                description: toolInput.description
                  ? String(toolInput.description).slice(0, 200)
                  : null,
                queryIndex,
                sessionId: input.sessionId,
                timestamp: timestampMs,
              });
            }
          }
        }

        queryIndex++;
        lastUserPreview = null;
      }

      if (type === "summary" && obj.summary) {
        const summary = String(obj.summary);
        if (summary.length > 0 && summary.length < 200) {
          displayName = summary;
        }
      }

      if (type === "pr-link") {
        const prNumber = obj.prNumber as number | undefined;
        const prUrl = obj.prUrl as string | undefined;
        const prRepository = obj.prRepository as string | undefined;

        if (prNumber != null && prUrl && prRepository) {
          prLinks.push({
            prNumber,
            prRepository,
            prUrl,
            sessionId: input.sessionId,
            timestamp: timestampMs,
          });
        }
      }
    }

    // ─── Deferred Error Resolution ────────────────────────────────────────────
    for (const { toolUse, apiToolId } of pendingToolUses) {
      const result = toolResultMap.get(apiToolId);
      if (result) {
        toolUse.hasError = result.isError;
        toolUse.errorMessage = result.errorContent ?? null;
      }
    }

    const savedByCaching = Math.max(
      0,
      totalFullInputCost - totalActualInputCost
    );

    const session: schema.NewSession = {
      compactions,
      cwd,
      displayName,
      durationMs: startTime && endTime ? endTime - startTime : null,
      endTime,
      gitBranch: null,
      harness: input.harness,
      isSubagent: input.isSubagent,
      parentSessionId: input.parentSessionId,
      projectPath: input.project,
      queryCount: queries.length,
      savedByCaching,
      sessionId: input.sessionId,
      slug: null,
      startTime: startTime ?? Date.now(),
      toolUseCount: toolUses.length,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      totalEphemeral1hTokens,
      totalEphemeral5mTokens,
      totalInputTokens,
      totalOutputTokens,
      turnCount,
      version,
    };

    return {
      agentSpawns,
      apiErrors,
      bashCommands,
      contextWindowUsage,
      fileOperations,
      hookEvents,
      prLinks,
      queries,
      session,
      skillInvocations,
      slashCommands,
      toolUses,
    };
  });

// ─── Claude Code Parser Service ──────────────────────────────────────────────

/**
 * Effect Service for Claude Code JSONL session files.
 * Satisfies HarnessParser interface for pluggable parser architecture.
 */
export class ClaudeCodeParserService extends Effect.Service<ClaudeCodeParserService>()(
  "ClaudeCodeParser",
  {
    scoped: Effect.gen(function* () {
      return {
        harness: "claude-code" as const,
        name: "Claude Code",
        discoverSessions: (basePath?: string) =>
          discoverClaudeCodeSessions(basePath),
        canHandle: (filePath: string) =>
          filePath.includes("/.claude/projects/") &&
          filePath.endsWith(".jsonl"),
        parseSession: parseClaudeCodeSession,
      } satisfies HarnessParser;
    }),
  }
) {}
