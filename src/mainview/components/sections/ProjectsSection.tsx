import { Section } from "@/components/layout/Section";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ChartCard } from "@/components/shared/ChartCard";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import type { DashboardData, ProjectSummary } from "@shared/rpc-types";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from "recharts";

interface ProjectsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

const projectConfig = {
  cost: {
    label: "Cost",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function ProjectsSection({ data, loading }: ProjectsSectionProps) {
  const projects = data?.projects ?? [];

  // Sort by cost descending
  const sortedProjects = [...projects].sort((a, b) => b.totalCost - a.totalCost);

  // Stats
  const totalProjects = projects.length;
  const mostActiveProject = sortedProjects[0];
  const highestCostProject = sortedProjects[0];

  // Prepare chart data
  const chartData = sortedProjects.slice(0, 10).map((p) => ({
    name: getProjectDisplayName(p.projectPath),
    cost: p.totalCost,
    sessions: p.sessionCount,
    fullPath: p.projectPath,
  }));

  return (
    <Section id="projects">
      <SectionHeader
        id="projects-header"
        title="Projects Analytics"
        subtitle={`${totalProjects} projects tracked`}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total Projects"
          value={formatNumber(totalProjects)}
          loading={loading}
        />
        <StatCard
          label="Most Active"
          value={mostActiveProject ? getProjectDisplayName(mostActiveProject.projectPath) : "-"}
          subtext={mostActiveProject ? `${mostActiveProject.sessionCount} sessions` : undefined}
          loading={loading}
        />
        <StatCard
          label="Highest Cost"
          value={highestCostProject ? getProjectDisplayName(highestCostProject.projectPath) : "-"}
          subtext={highestCostProject ? formatCurrency(highestCostProject.totalCost) : undefined}
          loading={loading}
        />
      </div>

      {/* Project Cost Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, item) => (
                        <div className="space-y-1">
                          <p className="font-medium">{item.payload.fullPath}</p>
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
                      fill={`hsl(var(--chart-${(index % 5) + 1}))`}
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
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {sortedProjects.map((project, i) => (
                  <ProjectRow key={i} project={project} rank={i + 1} />
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No projects found</p>
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
              {generateActivityData(projects).map((day, i) => (
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
          <div className="flex items-center justify-end gap-2 mt-4 text-xs text-muted-foreground">
            <span>Less</span>
            <div className="h-3 w-3 rounded-sm bg-muted" />
            <div className="h-3 w-3 rounded-sm bg-chart-2/30" />
            <div className="h-3 w-3 rounded-sm bg-chart-2/60" />
            <div className="h-3 w-3 rounded-sm bg-chart-2" />
            <span>More</span>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

function ProjectRow({ project, rank }: { project: ProjectSummary; rank: number }) {
  const lastActivity = new Date(project.lastActivity).toLocaleDateString();

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground w-6">#{rank}</span>
        <div>
          <p className="font-medium text-sm truncate max-w-[200px]">
            {getProjectDisplayName(project.projectPath)}
          </p>
          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
            {project.projectPath}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-medium text-sm">{formatCurrency(project.totalCost)}</p>
        <p className="text-xs text-muted-foreground">
          {project.sessionCount} sessions · {lastActivity}
        </p>
      </div>
    </div>
  );
}

function EmptyChartState({ height = 200 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center text-muted-foreground"
      style={{ height }}
    >
      No data available
    </div>
  );
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function getProjectDisplayName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || parts[parts.length - 2] || path;
}

function generateActivityData(projects: ProjectSummary[]): Array<{ date: string; sessions: number }> {
  const days = 28;
  const result: Array<{ date: string; sessions: number }> = [];
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
