# Daedux

Claude Code analytics dashboard with dual-mode architecture (Electrobun desktop + CLI/web).

## Commands

```bash
# Development
bun run dev           # CLI server (3456) + Vite frontend (5173)
bun run dev:app       # Desktop app with HMR
bun run dev:cli       # CLI server only
bun run dev:frontend  # Vite frontend only

# Quality
bun run typecheck     # TypeScript check
bun run check         # Lint (ultracite)
bun run fix           # Auto-fix lint issues
bun test              # Run tests

# Build
bun run build         # Full build (native + frontend + app)
bun run build:prod    # Production build
```

## Architecture

```
src/
├── bun/           # Backend (Bun runtime, Effect TS services)
│   ├── analytics/ # Data aggregation services
│   ├── db/        # Drizzle schema + migrations
│   ├── services/  # Background services (scheduler, Anthropic)
│   └── utils/     # Formatting, parsing utilities
├── mainview/      # Frontend (React 19, TanStack)
│   ├── routes/    # TanStack Router (file-based)
│   ├── queries/   # TanStack Query definitions
│   ├── components/# UI components (Shadcn/ui, Base-UI)
│   └── hooks/     # Custom hooks
├── cli/           # CLI entry point (@effect/cli)
└── shared/        # RPC types (frontend-backend contract)
```

**Dual Mode:**
- Desktop: Electrobun RPC (WebSocket) between main process and renderer
- CLI/Web: HTTP fetch to local server on port 3456

## Code Rules

### DO: Use Bun ecosystem
- `bun` / `bun run` over node/npm/pnpm/yarn
- `bun test` over jest/vitest
- `Bun.file()` over node:fs
- Bun auto-loads .env (no dotenv)

### DON'T: Create barrel exports
```typescript
// BAD: index.ts with re-exports
export * from "./UserRepository";
export type { User } from "./types";

// GOOD: Direct imports from source
import { UserRepository } from "@/services/UserRepository";
```

### DON'T: Add Redux/Zustand for server state
All API data goes through TanStack Query. No client-side stores for server state.

### DON'T: Throw exceptions in Effect code
Use typed errors via Effect.fail() - exceptions break Effect's error channel.

### DON'T: Over-engineer
Keep solutions simple. Don't create abstractions for one-time operations.

## Key Files

| File | Purpose |
|------|---------|
| `src/shared/rpc-types.ts` | Frontend-backend contract (source of truth) |
| `src/bun/db/schema.ts` | Drizzle database schema |
| `src/bun/errors.ts` | Domain error definitions |
| `src/bun/main.ts` | Effect Layer composition |
| `src/mainview/hooks/useApi.ts` | Environment-aware API client |

## Testing

```bash
bun test              # All tests
bun test --watch      # Watch mode
bun test:coverage     # With coverage
```

Tests in `tests/unit/` and `tests/integration/`.

## Gotchas

1. **Memory history required**: Router uses `createMemoryHistory` for desktop app's `views://` protocol (not browser history)

2. **Environment detection**: Check `window.__electrobun` to detect desktop vs web mode

3. **SQLite parameter limit**: Batch inserts must respect 999-parameter limit per statement

4. **Streaming parser**: JSONL parser streams line-by-line for memory efficiency

5. **Pre-aggregated metrics**: Token/cost totals stored in sessions table during sync (not calculated at runtime)

6. **Database locations**:
   - macOS: `~/Library/Application Support/Daedux/daedux.db`
   - Windows: `%APPDATA%/Daedux/daedux.db`
   - Linux: `~/.local/share/daedux/daedux.db`

7. **Path aliases**:
   - `@/*` → `./src/mainview/*`
   - `@shared/*` → `./src/shared/*`
   - `~/*` → `./src/*`
