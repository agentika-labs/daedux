/**
 * API abstraction for Electrobun RPC vs HTTP fetch.
 *
 * Detects runtime environment and provides a unified interface:
 * - Desktop app (Electrobun): Uses WebSocket RPC
 * - CLI/browser: Uses native fetch to HTTP endpoints
 */
import type {
  DashboardData,
  SyncResult,
  SessionSummary,
  AppSettings,
  AppInfo,
  AnthropicUsage,
  HarnessId,
} from "@shared/rpc-types";

// ─── Environment Detection ───────────────────────────────────────────────────

/**
 * Check if we're running in Electrobun desktop environment.
 * The __electrobun global is injected by Electrobun's webview.
 */
const isElectrobun = (): boolean =>
  typeof window !== "undefined" && "__electrobun" in window;

// ─── HTTP API Client ─────────────────────────────────────────────────────────

interface ApiClient {
  getDashboardData: (params: {
    filter?: "today" | "7d" | "30d" | "all";
    projectPath?: string;
    harness?: HarnessId;
  }) => Promise<DashboardData>;

  triggerSync: (params: { fullResync?: boolean }) => Promise<SyncResult>;

  getSyncStatus: () => Promise<{
    isScanning: boolean;
    lastScanAt: string | null;
    sessionCount: number;
  }>;

  getSessionDetail: (params: {
    sessionId: string;
  }) => Promise<SessionSummary | null>;

  getSettings: () => Promise<AppSettings>;

  getAppInfo: () => Promise<AppInfo>;

  getAnthropicUsage: () => Promise<AnthropicUsage>;
}

// Default timeout for API requests (30 seconds)
const API_TIMEOUT_MS = 30_000;

/**
 * HTTP-based API client for CLI/browser mode.
 * Uses native fetch to communicate with the local HTTP server.
 */
const createHttpClient = (): ApiClient => ({
  getDashboardData: async (params) => {
    const searchParams = new URLSearchParams();
    if (params.filter) {
      searchParams.set("filter", params.filter);
    }
    if (params.projectPath) {
      searchParams.set("projectPath", params.projectPath);
    }
    if (params.harness) {
      searchParams.set("harness", params.harness);
    }

    const url = `/api/dashboard${searchParams.toString() ? `?${searchParams}` : ""}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timed out", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  triggerSync: async (params) => {
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Sync error: ${response.status}`);
    }

    return response.json();
  },

  getSyncStatus: async () => {
    const response = await fetch("/api/sync/status");

    if (!response.ok) {
      throw new Error(`Status error: ${response.status}`);
    }

    return response.json();
  },

  getSessionDetail: async (params) => {
    const response = await fetch(`/api/session/${params.sessionId}`);

    if (!response.ok) {
      throw new Error(`Session error: ${response.status}`);
    }

    return response.json();
  },

  getSettings: async () => {
    const response = await fetch("/api/settings");

    if (!response.ok) {
      throw new Error(`Settings error: ${response.status}`);
    }

    return response.json();
  },

  getAppInfo: async () => {
    const response = await fetch("/api/app-info");

    if (!response.ok) {
      throw new Error(`App info error: ${response.status}`);
    }

    return response.json();
  },

  getAnthropicUsage: async () => {
    const response = await fetch("/api/anthropic-usage");

    if (!response.ok) {
      throw new Error(`Usage error: ${response.status}`);
    }

    return response.json();
  },
});

// ─── Electrobun RPC Client ───────────────────────────────────────────────────

/**
 * RPC-based API client for Electrobun desktop mode.
 * Wraps the electroview RPC methods with the same interface.
 */
const createRpcClient = (): ApiClient => {
  // Lazy-load electroview on first request to avoid importing electrobun in browser builds
  let electroviewPromise: Promise<typeof import("./useRPC")> | null = null;

  const getElectroview = () => {
    if (!electroviewPromise) {
      electroviewPromise = import("./useRPC");
    }
    return electroviewPromise;
  };

  return {
    getDashboardData: async (params) => {
      const { electroview } = await getElectroview();
      return electroview.request.getDashboardData(params);
    },
    triggerSync: async (params) => {
      const { electroview } = await getElectroview();
      return electroview.request.triggerSync(params);
    },
    getSyncStatus: async () => {
      const { electroview } = await getElectroview();
      return electroview.request.getSyncStatus({});
    },
    getSessionDetail: async (params) => {
      const { electroview } = await getElectroview();
      return electroview.request.getSessionDetail(params);
    },
    getSettings: async () => {
      const { electroview } = await getElectroview();
      return electroview.request.getSettings({});
    },
    getAppInfo: async () => {
      const { electroview } = await getElectroview();
      return electroview.request.getAppInfo({});
    },
    getAnthropicUsage: async () => {
      const { electroview } = await getElectroview();
      return electroview.request.getAnthropicUsage({});
    },
  };
};

// ─── Singleton Client ────────────────────────────────────────────────────────

let cachedClient: ApiClient | null = null;

/**
 * Get the API client for the current environment.
 * Creates a singleton instance on first call.
 */
export const getApiClient = (): ApiClient => {
  if (!cachedClient) {
    cachedClient = isElectrobun() ? createRpcClient() : createHttpClient();
  }
  return cachedClient;
};

// ─── React Hook ──────────────────────────────────────────────────────────────

/**
 * Hook to get the API client for making requests.
 *
 * @example
 * ```tsx
 * const api = useApi();
 * const data = await api.getDashboardData({ filter: "7d" });
 * ```
 */
export const useApi = (): ApiClient => getApiClient();

/**
 * Check if the app is running in desktop mode (Electrobun).
 * Useful for conditionally rendering desktop-only features.
 */
export const useIsDesktop = (): boolean => isElectrobun();
