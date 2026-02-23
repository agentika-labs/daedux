import { useState, useEffect } from "react";
import { useRPC, rpcRequest } from "../../hooks/useRPC";
import type { DashboardData } from "@shared/rpc-types";
import { formatCurrency, formatTokens, formatNumber } from "../../lib/utils";

interface DashboardProps {
  isLoading: boolean;
}

type FilterOption = "today" | "7d" | "30d" | "all";

const Dashboard = ({ isLoading: initialLoading }: DashboardProps) => {
  const rpc = useRPC();
  const [isLoading, setIsLoading] = useState(initialLoading);
  const [data, setData] = useState<DashboardData | null>(null);
  const [filter, setFilter] = useState<FilterOption>("7d");
  const [error, setError] = useState<string | null>(null);

  // Load dashboard data
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const dashboardData = await rpcRequest("getDashboardData", { filter });
        setData(dashboardData);
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [filter]);

  // Listen for data updates from main process
  useEffect(() => {
    const handleUpdate = () => {
      // Reload data when sessions are updated
      rpcRequest("getDashboardData", { filter }).then(setData).catch(console.error);
    };

    rpc.addMessageListener("sessionsUpdated", handleUpdate);
    return () => rpc.removeMessageListener("sessionsUpdated", handleUpdate);
  }, [filter]);

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-2">Error loading data</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Claude Usage Monitor</h1>
            <p className="text-sm text-muted-foreground">
              Track your token usage and costs
            </p>
          </div>

          {/* Filter buttons */}
          <div className="flex gap-2">
            {(["today", "7d", "30d", "all"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setFilter(option)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === option
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {option === "today"
                  ? "Today"
                  : option === "all"
                    ? "All Time"
                    : option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Cost"
            value={formatCurrency(totals?.totalCost ?? 0)}
            subtext={`${formatCurrency(totals?.avgCostPerSession ?? 0)} avg/session`}
          />
          <StatCard
            label="Sessions"
            value={formatNumber(totals?.totalSessions ?? 0)}
            subtext={`${formatNumber(totals?.totalSubagents ?? 0)} subagents`}
          />
          <StatCard
            label="Total Tokens"
            value={formatTokens(totals?.totalTokens ?? 0)}
            subtext={`${formatTokens(totals?.totalInputTokens ?? 0)} input`}
          />
          <StatCard
            label="Cache Savings"
            value={formatCurrency(totals?.savedByCaching ?? 0)}
            subtext={`${((totals?.cacheEfficiencyRatio ?? 0) * 100).toFixed(0)}% hit rate`}
            variant="success"
          />
        </div>

        {/* Efficiency Score */}
        {data?.efficiencyScore && (
          <div className="bg-card border border-border rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Efficiency Score</h2>
              <span
                className={`text-sm font-medium px-2 py-1 rounded ${
                  data.efficiencyScore.trend === "improving"
                    ? "bg-success/10 text-success"
                    : data.efficiencyScore.trend === "declining"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {data.efficiencyScore.trend === "improving"
                  ? "Improving"
                  : data.efficiencyScore.trend === "declining"
                    ? "Declining"
                    : "Stable"}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <ScoreBar
                label="Overall"
                value={data.efficiencyScore.overall}
                maxValue={100}
              />
              <ScoreBar
                label="Cache"
                value={data.efficiencyScore.cacheEfficiency}
                maxValue={100}
              />
              <ScoreBar
                label="Tool Success"
                value={data.efficiencyScore.toolSuccess}
                maxValue={100}
              />
              <ScoreBar
                label="Session"
                value={data.efficiencyScore.sessionEfficiency}
                maxValue={100}
              />
            </div>

            {data.efficiencyScore.topOpportunity && (
              <p className="mt-4 text-sm text-muted-foreground">
                Tip: {data.efficiencyScore.topOpportunity}
              </p>
            )}
          </div>
        )}

        {/* Weekly Comparison */}
        {data?.weeklyComparison && (
          <div className="bg-card border border-border rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">This Week vs Last Week</h2>

            <div className="grid grid-cols-3 gap-4">
              <ComparisonCard
                label="Cost"
                thisWeek={formatCurrency(data.weeklyComparison.thisWeek.cost)}
                lastWeek={formatCurrency(data.weeklyComparison.lastWeek.cost)}
                change={data.weeklyComparison.changes.cost}
                isInverse
              />
              <ComparisonCard
                label="Sessions"
                thisWeek={data.weeklyComparison.thisWeek.sessions.toString()}
                lastWeek={data.weeklyComparison.lastWeek.sessions.toString()}
                change={data.weeklyComparison.changes.sessions}
              />
              <ComparisonCard
                label="Cache Hit Rate"
                thisWeek={`${(data.weeklyComparison.thisWeek.cacheHitRate * 100).toFixed(0)}%`}
                lastWeek={`${(data.weeklyComparison.lastWeek.cacheHitRate * 100).toFixed(0)}%`}
                change={data.weeklyComparison.changes.cacheHitRate * 100}
              />
            </div>

            {(data.weeklyComparison.improvements.length > 0 ||
              data.weeklyComparison.concerns.length > 0) && (
              <div className="mt-4 flex gap-4">
                {data.weeklyComparison.improvements.length > 0 && (
                  <div className="flex-1">
                    <p className="text-sm font-medium text-success mb-1">Improvements</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {data.weeklyComparison.improvements.map((item, i) => (
                        <li key={i}>+ {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.weeklyComparison.concerns.length > 0 && (
                  <div className="flex-1">
                    <p className="text-sm font-medium text-destructive mb-1">Concerns</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {data.weeklyComparison.concerns.map((item, i) => (
                        <li key={i}>- {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sessions Table (placeholder) */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Sessions</h2>

          {data?.sessions && data.sessions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-sm text-muted-foreground">
                    <th className="pb-3 font-medium">Project</th>
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium text-right">Queries</th>
                    <th className="pb-3 font-medium text-right">Tokens</th>
                    <th className="pb-3 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.slice(0, 10).map((session) => (
                    <tr
                      key={session.sessionId}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-3">
                        <div className="font-medium truncate max-w-[200px]">
                          {session.displayName ?? session.project.split("/").pop()}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {session.project}
                        </div>
                      </td>
                      <td className="py-3 text-sm text-muted-foreground">{session.date}</td>
                      <td className="py-3 text-sm text-right">{session.queryCount}</td>
                      <td className="py-3 text-sm text-right">
                        {formatTokens(session.totalTokens)}
                      </td>
                      <td className="py-3 text-sm text-right font-medium">
                        {formatCurrency(session.totalCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No sessions found</p>
          )}
        </div>
      </main>
    </div>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  variant?: "default" | "success" | "warning";
}

const StatCard = ({ label, value, subtext, variant = "default" }: StatCardProps) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <p className="text-sm text-muted-foreground mb-1">{label}</p>
    <p
      className={`text-2xl font-semibold ${
        variant === "success"
          ? "text-success"
          : variant === "warning"
            ? "text-destructive"
            : ""
      }`}
    >
      {value}
    </p>
    {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
  </div>
);

interface ScoreBarProps {
  label: string;
  value: number;
  maxValue: number;
}

const ScoreBar = ({ label, value, maxValue }: ScoreBarProps) => {
  const percentage = Math.min(100, (value / maxValue) * 100);
  const color =
    percentage >= 75
      ? "bg-success"
      : percentage >= 50
        ? "bg-chart-4"
        : percentage >= 25
          ? "bg-chart-1"
          : "bg-destructive";

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(value)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

interface ComparisonCardProps {
  label: string;
  thisWeek: string;
  lastWeek: string;
  change: number;
  isInverse?: boolean;
}

const ComparisonCard = ({
  label,
  thisWeek,
  lastWeek,
  change,
  isInverse = false,
}: ComparisonCardProps) => {
  const isPositive = isInverse ? change < 0 : change > 0;
  const displayChange = Math.abs(change);

  return (
    <div className="text-center">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold">{thisWeek}</p>
      <div className="flex items-center justify-center gap-1 mt-1">
        <span className="text-xs text-muted-foreground">vs {lastWeek}</span>
        {change !== 0 && (
          <span
            className={`text-xs font-medium ${
              isPositive ? "text-success" : "text-destructive"
            }`}
          >
            {isPositive ? "+" : "-"}
            {displayChange.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
