import {
  WifiIcon,
  Clock01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  Activity01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  OtelDashboardData,
  OtelToolDecision,
  OtelApiLatency,
} from "@shared/rpc-types";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import { Section } from "@/components/layout/Section";
import { LoadingBoundary } from "@/components/shared/LoadingBoundary";
import { SectionHeader } from "@/components/shared/SectionHeader";
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
import { cn, formatNumber, formatPercent, formatDuration } from "@/lib/utils";

// ─── Chart Configs ──────────────────────────────────────────────────────────

const activeTimeConfig = {
  user: { color: "var(--chart-1)", label: "User Active" },
  cli: { color: "var(--chart-2)", label: "CLI Active" },
} satisfies ChartConfig;

const decisionConfig = {
  accepts: { color: "var(--success)", label: "Accepts" },
  rejects: { color: "var(--destructive)", label: "Rejects" },
} satisfies ChartConfig;

// ─── Component ──────────────────────────────────────────────────────────────

interface OtelSectionProps {
  data: OtelDashboardData | null;
  loading?: boolean;
}

export function OtelSection({ data, loading }: OtelSectionProps) {
  if (!data?.hasData && !loading) {
    return null; // Don't show section if no OTEL data
  }

  const analytics = data?.analytics;
  const toolDecisions = data?.toolDecisions ?? [];
  const apiLatency = data?.apiLatency ?? [];

  return (
    <Section id="otel">
      <SectionHeader
        id="otel-header"
        title="Real-Time Telemetry"
        subtitle="Live metrics from Claude Code via OpenTelemetry"
      >
        <Badge variant="secondary" className="gap-1">
          <HugeiconsIcon icon={WifiIcon} className="h-3 w-3" />
          OTEL
        </Badge>
      </SectionHeader>

      <Tabs defaultValue="overview">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="decisions">
            Tool Decisions ({formatNumber(toolDecisions.length)})
          </TabsTrigger>
          <TabsTrigger value="latency">
            API Latency ({formatNumber(apiLatency.length)})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab analytics={analytics ?? null} loading={loading} />
        </TabsContent>

        <TabsContent value="decisions">
          <ToolDecisionsTab decisions={toolDecisions} loading={loading} />
        </TabsContent>

        <TabsContent value="latency">
          <ApiLatencyTab latency={apiLatency} loading={loading} />
        </TabsContent>
      </Tabs>
    </Section>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────────

interface OverviewTabProps {
  analytics: OtelDashboardData["analytics"] | null;
  loading?: boolean;
}

function OverviewTab({ analytics, loading }: OverviewTabProps) {
  const activeTimeData = useMemo(() => {
    if (!analytics) {
      return [];
    }
    return [
      { name: "User", value: analytics.userTime, fill: "var(--chart-1)" },
      { name: "CLI", value: analytics.cliTime, fill: "var(--chart-2)" },
    ].filter((d) => d.value > 0);
  }, [analytics]);

  return (
    <LoadingBoundary loading={loading} skeleton="card">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Session Count */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>OTEL Sessions</CardDescription>
            <CardTitle className="text-2xl">
              {formatNumber(analytics?.sessionCount ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Total Active Time */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Time</CardDescription>
            <CardTitle className="text-2xl">
              {formatDuration((analytics?.totalActiveTime ?? 0) * 1000)}
            </CardTitle>
          </CardHeader>
        </Card>

        {/* API Calls */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>API Calls</CardDescription>
            <CardTitle className="text-2xl">
              {formatNumber(analytics?.totalApiCalls ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {analytics?.avgLatencyMs
              ? `Avg: ${Math.round(analytics.avgLatencyMs)}ms`
              : "—"}
          </CardContent>
        </Card>

        {/* Tool Decisions */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tool Decisions</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {formatNumber(
                (analytics?.totalAccepts ?? 0) + (analytics?.totalRejects ?? 0)
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <span className="text-success">
              {formatNumber(analytics?.totalAccepts ?? 0)} accepts
            </span>
            {" / "}
            <span className="text-destructive">
              {formatNumber(analytics?.totalRejects ?? 0)} rejects
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Active Time Breakdown */}
      {activeTimeData.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Active Time Breakdown</CardTitle>
            <CardDescription>
              Time spent actively using Claude Code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={activeTimeConfig}
              className="mx-auto h-[200px] w-full max-w-[300px]"
            >
              <PieChart>
                <Pie
                  data={activeTimeData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  label={({ name, value }) =>
                    `${name}: ${formatDuration(value * 1000)}`
                  }
                >
                  {activeTimeData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Legend />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </LoadingBoundary>
  );
}

// ─── Tool Decisions Tab ─────────────────────────────────────────────────────

interface ToolDecisionsTabProps {
  decisions: OtelToolDecision[];
  loading?: boolean;
}

function ToolDecisionsTab({ decisions, loading }: ToolDecisionsTabProps) {
  const chartData = useMemo(
    () =>
      decisions.slice(0, 10).map((d) => ({
        tool: d.toolName.replace("claude_code.", ""),
        accepts: d.accepts,
        rejects: d.rejects,
      })),
    [decisions]
  );

  return (
    <LoadingBoundary loading={loading} skeleton="list">
      {decisions.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-8 text-center">
            No tool decisions recorded yet. This shows when Claude Code asks for
            permission and you accept or reject.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Decision Distribution</CardTitle>
                <CardDescription>
                  Accept vs reject decisions by tool
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={decisionConfig}
                  className="h-[300px] w-full"
                >
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" />
                    <YAxis
                      dataKey="tool"
                      type="category"
                      width={100}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="accepts"
                      fill="var(--color-accepts)"
                      radius={[0, 4, 4, 0]}
                      stackId="a"
                    />
                    <Bar
                      dataKey="rejects"
                      fill="var(--color-rejects)"
                      radius={[0, 4, 4, 0]}
                      stackId="a"
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* List */}
          <Card>
            <CardHeader>
              <CardTitle>All Tool Decisions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[400px] space-y-2 overflow-y-auto">
                {decisions.map((decision) => (
                  <div
                    key={decision.toolName}
                    className="border-border flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">
                        {decision.toolName}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatNumber(decision.accepts + decision.rejects)}{" "}
                        total
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          className="text-success h-4 w-4"
                        />
                        <span className="text-success text-sm">
                          {formatNumber(decision.accepts)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          className="text-destructive h-4 w-4"
                        />
                        <span className="text-destructive text-sm">
                          {formatNumber(decision.rejects)}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          decision.acceptRate >= 0.8
                            ? "bg-success/10 text-success border-success/30"
                            : decision.acceptRate >= 0.5
                              ? "bg-warning/10 text-warning border-warning/30"
                              : "bg-destructive/10 text-destructive border-destructive/30"
                        )}
                      >
                        {formatPercent(decision.acceptRate)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </LoadingBoundary>
  );
}

// ─── API Latency Tab ────────────────────────────────────────────────────────

interface ApiLatencyTabProps {
  latency: OtelApiLatency[];
  loading?: boolean;
}

function ApiLatencyTab({ latency, loading }: ApiLatencyTabProps) {
  return (
    <LoadingBoundary loading={loading} skeleton="list">
      {latency.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-8 text-center">
            No API latency data recorded yet. This shows timing and retry
            statistics for Claude Code API calls.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>API Performance by Model</CardTitle>
            <CardDescription>
              Latency, retry rates, and costs per model
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] space-y-2 overflow-y-auto">
              {latency.map((row) => (
                <div
                  key={row.model}
                  className="border-border flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.model}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatNumber(row.requestCount)} requests
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {/* Latency */}
                    <div className="flex items-center gap-1">
                      <HugeiconsIcon
                        icon={Clock01Icon}
                        className="text-muted-foreground h-4 w-4"
                      />
                      <span>{Math.round(row.avgLatencyMs)}ms</span>
                    </div>

                    {/* Retry Rate */}
                    <div className="flex items-center gap-1">
                      <HugeiconsIcon
                        icon={Activity01Icon}
                        className={cn(
                          "h-4 w-4",
                          row.retryRate > 0.1
                            ? "text-warning"
                            : "text-muted-foreground"
                        )}
                      />
                      <span
                        className={cn(
                          row.retryRate > 0.1
                            ? "text-warning"
                            : "text-muted-foreground"
                        )}
                      >
                        {formatPercent(row.retryRate)} retry
                      </span>
                    </div>

                    {/* Avg Cost */}
                    {row.avgCostUsd > 0 && (
                      <Badge variant="outline">
                        ${row.avgCostUsd.toFixed(4)}/call
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </LoadingBoundary>
  );
}
