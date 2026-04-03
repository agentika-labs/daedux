# Daedux

Claude Code analytics dashboard with dual-mode architecture (Electrobun desktop + CLI/web).

## Commands

```bash
# Development
bun run dev           # CLI server (3456) + Vite frontend (5173)
bun run dev:desktop   # Desktop app (builds dylib, starts Vite + Electrobun)

# Native
bun run build:native-effects  # Rebuild macOS dylib (auto-runs in dev:desktop)

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

**Native macOS Layer** (desktop only):

```
native/macos/window-effects.mm          → Objective-C++ source
    ↓ compiled by scripts/build-macos-effects.sh
src/bun/libMacWindowEffects.dylib        → loaded via Bun FFI (dlopen)
    ↓ called from
src/bun/native/macos-effects.ts          → FFI bridge (symbols + setup)
    ↓ exclusion zones sent from renderer via RPC
src/mainview/hooks/useDragExclusionZones.ts → React hook (getBoundingClientRect → RPC)
```

View hierarchy inside the NSWindow contentView (back → front):

1. `NSVisualEffectView` — frosted glass vibrancy (behind WebView)
2. `WKWebView` — Electrobun's renderer (the web content)
3. `ElectrobunNativeDragView` — transparent 60px overlay at top, captures mouseDown for window drag

The drag view uses `hitTest:` to decide per-click: return `self` to drag the window, or return `nil` to pass the click through to the WebView (for buttons). Exclusion zone rects are sent from the renderer whenever header buttons change position.

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

| File                           | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `src/shared/rpc-types.ts`      | Frontend-backend contract (source of truth) |
| `src/bun/db/schema.ts`         | Drizzle database schema                     |
| `src/bun/errors.ts`            | Domain error definitions                    |
| `src/bun/main.ts`              | Effect Layer composition                    |
| `src/mainview/hooks/useApi.ts` | Environment-aware API client                |
| `native/macos/window-effects.mm`      | Obj-C++ native effects (vibrancy, drag, traffic lights) |
| `src/bun/native/macos-effects.ts`     | Bun FFI bridge to the native dylib          |

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

7. **Native view coordinates (two systems in play)**: `setFrame:` uses the *contentView's* coordinate system (check `[contentView isFlipped]` to determine y-axis direction). The drag view's own `isFlipped` (returns YES) only affects its *internal* coordinates — this makes hitTest/exclusion zones align with `getBoundingClientRect()` (y=0 at top). To pin the drag view to the visual top on resize, the *bottom* margin must be flexible: `NSViewMinYMargin` for non-flipped superviews, `NSViewMaxYMargin` for flipped.

8. **Rebuild dylib after .mm changes**: Run `bun run build:native-effects` (or restart `dev:desktop`). A stale dylib silently uses old native code.

9. **Fullscreen vibrancy**: `behindWindow` blending causes a red artifact in fullscreen (no window behind to sample). Native code auto-switches to `withinWindow` on fullscreen entry and hides the invisible toolbar to prevent header overlap.

10. **Path aliases**:
   - `@/*` → `./src/mainview/*`
   - `@shared/*` → `./src/shared/*`
   - `~/*` → `./src/*`
