import {
  WifiIcon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  OtelDashboardData,
  OtelProductivityMetrics,
  OtelCostBreakdown,
  OtelToolSuccessRate,
  OtelSessionBuckets,
  OtelProblemPatterns,
} from "@shared/rpc-types";
import { useMemo } from "react";
import { PieChart, Pie, Cell, Legend } from "recharts";

import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingBoundary } from "@/components/shared/LoadingBoundary";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  cn,
  formatNumber,
  formatPercent,
  formatDuration,
  formatCurrency,
} from "@/lib/utils";

// ─── Chart Configs ──────────────────────────────────────────────────────────

const sessionBucketConfig = {
  quick: { color: "var(--chart-1)", label: "Quick (<5m)" },
  feature: { color: "var(--chart-2)", label: "Feature (5-30m)" },
  deep: { color: "var(--chart-3)", label: "Deep (>30m)" },
} satisfies ChartConfig;

// ─── Component ──────────────────────────────────────────────────────────────

interface OtelSectionProps {
  data: OtelDashboardData | null;
  loading?: boolean;
}

export function OtelSection({ data, loading }: OtelSectionProps) {
  if (!data?.hasData && !loading) {
    return (
      <div className="flex flex-col">
        <EmptyState
          title="No telemetry data"
          description="Claude Code's OpenTelemetry integration isn't configured for this harness. Enable OTEL to track real-time metrics like session duration, tool success rates, and cost breakdown."
          icon={WifiIcon}
        />
      </div>
    );
  }

  const analytics = data?.analytics;
  const productivity = data?.productivity;
  const costBreakdown = data?.costBreakdown;
  const toolSuccessRates = data?.toolSuccessRates ?? [];
  const sessionBuckets = data?.sessionBuckets;
  const problemPatterns = data?.problemPatterns;

  return (
    <div className="flex flex-col">
      <Tabs defaultValue="overview">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            analytics={analytics ?? null}
            costBreakdown={costBreakdown ?? null}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceTab
            productivity={productivity ?? null}
            costBreakdown={costBreakdown ?? null}
            toolSuccessRates={toolSuccessRates}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="insights">
          <InsightsTab
            sessionBuckets={sessionBuckets ?? null}
            problemPatterns={problemPatterns ?? null}
            loading={loading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────────

interface OverviewTabProps {
  analytics: OtelDashboardData["analytics"] | null;
  costBreakdown: OtelCostBreakdown | null;
  loading?: boolean;
}

function OverviewTab({ analytics, costBreakdown, loading }: OverviewTabProps) {
  return (
    <LoadingBoundary loading={loading} skeleton="card">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Session Count */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sessions</CardDescription>
            <CardTitle className="text-2xl">
              {formatNumber(analytics?.sessionCount ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Active Time */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Time</CardDescription>
            <CardTitle className="text-2xl">
              {formatDuration((analytics?.totalActiveTime ?? 0) * 1000)}
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Total Cost with $/session subtext */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Cost</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(costBreakdown?.totalCost ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {costBreakdown?.avgCostPerSession
              ? `${formatCurrency(costBreakdown.avgCostPerSession)}/session`
              : "—"}
          </CardContent>
        </Card>

        {/* ROI Metrics: $/LOC + Cache Efficiency */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ROI Metrics</CardDescription>
            <CardTitle className="text-2xl">
              ${(costBreakdown?.costPerLoc ?? 0).toFixed(3)}/LOC
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            Cache: {Math.round(costBreakdown?.cacheEfficiencyRatio ?? 0)}:1
            ratio
          </CardContent>
        </Card>
      </div>
    </LoadingBoundary>
  );
}

// ─── Performance Tab ────────────────────────────────────────────────────────
// Merged from: ProductivityTab + CostsTab + old PerformanceTab

interface PerformanceTabProps {
  productivity: OtelProductivityMetrics | null;
  costBreakdown: OtelCostBreakdown | null;
  toolSuccessRates: OtelToolSuccessRate[];
  loading?: boolean;
}

function PerformanceTab({
  productivity,
  costBreakdown,
  toolSuccessRates,
  loading,
}: PerformanceTabProps) {
  const modelData = useMemo(
    () =>
      (costBreakdown?.byModel ?? []).map((m) => ({
        model: m.model.replace("claude-", "").replace("-latest", ""),
        cost: m.cost,
        requests: m.requests,
      })),
    [costBreakdown]
  );

  return (
    <LoadingBoundary loading={loading} skeleton="card">
      <div className="space-y-6">
        {/* Code Output Section */}
        <div>
          <h3 className="text-muted-foreground mb-3 text-sm font-medium uppercase tracking-wide">
            Code Output
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    className="text-success mr-1 inline h-4 w-4"
                  />
                  Lines Added
                </CardDescription>
                <CardTitle className="text-success text-2xl">
                  +{formatNumber(productivity?.totalLinesAdded ?? 0)}
                </CardTitle>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    className="text-destructive mr-1 inline h-4 w-4"
                  />
                  Lines Removed
                </CardDescription>
                <CardTitle className="text-destructive text-2xl">
                  -{formatNumber(productivity?.totalLinesRemoved ?? 0)}
                </CardTitle>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Commits</CardDescription>
                <CardTitle className="text-2xl">
                  {formatNumber(productivity?.totalCommits ?? 0)}
                </CardTitle>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Pull Requests</CardDescription>
                <CardTitle className="text-2xl">
                  {formatNumber(productivity?.totalPRs ?? 0)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        </div>

        {/* Cost & Tool Analysis Grid */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Cost by Model */}
          {modelData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Cost by Model</CardTitle>
                <CardDescription>
                  Spending breakdown by Claude model
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[300px] space-y-2 overflow-y-auto">
                  {modelData.map((row) => (
                    <div
                      key={row.model}
                      className="border-border flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.model}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatNumber(row.requests)} requests
                        </div>
                      </div>
                      <Badge variant="outline">
                        {formatCurrency(row.cost)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tool Success Rates */}
          {toolSuccessRates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tool Success Rates</CardTitle>
                <CardDescription>Success/failure rates by tool</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[300px] space-y-2 overflow-y-auto">
                  {toolSuccessRates.slice(0, 10).map((tool) => (
                    <div
                      key={tool.toolName}
                      className="border-border flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm">
                          {tool.toolName}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatNumber(tool.totalCalls)} calls
                          {tool.avgDurationMs > 0 &&
                            ` · ${Math.round(tool.avgDurationMs)}ms avg`}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          tool.successRate >= 0.95
                            ? "bg-success/10 text-success border-success/30"
                            : tool.successRate >= 0.8
                              ? "bg-warning/10 text-warning border-warning/30"
                              : "bg-destructive/10 text-destructive border-destructive/30"
                        )}
                      >
                        {formatPercent(tool.successRate)} success
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Empty state */}
        {modelData.length === 0 && toolSuccessRates.length === 0 && (
          <Card>
            <CardContent className="text-muted-foreground p-8 text-center">
              No performance data recorded yet. This shows code output, costs,
              and tool success rates.
            </CardContent>
          </Card>
        )}
      </div>
    </LoadingBoundary>
  );
}

// ─── Insights Tab ───────────────────────────────────────────────────────────

interface InsightsTabProps {
  sessionBuckets: OtelSessionBuckets | null;
  problemPatterns: OtelProblemPatterns | null;
  loading?: boolean;
}

function InsightsTab({
  sessionBuckets,
  problemPatterns,
  loading,
}: InsightsTabProps) {
  const bucketData = useMemo(() => {
    if (!sessionBuckets) {
      return [];
    }
    return [
      {
        name: "Quick (<5m)",
        value: sessionBuckets.quick,
        fill: "var(--chart-1)",
      },
      {
        name: "Feature (5-30m)",
        value: sessionBuckets.feature,
        fill: "var(--chart-2)",
      },
      {
        name: "Deep (>30m)",
        value: sessionBuckets.deep,
        fill: "var(--chart-3)",
      },
    ].filter((d) => d.value > 0);
  }, [sessionBuckets]);

  const hasProblems =
    (problemPatterns?.longUnproductiveSessions.length ?? 0) > 0 ||
    (problemPatterns?.highRejectionTools.length ?? 0) > 0 ||
    (problemPatterns?.apiErrorPatterns.length ?? 0) > 0;

  return (
    <LoadingBoundary loading={loading} skeleton="card">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Session Patterns */}
        <Card>
          <CardHeader>
            <CardTitle>Session Patterns</CardTitle>
            <CardDescription>
              Duration distribution of your sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bucketData.length > 0 ? (
              <ChartContainer
                config={sessionBucketConfig}
                className="mx-auto h-[220px] w-full max-w-[300px]"
              >
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie
                    data={bucketData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {bucketData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    wrapperStyle={{ paddingTop: 16 }}
                  />
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="text-muted-foreground p-8 text-center text-sm">
                No session data yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* What's Working */}
        <Card>
          <CardHeader>
            <CardTitle className="text-success flex items-center gap-2">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-4 w-4" />
              What's Working
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {(problemPatterns?.highRejectionTools.length ?? 0) === 0 && (
                <li className="flex items-center gap-2">
                  <span className="bg-success h-2 w-2 rounded-full" />
                  All tools have good acceptance rates
                </li>
              )}
              {(problemPatterns?.apiErrorPatterns.length ?? 0) === 0 && (
                <li className="flex items-center gap-2">
                  <span className="bg-success h-2 w-2 rounded-full" />
                  No API errors detected
                </li>
              )}
              {(problemPatterns?.longUnproductiveSessions.length ?? 0) ===
                0 && (
                <li className="flex items-center gap-2">
                  <span className="bg-success h-2 w-2 rounded-full" />
                  No long unproductive sessions
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Attention Areas */}
      {hasProblems && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-warning flex items-center gap-2">
              <HugeiconsIcon icon={AlertCircleIcon} className="h-4 w-4" />
              Attention Areas
            </CardTitle>
            <CardDescription>
              Issues detected from ROI analysis patterns
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Long Unproductive Sessions */}
              {(problemPatterns?.longUnproductiveSessions.length ?? 0) > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">
                    Long Sessions Without Commits
                  </h4>
                  <div className="space-y-1">
                    {problemPatterns?.longUnproductiveSessions.map(
                      (session) => (
                        <div
                          key={session.sessionId}
                          className="bg-warning/10 text-warning border-warning/30 flex items-center justify-between rounded border px-3 py-2 text-sm"
                        >
                          <span className="font-mono text-xs">
                            {session.sessionId.slice(0, 8)}...
                          </span>
                          <span>{formatDuration(session.durationMs)}</span>
                          <span>{formatCurrency(session.cost)}</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* High Rejection Tools */}
              {(problemPatterns?.highRejectionTools.length ?? 0) > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">
                    Tools with High Rejection Rates
                  </h4>
                  <div className="space-y-1">
                    {problemPatterns?.highRejectionTools.map((tool) => (
                      <div
                        key={tool.toolName}
                        className="bg-warning/10 text-warning border-warning/30 flex items-center justify-between rounded border px-3 py-2 text-sm"
                      >
                        <span className="font-mono">{tool.toolName}</span>
                        <span>
                          {formatPercent(tool.rejectRate)} reject rate
                        </span>
                        <span className="text-muted-foreground">
                          {tool.total} total
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* API Errors */}
              {(problemPatterns?.apiErrorPatterns.length ?? 0) > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">
                    API Error Patterns
                  </h4>
                  <div className="space-y-1">
                    {problemPatterns?.apiErrorPatterns.map((error) => (
                      <div
                        key={`${error.errorType}-${error.model}`}
                        className="bg-destructive/10 text-destructive border-destructive/30 flex items-center justify-between rounded border px-3 py-2 text-sm"
                      >
                        <span>HTTP {error.errorType}</span>
                        <span>{error.model}</span>
                        <span>{error.count} occurrences</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </LoadingBoundary>
  );
}
