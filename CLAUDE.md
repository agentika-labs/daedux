# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

claude-usage-monitor is a token usage dashboard for Claude Code. It parses session JSONL files from `~/.claude/projects/`, stores aggregated data in SQLite, and serves an interactive HTML dashboard showing costs, token usage, tool health, and cache efficiency.

## Commands

```bash
# Development
bun run dev                    # Run CLI with hot reload
bun run typecheck              # Type check with tsc --noEmit

# Testing
bun test                       # Run all tests
bun test --watch               # Watch mode
bun test tests/unit/           # Run unit tests only
bun test tests/integration/    # Run integration tests only
bun test --coverage            # Coverage report

# Building
bun run build                  # Bundle to dist/
bun run compile                # Compile to standalone binary

# CLI usage
bun src/cli.ts                 # Start dashboard server on :3456
bun src/cli.ts --json          # Output JSON to stdout, exit
bun src/cli.ts --resync        # Full resync (clears and re-parses all files)
bun src/cli.ts --verbose       # Log parse errors to stderr
```

## Architecture

### Service Layer (Effect TS)

The app uses Effect's Layer system for dependency injection:

```
AppLive (composed layer)
├── DatabaseServiceLive   # SQLite connection with Drizzle ORM
├── SyncServiceLive       # Parses JSONL files, writes to DB
└── AnalyticsServiceLive  # Reads aggregated data from DB
```

Services are defined in `src/services/`:
- `db.ts` - SQLite connection (WAL mode, 64MB cache), transaction helper
- `sync.ts` - File discovery, incremental sync by mtime, batch inserts
- `analytics.ts` - All read queries with date filtering support
- `main.ts` - Composes layers, re-exports service interfaces

### Data Flow

1. **Discovery**: `SyncService.discoverFiles()` scans `~/.claude/projects/` for `*.jsonl`
2. **Incremental sync**: Compares file mtime to cached values, skips unchanged files
3. **Parsing**: `src/services/parser.ts` extracts sessions, queries, tool uses from JSONL
4. **Storage**: Batch inserts into SQLite (respects 999-param limit)
5. **Analytics**: SQL queries aggregate data for dashboard

### Database

- Location: `~/.claude/usage-monitor.db`
- Schema: `src/db/schema.ts` (Drizzle ORM)
- Migrations: Manual via `drizzle-kit push`

Key tables:
- `sessions` - Aggregated session data (costs, tokens)
- `queries` - Per-API-call token breakdown
- `tool_uses` - Tool invocations with error tracking
- `file_operations`, `bash_commands`, `skill_invocations`, `agent_spawns` - Extended analytics

### Dashboard

- HTML: `src/dashboard.html` (imported as text)
- API: REST endpoints in `cli.ts` (`/api/data`, `/api/analytics/*`)
- Lazy loading: Core data loads fast, extended analytics load on demand

## Key Patterns

**Effect pipelines**: Use `Effect.gen` for sequential effects, `Effect.all` for parallel. Wrap database calls in `Effect.tryPromise` with typed errors.

**Date filtering**: Most analytics methods accept `DateFilter` for server-side filtering. Use `buildDateConditions()` helper for consistent SQL generation.

**Batch inserts**: SQLite has ~999 param limit. Use `getSafeBatchSize(tableName)` based on column count, insert in batches.

**Test databases**: `tests/helpers/test-db.ts` provides in-memory SQLite with schema. Use `createTestDatabaseLayer()` for Effect tests or `createTestDb()` for direct access.

**Test factories**: `tests/fixtures/factories/` provides builders for sessions, queries, etc.

## Dependencies

- **Effect TS**: Functional effects, error handling, DI
- **Drizzle ORM**: Type-safe SQL queries, schema definition
- **Bun**: Runtime, bundler, test runner, file I/O

## File Locations

- CLI entry: `src/cli.ts`
- Services: `src/services/*.ts`
- DB schema: `src/db/schema.ts`
- Pricing: `src/pricing.ts`
- Parser: `src/services/parser.ts`, `src/parser-utils.ts`
