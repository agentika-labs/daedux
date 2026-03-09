/**
 * Test database helper for creating in-memory SQLite databases with the schema.
 * Used for integration testing database operations.
 */
import { Database } from "bun:sqlite";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { Effect, Layer } from "effect";

import { DatabaseService } from "../../src/bun/db";
import * as schema from "../../src/bun/db/schema";

// ─── Schema DDL ──────────────────────────────────────────────────────────────

/**
 * Raw SQL to create all tables. Derived from src/db/schema.ts.
 * This is necessary because drizzle-kit push isn't available in tests.
 */
const CREATE_TABLES_SQL = `
-- Session file tracking for incremental sync
CREATE TABLE IF NOT EXISTS session_files (
  file_path TEXT PRIMARY KEY,
  mtime_ms INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  display_name TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration_ms INTEGER,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_read INTEGER DEFAULT 0,
  total_cache_write INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  query_count INTEGER DEFAULT 0,
  tool_use_count INTEGER DEFAULT 0,
  cwd TEXT,
  version TEXT,
  git_branch TEXT,
  slug TEXT,
  parent_session_id TEXT,
  is_subagent INTEGER DEFAULT 0,
  compactions INTEGER DEFAULT 0,
  saved_by_caching REAL DEFAULT 0,
  total_ephemeral_5m_tokens INTEGER DEFAULT 0,
  total_ephemeral_1h_tokens INTEGER DEFAULT 0,
  turn_count INTEGER DEFAULT 0,
  harness TEXT DEFAULT 'claude-code'
);
CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_path);
CREATE INDEX IF NOT EXISTS sessions_start_time_idx ON sessions(start_time);
CREATE INDEX IF NOT EXISTS sessions_parent_idx ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS sessions_harness_idx ON sessions(harness);
CREATE INDEX IF NOT EXISTS sessions_harness_time_idx ON sessions(harness, start_time);

-- Queries
CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  query_index INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  cost REAL,
  user_message_preview TEXT,
  assistant_preview TEXT,
  thinking_chars INTEGER DEFAULT 0,
  ephemeral_5m_tokens INTEGER DEFAULT 0,
  ephemeral_1h_tokens INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS queries_session_idx ON queries(session_id);
CREATE INDEX IF NOT EXISTS queries_timestamp_idx ON queries(timestamp);
CREATE INDEX IF NOT EXISTS queries_model_idx ON queries(model);

-- Tool uses
CREATE TABLE IF NOT EXISTS tool_uses (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_preview TEXT,
  duration_ms INTEGER,
  has_error INTEGER DEFAULT 0,
  error_message TEXT,
  target_path TEXT,
  caller_type TEXT
);
CREATE INDEX IF NOT EXISTS tool_uses_query_idx ON tool_uses(query_id);
CREATE INDEX IF NOT EXISTS tool_uses_session_idx ON tool_uses(session_id);
CREATE INDEX IF NOT EXISTS tool_uses_tool_name_idx ON tool_uses(tool_name);
CREATE INDEX IF NOT EXISTS tool_uses_target_path_idx ON tool_uses(target_path);

-- File operations
CREATE TABLE IF NOT EXISTS file_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  tool_use_id TEXT,
  operation TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_extension TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS file_ops_session_idx ON file_operations(session_id);
CREATE INDEX IF NOT EXISTS file_ops_path_idx ON file_operations(file_path);

-- Hook events
CREATE TABLE IF NOT EXISTS hook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  hook_type TEXT NOT NULL,
  hook_name TEXT,
  tool_name TEXT,
  command TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hook_events_session_idx ON hook_events(session_id);
CREATE INDEX IF NOT EXISTS hook_events_type_idx ON hook_events(hook_type);

-- Bash commands
CREATE TABLE IF NOT EXISTS bash_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  query_id TEXT,
  command TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  timestamp INTEGER
);
CREATE INDEX IF NOT EXISTS bash_commands_session_idx ON bash_commands(session_id);
CREATE INDEX IF NOT EXISTS bash_commands_category_idx ON bash_commands(category);

-- API errors
CREATE TABLE IF NOT EXISTS api_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  error_type TEXT NOT NULL,
  error_message TEXT,
  status_code INTEGER,
  timestamp INTEGER
);
CREATE INDEX IF NOT EXISTS api_errors_session_idx ON api_errors(session_id);
CREATE INDEX IF NOT EXISTS api_errors_type_idx ON api_errors(error_type);

-- Skill invocations
CREATE TABLE IF NOT EXISTS skill_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  args TEXT,
  query_index INTEGER,
  timestamp INTEGER
);
CREATE INDEX IF NOT EXISTS skill_invocations_session_idx ON skill_invocations(session_id);
CREATE INDEX IF NOT EXISTS skill_invocations_skill_idx ON skill_invocations(skill_name);

-- Agent spawns
CREATE TABLE IF NOT EXISTS agent_spawns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  description TEXT,
  query_index INTEGER,
  timestamp INTEGER
);
CREATE INDEX IF NOT EXISTS agent_spawns_session_idx ON agent_spawns(session_id);
CREATE INDEX IF NOT EXISTS agent_spawns_type_idx ON agent_spawns(agent_type);

-- Slash commands
CREATE TABLE IF NOT EXISTS slash_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  timestamp INTEGER
);
CREATE INDEX IF NOT EXISTS slash_commands_session_idx ON slash_commands(session_id);
CREATE INDEX IF NOT EXISTS slash_commands_command_idx ON slash_commands(command);

-- Context window usage
CREATE TABLE IF NOT EXISTS context_window_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  query_index INTEGER NOT NULL,
  cumulative_tokens INTEGER,
  cache_hit_ratio REAL,
  cost_this_query REAL
);
CREATE INDEX IF NOT EXISTS context_usage_session_idx ON context_window_usage(session_id);
CREATE INDEX IF NOT EXISTS context_usage_query_idx ON context_window_usage(query_index);

-- PR links
CREATE TABLE IF NOT EXISTS pr_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  pr_repository TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pr_links_session_idx ON pr_links(session_id);
CREATE INDEX IF NOT EXISTS pr_links_repo_idx ON pr_links(pr_repository);

-- Session schedules (for warm-up scheduling)
CREATE TABLE IF NOT EXISTS session_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  hour INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  days_of_week TEXT NOT NULL,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_schedules_enabled_idx ON session_schedules(enabled);
CREATE INDEX IF NOT EXISTS session_schedules_next_run_idx ON session_schedules(next_run_at);

-- Schedule executions
CREATE TABLE IF NOT EXISTS schedule_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id TEXT NOT NULL REFERENCES session_schedules(id) ON DELETE CASCADE,
  executed_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  session_id TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS schedule_executions_schedule_idx ON schedule_executions(schedule_id);
CREATE INDEX IF NOT EXISTS schedule_executions_executed_at_idx ON schedule_executions(executed_at);

-- OTEL sessions
CREATE TABLE IF NOT EXISTS otel_sessions (
  session_id TEXT PRIMARY KEY,
  user_account_uuid TEXT,
  organization_id TEXT,
  user_email TEXT,
  app_version TEXT,
  terminal_type TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  commit_count INTEGER DEFAULT 0,
  pr_count INTEGER DEFAULT 0,
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS otel_sessions_time_idx ON otel_sessions(first_seen_at);

-- OTEL metrics
CREATE TABLE IF NOT EXISTS otel_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES otel_sessions(session_id) ON DELETE CASCADE,
  timestamp_ns INTEGER NOT NULL,
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  model TEXT,
  token_type TEXT,
  time_type TEXT,
  tool_name TEXT,
  decision TEXT,
  decision_source TEXT,
  language TEXT,
  loc_type TEXT
);
CREATE INDEX IF NOT EXISTS otel_metrics_session_idx ON otel_metrics(session_id);
CREATE INDEX IF NOT EXISTS otel_metrics_name_idx ON otel_metrics(metric_name);
CREATE INDEX IF NOT EXISTS otel_metrics_time_idx ON otel_metrics(timestamp_ns);

-- OTEL events
CREATE TABLE IF NOT EXISTS otel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES otel_sessions(session_id) ON DELETE CASCADE,
  timestamp_ns INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  prompt_id TEXT,
  model TEXT,
  cost_usd REAL,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  speed TEXT,
  error_message TEXT,
  status_code TEXT,
  attempt INTEGER,
  tool_name TEXT,
  tool_success INTEGER,
  tool_duration_ms INTEGER,
  tool_decision TEXT,
  tool_decision_source TEXT,
  prompt_length INTEGER,
  prompt_content TEXT
);
CREATE INDEX IF NOT EXISTS otel_events_session_idx ON otel_events(session_id);
CREATE INDEX IF NOT EXISTS otel_events_name_idx ON otel_events(event_name);
CREATE INDEX IF NOT EXISTS otel_events_prompt_idx ON otel_events(prompt_id);
CREATE INDEX IF NOT EXISTS otel_events_tool_idx ON otel_events(tool_name);
`;

// ─── Test Database Factory ───────────────────────────────────────────────────

/**
 * Creates an in-memory SQLite database with the schema tables.
 * Each call returns a fresh, isolated database.
 */
export const createTestDb = () => {
  const sqlite = new Database(":memory:");

  // Enable foreign key constraints
  sqlite.exec("PRAGMA foreign_keys = ON");

  // Create all tables
  sqlite.exec(CREATE_TABLES_SQL);

  const db = drizzle({ client: sqlite, schema });

  const cleanup = () => {
    sqlite.close();
  };

  return { db, sqlite, cleanup };
};

/**
 * Creates an Effect Layer that provides DatabaseService with an in-memory database.
 * Use this in tests that need the full Effect infrastructure.
 */
export const TestDatabaseLayer = Layer.scoped(
  DatabaseService,
  Effect.acquireRelease(
    Effect.sync(() => createTestDb()),
    ({ sqlite }) => Effect.sync(() => sqlite.close())
  )
);

/**
 * Creates a fresh test database layer for each test.
 * Returns both the layer and direct database access for assertions.
 */
export const createTestDatabaseLayer = () => {
  const { db, sqlite } = createTestDb();

  const layer = Layer.succeed(DatabaseService, { db, sqlite });

  return { db, layer, sqlite };
};

// ─── Test Utilities ──────────────────────────────────────────────────────────

/**
 * Run an Effect with a fresh test database.
 * Automatically creates and closes the database.
 */
export const runWithTestDb = <A, E>(
  effect: Effect.Effect<A, E, DatabaseService>
): Promise<A> => {
  const testLayer = TestDatabaseLayer;
  return Effect.runPromise(Effect.provide(effect, testLayer));
};

/**
 * Insert a test session directly into the database.
 * Useful for setting up test scenarios.
 */
export const insertTestSession = (
  db: ReturnType<typeof createTestDb>["db"],
  session: Partial<schema.NewSession> & { sessionId: string }
) =>
  db.insert(schema.sessions).values({
    projectPath: "/test/project",
    queryCount: 0,
    startTime: Date.now(),
    toolUseCount: 0,
    ...session,
  });

/**
 * Insert a test query directly into the database.
 */
export const insertTestQuery = (
  db: ReturnType<typeof createTestDb>["db"],
  query: schema.NewQuery
) => db.insert(schema.queries).values(query);
