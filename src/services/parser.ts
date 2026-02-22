import { Effect } from "effect";
import * as schema from "../db/schema";
import { getPricing } from "../utils/pricing";
import { ParseError } from "./errors";
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
} from "../utils/parsing";
import { cacheHitRatio } from "./metrics";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedRecords {
  readonly session: schema.NewSession;
  readonly queries: schema.NewQuery[];
  readonly toolUses: schema.NewToolUse[];
  // Extended records (Phase 2 additions)
  readonly fileOperations: schema.NewFileOperation[];
  readonly hookEvents: schema.NewHookEvent[];
  readonly bashCommands: schema.NewBashCommand[];
  readonly apiErrors: schema.NewApiError[];
  readonly skillInvocations: schema.NewSkillInvocation[];
  readonly agentSpawns: schema.NewAgentSpawn[];
  readonly slashCommands: schema.NewSlashCommand[];
  readonly contextWindowUsage: schema.NewContextWindowUsage[];
  readonly prLinks: schema.NewPrLink[];
}

export interface FileInfo {
  readonly filePath: string;
  readonly sessionId: string;
  readonly project: string;
  readonly isSubagent: boolean;
  readonly parentSessionId: string | null;
}

// ─── Streaming Line Reader ───────────────────────────────────────────────────

/**
 * Streams lines from a file without loading it all into memory.
 * Buffers partial lines across chunk boundaries and collects complete lines.
 * Memory: O(max line size) instead of O(file size).
 *
 * @param filePath - Path to the JSONL file
 * @returns Promise resolving to array of non-empty lines
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
      if (line) lines.push(line);
    }
  }

  // Flush any remaining content
  const remaining = buffer.trim();
  if (remaining) lines.push(remaining);

  return lines;
};

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Single-pass streaming parser for JSONL session files.
 * Builds all database records in one pass - no intermediate objects.
 * Uses streaming line reader for memory efficiency (O(max line) vs O(file size)).
 *
 * @param fileInfo - File metadata (path, sessionId, project info)
 * @returns Parsed records (session, queries, toolUses, etc.) or null for empty files
 */
export const parseSessionFile = (
  fileInfo: FileInfo,
): Effect.Effect<ParsedRecords | null, ParseError> =>
  Effect.gen(function* () {
    // Stream lines from file (memory efficient - no full file load)
    const lines = yield* Effect.tryPromise({
      try: () => streamLinesFromFile(fileInfo.filePath),
      catch: (cause) => new ParseError({ filePath: fileInfo.filePath, cause }),
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
    // (tool_result appears AFTER tool_use in JSONL, so we can't resolve errors during first pass)
    const pendingToolUses: Array<{
      toolUse: schema.NewToolUse;
      apiToolId: string;
    }> = [];

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
    // Ephemeral cache tracking
    let totalEphemeral5mTokens = 0;
    let totalEphemeral1hTokens = 0;

    // Single pass through all entries
    for (const line of lines) {
      const obj = safeJsonParse(line);
      if (!obj) continue; // Skip malformed lines

      const type = obj.type as string | undefined;
      const timestamp = obj.timestamp as string | undefined;
      const timestampMs = timestamp
        ? new Date(timestamp).getTime()
        : Date.now();

      // Track time range
      if (timestamp) {
        const ts = new Date(timestamp).getTime();
        if (!startTime || ts < startTime) startTime = ts;
        if (!endTime || ts > endTime) endTime = ts;
      }

      // Extract metadata from any entry that has it
      if (obj.cwd && !cwd) cwd = obj.cwd as string;
      if (obj.version && !version) version = obj.version as string;

      // ─── System entries (API errors, compactions) ──────────────────────────
      if (type === "system") {
        const subtype = obj.subtype as string | undefined;

        // Count compaction boundaries
        if (subtype === "compact_boundary") {
          compactions++;
        }

        // Capture API errors
        if (subtype === "api_error") {
          apiErrors.push({
            sessionId: fileInfo.sessionId,
            errorType: (obj.error_type as string) ?? "unknown",
            errorMessage: (obj.message as string)?.slice(0, 500) ?? null,
            statusCode: (obj.status_code as number) ?? null,
            timestamp: timestampMs,
          });
        }
      }

      // ─── Progress entries (hooks) ──────────────────────────────────────────
      if (type === "progress" && obj.content) {
        const content = obj.content as Record<string, unknown>;
        if (content.hookEvent) {
          hookEvents.push({
            sessionId: fileInfo.sessionId,
            hookType: (content.hookEvent as string) ?? "unknown",
            hookName: (content.hookName as string) ?? null,
            toolName: (content.toolName as string) ?? null,
            command: (content.command as string) ?? null,
            exitCode: (content.exitCode as number) ?? null,
            durationMs: (content.durationMs as number) ?? null,
            timestamp: timestampMs,
          });
        }
      }

      // ─── Human/user messages ───────────────────────────────────────────────
      if ((type === "user" || type === "human") && obj.message) {
        const message = obj.message as Record<string, unknown>;
        const rawContent = message.content;
        // Content can be string, array of blocks, or undefined - normalize to array
        const content: Array<Record<string, unknown>> = Array.isArray(
          rawContent,
        )
          ? (rawContent as Array<Record<string, unknown>>)
          : typeof rawContent === "string"
            ? [{ type: "text", text: rawContent }]
            : [];

        lastUserPreview = extractPreview(content);
        if (lastUserPreview && !displayName) {
          displayName = lastUserPreview.slice(0, 200);
        }

        // Check for slash commands in user message
        const textContent = content.find((b) => b.type === "text");
        if (textContent && typeof textContent.text === "string") {
          const text = textContent.text;
          if (text.startsWith("/")) {
            const command = extractSlashCommand(text);
            if (command) {
              slashCommands.push({
                sessionId: fileInfo.sessionId,
                command,
                timestamp: timestampMs,
              });
            }
          }
        }

        // Also capture tool results from user messages
        for (const block of content) {
          if (block.type === "tool_result") {
            const toolUseId = block.tool_use_id as string;
            const isError = block.is_error === true;
            toolResultMap.set(toolUseId, {
              isError,
              errorContent: isError
                ? extractErrorContent(block.content)
                : undefined,
            });
          }
        }
      }

      // ─── Assistant responses ───────────────────────────────────────────────
      if (type === "assistant" && obj.message) {
        const message = obj.message as Record<string, unknown>;
        const usage = (message.usage ?? {}) as Record<string, number>;
        const content = (message.content ?? []) as Array<
          Record<string, unknown>
        >;
        const model = (message.model ?? "unknown") as string;

        // Token counts
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheWrite = usage.cache_creation_input_tokens ?? 0;

        // Extract ephemeral cache tokens from nested cache_creation object
        const cacheCreation = (usage.cache_creation ?? {}) as Record<
          string,
          number
        >;
        const ephemeral5m = cacheCreation.ephemeral_5m_input_tokens ?? 0;
        const ephemeral1h = cacheCreation.ephemeral_1h_input_tokens ?? 0;

        // Calculate cost with model-specific pricing
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

        // Accumulate session totals
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCacheRead += cacheRead;
        totalCacheWrite += cacheWrite;
        totalCost += cost;
        totalFullInputCost += fullInputCost;
        totalActualInputCost += actualInputCost;
        totalEphemeral5mTokens += ephemeral5m;
        totalEphemeral1hTokens += ephemeral1h;

        // Track cumulative tokens for context window usage
        cumulativeTokens += inputTokens + cacheRead + cacheWrite;
        const hitRatio = cacheHitRatio({
          uncachedInput: inputTokens,
          cacheRead,
          cacheWrite,
        });

        contextWindowUsage.push({
          sessionId: fileInfo.sessionId,
          queryIndex,
          cumulativeTokens,
          cacheHitRatio: hitRatio,
          costThisQuery: cost,
        });

        // Build query record directly
        const queryId = `${fileInfo.sessionId}:${queryIndex}`;
        queries.push({
          id: queryId,
          sessionId: fileInfo.sessionId,
          queryIndex,
          timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(),
          model,
          inputTokens,
          outputTokens,
          cacheRead,
          cacheWrite,
          cost,
          userMessagePreview: lastUserPreview,
          assistantPreview: extractPreview(content),
          thinkingChars: countThinkingChars(content),
          ephemeral5mTokens: ephemeral5m,
          ephemeral1hTokens: ephemeral1h,
        });

        // Extract tool uses from this response
        for (const block of content) {
          if (block.type === "tool_use") {
            const apiToolId = block.id as string;
            const toolName = block.name as string;
            const input = block.input as Record<string, unknown> | undefined;

            // Extract caller type: "direct" (user-requested) | "inference" (AI-decided)
            const caller = block.caller as Record<string, unknown> | undefined;
            const callerType = (caller?.type as string) ?? null;

            // Prefix tool_use ID with sessionId to ensure global uniqueness
            // (API tool IDs like "toolu_01ABC123" are only unique per-request)
            const globalToolId = `${fileInfo.sessionId}:${apiToolId}`;

            const targetPath = extractTargetPath(toolName, input);

            // Create tool use with placeholder error fields (resolved after parsing completes)
            const toolUse: schema.NewToolUse = {
              id: globalToolId,
              queryId,
              sessionId: fileInfo.sessionId,
              toolName,
              inputPreview: JSON.stringify(input).slice(0, 500),
              durationMs: null,
              hasError: false, // Will be resolved after all lines are parsed
              errorMessage: null, // Will be resolved after all lines are parsed
              targetPath,
              callerType,
            };
            toolUses.push(toolUse);

            // Track for deferred error resolution (tool_result comes AFTER tool_use in JSONL)
            pendingToolUses.push({ toolUse, apiToolId });

            // ─── Extract file operations ─────────────────────────────────────
            const operation = toolToOperation(toolName);
            if (operation && targetPath) {
              fileOperations.push({
                sessionId: fileInfo.sessionId,
                toolUseId: globalToolId,
                operation,
                filePath: targetPath,
                fileExtension: extractFileExtension(targetPath),
                timestamp: timestampMs,
              });
            }

            // ─── Extract bash commands ───────────────────────────────────────
            if (toolName === "Bash" && input?.command) {
              const command = String(input.command);
              bashCommands.push({
                sessionId: fileInfo.sessionId,
                queryId,
                command: command.slice(0, 1000),
                description: input.description
                  ? String(input.description).slice(0, 200)
                  : null,
                category: categorizeBashCommand(command),
                timestamp: timestampMs,
              });
            }

            // ─── Extract skill invocations ───────────────────────────────────
            if (toolName === "Skill" && input?.skill) {
              skillInvocations.push({
                sessionId: fileInfo.sessionId,
                skillName: String(input.skill),
                args: input.args ? String(input.args).slice(0, 500) : null,
                queryIndex,
                timestamp: timestampMs,
              });
            }

            // ─── Extract agent spawns (Task tool) ────────────────────────────
            if (toolName === "Task" && input?.subagent_type) {
              agentSpawns.push({
                sessionId: fileInfo.sessionId,
                agentType: String(input.subagent_type),
                description: input.description
                  ? String(input.description).slice(0, 200)
                  : null,
                queryIndex,
                timestamp: timestampMs,
              });
            }
          }
        }

        queryIndex++;
        lastUserPreview = null; // Reset after consuming
      }

      // Extract display name from summary
      if (type === "summary" && obj.summary) {
        const summary = String(obj.summary);
        if (summary.length > 0 && summary.length < 200) {
          displayName = summary;
        }
      }

      // ─── PR Link entries ─────────────────────────────────────────────────────
      if (type === "pr-link") {
        const prNumber = obj.prNumber as number | undefined;
        const prUrl = obj.prUrl as string | undefined;
        const prRepository = obj.prRepository as string | undefined;

        if (prNumber != null && prUrl && prRepository) {
          prLinks.push({
            sessionId: fileInfo.sessionId,
            prNumber,
            prUrl,
            prRepository,
            timestamp: timestampMs,
          });
        }
      }
    }

    // ─── Deferred Error Resolution ────────────────────────────────────────────
    // Tool results appear AFTER tool uses in JSONL (user message follows assistant message).
    // Now that all lines are parsed, resolve error status from toolResultMap.
    for (const { toolUse, apiToolId } of pendingToolUses) {
      const result = toolResultMap.get(apiToolId);
      if (result) {
        toolUse.hasError = result.isError;
        toolUse.errorMessage = result.errorContent ?? null;
      }
    }

    // Calculate saved by caching
    const savedByCaching = Math.max(
      0,
      totalFullInputCost - totalActualInputCost,
    );

    // Build session record
    const session: schema.NewSession = {
      sessionId: fileInfo.sessionId,
      projectPath: fileInfo.project,
      displayName,
      startTime: startTime ?? Date.now(),
      endTime,
      durationMs: startTime && endTime ? endTime - startTime : null,
      totalInputTokens,
      totalOutputTokens,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      queryCount: queries.length,
      toolUseCount: toolUses.length,
      cwd,
      version,
      gitBranch: null,
      slug: null,
      parentSessionId: fileInfo.parentSessionId,
      isSubagent: fileInfo.isSubagent,
      compactions,
      savedByCaching,
      totalEphemeral5mTokens,
      totalEphemeral1hTokens,
    };

    return {
      session,
      queries,
      toolUses,
      fileOperations,
      hookEvents,
      bashCommands,
      apiErrors,
      skillInvocations,
      agentSpawns,
      slashCommands,
      contextWindowUsage,
      prLinks,
    };
  });
