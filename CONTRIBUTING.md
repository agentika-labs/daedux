# Contributing to Daedux

## Quick Start

```bash
git clone https://github.com/agentika-labs/daedux.git
cd daedux
bun install
bun run dev          # CLI server (3456) + Vite frontend (5173)
```

For the desktop app:

```bash
bun run dev:desktop  # Builds dylib, starts Vite + Electrobun
```

## Architecture Overview

Daedux uses a **dual-mode architecture** with unified backend logic but different communication channels:

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React 19)                     │
│              TanStack Router + Query + Table                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
           ┌──────────────┴──────────────┐
           │                             │
    ┌──────▼──────┐              ┌───────▼───────┐
    │   Desktop   │              │   CLI/Web     │
    │  WebSocket  │              │    HTTP       │
    │    RPC      │              │    Fetch      │
    └──────┬──────┘              └───────┬───────┘
           │                             │
           └──────────────┬──────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   Backend (Bun + Effect TS)                  │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │  Sync       │  │  Analytics   │  │  Anthropic        │   │
│  │  Service    │  │  Orchestrator│  │  Usage Service    │   │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬─────────┘   │
│         │                │                    │              │
│         └────────────────┼────────────────────┘              │
│                          │                                   │
│              ┌───────────▼────────────┐                      │
│              │    Database Service    │                      │
│              │   (Drizzle + SQLite)   │                      │
│              └────────────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

### Dual Mode Communication

| Mode    | Frontend  | Backend          | Communication              |
| ------- | --------- | ---------------- | -------------------------- |
| Desktop | WKWebView | Bun main process | WebSocket RPC (Electrobun) |
| CLI/Web | Browser   | Bun HTTP server  | HTTP fetch                 |

The `useApi()` hook detects the environment and returns either an RPC or HTTP client with an identical interface. This abstraction enables single-source code for both modes.

### Directory Structure

```
src/
├── bun/           # Backend (Bun runtime, Effect TS)
│   ├── analytics/ # Data aggregation services
│   ├── db/        # Drizzle schema + migrations
│   ├── parsers/   # Multi-harness JSONL parsing
│   ├── services/  # Background services (scheduler, Anthropic)
│   └── native/    # macOS FFI bridge
├── mainview/      # Frontend (React 19, TanStack)
│   ├── routes/    # TanStack Router (file-based)
│   ├── queries/   # TanStack Query definitions
│   ├── components/# UI components (Shadcn/ui, Base-UI)
│   └── hooks/     # Custom hooks
├── cli/           # CLI entry point (@effect/cli)
└── shared/        # RPC types (frontend-backend contract)
```

## Key Files

| File                           | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `src/shared/rpc-types.ts`      | Frontend-backend contract (source of truth) |
| `src/bun/db/schema.ts`         | Drizzle database schema                     |
| `src/bun/errors.ts`            | Domain error definitions                    |
| `src/bun/main.ts`              | Effect Layer composition                    |
| `src/mainview/hooks/useApi.ts` | Environment-aware API client                |

## Code Patterns

### Effect TS Services

The backend uses Effect's service pattern for dependency injection:

```typescript
// Define a service
export class AnalyticsService extends Effect.Service<AnalyticsService>()(
  "AnalyticsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DatabaseService;
      return {
        getDashboard: (filter?: DateFilter) =>
          Effect.gen(function* () {
            // Implementation using db
          }),
      };
    }),
    dependencies: [DatabaseServiceLive],
  }
) {}
```

### Typed Errors

Never throw exceptions in Effect code. Use `Effect.fail()` with tagged errors:

```typescript
// Define error
export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  { sessionId: Schema.String }
) {}

// Use it
if (!session) {
  return Effect.fail(new SessionNotFoundError({ sessionId }));
}
```

### No Barrel Exports

Import directly from source modules:

```typescript
// ✗ Don't create index.ts with re-exports
export * from "./UserRepository";

// ✓ Import directly
import { UserRepository } from "@/services/UserRepository";
```

## Frontend-Backend Contract

All API types are defined in `src/shared/rpc-types.ts`. This is the single source of truth:

1. **Backend handlers** implement methods matching these types
2. **Frontend hooks** call methods expecting these types
3. **Any API change** must update this file first

```typescript
// rpc-types.ts
export interface DashboardData {
  sessions: SessionSummary[];
  totals: TokenTotals;
  trends: TrendData[];
  // ...
}

// Backend implements
getDashboard: (filter?: DateFilter) => Effect.Effect<DashboardData, Error>;

// Frontend consumes
const { data } = useQuery({ queryFn: () => api.getDashboard(filter) });
```

## Native macOS Layer

Desktop mode includes native effects (vibrancy, window drag):

```
native/macos/window-effects.mm          → Objective-C++ source
    ↓ compiled by scripts/build-macos-effects.sh
src/bun/libMacWindowEffects.dylib       → loaded via Bun FFI (dlopen)
    ↓ called from
src/bun/native/macos-effects.ts         → FFI bridge (symbols + setup)
    ↓ exclusion zones sent from renderer via RPC
src/mainview/hooks/useDragExclusionZones.ts → React hook
```

**Rebuild after .mm changes:**

```bash
bun run build:native-effects
```

A stale dylib silently uses old native code.

## Database Schema

Located in `src/bun/db/schema.ts`:

| Table            | Purpose                                                  |
| ---------------- | -------------------------------------------------------- |
| `sessions`       | One row per JSONL file, pre-aggregated token/cost totals |
| `queries`        | One row per API call, per-call token usage               |
| `toolUses`       | Tool invocations with success/failure + duration         |
| `fileOperations` | File read/write tracking                                 |
| `hookEvents`     | Hook execution events                                    |
| `bashCommands`   | Bash command history                                     |

**Pre-aggregation**: Session totals are computed during sync, not at query time. This enables instant dashboard loads.

**Batch limits**: SQLite has a ~999 parameter limit. Batch inserts calculate safe sizes via `getSafeBatchSize()`.

## Testing

```bash
bun test              # All tests
bun test --watch      # Watch mode
bun test:coverage     # With coverage
```

Tests in `tests/unit/` and `tests/integration/`.

### Test Helpers

- `tests/helpers/test-db.ts` — In-memory SQLite for DB tests
- `tests/helpers/rpc-test-harness.ts` — Mock RPC requests

## Common Workflows

### Adding a New Dashboard Metric

1. Implement calculation in `src/bun/analytics/`
2. Add query to `AnalyticsOrchestrator`
3. Update `DashboardData` type in `rpc-types.ts`
4. Add React component in `src/mainview/components/`

### Fixing a Parser Bug

1. Add test case in `tests/integration/parser.test.ts`
2. Fix `src/bun/parsers/claude-code/parser.ts`
3. Run `bun test` to validate
4. Test full sync: `bun run dev` → trigger resync

### Adding Desktop-Only UI

1. Use `useIsDesktop()` to conditionally render
2. Add RPC handler if backend call needed
3. Update `UsageMonitorRPC` schema in `rpc-types.ts`
4. Test with `bun run dev:desktop`

## Code Quality

```bash
bun run typecheck     # TypeScript check
bun run check         # Lint (ultracite)
bun run fix           # Auto-fix lint issues
```

Run these before committing.

## Submitting PRs

1. Fork the repository
2. Create a feature branch (`feat/your-feature` or `fix/your-fix`)
3. Make changes and add tests
4. Run `bun run typecheck` and `bun run check`
5. Submit a pull request with a clear description

For bugs, include steps to reproduce. For features, explain the use case.

Questions? Open an issue at [GitHub Issues](https://github.com/agentika-labs/daedux/issues).
