import { Effect } from "effect";
import { initializeDatabase } from "./db/migrate";
import { AppLive } from "./services/main";
import { SyncService } from "./services/sync";
import {
  SessionAnalyticsService,
  ModelAnalyticsService,
  ToolAnalyticsService,
  FileAnalyticsService,
  AgentAnalyticsService,
  ContextAnalyticsService,
  InsightsAnalyticsService,
} from "./services/analytics/index";
import { DatabaseError, ParseError, FileSystemError } from "./services/errors";
import type {
  Totals,
  DailyStat,
  SessionSummary,
  ProjectSummary,
  ModelBreakdown,
  BashCommandStat,
  FileActivityStat,
  FileExtensionStat,
  HookStat,
  ApiErrorStat,
  SkillROI,
  AgentStat,
  AgentROI,
  AgentUsageSummary,
  CommandStat,
  ContextHeatmapPoint,
  CacheEfficiencyPoint,
  CompactionAnalysis,
  ContextWindowFillPoint,
  PeakContextData,
  Insight,
  ExtendedTotals,
  DateFilter,
  EfficiencyScore,
  WeeklyComparison,
  ToolHealthReportCard,
  ToolHealthStat,
  DashboardStats,
} from "./services/analytics/index";
import { getPricing, modelDisplayNameWithVersion } from "./utils/pricing";
import dashboardHtml from "./dashboard.html" with { type: "text" };
import dashboardCss from "./dashboard.css" with { type: "text" };

// ─── CLI Args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const portArg = args.find((_, i) => args[i - 1] === "--port");
const PORT = portArg ? parseInt(portArg, 10) : 3456;
const NO_OPEN = args.includes("--no-open");
const JSON_MODE = args.includes("--json");
const HELP = args.includes("--help") || args.includes("-h");
const RESYNC = args.includes("--resync");
const VERBOSE = args.includes("--verbose") || args.includes("-v");

if (HELP) {
  console.log(`
claude-usage-monitor — Claude Code token usage dashboard

Usage:
  bun src/cli.ts [options]

Options:
  --port <n>    Port to serve on (default: 3456)
  --no-open     Don't auto-open the browser
  --json        Output JSON summary to stdout, then exit
  --resync      Force full resync of all session files
  -v, --verbose Log files that fail to parse (helps diagnose sync errors)
  -h, --help    Show this help
`);
  process.exit(0);
}

// ─── Dashboard Payload Types ─────────────────────────────────────────────────────

/**
 * Dashboard-compatible session format.
 * The dashboard HTML expects specific field names and computed values.
 */
interface DashboardSession {
  sessionId: string;
  project: string; // Dashboard expects 'project' not 'projectPath'
  date: string; // YYYY-MM-DD string (dashboard filters by string comparison)
  displayName: string | null;
  startTime: number;
  durationMs: number;
  totalCost: number;
  queryCount: number;
  toolUseCount: number;
  isSubagent: boolean;
  // Computed/default fields
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
  // Per-session detail arrays for client-side re-aggregation when filtering
  fileActivityDetails: Array<{ filePath: string; tool: string; extension: string }>;
}

/**
 * Dashboard-compatible totals format.
 * Includes computed metrics the dashboard expects.
 */
interface DashboardTotals {
  totalSessions: number;
  totalSubagents: number;
  totalQueries: number;
  totalToolUses: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  // Computed metrics
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
  // ROI metrics (defaults)
  costPerEdit: number;
  totalFileOperations: number;
  contextEfficiencyScore: number;
  avgContextUtilization: number;
  agentLeverageRatio: number;
  totalAgentSpawns: number;
  promptEfficiencyRatio: number;
  totalSkillInvocations: number;
}

/**
 * Payload format expected by dashboard.html
 */
interface DashboardPayload {
  totals: DashboardTotals;
  dailyUsage: DailyStat[]; // Dashboard expects 'dailyUsage' not 'dailyStats'
  sessions: DashboardSession[];
  projects: ProjectSummary[];
  insights: Array<{
    type: 'success' | 'warning' | 'info';
    title: string;
    description: string;
    action: string;
    priority?: number;
    comparison?: {
      thisWeek: number;
      lastWeek: number;
      changePercent: number;
      direction: 'up' | 'down' | 'flat';
    };
  }>;
  // Story-driven analytics (Phase 1)
  efficiencyScore: {
    overall: number;
    cacheEfficiency: number;
    toolSuccess: number;
    sessionEfficiency: number;
    trend: 'improving' | 'declining' | 'stable';
    topOpportunity: string;
  };
  weeklyComparison: {
    thisWeek: {
      sessions: number;
      cost: number;
      costPerSession: number;
      cacheHitRate: number;
      toolErrorRate: number;
      avgQueriesPerSession: number;
    };
    lastWeek: {
      sessions: number;
      cost: number;
      costPerSession: number;
      cacheHitRate: number;
      toolErrorRate: number;
      avgQueriesPerSession: number;
    };
    changes: {
      sessions: number;
      cost: number;
      costPerSession: number;
      cacheHitRate: number;
      toolErrorRate: number;
      avgQueriesPerSession: number;
    };
    improvements: string[];
    concerns: string[];
  };
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
  // Extended analytics (Phase 4 additions)
  toolHealth: Array<{
    name: string;
    totalCalls: number;
    errors: number;
    errorRate: number;
    topErrors: Array<{ message: string; count: number }>;
  }>;
  bashCommands: BashCommandStat[];
  fileActivity: FileActivityStat[];
  fileExtensions: FileExtensionStat[];
  hookStats: HookStat[];
  apiErrors: ApiErrorStat[];
  skillROI: SkillROI[];
  agentStats: Array<{
    agentType: string;
    invocationCount: number;
    successCount: number;
    errorCount: number;
  }>;
  commandStats: Array<{
    command: string;
    usageCount: number;
    avgSessionCost: number;
  }>;
  contextHeatmap: Array<{
    turnBucket: string;
    utilizationBucket: string;
    count: number;
    avgCostPerTurn: number;
  }>;
  cacheEfficiencyCurve: Array<{
    turn: number;
    avgCacheHitRatio: number;
  }>;
  compactionAnalysis: {
    compactionRate: number;
    sessionsWithCompaction: number;
    totalCompactions: number;
    avgTriggerTurn: number;
  };
  // Context window visualization (redesign)
  contextWindowFill: Array<{
    turn: number;
    avgTokens: number;
    maxTokens: number;
    sessionCount: number;
    p25Tokens: number;
    p75Tokens: number;
  }>;
  peakContextDistribution: Array<{
    sessionId: string;
    peakTokens: number;
    model: string | null;
  }>;
  // Story-driven analytics (Phase 2: Agent ROI)
  agentROI: {
    agents: Array<{
      agentType: string;
      spawns: number;
      totalCost: number;
      avgCostPerSpawn: number;
      toolsTriggered: number;
      avgToolsPerSpawn: number;
      successRate: number;
      roi: number;
      category: 'high-value' | 'low-value' | 'experimental';
    }>;
    summary: {
      totalSpawns: number;
      totalAgentCost: number;
      avgCostPerSpawn: number;
      mostUsedAgent: string;
      highestROIAgent: string;
      underusedAgents: string[];
      recommendations: string[];
    };
  };
  // Story-driven analytics (Phase 3: Tool Health Deep Dive)
  toolHealthReportCard: {
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
  };
}

// ─── Dashboard Compatibility Transformation ─────────────────────────────────────

// ─── Transformation Helpers ─────────────────────────────────────────────────────
// Shared by transformForDashboard() and lazy-loaded endpoints

const transformContextHeatmap = (raw: ContextHeatmapPoint[]) =>
  raw.map((p) => ({
    turnBucket: p.turnRange,
    utilizationBucket: p.utilizationBucket,
    count: p.count,
    avgCostPerTurn: 0,
  }));

const transformCacheEfficiencyCurve = (raw: CacheEfficiencyPoint[]) =>
  raw.map((p) => ({
    turn: p.queryIndex,
    avgCacheHitRatio: p.avgCacheHitRatio,
  }));

const transformCompactionAnalysis = (raw: CompactionAnalysis) => ({
  compactionRate: raw.totalSessions > 0
    ? raw.sessionsWithCompactions / raw.totalSessions
    : 0,
  sessionsWithCompaction: raw.sessionsWithCompactions,
  totalCompactions: Math.round(
    raw.avgCompactionsPerSession * raw.sessionsWithCompactions
  ),
  avgTriggerTurn: 0,
});

const transformContextWindowFill = (raw: ContextWindowFillPoint[]) =>
  raw.map((p) => ({
    turn: p.queryIndex,
    avgTokens: p.avgCumulativeTokens,
    maxTokens: p.maxCumulativeTokens,
    sessionCount: p.sessionCount,
    p25Tokens: p.p25Tokens,
    p75Tokens: p.p75Tokens,
  }));

/** Convert timestamp (ms) to YYYY-MM-DD string in local timezone */
const toDateString = (timestamp: number): string => {
  const d = new Date(timestamp);
  // Use local timezone instead of UTC to match user's calendar day
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Transform service data to dashboard-compatible format.
 * Bridges the naming conventions and adds computed fields the dashboard expects.
 */
const transformForDashboard = (data: {
  totals: Totals;
  extendedTotals: ExtendedTotals;
  dailyStats: DailyStat[];
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  insights: Insight[];
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
  // Extended analytics (service returns dashboard-ready data)
  toolHealth: ToolHealthStat[];
  bashCommands: BashCommandStat[];
  fileActivity: FileActivityStat[];
  fileExtensions: FileExtensionStat[];
  hookStats: HookStat[];
  apiErrors: ApiErrorStat[];
  skillROI: SkillROI[];
  agentStats: AgentStat[];
  commandStats: CommandStat[];
  contextHeatmap: ContextHeatmapPoint[];
  cacheEfficiencyCurve: CacheEfficiencyPoint[];
  compactionAnalysis: CompactionAnalysis;
  contextWindowFill: ContextWindowFillPoint[];
  peakContextDistribution: PeakContextData[];
  // Per-session data for client-side reaggregation
  sessionToolCounts: Map<string, Record<string, number>>;
  sessionPrimaryModels: Map<string, string>;
  sessionFileOperations: Map<string, Array<{ filePath: string; tool: string; extension: string }>>;
  sessionAgentCounts: Map<string, number>;
  sessionToolErrorCounts: Map<string, number>;
  // Story-driven analytics (Phase 1)
  efficiencyScore: EfficiencyScore;
  weeklyComparison: WeeklyComparison;
  // Story-driven analytics (Phase 2)
  agentROI: { agents: AgentROI[]; summary: AgentUsageSummary };
  // Story-driven analytics (Phase 3)
  toolHealthReportCard: ToolHealthReportCard;
}): DashboardPayload => {
  const {
    totals,
    extendedTotals,
    dailyStats,
    sessions,
    projects,
    insights,
    modelBreakdown,
    toolUsage,
    topPrompts,
    toolHealth,
    bashCommands,
    fileActivity,
    fileExtensions,
    hookStats,
    apiErrors,
    skillROI,
    agentStats,
    commandStats,
    contextHeatmap,
    cacheEfficiencyCurve,
    compactionAnalysis,
    contextWindowFill,
    peakContextDistribution,
    // Per-session data for client-side reaggregation
    sessionToolCounts,
    sessionPrimaryModels,
    sessionFileOperations,
    sessionAgentCounts,
    sessionToolErrorCounts,
    // Story-driven analytics (Phase 1)
    efficiencyScore,
    weeklyComparison,
    // Story-driven analytics (Phase 2)
    agentROI,
    // Story-driven analytics (Phase 3)
    toolHealthReportCard,
  } = data;

  // Compute aggregate token metrics (only values actually used below)
  const totalTokens = totals.totalInputTokens + totals.totalOutputTokens;
  const uncachedInput = totals.totalInputTokens;

  // Transform totals - use extendedTotals for computed metrics
  const dashboardTotals: DashboardTotals = {
    ...totals,
    totalTokens,
    output: totals.totalOutputTokens,
    uncachedInput,
    cacheRead: totals.totalCacheRead,
    cacheCreation: totals.totalCacheWrite,
    savedByCaching: extendedTotals.savedByCaching,
    cacheEfficiencyRatio: extendedTotals.cacheEfficiencyRatio,
    cacheSavingsUsd: extendedTotals.savedByCaching,
    avgCostPerSession: extendedTotals.avgCostPerSession,
    avgCostPerQuery: extendedTotals.avgCostPerQuery,
    avgSessionDurationMs: extendedTotals.avgSessionDurationMs,
    dateRange: extendedTotals.dateRange,
    // ROI metrics from extendedTotals
    costPerEdit: extendedTotals.totalFileOperations > 0
      ? totals.totalCost / extendedTotals.totalFileOperations
      : 0,
    totalFileOperations: extendedTotals.totalFileOperations,
    contextEfficiencyScore: extendedTotals.cacheEfficiencyRatio * 100, // Scale to 0-100
    avgContextUtilization: extendedTotals.cacheEfficiencyRatio * 100,
    agentLeverageRatio: extendedTotals.agentLeverageRatio,
    totalAgentSpawns: extendedTotals.totalAgentSpawns,
    promptEfficiencyRatio:
      totals.totalInputTokens > 0
        ? totals.totalOutputTokens / totals.totalInputTokens
        : 0,
    totalSkillInvocations: extendedTotals.totalSkillInvocations,
  };

  // Transform sessions - calculate real token values for date range filtering
  const dashboardSessions: DashboardSession[] = sessions.map((s) => {
    // Note: totalInputTokens is already the uncached input (not including cache)
    const uncachedInput = s.totalInputTokens ?? 0;
    const outputTokens = s.totalOutputTokens ?? 0;
    const cacheRead = s.totalCacheRead ?? 0;
    const cacheWrite = s.totalCacheWrite ?? 0;

    // Get per-session data for client-side reaggregation
    const sessionModel = sessionPrimaryModels.get(s.sessionId) ?? "claude-sonnet-4-5-20251022";
    const sessionTools = sessionToolCounts.get(s.sessionId) ?? {};
    const sessionFileOps = sessionFileOperations.get(s.sessionId) ?? [];
    const fileReadCount = sessionFileOps.filter((op) => op.tool === "Read").length;
    const fileEditCount = sessionFileOps.filter((op) => op.tool === "Edit").length;
    const fileWriteCount = sessionFileOps.filter((op) => op.tool === "Write").length;

    return {
      sessionId: s.sessionId,
      project: s.projectPath, // Rename: projectPath → project
      date: toDateString(s.startTime), // Add date string for filtering
      displayName: s.displayName,
      startTime: s.startTime,
      durationMs: s.durationMs ?? 0,
      totalCost: s.totalCost ?? 0,
      queryCount: s.queryCount ?? 0,
      toolUseCount: s.toolUseCount ?? 0,
      isSubagent: s.isSubagent ?? false,
      // Real model from queries table (for filtered model breakdown)
      model: sessionModel,
      modelShort: modelDisplayNameWithVersion(sessionModel),
      firstPrompt: s.displayName ?? "Session",
      // Real token values from session aggregates (enables date range filtering)
      // totalTokens = uncachedInput + outputTokens (tokens consumed, matches aggregate totals)
      totalTokens: uncachedInput + outputTokens,
      // Real per-session cache savings from database
      savedByCaching: s.savedByCaching ?? 0,
      uncachedInput,
      cacheRead,
      cacheCreation: cacheWrite,
      output: outputTokens,
      compactions: s.compactions ?? 0,
      subagentCount: sessionAgentCounts.get(s.sessionId) ?? 0,
      toolErrorCount: sessionToolErrorCounts.get(s.sessionId) ?? 0,
      bashCommandCount: sessionTools.Bash ?? 0,
      fileReadCount,
      fileEditCount,
      fileWriteCount,
      // Real per-session tool counts for filtered tool usage charts
      toolCounts: sessionTools,
      queries: [],
      // Per-session file operations for client-side re-aggregation when filtering
      fileActivityDetails: sessionFileOps,
    };
  });

  // Transform context analytics using shared helpers
  // (toolHealth, agentStats, commandStats now return dashboard-ready data directly)
  const transformedContextHeatmap = transformContextHeatmap(contextHeatmap);
  const transformedCacheEfficiencyCurve = transformCacheEfficiencyCurve(cacheEfficiencyCurve);
  const transformedCompactionAnalysis = transformCompactionAnalysis(compactionAnalysis);

  // Transform insights from analytics schema to dashboard schema
  // Include action, priority, and comparison from enhanced insights
  const transformedInsights = insights.map((i) => ({
    type: (i.type === 'tip' ? 'info' : i.type) as 'success' | 'warning' | 'info',
    title: i.title,
    description: i.message,     // Rename: message → description
    action: i.action ?? '',     // Actionable recommendation
    priority: i.priority,       // Sorting priority (higher = more important)
    comparison: i.comparison,   // Week-over-week comparison data
  }));

  return {
    totals: dashboardTotals,
    dailyUsage: dailyStats, // Rename: dailyStats → dailyUsage
    sessions: dashboardSessions,
    projects,
    insights: transformedInsights,
    // Story-driven analytics (Phase 1)
    efficiencyScore,
    weeklyComparison,
    modelBreakdown,
    toolUsage,
    topPrompts,
    // Extended analytics
    toolHealth,      // Service returns dashboard-ready data
    bashCommands,
    fileActivity,
    fileExtensions,
    hookStats,
    apiErrors,
    skillROI,
    agentStats,      // Service returns dashboard-ready data
    commandStats,    // Service returns dashboard-ready data
    contextHeatmap: transformedContextHeatmap,
    cacheEfficiencyCurve: transformedCacheEfficiencyCurve,
    compactionAnalysis: transformedCompactionAnalysis,
    // Context window visualization (redesign) - use shared helper
    contextWindowFill: transformContextWindowFill(contextWindowFill),
    peakContextDistribution,
    // Story-driven analytics (Phase 2: Agent ROI)
    agentROI,
    // Story-driven analytics (Phase 3: Tool Health Deep Dive)
    toolHealthReportCard,
  };
};

// ─── Run Pipeline ──────────────────────────────────────────────────────────────

const log = (msg: string) => console.error(msg); // stderr so --json stdout stays clean

/** Initialize database and run incremental sync */
const initAndSync = Effect.gen(function* () {
  const syncService = yield* SyncService;
  const syncOptions = { verbose: VERBOSE };

  const startTime = Date.now();
  const result = RESYNC
    ? yield* syncService.fullResync(syncOptions)
    : yield* syncService.syncIncremental(syncOptions);
  const elapsed = Date.now() - startTime;

  if (result.synced > 0) {
    log(`Synced ${result.synced}/${result.total} files in ${elapsed}ms (${result.unchanged} unchanged)`);
  } else {
    log(`All ${result.total} files up to date (${elapsed}ms)`);
  }

  if (result.errors > 0) {
    log(`Warning: ${result.errors} files had parse errors`);
  }

  return result;
});

/** Parse date filter from URL query parameters */
const parseDateFilter = (url: URL): DateFilter => {
  const filter = url.searchParams.get("filter");
  const now = Date.now();

  switch (filter) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { startTime: start.getTime(), endTime: now };
    }
    case "7d":
      return { startTime: now - 7 * 86400000, endTime: now };
    case "30d":
      return { startTime: now - 30 * 86400000, endTime: now };
    default:
      return {}; // 'all' or no filter
  }
};

/** Load dashboard data from SQLite and transform for dashboard compatibility */
const loadDashboardData = (dateFilter: DateFilter = {}) => Effect.gen(function* () {
  // Get all domain services
  const sessions = yield* SessionAnalyticsService;
  const models = yield* ModelAnalyticsService;
  const tools = yield* ToolAnalyticsService;
  const files = yield* FileAnalyticsService;
  const agents = yield* AgentAnalyticsService;
  const context = yield* ContextAnalyticsService;
  const insightsService = yield* InsightsAnalyticsService;

  // Fetch all analytics data in parallel
  // Pass dateFilter to methods that support it
  const [
    totals,
    extendedTotals,
    dailyStats,
    sessionList,
    projects,
    modelBreakdown,
    toolUsage,
    topPrompts,
    insights,
    toolHealth,
    bashCommands,
    fileActivity,
    fileExtensions,
    hookStats,
    apiErrors,
    skillROI,
    agentStats,
    commandStats,
    contextHeatmap,
    cacheEfficiencyCurve,
    compactionAnalysis,
    contextWindowFill,
    peakContextDistribution,
    // Per-session data for client-side reaggregation
    sessionToolCounts,
    sessionPrimaryModels,
    sessionFileOperations,
    sessionAgentCounts,
    sessionToolErrorCounts,
    // Story-driven analytics (Phase 1)
    efficiencyScore,
    weeklyComparison,
    // Story-driven analytics (Phase 2)
    agentROI,
    // Story-driven analytics (Phase 3)
    toolHealthReportCard,
  ] = yield* Effect.all([
    sessions.getTotals(dateFilter),
    sessions.getExtendedTotals(dateFilter),
    sessions.getDailyStats(undefined, dateFilter),
    sessions.getSessionSummaries({ includeSubagents: false, dateFilter }),
    sessions.getProjectSummaries(dateFilter),
    models.getModelBreakdown(dateFilter),
    tools.getToolUsage(dateFilter),
    sessions.getTopPrompts(30, dateFilter),
    insightsService.generateInsights(dateFilter),
    tools.getToolHealth(dateFilter),
    tools.getBashCommandStats(dateFilter),
    files.getFileActivity(50, dateFilter),
    files.getFileExtensions(dateFilter),
    agents.getHookStats(dateFilter),
    tools.getApiErrors(dateFilter),
    agents.getSkillROI(dateFilter),
    agents.getAgentStats(dateFilter),
    agents.getCommandStats(dateFilter),
    context.getContextHeatmap(dateFilter),
    context.getCacheEfficiencyCurve(dateFilter),
    context.getCompactionAnalysis(dateFilter),
    context.getContextWindowFill(dateFilter),
    context.getContextPeakDistribution(dateFilter),
    // Per-session data for client-side reaggregation
    tools.getSessionToolCounts(dateFilter),
    sessions.getSessionPrimaryModels(dateFilter),
    files.getSessionFileOperations(dateFilter),
    sessions.getSessionAgentCounts(dateFilter),
    tools.getSessionToolErrorCounts(dateFilter),
    // Story-driven analytics (Phase 1)
    insightsService.getEfficiencyScore(dateFilter),
    insightsService.getWeeklyComparison(dateFilter),
    // Story-driven analytics (Phase 2)
    agents.getAgentROI(dateFilter),
    // Story-driven analytics (Phase 3)
    tools.getToolHealthReportCard(dateFilter),
  ]);

  // Transform to dashboard-compatible format
  return transformForDashboard({
    totals,
    extendedTotals,
    dailyStats,
    sessions: sessionList,
    projects,
    insights,
    modelBreakdown,
    toolUsage,
    topPrompts,
    toolHealth,
    bashCommands,
    fileActivity,
    fileExtensions,
    hookStats,
    apiErrors,
    skillROI,
    agentStats,
    commandStats,
    contextHeatmap,
    cacheEfficiencyCurve,
    compactionAnalysis,
    contextWindowFill,
    peakContextDistribution,
    // Per-session data for client-side reaggregation
    sessionToolCounts,
    sessionPrimaryModels,
    sessionFileOperations,
    sessionAgentCounts,
    sessionToolErrorCounts,
    // Story-driven analytics (Phase 1)
    efficiencyScore,
    weeklyComparison,
    // Story-driven analytics (Phase 2)
    agentROI,
    // Story-driven analytics (Phase 3)
    toolHealthReportCard,
  });
});

// ─── Core Data Loader (Fast - for initial load) ─────────────────────────────────

/**
 * Load only core dashboard data for fast initial render.
 * Heavy analytics (context heatmap, tool health, etc.) are loaded on demand.
 * Reduces initial load from 25+ queries to ~8 queries (~80% reduction).
 */
const loadCoreData = (dateFilter: DateFilter = {}) => Effect.gen(function* () {
  // Get required domain services
  const sessionsService = yield* SessionAnalyticsService;
  const toolsService = yield* ToolAnalyticsService;
  const filesService = yield* FileAnalyticsService;
  const agentsService = yield* AgentAnalyticsService;
  const insightsService = yield* InsightsAnalyticsService;

  const [
    totals,
    extendedTotals,
    dailyStats,
    sessionList,
    projects,
    insights,
    // Per-session data needed for client-side reaggregation
    sessionToolCounts,
    sessionPrimaryModels,
    sessionFileOperations,
    sessionAgentCounts,
    sessionToolErrorCounts,
    // Story-driven analytics (Phase 1) - fast queries, included in core load
    efficiencyScore,
    weeklyComparison,
    // Story-driven analytics (Phase 2)
    agentROI,
    // Story-driven analytics (Phase 3)
    toolHealthReportCard,
  ] = yield* Effect.all([
    sessionsService.getTotals(dateFilter),
    sessionsService.getExtendedTotals(dateFilter),
    sessionsService.getDailyStats(undefined, dateFilter),
    sessionsService.getSessionSummaries({ includeSubagents: false, dateFilter }),
    sessionsService.getProjectSummaries(dateFilter),
    insightsService.generateInsights(dateFilter),
    toolsService.getSessionToolCounts(dateFilter),
    sessionsService.getSessionPrimaryModels(dateFilter),
    filesService.getSessionFileOperations(dateFilter),
    sessionsService.getSessionAgentCounts(dateFilter),
    toolsService.getSessionToolErrorCounts(dateFilter),
    insightsService.getEfficiencyScore(dateFilter),
    insightsService.getWeeklyComparison(dateFilter),
    agentsService.getAgentROI(dateFilter),
    toolsService.getToolHealthReportCard(dateFilter),
  ]);

  return transformForDashboard({
    totals,
    extendedTotals,
    dailyStats,
    sessions: sessionList,
    projects,
    insights,
    // Empty placeholders for lazy-loaded data
    modelBreakdown: [],
    toolUsage: [],
    topPrompts: [],
    toolHealth: [],
    bashCommands: [],
    fileActivity: [],
    fileExtensions: [],
    hookStats: [],
    apiErrors: [],
    skillROI: [],
    agentStats: [],
    commandStats: [],
    contextHeatmap: [],
    cacheEfficiencyCurve: [],
    compactionAnalysis: { totalSessions: 0, sessionsWithCompactions: 0, avgCompactionsPerSession: 0 },
    contextWindowFill: [],
    peakContextDistribution: [],
    sessionToolCounts,
    sessionPrimaryModels,
    sessionFileOperations,
    sessionAgentCounts,
    sessionToolErrorCounts,
    // Story-driven analytics (Phase 1)
    efficiencyScore,
    weeklyComparison,
    // Story-driven analytics (Phase 2)
    agentROI,
    // Story-driven analytics (Phase 3)
    toolHealthReportCard,
  });
});

// ─── Lazy-Loaded Analytics ─────────────────────────────────────────────────────

/** Load model analytics (model breakdown, top prompts) */
const loadModelsAnalytics = (dateFilter: DateFilter = {}) => Effect.gen(function* () {
  const modelsService = yield* ModelAnalyticsService;
  const sessionsService = yield* SessionAnalyticsService;
  const [modelBreakdown, topPrompts] = yield* Effect.all([
    modelsService.getModelBreakdown(dateFilter),
    sessionsService.getTopPrompts(30, dateFilter),
  ]);
  return { modelBreakdown, topPrompts };
});

/** Load tools analytics (tool usage, health, bash commands) */
const loadToolsAnalytics = (dateFilter: DateFilter = {}) => Effect.gen(function* () {
  const toolsService = yield* ToolAnalyticsService;
  const agentsService = yield* AgentAnalyticsService;
  const [toolUsage, toolHealth, bashCommands, hookStats, apiErrors, agentStats, commandStats, skillROI] = yield* Effect.all([
    toolsService.getToolUsage(dateFilter),
    toolsService.getToolHealth(dateFilter),
    toolsService.getBashCommandStats(dateFilter),
    agentsService.getHookStats(dateFilter),
    toolsService.getApiErrors(dateFilter),
    agentsService.getAgentStats(dateFilter),
    agentsService.getCommandStats(dateFilter),
    agentsService.getSkillROI(dateFilter),
  ]);
  return { toolUsage, toolHealth, bashCommands, hookStats, apiErrors, agentStats, commandStats, skillROI };
});

/** Load files analytics (file activity, extensions) */
const loadFilesAnalytics = (dateFilter: DateFilter = {}) => Effect.gen(function* () {
  const filesService = yield* FileAnalyticsService;
  const [fileActivity, fileExtensions] = yield* Effect.all([
    filesService.getFileActivity(50, dateFilter),
    filesService.getFileExtensions(dateFilter),
  ]);
  return { fileActivity, fileExtensions };
});

/** Load context analytics (heatmap, cache curve, context fill, peak distribution) */
const loadContextAnalytics = (dateFilter: DateFilter = {}, projectPath?: string) => Effect.gen(function* () {
  const contextService = yield* ContextAnalyticsService;
  const [contextHeatmap, cacheEfficiencyCurve, compactionAnalysisRaw, contextWindowFill, peakContextDistribution] = yield* Effect.all([
    contextService.getContextHeatmap(dateFilter, projectPath),
    contextService.getCacheEfficiencyCurve(dateFilter, projectPath),
    contextService.getCompactionAnalysis(dateFilter, projectPath),
    contextService.getContextWindowFill(dateFilter, projectPath),
    contextService.getContextPeakDistribution(dateFilter, projectPath),
  ]);
  // Use shared transformation helpers (same as transformForDashboard)
  return {
    contextHeatmap: transformContextHeatmap(contextHeatmap),
    cacheEfficiencyCurve: transformCacheEfficiencyCurve(cacheEfficiencyCurve),
    compactionAnalysis: transformCompactionAnalysis(compactionAnalysisRaw),
    contextWindowFill: transformContextWindowFill(contextWindowFill),
    peakContextDistribution, // No transformation needed
  };
});

/** Load unified dashboard stats (consistent metrics for data quality) */
const loadDashboardStats = (dateFilter: DateFilter = {}) => Effect.gen(function* () {
  const sessionsService = yield* SessionAnalyticsService;
  return yield* sessionsService.getDashboardStats(dateFilter);
});

// ─── Pipeline Runners ─────────────────────────────────────────────────────────────

const runPipeline = (dateFilter: DateFilter = {}): Promise<DashboardPayload> => {
  // Initialize database tables
  initializeDatabase();

  return Effect.runPromise(
    Effect.gen(function* () {
      yield* initAndSync;
      return yield* loadDashboardData(dateFilter);
    }).pipe(Effect.provide(AppLive))
  );
};

const runCorePipeline = (dateFilter: DateFilter = {}): Promise<DashboardPayload> => {
  initializeDatabase();
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* initAndSync;
      return yield* loadCoreData(dateFilter);
    }).pipe(Effect.provide(AppLive))
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runAnalyticsPipeline = <T>(
  loader: (dateFilter: DateFilter) => Effect.Effect<T, unknown, any>,
  dateFilter: DateFilter = {}
): Promise<T> => {
  initializeDatabase();
  return Effect.runPromise(
    loader(dateFilter).pipe(Effect.provide(AppLive)) as Effect.Effect<T, never, never>
  );
};

// ─── JSON Mode ─────────────────────────────────────────────────────────────────

if (JSON_MODE) {
  const payload = await runPipeline();
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(0);
}

// ─── Server Mode ───────────────────────────────────────────────────────────────

let cachedPayload: DashboardPayload | null = null;

// ─── API Error Handling ─────────────────────────────────────────────────────

interface ApiErrorResponse {
  error: string;
  code: string;
  timestamp: number;
}

/**
 * Convert errors to standardized API error responses.
 * Logs errors to stderr and returns appropriate HTTP status codes.
 */
const handleApiError = (error: unknown): Response => {
  const timestamp = Date.now();

  // Log to stderr (keeps --json stdout clean)
  console.error("API Error:", error);

  // Handle typed Effect errors
  if (error instanceof DatabaseError) {
    const response: ApiErrorResponse = {
      error: `Database operation failed: ${error.operation}`,
      code: "DATABASE_ERROR",
      timestamp,
    };
    return Response.json(response, { status: 500 });
  }

  if (error instanceof ParseError) {
    const response: ApiErrorResponse = {
      error: `Failed to parse session data: ${error.filePath}`,
      code: "PARSE_ERROR",
      timestamp,
    };
    return Response.json(response, { status: 500 });
  }

  if (error instanceof FileSystemError) {
    const response: ApiErrorResponse = {
      error: `File system error: ${error.path}`,
      code: "FILESYSTEM_ERROR",
      timestamp,
    };
    return Response.json(response, { status: 500 });
  }

  // Generic error fallback
  const message = error instanceof Error ? error.message : "Unknown error";
  const response: ApiErrorResponse = {
    error: `Internal server error: ${message}`,
    code: "INTERNAL_ERROR",
    timestamp,
  };
  return Response.json(response, { status: 500 });
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Static files - no error handling needed
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(dashboardHtml as unknown as string, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/dashboard.css") {
      return new Response(dashboardCss as unknown as string, {
        headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }

    // API endpoints - wrapped in try/catch for error handling
    try {
      // Main data endpoint - returns core data only, analytics loaded lazily
      if (url.pathname === "/api/data") {
        const dateFilter = parseDateFilter(url);
        const hasFilter = dateFilter.startTime || dateFilter.endTime;

        // For 'all' (no filter), use cache; for filtered, always compute fresh
        if (!hasFilter && cachedPayload) {
          return Response.json(cachedPayload);
        }

        // Use core pipeline for faster initial load (analytics loaded via separate endpoints)
        const payload = await runCorePipeline(dateFilter);
        if (!hasFilter) {
          cachedPayload = payload;
        }
        return Response.json(payload);
      }

      // Session drilldown endpoint
      if (url.pathname === "/api/session") {
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "Missing id parameter" }, { status: 400 });
        if (!cachedPayload) {
          cachedPayload = await runPipeline();
        }
        const session = cachedPayload.sessions.find((s) => s.sessionId === id);
        if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
        return Response.json(session);
      }

      // Refresh endpoint
      if (url.pathname === "/api/refresh") {
        cachedPayload = await runPipeline();
        return Response.json({ ok: true, sessions: cachedPayload.totals.totalSessions });
      }

      // ─── Lazy-Loaded Analytics Endpoints ────────────────────────────────────────

      // Models analytics (model breakdown, top prompts)
      if (url.pathname === "/api/analytics/models") {
        const dateFilter = parseDateFilter(url);
        const data = await runAnalyticsPipeline(loadModelsAnalytics, dateFilter);
        return Response.json(data);
      }

      // Tools analytics (tool usage, health, bash commands, hooks, errors, agents, skills)
      if (url.pathname === "/api/analytics/tools") {
        const dateFilter = parseDateFilter(url);
        const data = await runAnalyticsPipeline(loadToolsAnalytics, dateFilter);
        return Response.json(data);
      }

      // Files analytics (file activity, extensions)
      if (url.pathname === "/api/analytics/files") {
        const dateFilter = parseDateFilter(url);
        const data = await runAnalyticsPipeline(loadFilesAnalytics, dateFilter);
        return Response.json(data);
      }

      // Context analytics (heatmap, cache curve, compaction, context fill, peak distribution)
      if (url.pathname === "/api/analytics/context") {
        const dateFilter = parseDateFilter(url);
        const projectPath = url.searchParams.get("project") || undefined;
        const data = await runAnalyticsPipeline(
          (df) => loadContextAnalytics(df, projectPath),
          dateFilter
        );
        return Response.json(data);
      }

      // Unified dashboard stats (consistent metrics for data quality)
      if (url.pathname === "/api/stats") {
        const dateFilter = parseDateFilter(url);
        const stats = await runAnalyticsPipeline(loadDashboardStats, dateFilter);
        return Response.json(stats);
      }
    } catch (error) {
      return handleApiError(error);
    }

    return new Response("Not found", { status: 404 });
  },
});

log(`Dashboard running at http://localhost:${server.port}`);

// Auto-open browser
if (!NO_OPEN) {
  Bun.spawn(["open", `http://localhost:${server.port}`]);
}

// Graceful shutdown
process.on("SIGINT", () => {
  log("\nShutting down...");
  server.stop();
  process.exit(0);
});
