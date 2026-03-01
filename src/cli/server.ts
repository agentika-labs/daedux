import { existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";

/**
 * HTTP server for CLI mode - serves the dashboard via Bun.serve()
 */
import { Duration, Effect, ManagedRuntime } from "effect";
import type { Layer } from "effect";

import { FileAnalyticsService } from "../bun/analytics/file-analytics";
import { SessionAnalyticsService } from "../bun/analytics/session-analytics";
import { ToolAnalyticsService } from "../bun/analytics/tool-analytics";
import { AppLive } from "../bun/main";
import { AnthropicUsageService } from "../bun/services/anthropic-usage";
import { loadDashboardData } from "../bun/services/dashboard-loader";
import { SyncService } from "../bun/sync";
import { transformSessionToRPC } from "../bun/utils/session-transformer";
import type { DateFilter, SyncResult } from "../shared/rpc-types";

export interface ServerOptions {
  port: number;
  verbose?: boolean;
  resync?: boolean;
}

const runtime = ManagedRuntime.make(AppLive);

// Default timeout for backend operations (30 seconds)
const DEFAULT_TIMEOUT_MS = 30_000;

const runEffect = <A, E>(
  effect: Effect.Effect<A, E, Layer.Layer.Success<typeof AppLive>>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<A> =>
  runtime.runPromise(
    effect.pipe(
      Effect.timeoutFail({
        duration: Duration.millis(timeoutMs),
        onTimeout: () => new Error(`Operation timed out after ${timeoutMs}ms`),
      })
    )
  );

export const parseDateFilter = (filter?: string | null): DateFilter => {
  const now = Date.now();

  switch (filter) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { endTime: now, startTime: start.getTime() };
    }
    case "7d": {
      return { endTime: now, startTime: now - 7 * 86_400_000 };
    }
    case "30d": {
      return { endTime: now, startTime: now - 30 * 86_400_000 };
    }
    case "all": {
      // Explicit full range: epoch to now
      // This ensures buildComparisonWindows detects hasFilter=true
      // and uses our bounds instead of defaulting to 7 days
      return { startTime: 0, endTime: now };
    }
    default: {
      // No filter specified (undefined/null) - returns empty
      return {};
    }
  }
};

// loadDashboardData is imported from ../bun/services/dashboard-loader

// ─── Sync Operations ─────────────────────────────────────────────────────────

const runSync = (fullResync = false) =>
  Effect.gen(function* () {
    const syncService = yield* SyncService;
    return fullResync
      ? yield* syncService.fullResync({ verbose: false })
      : yield* syncService.syncIncremental({ verbose: false });
  });

// ─── Static File Serving ─────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const getDistDir = (): string => {
  // In npm package: dist/ is sibling to bin/cli.js
  // When running from source: dist/ is at project root
  const candidates = [
    join(dirname(Bun.main), "..", "dist"),
    join(dirname(Bun.main), "dist"),
    join(process.cwd(), "dist"),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) {
      return dir;
    }
  }

  // Return first candidate as fallback (will result in 404s)
  return candidates[0] ?? join(process.cwd(), "dist");
};

const serveStatic = (pathname: string): Response | null => {
  const distDir = getDistDir();
  const filePath =
    pathname === "/" ? join(distDir, "index.html") : join(distDir, pathname);

  const file = Bun.file(filePath);
  if (!file.size) {
    return null;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new Response(file, {
    headers: { "Content-Type": contentType },
  });
};

// ─── HTTP Server ─────────────────────────────────────────────────────────────

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, verbose, resync } = options;

  // Run initial sync before starting server
  if (verbose) {
    console.log("Running initial sync...");
  }

  try {
    const syncResult = await runEffect(runSync(resync ?? false));
    if (verbose) {
      console.log(
        `Synced ${syncResult.synced} sessions (${syncResult.unchanged} unchanged, ${syncResult.errors} errors)`
      );
    }
  } catch (error) {
    console.error("Initial sync failed:", error);
  }

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // ─── Favicon (prevent 404 spam in console) ─────────────────────────────

      if (pathname === "/favicon.svg" || pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      // ─── API Routes ──────────────────────────────────────────────────────

      if (pathname === "/api/dashboard") {
        try {
          const filter = url.searchParams.get("filter");
          const dateFilter = parseDateFilter(filter);
          const data = await runEffect(loadDashboardData(dateFilter));
          return Response.json(data);
        } catch (error) {
          console.error("Dashboard data error:", error);
          return Response.json(
            { error: "Failed to load dashboard data" },
            { status: 500 }
          );
        }
      }

      if (pathname === "/api/sync" && req.method === "POST") {
        try {
          const body = await req.json().catch(() => ({}));
          const fullResync =
            (body as { fullResync?: boolean }).fullResync ?? false;
          const result = await runEffect(runSync(fullResync));
          return Response.json(result satisfies SyncResult);
        } catch (error) {
          console.error("Sync error:", error);
          return Response.json({ error: "Sync failed" }, { status: 500 });
        }
      }

      if (pathname === "/api/sync/status") {
        try {
          const status = await runEffect(
            Effect.gen(function* () {
              const sessionService = yield* SessionAnalyticsService;
              const totals = yield* sessionService.getTotals({});
              return {
                isScanning: false,
                lastScanAt: null,
                sessionCount: totals.totalSessions,
              };
            })
          );
          return Response.json(status);
        } catch (error) {
          console.error("Sync status error:", error);
          return Response.json(
            { error: "Failed to get sync status" },
            { status: 500 }
          );
        }
      }

      if (pathname.startsWith("/api/session/")) {
        const sessionId = pathname.split("/api/session/")[1];
        if (sessionId) {
          try {
            const detail = await runEffect(
              Effect.gen(function* () {
                const sessions = yield* SessionAnalyticsService;
                const tools = yield* ToolAnalyticsService;
                const files = yield* FileAnalyticsService;

                const list = yield* sessions.getSessionSummaries({
                  dateFilter: {},
                  includeSubagents: true,
                });

                const session = list.find((s) => s.sessionId === sessionId);
                if (!session) {
                  return null;
                }

                // Get additional data for the session
                const sessionToolCounts = yield* tools.getSessionToolCounts({});
                const sessionFileOps = yield* files.getSessionFileOperations(
                  {}
                );
                const sessionPrimaryModels =
                  yield* sessions.getSessionPrimaryModels({});
                const sessionAgentCounts =
                  yield* sessions.getSessionAgentCounts({});
                const sessionToolErrors =
                  yield* tools.getSessionToolErrorCounts({});

                return transformSessionToRPC({
                  session,
                  sessionTools: sessionToolCounts.get(sessionId) ?? {},
                  sessionFileOps: sessionFileOps.get(sessionId) ?? [],
                  sessionModel:
                    sessionPrimaryModels.get(sessionId) ??
                    "claude-sonnet-4-5-20251022",
                  agentCount: sessionAgentCounts.get(sessionId) ?? 0,
                  errorCount: sessionToolErrors.get(sessionId) ?? 0,
                });
              })
            );
            return Response.json(detail);
          } catch (error) {
            console.error("Session detail error:", error);
            return Response.json(
              { error: "Failed to load session" },
              { status: 500 }
            );
          }
        }
      }

      if (pathname === "/api/app-info") {
        try {
          // Read version from package.json
          const packageJsonPath = join(import.meta.dir, "../../package.json");
          const packageJson = await Bun.file(packageJsonPath).json();
          const version = packageJson.version ?? "0.0.0";

          // Construct ARM64 DMG download URL for macOS
          const downloadUrl = `https://github.com/agentika-labs/daedux/releases/download/v${version}/daedux-${version}-darwin-arm64.dmg`;

          return Response.json({
            version,
            updateAvailable: false,
            updateVersion: null,
            downloadUrl,
          });
        } catch (error) {
          console.error("App info error:", error);
          return Response.json(
            { error: "Failed to get app info" },
            { status: 500 }
          );
        }
      }

      if (pathname === "/api/anthropic-usage") {
        try {
          const usage = await runEffect(
            Effect.gen(function* () {
              const anthropicService = yield* AnthropicUsageService;
              return yield* anthropicService.getUsage();
            })
          );
          return Response.json(usage);
        } catch (error) {
          console.error("Anthropic usage error:", error);
          return Response.json(
            { error: "Failed to get usage" },
            { status: 500 }
          );
        }
      }

      if (pathname === "/api/settings") {
        // Simplified settings for CLI mode
        return Response.json({
          theme: "system",
          scanOnLaunch: true,
          scanIntervalMinutes: 5,
          customPaths: {},
          schedulerEnabled: false,
        });
      }

      // ─── Static Files ────────────────────────────────────────────────────

      // Serve index.html for root and non-API routes (SPA fallback)
      if (pathname === "/" || !pathname.startsWith("/api")) {
        const staticResponse = serveStatic(pathname);
        if (staticResponse) {
          return staticResponse;
        }

        // SPA fallback - serve index.html for client-side routing
        if (!pathname.includes(".")) {
          const indexResponse = serveStatic("/");
          if (indexResponse) {
            return indexResponse;
          }
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`\nDaedux dashboard running at http://localhost:${port}`);
  console.log("Press Ctrl+C to stop\n");

  // Keep the server running
  await new Promise(() => {});
}

export async function outputJson(filter?: string): Promise<void> {
  try {
    const syncResult = await runEffect(runSync(false));
    const dateFilter = parseDateFilter(filter);
    const data = await runEffect(loadDashboardData(dateFilter));

    console.log(
      JSON.stringify(
        {
          ...data,
          _meta: {
            syncedSessions: syncResult.synced,
            unchangedSessions: syncResult.unchanged,
            errors: syncResult.errors,
            generatedAt: new Date().toISOString(),
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(JSON.stringify({ error: String(error) }));
    process.exit(1);
  }
}
