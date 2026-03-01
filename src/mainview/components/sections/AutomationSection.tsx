import {
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  Clock01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  DashboardData,
  AgentROIEntry,
  SkillROIEntry,
  HookStatEntry,
} from "@shared/rpc-types";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Section } from "@/components/layout/Section";
import { InsightCard } from "@/components/shared/InsightCard";
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
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  cn,
  formatPercent,
  formatNumber,
  getProductivityRating,
  getReliabilityStatus,
  getHookHealth,
  formatAvgDuration,
} from "@/lib/utils";

// ─── Stable Empty Arrays (prevent useMemo dep changes on rerenders) ──────────
const EMPTY_SKILL_ROI: SkillROIEntry[] = [];
const EMPTY_HOOK_STATS: HookStatEntry[] = [];

interface AutomationSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

export function AutomationSection({ data, loading }: AutomationSectionProps) {
  const agentROI = data?.agentROI;
  const skillROI = data?.skillROI ?? EMPTY_SKILL_ROI;
  const hookStats = data?.hookStats ?? EMPTY_HOOK_STATS;
  const skillImpact = data?.skillImpact;

  // Generate headline insight based on data
  const headline = useMemo(() => {
    if (!agentROI?.agents.length && !skillROI.length && !hookStats.length) {
      return null;
    }

    // Check for high-value agents
    const highValueAgents =
      agentROI?.agents.filter((a) => a.category === "high-value") ?? [];
    const firstHighValueAgent = highValueAgents[0];
    if (firstHighValueAgent) {
      return {
        context: `${firstHighValueAgent.agentType} has ${firstHighValueAgent.successRate}% success rate`,
        text: `${highValueAgents.length} high-value agents identified`,
        type: "success" as const,
      };
    }

    // Check for skill impact
    if (skillImpact && skillImpact.impact.errorRateReduction > 0.05) {
      return {
        context: "Sessions using skills have fewer tool errors",
        text: `Skills reduce tool errors by ${(skillImpact.impact.errorRateReduction * 100).toFixed(0)}%`,
        type: "success" as const,
      };
    }

    // Check for hook issues
    const problematicHooks = hookStats.filter(
      (h) => h.totalExecutions > 0 && h.failures / h.totalExecutions > 0.2
    );
    const firstProblematicHook = problematicHooks[0];
    if (firstProblematicHook) {
      const failureRate =
        firstProblematicHook.totalExecutions > 0
          ? firstProblematicHook.failures / firstProblematicHook.totalExecutions
          : 0;
      return {
        context: `${firstProblematicHook.hookName ?? "unknown"} has ${formatPercent(failureRate)} failure rate`,
        text: `${problematicHooks.length} hooks need attention`,
        type: "warning" as const,
      };
    }

    return null;
  }, [agentROI, skillROI, skillImpact, hookStats]);

  return (
    <Section id="automation">
      <SectionHeader
        id="automation-header"
        title="Automation Analytics"
        subtitle="Track agents, skills, and hooks efficiency"
      />

      {/* Headline Insight */}
      {headline && (
        <InsightCard
          headline={headline.text}
          context={headline.context}
          type={headline.type}
          priority="medium"
          className="mb-6"
        />
      )}

      {/* Tabbed Content */}
      <Tabs defaultValue="agents">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="agents">
            Agents ({formatNumber(agentROI?.summary.totalSpawns ?? 0)})
          </TabsTrigger>
          <TabsTrigger value="skills">
            Skills ({formatNumber(skillROI.length)})
          </TabsTrigger>
          <TabsTrigger value="hooks">
            Hooks ({formatNumber(hookStats.length)})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="agents">
          <AgentsTab agents={agentROI?.agents ?? []} loading={loading} />
        </TabsContent>

        <TabsContent value="skills">
          <SkillsTab
            skills={skillROI}
            impact={skillImpact ?? null}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="hooks">
          <HooksTab hooks={hookStats} loading={loading} />
        </TabsContent>
      </Tabs>
    </Section>
  );
}

// ─── Agents Tab ────────────────────────────────────────────────────────────────

interface AgentsTabProps {
  agents: AgentROIEntry[];
  loading?: boolean;
}

function AgentsTab({ agents, loading }: AgentsTabProps) {
  return (
    <Card>
      <LoadingBoundary loading={loading} skeleton="list" className="p-6">
        {agents.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center">
            No agent spawns recorded yet. Agents are created via the Task tool.
          </p>
        ) : (
          <>
            <CardHeader className="pb-2">
              <CardTitle>Agent Performance</CardTitle>
              <CardDescription>
                Reliability and productivity of Task tool agents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[400px] space-y-2 overflow-y-auto pr-2">
                {agents.map((agent) => {
                  const rating = getProductivityRating(
                    agent.successRate,
                    agent.avgToolsPerSpawn
                  );
                  const errors = Math.round(
                    agent.toolsTriggered * (1 - agent.successRate / 100)
                  );

                  return (
                    <div
                      key={agent.agentType}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border",
                        agent.successRate >= 90
                          ? "bg-success/5 border-success/20"
                          : agent.successRate >= 70
                            ? "bg-muted/50 border-border"
                            : "bg-destructive/5 border-destructive/20"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {agent.agentType}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {formatNumber(agent.spawns)} spawns
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-4">
                        {/* Success Rate - fixed width */}
                        <div className="w-14 text-right">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              agent.successRate >= 90
                                ? "bg-success/10 text-success border-success/30"
                                : agent.successRate >= 70
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-destructive/10 text-destructive border-destructive/30"
                            )}
                          >
                            {formatPercent(agent.successRate / 100)}
                          </Badge>
                        </div>

                        {/* Errors - ALWAYS render with fixed width */}
                        <span className="text-destructive w-20 text-right text-xs">
                          {errors > 0 ? `${errors} errors` : "—"}
                        </span>

                        {/* Productivity Rating - split into fixed columns */}
                        <div className="flex items-center gap-2">
                          {/* eslint-disable react/no-array-index-key -- fixed 5-star rating, no data identity */}
                          <div className="flex items-center">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <HugeiconsIcon
                                key={`star-${i}`}
                                icon={StarIcon}
                                className={cn(
                                  "h-3 w-3",
                                  i < rating.stars
                                    ? "text-chart-4"
                                    : "text-muted"
                                )}
                              />
                            ))}
                          </div>
                          {/* eslint-enable react/no-array-index-key */}
                          <span
                            className={cn(
                              "w-24 text-xs",
                              `text-${rating.variant}`
                            )}
                          >
                            {rating.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </>
        )}
      </LoadingBoundary>
    </Card>
  );
}

// ─── Skills Tab ────────────────────────────────────────────────────────────────

interface SkillsTabProps {
  skills: SkillROIEntry[];
  impact: DashboardData["skillImpact"];
  loading?: boolean;
}

const skillImpactChartConfig = {
  withSkills: {
    color: "var(--chart-2)",
    label: "With Skills",
  },
  withoutSkills: {
    color: "var(--muted)",
    label: "Without Skills",
  },
} satisfies ChartConfig;

function SkillsTab({ skills, impact, loading }: SkillsTabProps) {
  // Prepare impact chart data
  const impactData = useMemo(() => {
    if (!impact) {
      return [];
    }

    return [
      {
        metric: "Error Rate",
        withSkills: Math.round(impact.withSkills.avgToolErrorRate * 100),
        withoutSkills: Math.round(impact.withoutSkills.avgToolErrorRate * 100),
      },
      {
        metric: "Completion",
        withSkills: Math.round(impact.withSkills.avgCompletionRate * 100),
        withoutSkills: Math.round(impact.withoutSkills.avgCompletionRate * 100),
      },
      {
        metric: "Cache Hit",
        withSkills: Math.round(impact.withSkills.avgCacheHitRatio * 100),
        withoutSkills: Math.round(impact.withoutSkills.avgCacheHitRatio * 100),
      },
    ];
  }, [impact]);

  return (
    <LoadingBoundary
      loading={loading}
      fallback={
        <div className="space-y-6">
          <div className="bg-muted h-[200px] w-full animate-pulse rounded" />
          <div className="bg-muted h-[200px] w-full animate-pulse rounded" />
        </div>
      }
    >
      {skills.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-8 text-center">
            No skill invocations recorded yet. Skills are invoked via
            /skill-name commands.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Impact Comparison Chart */}
          {impact && impactData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Do Skills Improve Output?</CardTitle>
                <CardDescription>
                  Comparing {impact.withSkills.sessionCount} sessions with
                  skills vs {impact.withoutSkills.sessionCount} without
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-6 lg:flex-row">
                  {/* Chart */}
                  <ChartContainer
                    config={skillImpactChartConfig}
                    className="min-h-[200px] flex-1"
                  >
                    <BarChart
                      data={impactData}
                      accessibilityLayer
                      layout="vertical"
                    >
                      <CartesianGrid horizontal={false} />
                      <XAxis
                        type="number"
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 100]}
                      />
                      <YAxis
                        dataKey="metric"
                        type="category"
                        tickLine={false}
                        axisLine={false}
                        width={80}
                      />
                      <ChartTooltip
                        content={<ChartTooltipContent />}
                        animationDuration={150}
                        isAnimationActive={false}
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar
                        dataKey="withSkills"
                        fill="var(--color-withSkills)"
                        radius={4}
                      />
                      <Bar
                        dataKey="withoutSkills"
                        fill="var(--color-withoutSkills)"
                        radius={4}
                      />
                    </BarChart>
                  </ChartContainer>

                  {/* Impact Badges */}
                  <div className="flex min-w-[180px] flex-col gap-3">
                    <ImpactBadge
                      label="Error Rate"
                      value={impact.impact.errorRateReduction}
                      lowerIsBetter
                    />
                    <ImpactBadge
                      label="Completion"
                      value={impact.impact.completionImprovement}
                    />
                    <ImpactBadge
                      label="Avg Turns"
                      value={impact.impact.turnsReduction}
                      lowerIsBetter
                    />
                    <ImpactBadge
                      label="Cache Hit"
                      value={impact.impact.cacheImprovement}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Skills Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Skill Reliability</CardTitle>
              <CardDescription>
                Completion rates and usage frequency
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-2">
                {skills.map((skill) => {
                  const status = getReliabilityStatus(skill.completionRate);

                  return (
                    <div
                      key={skill.skillName}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border",
                        skill.completionRate >= 0.85
                          ? "bg-success/5 border-success/20"
                          : skill.completionRate >= 0.7
                            ? "bg-muted/50 border-border"
                            : "bg-warning/5 border-warning/20"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono font-medium">
                          {skill.skillName}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatNumber(skill.invocationCount)} uses &middot;{" "}
                          {skill.avgToolsTriggered} avg actions
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            status.variant === "success"
                              ? "bg-success/10 text-success border-success/30"
                              : status.variant === "warning"
                                ? "bg-warning/10 text-warning border-warning/30"
                                : "bg-destructive/10 text-destructive border-destructive/30"
                          )}
                        >
                          {formatPercent(skill.completionRate)}
                        </Badge>
                        <span
                          className={cn("text-xs", `text-${status.variant}`)}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </LoadingBoundary>
  );
}

// ─── Hooks Tab ─────────────────────────────────────────────────────────────────

interface HooksTabProps {
  hooks: HookStatEntry[];
  loading?: boolean;
}

function HooksTab({ hooks, loading }: HooksTabProps) {
  return (
    <Card>
      <LoadingBoundary loading={loading} skeleton="list" className="p-6">
        {hooks.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center">
            No hook executions recorded yet. Hooks run on events like
            PreToolUse, PostToolUse, etc.
          </p>
        ) : (
          <>
            <CardHeader className="pb-2">
              <CardTitle>Hook Health</CardTitle>
              <CardDescription>
                Execution frequency, failures, and latency
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[400px] space-y-2 overflow-y-auto pr-2">
                {hooks.map((hook) => {
                  const failureRate =
                    hook.totalExecutions > 0
                      ? hook.failures / hook.totalExecutions
                      : 0;
                  const health = getHookHealth(failureRate, hook.avgDurationMs);

                  return (
                    <div
                      key={`${hook.hookType}-${hook.hookName}`}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border",
                        health.variant === "success"
                          ? "bg-success/5 border-success/20"
                          : health.variant === "warning"
                            ? "bg-warning/5 border-warning/20"
                            : "bg-destructive/5 border-destructive/20"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {hook.hookName ?? "unnamed"}
                        </div>
                        <div className="text-muted-foreground flex items-center gap-2 text-xs">
                          <Badge
                            variant="outline"
                            className="px-1.5 py-0 text-[10px]"
                          >
                            {hook.hookType}
                          </Badge>
                          <span>
                            {formatNumber(hook.totalExecutions)} triggers
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-4">
                        {/* Failures */}
                        {hook.failures > 0 && (
                          <span
                            className={cn(
                              "text-xs",
                              failureRate > 0.1
                                ? "text-destructive"
                                : "text-muted-foreground"
                            )}
                          >
                            {hook.failures} ({formatPercent(failureRate)})
                            failures
                          </span>
                        )}

                        {/* Latency */}
                        <div className="text-muted-foreground flex items-center gap-1 text-xs">
                          <HugeiconsIcon
                            icon={Clock01Icon}
                            className="h-3 w-3"
                          />
                          {formatAvgDuration(hook.avgDurationMs)}
                        </div>

                        {/* Health Status */}
                        <div className="flex items-center gap-1">
                          <HugeiconsIcon
                            icon={
                              health.icon === "check"
                                ? CheckmarkCircle02Icon
                                : AlertCircleIcon
                            }
                            className={cn(
                              "h-4 w-4",
                              health.variant === "success"
                                ? "text-success"
                                : health.variant === "warning"
                                  ? "text-warning"
                                  : "text-destructive"
                            )}
                          />
                          <span
                            className={cn("text-xs", `text-${health.variant}`)}
                          >
                            {health.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </>
        )}
      </LoadingBoundary>
    </Card>
  );
}

// ─── Helper Components ──────────────────────────────────────────────────────────

interface ImpactBadgeProps {
  label: string;
  value: number;
  lowerIsBetter?: boolean;
}

function ImpactBadge({
  label,
  value,
  lowerIsBetter = false,
}: ImpactBadgeProps) {
  const isPositive = lowerIsBetter ? value > 0 : value > 0;
  const absPercent = Math.abs(value * 100);
  const direction = isPositive
    ? lowerIsBetter
      ? "fewer"
      : "more"
    : lowerIsBetter
      ? "more"
      : "less";

  if (absPercent < 1) {
    return (
      <div className="bg-muted/50 rounded-lg p-2 text-center">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="text-muted-foreground text-sm font-medium">
          No difference
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "p-2 rounded-lg text-center",
        isPositive ? "bg-success/10" : "bg-destructive/10"
      )}
    >
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={cn(
          "text-sm font-medium",
          isPositive ? "text-success" : "text-destructive"
        )}
      >
        {isPositive ? "▼" : "▲"} {absPercent.toFixed(0)}% {direction}
      </div>
    </div>
  );
}
