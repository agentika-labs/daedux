import { useCallback, useMemo, useRef, useEffect } from "react";
import type {
  DashboardData,
  TrayStats,
  AppSettings,
  SyncResult,
  SessionSummary,
} from "@shared/rpc-types";

// ─── RPC Request Types ──────────────────────────────────────────────────────

interface RPCRequests {
  getDashboardData: (params: { filter?: string; projectPath?: string }) => Promise<DashboardData>;
  getAnalytics: (params: { category: string; filter?: string; projectPath?: string }) => Promise<unknown>;
  getSessionDetail: (params: { sessionId: string }) => Promise<SessionSummary | null>;
  triggerSync: (params: { fullResync?: boolean }) => Promise<SyncResult>;
  getSyncStatus: () => Promise<{ isScanning: boolean; lastScanAt: string | null; sessionCount: number }>;
  getTrayStats: () => Promise<TrayStats>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<boolean>;
}

interface RPCMessages {
  log: (params: { msg: string; level?: "info" | "warn" | "error" }) => void;
  openExternal: (params: { url: string }) => void;
}

// Types for messages we receive from main process
interface RPCSends {
  syncStarted: Record<string, never>;
  syncProgress: { current: number; total: number };
  syncCompleted: { synced: number; errors: number };
  navigate: { view: string };
  themeChanged: { theme: "system" | "light" | "dark" };
  sessionsUpdated: { scanResult: { scanned: number; total: number } };
}

type SendKey = keyof RPCSends;
type SendPayload<K extends SendKey> = RPCSends[K];
type MessageListener<K extends SendKey> = (payload: SendPayload<K>) => void;

/**
 * Electrobun exposes RPC on window.rpc
 */
interface ElectrobunRPC {
  request: <K extends keyof RPCRequests>(
    method: K,
    params: Parameters<RPCRequests[K]>[0]
  ) => Promise<Awaited<ReturnType<RPCRequests[K]>>>;
  send: <K extends keyof RPCMessages>(
    method: K,
    params: Parameters<RPCMessages[K]>[0]
  ) => void;
  on: <K extends SendKey>(event: K, callback: MessageListener<K>) => void;
  off: <K extends SendKey>(event: K, callback: MessageListener<K>) => void;
}

declare global {
  interface Window {
    rpc?: ElectrobunRPC;
  }
}

// Check if we're in an Electrobun environment
const isElectrobun = typeof window !== "undefined" && window.rpc !== undefined;

// Mock RPC for development (when running without Electrobun)
const createMockRPC = (): ElectrobunRPC => {
  const listeners = new Map<string, Set<MessageListener<SendKey>>>();

  // Mock data for development
  const mockDashboardData: DashboardData = {
    totals: {
      totalSessions: 42,
      totalSubagents: 15,
      totalQueries: 1234,
      totalToolUses: 5678,
      totalCost: 12.34,
      totalInputTokens: 1_500_000,
      totalOutputTokens: 500_000,
      totalCacheRead: 800_000,
      totalCacheWrite: 200_000,
      totalTokens: 2_000_000,
      output: 500_000,
      uncachedInput: 700_000,
      cacheRead: 800_000,
      cacheCreation: 200_000,
      savedByCaching: 5.67,
      cacheEfficiencyRatio: 0.53,
      cacheSavingsUsd: 5.67,
      avgCostPerSession: 0.29,
      avgCostPerQuery: 0.01,
      avgSessionDurationMs: 180_000,
      dateRange: { from: "2024-01-01", to: "2024-12-31" },
      costPerEdit: 0.02,
      totalFileOperations: 500,
      contextEfficiencyScore: 75,
      avgContextUtilization: 65,
      agentLeverageRatio: 2.5,
      totalAgentSpawns: 15,
      promptEfficiencyRatio: 0.33,
      totalSkillInvocations: 25,
    },
    dailyUsage: [],
    sessions: [],
    projects: [],
    insights: [],
    efficiencyScore: {
      overall: 75,
      cacheEfficiency: 80,
      toolSuccess: 95,
      sessionEfficiency: 60,
      trend: "improving",
      topOpportunity: "Increase cache utilization",
    },
    weeklyComparison: {
      thisWeek: {
        sessions: 20,
        cost: 5.5,
        costPerSession: 0.275,
        cacheHitRate: 0.53,
        toolErrorRate: 0.05,
        avgQueriesPerSession: 30,
      },
      lastWeek: {
        sessions: 18,
        cost: 6.0,
        costPerSession: 0.333,
        cacheHitRate: 0.48,
        toolErrorRate: 0.08,
        avgQueriesPerSession: 28,
      },
      changes: {
        sessions: 2,
        cost: -0.5,
        costPerSession: -0.058,
        cacheHitRate: 0.05,
        toolErrorRate: -0.03,
        avgQueriesPerSession: 2,
      },
      improvements: ["Cost per session decreased 17%", "Cache hit rate up 5%"],
      concerns: [],
    },
    modelBreakdown: [],
    toolUsage: [],
    topPrompts: [],
    toolHealth: [],
    agentROI: {
      agents: [],
      summary: {
        totalSpawns: 15,
        totalAgentCost: 1.5,
        avgCostPerSpawn: 0.1,
        mostUsedAgent: "code-reviewer",
        highestROIAgent: "code-reviewer",
        underusedAgents: [],
        recommendations: [],
      },
    },
    toolHealthReportCard: {
      reliableTools: [],
      frictionPoints: [],
      bashDeepDive: [],
      headline: "Tools are performing well",
      recommendation: "No action needed",
    },
  };

  return {
    request: async <K extends keyof RPCRequests>(
      method: K,
      _params: Parameters<RPCRequests[K]>[0]
    ): Promise<Awaited<ReturnType<RPCRequests[K]>>> => {
      console.log(`[Mock RPC] request: ${method}`, _params);

      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      switch (method) {
        case "getDashboardData":
          return mockDashboardData as Awaited<ReturnType<RPCRequests[K]>>;
        case "triggerSync":
          return { synced: 10, total: 50, unchanged: 40, errors: 0 } as Awaited<
            ReturnType<RPCRequests[K]>
          >;
        case "getSyncStatus":
          return {
            isScanning: false,
            lastScanAt: new Date().toISOString(),
            sessionCount: 42,
          } as Awaited<ReturnType<RPCRequests[K]>>;
        case "getTrayStats":
          return {
            todayTokens: 50_000,
            todayCost: 0.5,
            todaySessions: 5,
            todayEvents: 150,
            activeSessions: 0,
          } as Awaited<ReturnType<RPCRequests[K]>>;
        case "getSettings":
          return {
            theme: "system",
            scanOnLaunch: true,
            scanIntervalMinutes: 5,
            customPaths: {},
          } as Awaited<ReturnType<RPCRequests[K]>>;
        default:
          console.warn(`[Mock RPC] Unhandled method: ${method}`);
          return null as Awaited<ReturnType<RPCRequests[K]>>;
      }
    },
    send: <K extends keyof RPCMessages>(method: K, params: Parameters<RPCMessages[K]>[0]) => {
      console.log(`[Mock RPC] send: ${method}`, params);
    },
    on: <K extends SendKey>(event: K, callback: MessageListener<K>) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback as MessageListener<SendKey>);
    },
    off: <K extends SendKey>(event: K, callback: MessageListener<K>) => {
      listeners.get(event)?.delete(callback as MessageListener<SendKey>);
    },
  };
};

const rpcInstance = isElectrobun ? window.rpc! : createMockRPC();

/**
 * Hook to interact with the Electrobun main process via RPC.
 */
export function useRPC() {
  const listenersRef = useRef<Map<string, Set<MessageListener<SendKey>>>>(new Map());

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      for (const [event, callbacks] of listenersRef.current) {
        for (const callback of callbacks) {
          rpcInstance.off(event as SendKey, callback);
        }
      }
      listenersRef.current.clear();
    };
  }, []);

  const request = useCallback(
    async <K extends keyof RPCRequests>(
      method: K,
      params: Parameters<RPCRequests[K]>[0]
    ): Promise<Awaited<ReturnType<RPCRequests[K]>>> => {
      const result = await rpcInstance.request(method, params);
      return result;
    },
    []
  );

  const send = useCallback(
    <K extends keyof RPCMessages>(method: K, params: Parameters<RPCMessages[K]>[0]): void => {
      rpcInstance.send(method, params);
    },
    []
  );

  const addMessageListener = useCallback(
    <K extends SendKey>(event: K, callback: MessageListener<K>): void => {
      if (!listenersRef.current.has(event)) {
        listenersRef.current.set(event, new Set());
      }
      listenersRef.current.get(event)!.add(callback as MessageListener<SendKey>);
      rpcInstance.on(event, callback);
    },
    []
  );

  const removeMessageListener = useCallback(
    <K extends SendKey>(event: K, callback: MessageListener<K>): void => {
      listenersRef.current.get(event)?.delete(callback as MessageListener<SendKey>);
      rpcInstance.off(event, callback);
    },
    []
  );

  return useMemo(
    () => ({
      request,
      send,
      addMessageListener,
      removeMessageListener,
    }),
    [request, send, addMessageListener, removeMessageListener]
  );
}

/**
 * Utility hook to log messages to the main process
 */
export function useLogger() {
  const { send } = useRPC();

  return useMemo(
    () => ({
      info: (msg: string) => send("log", { msg, level: "info" }),
      warn: (msg: string) => send("log", { msg, level: "warn" }),
      error: (msg: string) => send("log", { msg, level: "error" }),
    }),
    [send]
  );
}
