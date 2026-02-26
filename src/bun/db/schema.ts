import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// ─── Session Files (mtime tracking for incremental sync) ────────────────────

/**
 * Tracks JSONL file modification times for incremental parsing.
 * When mtime changes, we re-parse that file; otherwise skip it.
 */
export const sessionFiles = sqliteTable("session_files", {
  filePath: text("file_path").primaryKey(),
  mtimeMs: integer("mtime_ms").notNull(),
  sessionId: text("session_id").notNull(),
  syncedAt: integer("synced_at").notNull(), // Unix timestamp ms
});

// ─── Sessions ───────────────────────────────────────────────────────────────

/**
 * Core session table - one row per JSONL session file.
 * Aggregated token/cost values are computed during sync to avoid runtime calculation.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    sessionId: text("session_id").primaryKey(),
    projectPath: text("project_path").notNull(),
    displayName: text("display_name"),

    // Time range
    startTime: integer("start_time").notNull(), // Unix timestamp ms
    endTime: integer("end_time"),
    durationMs: integer("duration_ms"),

    // Pre-aggregated token usage (computed during sync)
    totalInputTokens: integer("total_input_tokens").default(0),
    totalOutputTokens: integer("total_output_tokens").default(0),
    totalCacheRead: integer("total_cache_read").default(0),
    totalCacheWrite: integer("total_cache_write").default(0),
    totalCost: real("total_cost").default(0),

    // Counts
    queryCount: integer("query_count").default(0),
    toolUseCount: integer("tool_use_count").default(0),

    // Session metadata
    cwd: text("cwd"), // Working directory
    version: text("version"), // Claude Code version
    gitBranch: text("git_branch"),
    slug: text("slug"), // Human-readable session slug

    // Subagent tracking
    parentSessionId: text("parent_session_id"),
    isSubagent: integer("is_subagent", { mode: "boolean" }).default(false),

    // Extended metrics (Phase 1 additions)
    compactions: integer("compactions").default(0),
    savedByCaching: real("saved_by_caching").default(0),
    turnCount: integer("turn_count").default(0), // Number of user turns (human messages)

    // Ephemeral cache totals
    totalEphemeral5mTokens: integer("total_ephemeral_5m_tokens").default(0),
    totalEphemeral1hTokens: integer("total_ephemeral_1h_tokens").default(0),
  },
  (table) => [
    index("sessions_project_idx").on(table.projectPath),
    index("sessions_start_time_idx").on(table.startTime),
    index("sessions_parent_idx").on(table.parentSessionId),
    // Composite indexes for common filtered queries
    index("sessions_project_time_idx").on(table.projectPath, table.startTime),
    index("sessions_subagent_time_idx").on(table.isSubagent, table.startTime),
  ]
);

// ─── Queries (API calls within sessions) ────────────────────────────────────

/**
 * Each assistant response is a "query" with token usage.
 * Stores per-query breakdown for detailed analysis.
 */
export const queries = sqliteTable(
  "queries",
  {
    id: text("id").primaryKey(), // sessionId:queryIndex
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    queryIndex: integer("query_index").notNull(),
    timestamp: integer("timestamp").notNull(), // Unix timestamp ms

    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheRead: integer("cache_read"),
    cacheWrite: integer("cache_write"),
    cost: real("cost"),

    // Content preview (truncated for storage efficiency)
    userMessagePreview: text("user_message_preview"), // First 500 chars
    assistantPreview: text("assistant_preview"), // First 500 chars

    // Thinking metrics
    thinkingChars: integer("thinking_chars").default(0),

    // Ephemeral cache tokens (from nested cache_creation object)
    ephemeral5mTokens: integer("ephemeral_5m_tokens").default(0),
    ephemeral1hTokens: integer("ephemeral_1h_tokens").default(0),
  },
  (table) => [
    index("queries_session_idx").on(table.sessionId),
    index("queries_timestamp_idx").on(table.timestamp),
    index("queries_model_idx").on(table.model),
    // Composite index for model breakdown by session
    index("queries_session_model_idx").on(table.sessionId, table.model),
  ]
);

// ─── Tool Uses ──────────────────────────────────────────────────────────────

/**
 * Individual tool invocations within queries.
 * Used for tool health stats, timing analysis, and file operation tracking.
 */
export const toolUses = sqliteTable(
  "tool_uses",
  {
    id: text("id").primaryKey(), // toolUseId from journal entry
    queryId: text("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),

    toolName: text("tool_name").notNull(),
    inputPreview: text("input_preview"), // First 500 chars of input JSON
    durationMs: integer("duration_ms"),

    // Result tracking
    hasError: integer("has_error", { mode: "boolean" }).default(false),
    errorMessage: text("error_message"),

    // For file operations (Read, Write, Edit, Glob, Grep)
    targetPath: text("target_path"),

    // Caller type: "direct" (user-requested) | "inference" (AI-decided)
    callerType: text("caller_type"),
  },
  (table) => [
    index("tool_uses_query_idx").on(table.queryId),
    index("tool_uses_session_idx").on(table.sessionId),
    index("tool_uses_tool_name_idx").on(table.toolName),
    index("tool_uses_target_path_idx").on(table.targetPath),
    // Composite index for tool counts per session
    index("tool_uses_session_tool_idx").on(table.sessionId, table.toolName),
  ]
);

// ─── File Operations (denormalized for fast file activity queries) ──────────

/**
 * Tracks which files were accessed and how.
 * Denormalized from toolUses for efficient file-centric queries.
 */
export const fileOperations = sqliteTable(
  "file_operations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    toolUseId: text("tool_use_id"),

    operation: text("operation").notNull(), // read, write, edit, glob, grep
    filePath: text("file_path").notNull(),
    fileExtension: text("file_extension"), // e.g., "ts", "js", "py"
    timestamp: integer("timestamp").notNull(), // Unix timestamp ms
  },
  (table) => [
    index("file_ops_session_idx").on(table.sessionId),
    index("file_ops_path_idx").on(table.filePath),
  ]
);

// ─── Hook Events ────────────────────────────────────────────────────────────

/**
 * Captures hook execution for debugging and analysis.
 */
export const hookEvents = sqliteTable(
  "hook_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),

    hookType: text("hook_type").notNull(), // PreToolUse, PostToolUse, SessionStart, etc.
    hookName: text("hook_name"), // e.g., "PostToolUse:format"
    toolName: text("tool_name"),
    command: text("command"), // Shell command executed
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms"),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => [
    index("hook_events_session_idx").on(table.sessionId),
    index("hook_events_type_idx").on(table.hookType),
  ]
);

// ─── Bash Commands ────────────────────────────────────────────────────────────

/**
 * Tracks Bash tool invocations with command categorization.
 */
export const bashCommands = sqliteTable(
  "bash_commands",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    queryId: text("query_id"),
    command: text("command").notNull(),
    description: text("description"),
    category: text("category").notNull(), // git, package_manager, build_test, file_ops, other
    timestamp: integer("timestamp"),
  },
  (table) => [
    index("bash_commands_session_idx").on(table.sessionId),
    index("bash_commands_category_idx").on(table.category),
  ]
);

// ─── API Errors ─────────────────────────────────────────────────────────────

/**
 * Tracks API errors from system entries.
 */
export const apiErrors = sqliteTable(
  "api_errors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    errorType: text("error_type").notNull(),
    errorMessage: text("error_message"),
    statusCode: integer("status_code"),
    timestamp: integer("timestamp"),
  },
  (table) => [
    index("api_errors_session_idx").on(table.sessionId),
    index("api_errors_type_idx").on(table.errorType),
  ]
);

// ─── Skill Invocations ──────────────────────────────────────────────────────

/**
 * Tracks Skill tool invocations for ROI analysis.
 */
export const skillInvocations = sqliteTable(
  "skill_invocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    skillName: text("skill_name").notNull(),
    args: text("args"),
    queryIndex: integer("query_index"),
    timestamp: integer("timestamp"),
  },
  (table) => [
    index("skill_invocations_session_idx").on(table.sessionId),
    index("skill_invocations_skill_idx").on(table.skillName),
  ]
);

// ─── Agent Spawns ───────────────────────────────────────────────────────────

/**
 * Tracks Task tool invocations (subagent spawns).
 */
export const agentSpawns = sqliteTable(
  "agent_spawns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull(),
    description: text("description"),
    queryIndex: integer("query_index"),
    timestamp: integer("timestamp"),
  },
  (table) => [
    index("agent_spawns_session_idx").on(table.sessionId),
    index("agent_spawns_type_idx").on(table.agentType),
  ]
);

// ─── Slash Commands ─────────────────────────────────────────────────────────

/**
 * Tracks slash command usage from user messages.
 */
export const slashCommands = sqliteTable(
  "slash_commands",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    command: text("command").notNull(),
    timestamp: integer("timestamp"),
  },
  (table) => [
    index("slash_commands_session_idx").on(table.sessionId),
    index("slash_commands_command_idx").on(table.command),
  ]
);

// ─── Context Window Usage ───────────────────────────────────────────────────

/**
 * Tracks per-query context window usage for heatmap visualization.
 */
export const contextWindowUsage = sqliteTable(
  "context_window_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    queryIndex: integer("query_index").notNull(),
    cumulativeTokens: integer("cumulative_tokens"),
    cacheHitRatio: real("cache_hit_ratio"),
    costThisQuery: real("cost_this_query"),
  },
  (table) => [
    index("context_usage_session_idx").on(table.sessionId),
    index("context_usage_query_idx").on(table.queryIndex),
  ]
);

// ─── PR Links ────────────────────────────────────────────────────────────────

/**
 * Tracks PR links created or referenced during sessions.
 * Useful for correlating sessions with pull requests.
 */
export const prLinks = sqliteTable(
  "pr_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    prUrl: text("pr_url").notNull(),
    prRepository: text("pr_repository").notNull(),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => [
    index("pr_links_session_idx").on(table.sessionId),
    index("pr_links_repo_idx").on(table.prRepository),
  ]
);

// ─── Session Schedules (Warm-up Scheduling) ─────────────────────────────────

/**
 * Scheduled session warm-ups to pre-start usage windows.
 * Uses simple time-based scheduling (hour/minute/days) instead of cron.
 */
export const sessionSchedules = sqliteTable("session_schedules", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true),

  // Simple time-based scheduling
  hour: integer("hour").notNull(), // 0-23
  minute: integer("minute").notNull(), // 0-59
  daysOfWeek: text("days_of_week").notNull(), // JSON array: [1,2,3,4,5] for weekdays

  // Tracking
  lastRunAt: integer("last_run_at"), // Unix timestamp ms
  nextRunAt: integer("next_run_at"), // Unix timestamp ms (computed)
  createdAt: integer("created_at").notNull(), // Unix timestamp ms
});

/**
 * Execution history for scheduled warm-ups.
 * Tracks success/failure and links to created sessions.
 */
export const scheduleExecutions = sqliteTable(
  "schedule_executions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => sessionSchedules.id, { onDelete: "cascade" }),
    executedAt: integer("executed_at").notNull(), // Unix timestamp ms
    status: text("status").notNull(), // "success" | "error" | "skipped"
    errorMessage: text("error_message"),
    sessionId: text("session_id"), // Links to created session (if successful)
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("schedule_exec_schedule_idx").on(table.scheduleId),
    index("schedule_exec_time_idx").on(table.executedAt),
  ]
);

// ─── Type exports for Effect Schema generation ──────────────────────────────

export type SessionSchedule = typeof sessionSchedules.$inferSelect;
export type NewSessionSchedule = typeof sessionSchedules.$inferInsert;

export type ScheduleExecution = typeof scheduleExecutions.$inferSelect;
export type NewScheduleExecution = typeof scheduleExecutions.$inferInsert;

export type SessionFile = typeof sessionFiles.$inferSelect;
export type NewSessionFile = typeof sessionFiles.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Query = typeof queries.$inferSelect;
export type NewQuery = typeof queries.$inferInsert;

export type ToolUse = typeof toolUses.$inferSelect;
export type NewToolUse = typeof toolUses.$inferInsert;

export type FileOperation = typeof fileOperations.$inferSelect;
export type NewFileOperation = typeof fileOperations.$inferInsert;

export type HookEvent = typeof hookEvents.$inferSelect;
export type NewHookEvent = typeof hookEvents.$inferInsert;

export type BashCommand = typeof bashCommands.$inferSelect;
export type NewBashCommand = typeof bashCommands.$inferInsert;

export type ApiError = typeof apiErrors.$inferSelect;
export type NewApiError = typeof apiErrors.$inferInsert;

export type SkillInvocation = typeof skillInvocations.$inferSelect;
export type NewSkillInvocation = typeof skillInvocations.$inferInsert;

export type AgentSpawn = typeof agentSpawns.$inferSelect;
export type NewAgentSpawn = typeof agentSpawns.$inferInsert;

export type SlashCommand = typeof slashCommands.$inferSelect;
export type NewSlashCommand = typeof slashCommands.$inferInsert;

export type ContextWindowUsage = typeof contextWindowUsage.$inferSelect;
export type NewContextWindowUsage = typeof contextWindowUsage.$inferInsert;

export type PrLink = typeof prLinks.$inferSelect;
export type NewPrLink = typeof prLinks.$inferInsert;
