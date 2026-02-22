import { Database } from "bun:sqlite";

const DB_PATH = `${process.env.HOME}/.claude/usage-monitor.db`;

/**
 * Initialize the database with all required tables.
 * Uses CREATE TABLE IF NOT EXISTS for idempotent setup.
 */
export function initializeDatabase(): void {
  const sqlite = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  // Create tables with IF NOT EXISTS for idempotent setup
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS session_files (
      file_path TEXT PRIMARY KEY,
      mtime_ms INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
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
      total_ephemeral_1h_tokens INTEGER DEFAULT 0
    )
  `);

  // Add columns to sessions if they don't exist (for existing databases)
  try {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN compactions INTEGER DEFAULT 0`);
  } catch { /* column may already exist */ }
  try {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN saved_by_caching REAL DEFAULT 0`);
  } catch { /* column may already exist */ }
  try {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN total_ephemeral_5m_tokens INTEGER DEFAULT 0`);
  } catch { /* column may already exist */ }
  try {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN total_ephemeral_1h_tokens INTEGER DEFAULT 0`);
  } catch { /* column may already exist */ }

  sqlite.exec(`
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
    )
  `);

  // Add ephemeral token columns to queries if they don't exist (for existing databases)
  try {
    sqlite.exec(`ALTER TABLE queries ADD COLUMN ephemeral_5m_tokens INTEGER DEFAULT 0`);
  } catch { /* column may already exist */ }
  try {
    sqlite.exec(`ALTER TABLE queries ADD COLUMN ephemeral_1h_tokens INTEGER DEFAULT 0`);
  } catch { /* column may already exist */ }

  sqlite.exec(`
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
    )
  `);

  // Add caller_type column if it doesn't exist (for existing databases)
  try {
    sqlite.exec(`ALTER TABLE tool_uses ADD COLUMN caller_type TEXT`);
  } catch { /* column may already exist */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS file_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      tool_use_id TEXT,
      operation TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_extension TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  // Add file_extension column if it doesn't exist (for existing databases)
  try {
    sqlite.exec(`ALTER TABLE file_operations ADD COLUMN file_extension TEXT`);
  } catch { /* column may already exist */ }

  sqlite.exec(`
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
    )
  `);

  // ─── New Tables (Phase 1 additions) ───────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bash_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      query_id TEXT,
      command TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      timestamp INTEGER
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      error_type TEXT NOT NULL,
      error_message TEXT,
      status_code INTEGER,
      timestamp INTEGER
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS skill_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      skill_name TEXT NOT NULL,
      args TEXT,
      query_index INTEGER,
      timestamp INTEGER
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_spawns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL,
      description TEXT,
      query_index INTEGER,
      timestamp INTEGER
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS slash_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      command TEXT NOT NULL,
      timestamp INTEGER
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS context_window_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      query_index INTEGER NOT NULL,
      cumulative_tokens INTEGER,
      cache_hit_ratio REAL,
      cost_this_query REAL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pr_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      pr_url TEXT NOT NULL,
      pr_repository TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  // Create indexes for common query patterns
  sqlite.exec(`CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_path)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS sessions_start_time_idx ON sessions(start_time)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS sessions_parent_idx ON sessions(parent_session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS queries_session_idx ON queries(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS queries_timestamp_idx ON queries(timestamp)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS queries_model_idx ON queries(model)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tool_uses_query_idx ON tool_uses(query_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tool_uses_session_idx ON tool_uses(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tool_uses_tool_name_idx ON tool_uses(tool_name)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tool_uses_target_path_idx ON tool_uses(target_path)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS file_ops_session_idx ON file_operations(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS file_ops_path_idx ON file_operations(file_path)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS hook_events_session_idx ON hook_events(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS hook_events_type_idx ON hook_events(hook_type)`);

  // New table indexes
  sqlite.exec(`CREATE INDEX IF NOT EXISTS bash_commands_session_idx ON bash_commands(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS bash_commands_category_idx ON bash_commands(category)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS api_errors_session_idx ON api_errors(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS api_errors_type_idx ON api_errors(error_type)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS skill_invocations_session_idx ON skill_invocations(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS skill_invocations_skill_idx ON skill_invocations(skill_name)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS agent_spawns_session_idx ON agent_spawns(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS agent_spawns_type_idx ON agent_spawns(agent_type)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS slash_commands_session_idx ON slash_commands(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS slash_commands_command_idx ON slash_commands(command)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS context_usage_session_idx ON context_window_usage(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS context_usage_query_idx ON context_window_usage(query_index)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS pr_links_session_idx ON pr_links(session_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS pr_links_repo_idx ON pr_links(pr_repository)`);

  sqlite.close();
}

// Run if executed directly
if (import.meta.main) {
  console.log("Initializing database...");
  initializeDatabase();
  console.log(`Database initialized at ${DB_PATH}`);
}
