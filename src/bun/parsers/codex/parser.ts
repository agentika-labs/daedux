import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Effect } from "effect";

import { FilePath } from "../../../shared/branded";
import type * as schema from "../../db/schema";
import { ParseError } from "../../errors";
import { cacheHitRatio } from "../../metrics";
import { calculateCost, getPricing } from "../../utils/pricing";
import {
  categorizeBashCommand,
  extractFileExtension,
  extractSlashCommand,
  isSystemContent,
  safeJsonParse,
  stripXmlTags,
} from "../../utils/parsing";
import type { HarnessParser, ParserInput, ParsedRecords } from "../types";
import { discoverCodexSessions } from "./discovery";

// ─── Types ──────────────────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

interface ThreadMetadata {
  readonly title: string | null;
  readonly preview: string | null;
  readonly cwd: string | null;
  readonly cliVersion: string | null;
  readonly gitBranch: string | null;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly createdAtMs: number | null;
  readonly updatedAtMs: number | null;
}

interface ToolResultUpdate {
  readonly durationMs?: number;
  readonly hasError?: boolean;
  readonly errorMessage?: string | null;
}

// ─── Streaming Line Reader ──────────────────────────────────────────────────

const streamLinesFromFile = async (filePath: string): Promise<string[]> => {
  const file = Bun.file(filePath);
  const stream = file.stream();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        lines.push(line);
      }
    }
  }

  const remaining = buffer.trim();
  if (remaining) {
    lines.push(remaining);
  }

  return lines;
};

// ─── SQLite Metadata Enrichment ─────────────────────────────────────────────

const readThreadMetadata = (sessionId: string): ThreadMetadata | null => {
  const stateDbPath = path.join(os.homedir(), ".codex", "state_5.sqlite");
  if (!existsSync(stateDbPath)) {
    return null;
  }

  try {
    const db = new Database(stateDbPath, { readonly: true, strict: true });
    try {
      const row = db
        .query<
          {
            title: string | null;
            preview: string | null;
            cwd: string | null;
            cli_version: string | null;
            git_branch: string | null;
            model: string | null;
            reasoning_effort: string | null;
            created_at_ms: number | null;
            updated_at_ms: number | null;
          },
          [string]
        >(
          `SELECT title, preview, cwd, cli_version, git_branch, model, reasoning_effort,
                  created_at_ms, updated_at_ms
             FROM threads
            WHERE id = ?
            LIMIT 1`
        )
        .get(sessionId);

      if (!row) {
        return null;
      }

      return {
        cliVersion: row.cli_version,
        createdAtMs: row.created_at_ms,
        cwd: row.cwd,
        gitBranch: row.git_branch,
        model: row.model,
        preview: row.preview,
        reasoningEffort: row.reasoning_effort,
        title: row.title,
        updatedAtMs: row.updated_at_ms,
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
};

// ─── Parsing Helpers ────────────────────────────────────────────────────────

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): JsonRecord | null =>
  isJsonRecord(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const timestampMs = (timestamp: unknown): number | null => {
  if (typeof timestamp !== "string") {
    return null;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const parseArguments = (value: unknown): JsonRecord => {
  if (typeof value === "string") {
    const parsed = safeJsonParse(value);
    return parsed ?? {};
  }
  return asRecord(value) ?? {};
};

const textFromContent = (content: unknown): string | null => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of content) {
    const obj = asRecord(block);
    const text = asString(obj?.text);
    if (text !== null && text.length > 0) {
      parts.push(text);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
};

const preview = (text: string | null | undefined): string | null => {
  if (text === null || text === undefined || text.length === 0) {
    return null;
  }
  const stripped = stripXmlTags(text).trim();
  return stripped.length > 0 ? stripped.slice(0, 500) : null;
};

const isCodexSystemUserContent = (text: string): boolean => {
  const trimmed = text.trimStart();
  return (
    isSystemContent(trimmed) ||
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<goal_context>") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("<INSTRUCTIONS") ||
    trimmed.startsWith("<environment_context>")
  );
};

const readTokenUsage = (value: unknown): TokenUsage => {
  const obj = asRecord(value) ?? {};
  return {
    cachedInputTokens: asNumber(obj.cached_input_tokens),
    inputTokens: asNumber(obj.input_tokens),
    outputTokens: asNumber(obj.output_tokens),
    reasoningOutputTokens: asNumber(obj.reasoning_output_tokens),
    totalTokens: asNumber(obj.total_tokens),
  };
};

const getCommandText = (toolName: string, args: JsonRecord): string | null => {
  if (toolName === "exec_command") {
    return asString(args.cmd);
  }

  const command = args.command;
  if (typeof command === "string") {
    return command;
  }
  if (Array.isArray(command)) {
    return command.map(String).join(" ");
  }

  return null;
};

const getTargetPath = (toolName: string, args: JsonRecord): FilePath | null => {
  if (toolName === "view_image") {
    const imagePath = asString(args.path) ?? asString(args.file_path);
    return imagePath !== null && imagePath.length > 0
      ? FilePath(imagePath)
      : null;
  }

  if (toolName === "read_thread_terminal") {
    return null;
  }

  const command = getCommandText(toolName, args);
  if (command === null || command.length === 0) {
    return null;
  }

  return null;
};

const patchOperation = (changeType: unknown): "edit" | "write" => {
  const type = typeof changeType === "string" ? changeType.toLowerCase() : "";
  return type === "add" || type === "create" ? "write" : "edit";
};

const applyToolUpdate = (
  toolUses: schema.NewToolUse[],
  callId: string,
  update: ToolResultUpdate
): void => {
  const toolUse = toolUses.find((item) => item.id.endsWith(`:${callId}`));
  if (!toolUse) {
    return;
  }

  if (update.durationMs !== undefined) {
    toolUse.durationMs = update.durationMs;
  }
  if (update.hasError !== undefined) {
    toolUse.hasError = update.hasError;
  }
  if (update.errorMessage !== undefined) {
    toolUse.errorMessage = update.errorMessage;
  }
};

const durationToMs = (duration: unknown): number | undefined => {
  const obj = asRecord(duration);
  if (!obj) {
    return undefined;
  }
  const secs = asNumber(obj.secs);
  const nanos = asNumber(obj.nanos);
  return Math.round(secs * 1000 + nanos / 1_000_000);
};

const resultErrorMessage = (result: unknown): string | null => {
  const obj = asRecord(result);
  if (!obj) {
    return null;
  }
  if ("Err" in obj) {
    return JSON.stringify(obj.Err).slice(0, 500);
  }
  if ("error" in obj) {
    return JSON.stringify(obj.error).slice(0, 500);
  }
  return null;
};

const emptyRecords = {
  agentSpawns: [] as schema.NewAgentSpawn[],
  apiErrors: [] as schema.NewApiError[],
  bashCommands: [] as schema.NewBashCommand[],
  contextWindowUsage: [] as schema.NewContextWindowUsage[],
  fileOperations: [] as schema.NewFileOperation[],
  hookEvents: [] as schema.NewHookEvent[],
  prLinks: [] as schema.NewPrLink[],
  queries: [] as schema.NewQuery[],
  skillInvocations: [] as schema.NewSkillInvocation[],
  slashCommands: [] as schema.NewSlashCommand[],
  toolUses: [] as schema.NewToolUse[],
};

// ─── Parse Session Implementation ───────────────────────────────────────────

const parseCodexSession = Effect.fn("CodexParser.parseSession")(function* (
  input: ParserInput
) {
  const lines = yield* Effect.tryPromise({
    catch: (cause) => new ParseError({ cause, filePath: input.filePath }),
    try: async () => streamLinesFromFile(input.filePath),
  });

  if (lines.length === 0) {
    return null;
  }

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

  const threadMetadata = readThreadMetadata(input.sessionId);

  let startTime: number | null = threadMetadata?.createdAtMs ?? null;
  let endTime: number | null = threadMetadata?.updatedAtMs ?? null;
  let cwd: string | null = threadMetadata?.cwd ?? null;
  let version: string | null = threadMetadata?.cliVersion ?? null;
  let gitBranch: string | null = threadMetadata?.gitBranch ?? null;
  let model: string | null = threadMetadata?.model ?? null;
  let displayName: string | null = threadMetadata?.title ?? null;
  let firstPrompt: string | null = threadMetadata?.preview ?? null;
  let lastAssistantPreview: string | null = null;
  let lastUserPreview: string | null = firstPrompt;
  let currentQueryIndex = 0;
  let maxReferencedQueryIndex = -1;
  let turnCount = 0;
  let compactions = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let previousTotalTokens: number | null = null;

  const ensureTimeRange = (value: number | null): void => {
    if (value === null) {
      return;
    }
    if (startTime === null || value < startTime) {
      startTime = value;
    }
    if (endTime === null || value > endTime) {
      endTime = value;
    }
  };

  const ensureSyntheticQuery = (queryIndex: number, ts: number): void => {
    if (queries.some((query) => query.queryIndex === queryIndex)) {
      return;
    }

    queries.push({
      assistantPreview: null,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      ephemeral1hTokens: 0,
      ephemeral5mTokens: 0,
      id: `${input.sessionId}:${queryIndex}`,
      inputTokens: 0,
      model: model ?? "unknown",
      outputTokens: 0,
      queryIndex,
      sessionId: input.sessionId,
      thinkingChars: 0,
      timestamp: ts,
      userMessagePreview: lastUserPreview,
    });
  };

  for (const line of lines) {
    const obj = safeJsonParse(line);
    if (!obj) {
      continue;
    }

    const ts = timestampMs(obj.timestamp);
    ensureTimeRange(ts);

    const type = asString(obj.type);
    const payload = asRecord(obj.payload);

    if (type === "session_meta" && payload) {
      cwd = cwd ?? asString(payload.cwd);
      version = version ?? asString(payload.cli_version);
      const git = asRecord(payload.git);
      gitBranch = gitBranch ?? asString(git?.branch);
      continue;
    }

    if (type === "turn_context" && payload) {
      cwd = cwd ?? asString(payload.cwd);
      model = asString(payload.model) ?? model;
      const summary = preview(asString(payload.summary));
      if (displayName === null && summary !== null) {
        displayName = summary;
      }
      continue;
    }

    if (type === "compacted") {
      compactions++;
      continue;
    }

    if (type === "response_item" && payload) {
      const payloadType = asString(payload.type);

      if (payloadType === "message") {
        const role = asString(payload.role);
        const text = textFromContent(payload.content);
        const textPreview = preview(text);

        if (role === "assistant") {
          lastAssistantPreview = textPreview ?? lastAssistantPreview;
        }

        if (
          role === "user" &&
          text !== null &&
          text.length > 0 &&
          !isCodexSystemUserContent(text)
        ) {
          turnCount++;
          lastUserPreview = textPreview;
          firstPrompt = firstPrompt ?? textPreview;

          if (text.trimStart().startsWith("/")) {
            const command = extractSlashCommand(text.trimStart());
            if (command) {
              slashCommands.push({
                command,
                sessionId: input.sessionId,
                timestamp: ts ?? Date.now(),
              });
            }
          }
        }
        continue;
      }

      if (payloadType === "reasoning") {
        continue;
      }

      if (
        payloadType === "function_call_output" ||
        payloadType === "custom_tool_call_output"
      ) {
        const callId = asString(payload.call_id);
        const output = asString(payload.output);
        const exitCodeMatch = output?.match(/Process exited with code (\d+)/);
        const exitCodeText = exitCodeMatch?.[1];
        const exitCode =
          exitCodeText !== undefined && exitCodeText.length > 0
            ? Number.parseInt(exitCodeText, 10)
            : 0;

        if (callId !== null && callId.length > 0 && exitCode !== 0) {
          applyToolUpdate(toolUses, callId, {
            errorMessage:
              output?.slice(0, 500) ?? `Exited with code ${exitCode}`,
            hasError: true,
          });
        }
        continue;
      }

      if (
        payloadType === "function_call" ||
        payloadType === "custom_tool_call" ||
        payloadType === "web_search_call" ||
        payloadType === "tool_search_call"
      ) {
        const callId = asString(payload.call_id) ?? crypto.randomUUID();
        const rawName = asString(payload.name) ?? payloadType;
        const namespace = asString(payload.namespace);
        const toolName =
          namespace !== null && namespace.length > 0
            ? `${namespace}.${rawName}`
            : rawName;
        const args = parseArguments(payload.arguments ?? payload.input);
        const queryIndex = currentQueryIndex;
        const queryId = `${input.sessionId}:${queryIndex}`;
        const globalToolId = `${input.sessionId}:${callId}`;
        const targetPath = getTargetPath(rawName, args);

        maxReferencedQueryIndex = Math.max(maxReferencedQueryIndex, queryIndex);
        toolUses.push({
          callerType: null,
          durationMs: null,
          errorMessage: null,
          hasError: false,
          id: globalToolId,
          inputPreview: JSON.stringify(args).slice(0, 500),
          queryId,
          sessionId: input.sessionId,
          targetPath,
          toolName,
        });

        const command = getCommandText(rawName, args);
        if (command !== null && command.length > 0) {
          bashCommands.push({
            category: categorizeBashCommand(command),
            command: command.slice(0, 1000),
            description: asString(args.description)?.slice(0, 200) ?? null,
            queryId,
            sessionId: input.sessionId,
            timestamp: ts,
          });
        }

        if (targetPath) {
          fileOperations.push({
            fileExtension: extractFileExtension(targetPath),
            filePath: targetPath,
            operation: "read",
            sessionId: input.sessionId,
            timestamp: ts ?? Date.now(),
            toolUseId: globalToolId,
          });
        }
      }

      continue;
    }

    if (type === "event_msg" && payload) {
      const payloadType = asString(payload.type);

      if (payloadType === "agent_message") {
        lastAssistantPreview =
          preview(asString(payload.message)) ?? lastAssistantPreview;
        continue;
      }

      if (payloadType === "user_message") {
        const text = asString(payload.message) ?? asString(payload.text);
        if (
          text !== null &&
          text.length > 0 &&
          !isCodexSystemUserContent(text)
        ) {
          turnCount++;
          lastUserPreview = preview(text);
          firstPrompt = firstPrompt ?? lastUserPreview;
        }
        continue;
      }

      if (payloadType === "context_compacted") {
        compactions++;
        continue;
      }

      if (payloadType === "turn_aborted") {
        apiErrors.push({
          errorMessage: asString(payload.reason) ?? "Turn aborted",
          errorType: "turn_aborted",
          sessionId: input.sessionId,
          statusCode: null,
          timestamp: ts,
        });
        continue;
      }

      if (payloadType === "patch_apply_end") {
        const callId = asString(payload.call_id);
        const success = payload.success !== false;
        const stderr = asString(payload.stderr);
        const stdout = asString(payload.stdout);

        if (callId !== null && callId.length > 0) {
          applyToolUpdate(toolUses, callId, {
            errorMessage: success ? null : (stderr ?? stdout ?? "Patch failed"),
            hasError: !success,
          });
        }

        const changes = asRecord(payload.changes);
        if (changes) {
          for (const [changedPath, change] of Object.entries(changes)) {
            const changeObj = asRecord(change);
            fileOperations.push({
              fileExtension: extractFileExtension(changedPath),
              filePath: changedPath,
              operation: patchOperation(changeObj?.type),
              sessionId: input.sessionId,
              timestamp: ts ?? Date.now(),
              toolUseId:
                callId !== null && callId.length > 0
                  ? `${input.sessionId}:${callId}`
                  : null,
            });
          }
        }
        continue;
      }

      if (payloadType === "mcp_tool_call_end") {
        const callId = asString(payload.call_id);
        if (callId !== null && callId.length > 0) {
          const errorMessage = resultErrorMessage(payload.result);
          applyToolUpdate(toolUses, callId, {
            durationMs: durationToMs(payload.duration),
            errorMessage,
            hasError: errorMessage !== null,
          });
        }
        continue;
      }

      if (payloadType === "token_count") {
        const info = asRecord(payload.info) ?? {};
        const lastUsage = readTokenUsage(info.last_token_usage);
        const totalUsage = readTokenUsage(info.total_token_usage);
        const totalTokens = totalUsage.totalTokens;

        if (totalTokens === 0 || totalTokens === previousTotalTokens) {
          continue;
        }
        previousTotalTokens = totalTokens;

        const cacheRead = lastUsage.cachedInputTokens;
        const inputTokens = Math.max(0, lastUsage.inputTokens - cacheRead);
        const outputTokens = lastUsage.outputTokens;
        const pricing = getPricing(model ?? "unknown");
        const cost = calculateCost(pricing, {
          cacheCreation: 0,
          cacheRead,
          output: outputTokens,
          uncachedInput: inputTokens,
        }).totalCost;
        const hitRatio = cacheHitRatio({
          cacheRead,
          cacheWrite: 0,
          uncachedInput: inputTokens,
        });
        const queryIndex = currentQueryIndex;
        const queryId = `${input.sessionId}:${queryIndex}`;

        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCacheRead += cacheRead;
        totalCacheWrite += 0;
        totalCost += cost;

        queries.push({
          assistantPreview: lastAssistantPreview,
          cacheRead,
          cacheWrite: 0,
          cost,
          ephemeral1hTokens: 0,
          ephemeral5mTokens: 0,
          id: queryId,
          inputTokens,
          model: model ?? "unknown",
          outputTokens,
          queryIndex,
          sessionId: input.sessionId,
          thinkingChars: lastUsage.reasoningOutputTokens,
          timestamp: ts ?? Date.now(),
          userMessagePreview: lastUserPreview,
        });

        contextWindowUsage.push({
          cacheHitRatio: hitRatio,
          costThisQuery: cost,
          cumulativeTokens: totalTokens,
          queryIndex,
          sessionId: input.sessionId,
        });

        currentQueryIndex++;
        lastAssistantPreview = null;
        lastUserPreview = null;
      }
    }
  }

  const fallbackTimestamp = startTime ?? Date.now();
  for (let i = 0; i <= maxReferencedQueryIndex; i++) {
    ensureSyntheticQuery(i, fallbackTimestamp);
  }
  queries.sort((a, b) => a.queryIndex - b.queryIndex);

  displayName ??= firstPrompt;

  const session: schema.NewSession = {
    compactions,
    cwd,
    displayName,
    durationMs:
      startTime !== null && endTime !== null ? endTime - startTime : null,
    endTime,
    gitBranch,
    harness: input.harness,
    isSubagent: input.isSubagent,
    parentSessionId: input.parentSessionId,
    projectPath: cwd ?? input.project,
    queryCount: queries.length,
    savedByCaching: 0,
    sessionId: input.sessionId,
    slug: null,
    startTime: startTime ?? Date.now(),
    toolUseCount: toolUses.length,
    totalCacheRead,
    totalCacheWrite,
    totalCost,
    totalEphemeral1hTokens: 0,
    totalEphemeral5mTokens: 0,
    totalInputTokens,
    totalOutputTokens,
    turnCount,
    version: version ?? threadMetadata?.reasoningEffort ?? null,
  };

  return {
    ...emptyRecords,
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
  } satisfies ParsedRecords;
});

// ─── Codex Parser Service ───────────────────────────────────────────────────

/**
 * Effect Service for Codex (OpenAI's coding CLI) session files.
 * Codex stores sessions in ~/.codex/sessions/YYYY/MM/DD/*.jsonl.
 */
export class CodexParserService extends Effect.Service<CodexParserService>()(
  "CodexParser",
  {
    scoped: Effect.gen(function* () {
      return {
        harness: "codex" as const,
        name: "Codex",
        discoverSessions: (basePath?: string) =>
          discoverCodexSessions(basePath),
        canHandle: (filePath: string) =>
          filePath.includes("/.codex/sessions/") && filePath.endsWith(".jsonl"),
        parseSession: parseCodexSession,
      } satisfies HarnessParser;
    }),
  }
) {}
