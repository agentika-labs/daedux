/**
 * RPC type definitions shared between Electrobun main process and renderer.
 * These define the contract for communication between frontend and backend.
 */

import type { RPCSchema } from "electrobun/bun";

// ─── Date Filter ────────────────────────────────────────────────────────────

export interface DateFilter {
  startTime?: number;
  endTime?: number;
}

// ─── Dashboard Data Types ───────────────────────────────────────────────────

export interface DashboardTotals {
  totalSessions: number;
  totalSubagents: number;
  totalQueries: number;
  totalToolUses: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  output: number;
  uncachedInput: number;
  cacheRead: number;
  cacheCreation: number;
  savedByCaching: number;
  cacheEfficiencyRatio: number;
  cacheSavingsUsd: number;
  avgCostPerSession: number;
  avgCostPerQuery: number;
  avgSessionDurationMs: number;
  dateRange: { from: string; to: string };
  costPerEdit: number;
  totalFileOperations: number;
  contextEfficiencyScore: number;
  avgContextUtilization: number;
  agentLeverageRatio: number;
  totalAgentSpawns: number;
  promptEfficiencyRatio: number;
  totalSkillInvocations: number;
}

export interface DailyStat {
  date: string;
  sessionCount: number;
  queryCount: number;
  totalCost: number;
  totalTokens: number;
  uncachedInput: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

export interface SessionSummary {
  sessionId: string;
  project: string;
  date: string;
  displayName: string | null;
  startTime: number;
  durationMs: number;
  totalCost: number;
  queryCount: number;
  toolUseCount: number;
  isSubagent: boolean;
  model: string;
  modelShort: string;
  firstPrompt: string;
  totalTokens: number;
  savedByCaching: number;
  uncachedInput: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
  compactions: number;
  subagentCount: number;
  toolErrorCount: number;
  bashCommandCount: number;
  fileReadCount: number;
  fileEditCount: number;
  fileWriteCount: number;
  toolCounts: Record<string, number>;
  queries: unknown[];
  fileActivityDetails: Array<{ filePath: string; tool: string; extension: string }>;
}

export interface ProjectSummary {
  projectPath: string;
  sessionCount: number;
  totalCost: number;
  totalQueries: number;
  lastActivity: number;
}

export interface ModelBreakdown {
  model: string;
  modelShort: string;
  modelFamily: string;
  rawModelIds: string[];
  totalTokens: number;
  totalCost: number;
  queries: number;
  sessions: number;
}

export interface EfficiencyScore {
  overall: number;
  cacheEfficiency: number;
  toolSuccess: number;
  sessionEfficiency: number;
  trend: "improving" | "declining" | "stable";
  topOpportunity: string;
}

export interface WeeklyStats {
  sessions: number;
  cost: number;
  costPerSession: number;
  cacheHitRate: number;
  toolErrorRate: number;
  avgQueriesPerSession: number;
}

export interface WeeklyComparison {
  thisWeek: WeeklyStats;
  lastWeek: WeeklyStats;
  changes: WeeklyStats;
  improvements: string[];
  concerns: string[];
}

export interface Insight {
  type: "success" | "warning" | "info";
  title: string;
  description: string;
  action: string;
  priority?: number;
  comparison?: {
    thisWeek: number;
    lastWeek: number;
    changePercent: number;
    direction: "up" | "down" | "flat";
  };
}

export interface AgentROIEntry {
  agentType: string;
  spawns: number;
  totalCost: number;
  avgCostPerSpawn: number;
  toolsTriggered: number;
  avgToolsPerSpawn: number;
  successRate: number;
  roi: number;
  category: "high-value" | "low-value" | "experimental";
}

export interface AgentROISummary {
  totalSpawns: number;
  totalAgentCost: number;
  avgCostPerSpawn: number;
  mostUsedAgent: string;
  highestROIAgent: string;
  underusedAgents: string[];
  recommendations: string[];
}

export interface AgentROI {
  agents: AgentROIEntry[];
  summary: AgentROISummary;
}

export interface ToolHealthEntry {
  name: string;
  totalCalls: number;
  errors: number;
  errorRate: number;
  topErrors: Array<{ message: string; count: number }>;
}

export interface ToolHealthReportCard {
  reliableTools: Array<{ name: string; successRate: number; totalCalls: number }>;
  frictionPoints: Array<{ name: string; errorRate: number; topError: string; totalCalls: number }>;
  bashDeepDive: Array<{
    category: string;
    totalCommands: number;
    errorCount: number;
    errorRate: number;
    topErrors: Array<{ message: string; count: number }>;
    fixSuggestions: string[];
  }>;
  headline: string;
  recommendation: string;
}

// ─── Dashboard Payload ──────────────────────────────────────────────────────

export interface DashboardData {
  totals: DashboardTotals;
  dailyUsage: DailyStat[];
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  insights: Insight[];
  efficiencyScore: EfficiencyScore;
  weeklyComparison: WeeklyComparison;
  modelBreakdown: ModelBreakdown[];
  toolUsage: Array<{ name: string; count: number; sessions: number }>;
  topPrompts: Array<{
    prompt: string;
    date: string;
    model: string;
    totalTokens: number;
    cost: number;
    sessionId: string;
  }>;
  toolHealth: ToolHealthEntry[];
  agentROI: AgentROI;
  toolHealthReportCard: ToolHealthReportCard;
}

// ─── Tray Stats ─────────────────────────────────────────────────────────────

export interface TrayStats {
  todayTokens: number;
  todayCost: number;
  todaySessions: number;
  todayEvents: number;
  activeSessions: number;
}

// ─── App Settings ───────────────────────────────────────────────────────────

export interface AppSettings {
  theme: "system" | "light" | "dark";
  scanOnLaunch: boolean;
  scanIntervalMinutes: number;
  customPaths: Record<string, string>;
}

// ─── Sync Result ────────────────────────────────────────────────────────────

export interface SyncResult {
  synced: number;
  total: number;
  unchanged: number;
  errors: number;
}

// ─── Electrobun RPC Schema ──────────────────────────────────────────────────

/**
 * Electrobun RPC schema - defines messages between main process (bun) and renderer (webview).
 * The `bun` key defines what the main process can handle.
 * The `webview` key defines what the renderer can handle.
 */
export type UsageMonitorRPC = {
  bun: RPCSchema<{
    requests: {
      getDashboardData: {
        params: { filter?: "today" | "7d" | "30d" | "all"; projectPath?: string };
        response: DashboardData;
      };
      getAnalytics: {
        params: { category: string; filter?: string; projectPath?: string };
        response: unknown;
      };
      getSessionDetail: {
        params: { sessionId: string };
        response: SessionSummary | null;
      };
      triggerSync: {
        params: { fullResync?: boolean };
        response: SyncResult;
      };
      getSyncStatus: {
        params: Record<string, never>;
        response: { isScanning: boolean; lastScanAt: string | null; sessionCount: number };
      };
      getTrayStats: {
        params: Record<string, never>;
        response: TrayStats;
      };
      getSettings: {
        params: Record<string, never>;
        response: AppSettings;
      };
      updateSettings: {
        params: Partial<AppSettings>;
        response: boolean;
      };
    };
    messages: {
      log: { msg: string; level?: "info" | "warn" | "error" };
      openExternal: { url: string };
    };
  }>;

  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      syncStarted: Record<string, never>;
      syncProgress: { current: number; total: number };
      syncCompleted: { synced: number; errors: number };
      navigate: { view: string };
      themeChanged: { theme: "system" | "light" | "dark" };
      sessionsUpdated: { scanResult: { scanned: number; total: number } };
    };
  }>;
};
