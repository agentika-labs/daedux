import type { DashboardData, ProjectSummary } from "@shared/rpc-types";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from "recharts";

// ─── Stable Empty Arrays (prevent useMemo dep changes on rerenders) ──────────
const EMPTY_PROJECTS: ProjectSummary[] = [];

import { ChartCard } from "@/components/shared/ChartCard";
import { EmptyChartState } from "@/components/shared/EmptyChartState";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingBoundary } from "@/components/shared/LoadingBoundary";
import { StatCard } from "@/components/shared/StatCard";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import {
  formatCurrency,
  formatNumber,
  cn,
  shortenPath,
  computeSmartProjectNames,
} from "@/lib/utils";
import type { SmartProjectName } from "@/lib/utils";

interface ProjectsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

// ─── Hoisted Formatters (stable references, no re-creation on render) ─────────

/** Format currency for X-axis ticks */
const formatCurrencyAxisTick = (value: number) => `$${value.toFixed(2)}`;

// Hoisted outside component per rendering-hoist-jsx rule
// This avoids recreating the function on every render
function TruncatedYAxisTick({
  x,
  y,
  payload,
}: {
  x: number;
  y: number;
  payload: { value: string };
}) {
  const maxLength = 18; // chars before truncation
  const text = payload.value;
  const displayText =
    text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;

  return (
    <text
      x={x}
      y={y}
      textAnchor="end"
      dominantBaseline="middle"
      className="fill-muted-foreground text-xs"
    >
      {displayText}
    </text>
  );
}

const projectConfig = {
  cost: {
    color: "var(--chart-1)",
    label: "Cost",
  },
} satisfies ChartConfig;

export function ProjectsSection({ data, loading }: ProjectsSectionProps) {
  const projects = data?.projects ?? EMPTY_PROJECTS;

  // Memoize sorted projects (only recalculates when projects changes)
  const sortedProjects = useMemo(
    () => [...projects].toSorted((a, b) => b.totalCost - a.totalCost),
    [projects]
  );

  // Stats
  const totalProjects = projects.length;
  const mostActiveProject = sortedProjects[0];
  const highestCostProject = sortedProjects[0];

  // Pre-compute smart names for disambiguation in O(n) instead of O(n²)
  // Pass cwd when available for accurate path splitting (avoids hyphenated path ambiguity)
  const smartNames = useMemo(() => {
    const allItems = projects.map((p) => ({
      cwd: p.cwd,
      projectPath: p.projectPath,
    }));
    return computeSmartProjectNames(allItems);
  }, [projects]);

  // Memoize chart data (depends on sortedProjects and smartNames)
  const chartData = useMemo(
    () =>
      sortedProjects.slice(0, 10).map((p) => {
        const smartName = smartNames.get(p.projectPath)!;
        return {
          cost: p.totalCost,
          name: smartName.secondary
            ? `${smartName.primary} (${smartName.secondary})`
            : smartName.primary,
          sessions: p.sessionCount,
          smartName, // Pass the full SmartProjectName object for tooltip
        };
      }),
    [sortedProjects, smartNames]
  );

  // Memoize activity data - O(28 × n) operation, expensive for many projects
  const activityData = useMemo(
    () => generateActivityData(projects),
    [projects]
  );

  return (
    <div className="flex flex-col">
      {/* Summary Cards — sealed metric row */}
      <div className="border-border grid grid-cols-3 border-b">
        <StatCard
          label="Total Projects"
          value={formatNumber(totalProjects)}
          loading={loading}
        />
        <StatCard
          label="Most Active"
          value={
            mostActiveProject
              ? (smartNames.get(mostActiveProject.projectPath)?.primary ?? "-")
              : "-"
          }
          subtext={
            mostActiveProject
              ? `${mostActiveProject.sessionCount} sessions`
              : undefined
          }
          loading={loading}
        />
        <StatCard
          label="Highest Cost"
          value={
            highestCostProject
              ? (smartNames.get(highestCostProject.projectPath)?.primary ?? "-")
              : "-"
          }
          subtext={
            highestCostProject
              ? formatCurrency(highestCostProject.totalCost)
              : undefined
          }
          loading={loading}
        />
      </div>

      {/* Project Cost Ranking */}
      <div className="border-border grid grid-cols-1 border-b lg:grid-cols-2">
        <ChartCard
          title="Project Cost Ranking"
          subtitle="Top 10 projects by cost"
          loading={loading}
        >
          {chartData.length > 0 ? (
            <ChartContainer
              config={projectConfig}
              className="h-[250px] w-full md:h-[300px]"
            >
              <BarChart data={chartData} layout="vertical" accessibilityLayer>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrencyAxisTick}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={140}
                  tick={TruncatedYAxisTick}
                  interval={0}
                />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  animationDuration={150}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, _name, item) => (
                        <div className="space-y-1">
                          <div className="flex items-baseline gap-2">
                            <p className="font-medium">
                              {item.payload.smartName.primary}
                            </p>
                            {item.payload.smartName.secondary && (
                              <span className="text-muted-foreground text-xs">
                                in {item.payload.smartName.secondary}
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            {shortenPath(item.payload.smartName.full)}
                          </p>
                          <p>Cost: {formatCurrency(value as number)}</p>
                          <p>Sessions: {item.payload.sessions}</p>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={`var(--chart-${(index % 5) + 1})`}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyChartState />
          )}
        </ChartCard>

        {/* Projects List */}
        <div className="border-border px-6 py-4 lg:border-l">
          <div className="mb-2 font-semibold">All Projects</div>
          <LoadingBoundary loading={loading} skeleton="list" count={4}>
            {sortedProjects.length > 0 ? (
              <div className="max-h-[300px] space-y-1 overflow-y-auto">
                {sortedProjects.map((project, i) => (
                  <ProjectRow
                    key={project.projectPath}
                    project={project}
                    rank={i + 1}
                    smartName={smartNames.get(project.projectPath)!}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No projects yet"
                description="Projects appear here after your first Claude Code session."
              />
            )}
          </LoadingBoundary>
        </div>
      </div>

      {/* Activity Heatmap */}
      <div className="border-border border-b px-6 py-4">
        <div className="mb-2 font-semibold">Recent Activity</div>
        <LoadingBoundary loading={loading} skeleton="chart" height={100}>
          <div className="grid grid-cols-7 gap-1">
            {/* Simple activity visualization - last 28 days */}
            {activityData.map((day) => (
              <div
                key={day.date}
                className={cn(
                  "h-6 rounded-sm",
                  day.sessions === 0 && "bg-muted",
                  day.sessions > 0 && day.sessions <= 2 && "bg-chart-2/30",
                  day.sessions > 2 && day.sessions <= 5 && "bg-chart-2/60",
                  day.sessions > 5 && "bg-chart-2"
                )}
                title={`${day.date}: ${day.sessions} sessions`}
              />
            ))}
          </div>
        </LoadingBoundary>
        <div className="text-muted-foreground mt-4 flex items-center justify-end gap-2 text-xs">
          <span>Less</span>
          <div className="bg-muted h-3 w-3 rounded-sm" />
          <div className="bg-chart-2/30 h-3 w-3 rounded-sm" />
          <div className="bg-chart-2/60 h-3 w-3 rounded-sm" />
          <div className="bg-chart-2 h-3 w-3 rounded-sm" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

function ProjectRow({
  project,
  rank,
  smartName,
}: {
  project: ProjectSummary;
  rank: number;
  smartName: SmartProjectName;
}) {
  const shortPath = shortenPath(smartName.full);

  return (
    <div
      className="hover:bg-muted/50 group flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
      title={smartName.full}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="text-muted-foreground/60 w-5 shrink-0 text-xs">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-sm font-medium">{smartName.primary}</p>
            {smartName.secondary && (
              <span className="text-muted-foreground shrink-0 text-xs">
                in {smartName.secondary}
              </span>
            )}
          </div>
          <p className="text-muted-foreground/50 h-4 truncate text-xs opacity-0 transition-opacity group-hover:opacity-100">
            {shortPath}
          </p>
        </div>
      </div>
      <div className="ml-4 shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">
          {formatCurrency(project.totalCost)}
        </p>
        <p className="text-muted-foreground text-xs">
          {project.sessionCount} sessions
        </p>
      </div>
    </div>
  );
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function generateActivityData(
  projects: ProjectSummary[]
): { date: string; sessions: number }[] {
  const days = 28;
  const result: { date: string; sessions: number }[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0] ?? "";

    // Count sessions for this day across all projects
    const sessionsOnDay = projects.reduce((acc, p) => {
      const lastActivity = new Date(p.lastActivity);
      const lastActivityDate = lastActivity.toISOString().split("T")[0] ?? "";
      if (lastActivityDate === dateStr) {
        return acc + 1;
      }
      return acc;
    }, 0);

    result.push({ date: dateStr, sessions: sessionsOnDay });
  }

  return result;
}
