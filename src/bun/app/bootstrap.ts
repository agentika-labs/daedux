import { Effect, ParseResult } from "effect";

import { DatabaseService } from "../db";
import { initializeDatabase } from "../db/migrate";
import { DatabaseError, OtelStorageError } from "../errors";
import {
  configureBackgroundScan,
  configureScheduler,
} from "../lifecycle/intervals";
import type { OtlpResponse } from "../otel/receiver";
import { cleanupOtelData } from "../otel/retention";
import { clearIntervalIfActive } from "../utils/intervals";
import { log } from "../utils/log";
import { getRuntime, runEffect } from "./runtime";
import {
  getSettings,
  getScanIntervalId,
  getSchedulerIntervalId,
  setScanIntervalId,
  setSchedulerIntervalId,
} from "./state";
import type { SyncCallbacks } from "./sync-operations";
import { runSyncWithNotifications } from "./sync-operations";

// ─── Background Task Configuration ──────────────────────────────────────────

export const resetBackgroundScan = (
  intervalMinutes: number,
  syncCallbacks: SyncCallbacks
): void => {
  clearIntervalIfActive(getScanIntervalId, setScanIntervalId);
  const newIntervalId = configureBackgroundScan(intervalMinutes, () => {
    void runSyncWithNotifications(false, syncCallbacks);
  });
  setScanIntervalId(newIntervalId);
};

export const resetScheduler = (enabled: boolean): void => {
  clearIntervalIfActive(getSchedulerIntervalId, setSchedulerIntervalId);
  const newIntervalId = configureScheduler(enabled, runEffect);
  setSchedulerIntervalId(newIntervalId);
};

// ─── OTEL HTTP Server ───────────────────────────────────────────────────────

let otelServer: ReturnType<typeof Bun.serve> | null = null;

export const startOtelServer = (
  handleMetrics: OtelHandler,
  handleLogs: OtelHandler,
  buildSuccessResponse: () => OtlpResponse,
  buildClientErrorResponse: (error: string) => OtlpResponse,
  buildServerErrorResponse: (error: string) => OtlpResponse
): void => {
  const settings = getSettings();
  if (!settings.otel?.enabled) {
    return;
  }

  const OTEL_PORT = 4318;

  otelServer = Bun.serve({
    port: OTEL_PORT,
    fetch: async (req) => {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (url.pathname === "/v1/metrics" && req.method === "POST") {
        try {
          const body = await req.json();
          await runEffect(handleMetrics(body));
          return Response.json(buildSuccessResponse());
        } catch (error) {
          return buildOtelErrorResponse(
            error,
            buildClientErrorResponse,
            buildServerErrorResponse
          );
        }
      }

      if (url.pathname === "/v1/logs" && req.method === "POST") {
        try {
          const body = await req.json();
          await runEffect(handleLogs(body));
          return Response.json(buildSuccessResponse());
        } catch (error) {
          return buildOtelErrorResponse(
            error,
            buildClientErrorResponse,
            buildServerErrorResponse
          );
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  log.info("otel", `OTEL receiver listening on port ${OTEL_PORT}`);
};

export const stopOtelServer = (): void => {
  if (otelServer) {
    otelServer.stop();
    otelServer = null;
  }
};

const buildOtelErrorResponse = (
  error: unknown,
  buildClientError: (msg: string) => OtlpResponse,
  buildServerError: (msg: string) => OtlpResponse
): Response => {
  const errorStr = String(error);
  const isParseError = errorStr.includes("ParseError");
  return Response.json(
    isParseError ? buildClientError(errorStr) : buildServerError(errorStr),
    { status: isParseError ? 400 : 500 }
  );
};

// ─── Bootstrap ──────────────────────────────────────────────────────────────

type OtelHandler = (
  body: unknown
) => Effect.Effect<
  { stored: number },
  OtelStorageError | DatabaseError | ParseResult.ParseError,
  DatabaseService
>;

export interface BootstrapDeps {
  syncCallbacks: SyncCallbacks;
  onTrayRefresh: () => void;
  handleMetrics: OtelHandler;
  handleLogs: OtelHandler;
  buildSuccessResponse: () => OtlpResponse;
  buildClientErrorResponse: (error: string) => OtlpResponse;
  buildServerErrorResponse: (error: string) => OtlpResponse;
  refreshApplicationMenu: () => void;
  checkForUpdates: () => Promise<void>;
}

export const bootstrap = async (deps: BootstrapDeps): Promise<void> => {
  const settings = getSettings();

  // Force all Effect layers to build NOW, before the webview can make RPC calls.
  // ManagedRuntime.make() is lazy — layers only construct on first runPromise call.
  await getRuntime().runPromise(Effect.void);

  // Initialize database schema
  initializeDatabase();

  // Run OTEL data cleanup on startup if enabled
  if (settings.otel?.enabled) {
    const retentionDays = settings.otel.retentionDays ?? 30;
    void runEffect(cleanupOtelData(retentionDays));
  }

  // Start OTEL HTTP receiver if enabled
  startOtelServer(
    deps.handleMetrics,
    deps.handleLogs,
    deps.buildSuccessResponse,
    deps.buildClientErrorResponse,
    deps.buildServerErrorResponse
  );

  // Set up application menu
  deps.refreshApplicationMenu();

  // Configure background scan
  resetBackgroundScan(settings.scanIntervalMinutes, deps.syncCallbacks);

  // Configure scheduler if enabled
  if (settings.schedulerEnabled) {
    resetScheduler(true);
  }

  // Initial sync if enabled
  if (settings.scanOnLaunch) {
    await runSyncWithNotifications(false, deps.syncCallbacks);
  }

  // Check for updates in background (silent)
  void deps.checkForUpdates();
};
