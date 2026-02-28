import type { DashboardData, ProjectSummary } from "@shared/rpc-types";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from "recharts";

import { Section } from "@/components/layout/Section";
import { ChartCard } from "@/components/shared/ChartCard";
import { EmptyChartState } from "@/components/shared/EmptyChartState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatNumber,
  cn,
  shortenPath,
  getSmartProjectName,
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
  const projects = data?.projects ?? [];

  // Memoize sorted projects (only recalculates when projects changes)
  const sortedProjects = useMemo(
    () => [...projects].toSorted((a, b) => b.totalCost - a.totalCost),
    [projects]
  );

  // Stats
  const totalProjects = projects.length;
  const mostActiveProject = sortedProjects[0];
  const highestCostProject = sortedProjects[0];

  // Pre-compute smart names for disambiguation
  // Pass cwd when available for accurate path splitting (avoids hyphenated path ambiguity)
  const smartNames = useMemo(() => {
    const allItems = projects.map((p) => ({
      cwd: p.cwd,
      projectPath: p.projectPath,
    }));
    return new Map(
      projects.map((p) => [
        p.projectPath,
        getSmartProjectName(
          { cwd: p.cwd, projectPath: p.projectPath },
          allItems
        ),
      ])
    );
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
    <Section id="projects">
      <SectionHeader
        id="projects-header"
        title="Projects Analytics"
        subtitle={`${totalProjects} projects tracked`}
      />

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
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
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Project Cost Ranking"
          subtitle="Top 10 projects by cost"
          loading={loading}
        >
          {chartData.length > 0 ? (
            <ChartContainer config={projectConfig} className="h-[300px] w-full">
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
                  {chartData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>All Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : sortedProjects.length > 0 ? (
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
              <p className="text-muted-foreground py-8 text-center">
                No projects found
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity Heatmap placeholder */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[100px] w-full" />
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {/* Simple activity visualization - last 28 days */}
              {activityData.map((day, i) => (
                <div
                  key={i}
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
          )}
          <div className="text-muted-foreground mt-4 flex items-center justify-end gap-2 text-xs">
            <span>Less</span>
            <div className="bg-muted h-3 w-3 rounded-sm" />
            <div className="bg-chart-2/30 h-3 w-3 rounded-sm" />
            <div className="bg-chart-2/60 h-3 w-3 rounded-sm" />
            <div className="bg-chart-2 h-3 w-3 rounded-sm" />
            <span>More</span>
          </div>
        </CardContent>
      </Card>
    </Section>
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
