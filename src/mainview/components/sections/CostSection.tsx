import type {
  DashboardData,
  DailyStat,
  ModelBreakdown,
} from "@shared/rpc-types";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ComposedChart,
  Line,
  Cell,
} from "recharts";

import { ExpensivePromptsCard } from "@/components/cards/ExpensivePromptsCard";
import { Section } from "@/components/layout/Section";
import { ChartCard } from "@/components/shared/ChartCard";
import { EmptyChartState } from "@/components/shared/EmptyChartState";
import { LegendItem } from "@/components/shared/LegendItem";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { StatCard } from "@/components/shared/StatCard";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import {
  formatCurrencyAxisTick,
  formatCurrencyAxisTickRounded,
  formatDateTick,
} from "@/lib/chart-formatters";
import { formatCurrency, formatTokens } from "@/lib/utils";

// ─── Stable Empty Arrays (prevent useMemo dep changes on rerenders) ──────────
const EMPTY_DAILY_USAGE: DailyStat[] = [];
const EMPTY_MODEL_BREAKDOWN: ModelBreakdown[] = [];

interface CostSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

const dailyCostConfig = {
  cost: {
    color: "var(--chart-1)",
    label: "Cost",
  },
  cumulativeCost: {
    color: "var(--chart-2)",
    label: "Cumulative",
  },
} satisfies ChartConfig;

const modelConfig = {
  cost: {
    color: "var(--chart-1)",
    label: "Cost",
  },
} satisfies ChartConfig;

const tokenConfig = {
  cacheCreation: {
    color: "var(--chart-3)",
    label: "Cache Creation",
  },
  cacheRead: {
    color: "var(--chart-2)",
    label: "Cache Read",
  },
  output: {
    color: "var(--chart-4)",
    label: "Output",
  },
  uncachedInput: {
    color: "var(--chart-1)",
    label: "Uncached Input",
  },
} satisfies ChartConfig;

export function CostSection({ data, loading }: CostSectionProps) {
  const totals = data?.totals;
  const dailyUsage = data?.dailyUsage ?? EMPTY_DAILY_USAGE;
  const modelBreakdown = data?.modelBreakdown ?? EMPTY_MODEL_BREAKDOWN;

  // Memoize cumulative cost calculation (only recalculates when dailyUsage changes)
  const dailyWithCumulative = useMemo(
    () =>
      dailyUsage.reduce<(DailyStat & { cumulativeCost: number })[]>(
        (acc, day) => {
          const lastItem = acc.at(-1);
          const prev = lastItem?.cumulativeCost ?? 0;
          return [...acc, { ...day, cumulativeCost: prev + day.totalCost }];
        },
        []
      ),
    [dailyUsage]
  );

  // Token breakdown for stacked bar
  const tokenBreakdown = useMemo(
    () =>
      totals
        ? [
            {
              cacheCreation: totals.cacheCreation,
              cacheRead: totals.cacheRead,
              name: "Tokens",
              output: totals.output,
              uncachedInput: totals.uncachedInput,
            },
          ]
        : [],
    [totals]
  );

  // Memoize sorted model breakdown - avoids .toSorted() on every render
  const sortedModelBreakdown = useMemo(
    () =>
      modelBreakdown.toSorted((a, b) => b.totalCost - a.totalCost).slice(0, 6),
    [modelBreakdown]
  );

  return (
    <Section id="cost">
      <SectionHeader
        id="cost-header"
        title="Cost Analytics"
        subtitle="Track spending patterns and identify optimization opportunities"
      />

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard
          label="Total Cost"
          value={formatCurrency(totals?.totalCost ?? 0)}
          loading={loading}
        />
        <StatCard
          label="Avg per Session"
          value={formatCurrency(totals?.avgCostPerSession ?? 0)}
          loading={loading}
        />
        <StatCard
          label="Avg per Query"
          value={formatCurrency(totals?.avgCostPerQuery ?? 0)}
          loading={loading}
        />
      </div>

      {/* Charts Row */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Daily Cost Trend */}
        <ChartCard
          title="Daily Cost Trend"
          subtitle="Cost per day with cumulative line"
          loading={loading}
        >
          {dailyWithCumulative.length > 0 ? (
            <ChartContainer
              config={dailyCostConfig}
              className="h-[250px] w-full"
            >
              <ComposedChart data={dailyWithCumulative} accessibilityLayer>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={formatDateTick}
                />
                <YAxis
                  yAxisId="left"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrencyAxisTick}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrencyAxisTickRounded}
                />
                <ChartTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  animationDuration={150}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <span>
                          {name === "cost" ? "Daily" : "Cumulative"}:{" "}
                          {formatCurrency(value as number)}
                        </span>
                      )}
                    />
                  }
                />
                <Bar
                  yAxisId="left"
                  dataKey="totalCost"
                  name="cost"
                  fill="var(--color-cost)"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulativeCost"
                  name="cumulativeCost"
                  stroke="var(--color-cumulativeCost)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ChartContainer>
          ) : (
            <EmptyChartState />
          )}
        </ChartCard>

        {/* Model Breakdown */}
        <ChartCard
          title="Cost by Model"
          subtitle="Which models are costing the most"
          loading={loading}
        >
          {sortedModelBreakdown.length > 0 ? (
            <ChartContainer config={modelConfig} className="h-[250px] w-full">
              <BarChart
                data={sortedModelBreakdown}
                layout="vertical"
                accessibilityLayer
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrencyAxisTick}
                />
                <YAxis
                  type="category"
                  dataKey="modelShort"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  animationDuration={150}
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatCurrency(value as number)}
                    />
                  }
                />
                <Bar dataKey="totalCost" name="cost" radius={[0, 4, 4, 0]}>
                  {sortedModelBreakdown.map((entry, index) => (
                    <Cell
                      key={entry.modelShort}
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
      </div>

      {/* Token Breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Token Breakdown"
          subtitle="Distribution of token types"
          loading={loading}
        >
          {tokenBreakdown.length > 0 ? (
            <ChartContainer config={tokenConfig} className="h-[100px] w-full">
              <BarChart
                data={tokenBreakdown}
                layout="vertical"
                accessibilityLayer
              >
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" hide />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  animationDuration={150}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(_value, _name, item, index) => {
                        if (index !== 0) {
                          return null;
                        }

                        const data = item.payload as {
                          uncachedInput: number;
                          cacheRead: number;
                          cacheCreation: number;
                          output: number;
                        };
                        const total =
                          data.uncachedInput +
                          data.cacheRead +
                          data.cacheCreation +
                          data.output;

                        const items = [
                          {
                            key: "uncachedInput",
                            label: "Uncached Input",
                            color: "var(--chart-1)",
                            value: data.uncachedInput,
                          },
                          {
                            key: "cacheRead",
                            label: "Cache Read",
                            color: "var(--chart-2)",
                            value: data.cacheRead,
                          },
                          {
                            key: "cacheCreation",
                            label: "Cache Creation",
                            color: "var(--chart-3)",
                            value: data.cacheCreation,
                          },
                          {
                            key: "output",
                            label: "Output",
                            color: "var(--chart-4)",
                            value: data.output,
                          },
                        ];

                        return (
                          <div className="space-y-1.5">
                            {items.map((item) => (
                              <div
                                key={item.key}
                                className="flex items-center gap-2"
                              >
                                <div
                                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                                  style={{ backgroundColor: item.color }}
                                />
                                <span className="text-muted-foreground flex-1">
                                  {item.label}
                                </span>
                                <span className="font-mono font-medium tabular-nums">
                                  {formatTokens(item.value)}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                  ({((item.value / total) * 100).toFixed(1)}%)
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar
                  dataKey="uncachedInput"
                  stackId="a"
                  fill="var(--color-uncachedInput)"
                  radius={[4, 0, 0, 4]}
                />
                <Bar
                  dataKey="cacheRead"
                  stackId="a"
                  fill="var(--color-cacheRead)"
                />
                <Bar
                  dataKey="cacheCreation"
                  stackId="a"
                  fill="var(--color-cacheCreation)"
                />
                <Bar
                  dataKey="output"
                  stackId="a"
                  fill="var(--color-output)"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyChartState height={100} />
          )}
          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs">
            <LegendItem
              color="var(--chart-1)"
              label="Uncached Input"
              value={formatTokens(totals?.uncachedInput ?? 0)}
            />
            <LegendItem
              color="var(--chart-2)"
              label="Cache Read"
              value={formatTokens(totals?.cacheRead ?? 0)}
            />
            <LegendItem
              color="var(--chart-3)"
              label="Cache Creation"
              value={formatTokens(totals?.cacheCreation ?? 0)}
            />
            <LegendItem
              color="var(--chart-4)"
              label="Output"
              value={formatTokens(totals?.output ?? 0)}
            />
          </div>
        </ChartCard>

        {/* Expensive Prompts */}
        <ExpensivePromptsCard data={data} loading={loading} />
      </div>
    </Section>
  );
}
