import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatCurrency, formatTokens, cn } from "@/lib/utils";
import type { DashboardData } from "@shared/rpc-types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpensivePromptsCardProps {
  data: DashboardData | null;
  loading?: boolean;
}

type TopPrompt = NonNullable<DashboardData["topPrompts"]>[number];

interface PromptRowProps {
  prompt: TopPrompt;
  rank: number;
  maxCost: number;
  percentOfTotal: number;
  totalOfTop5: number;
  expanded: boolean;
  onToggle: () => void;
}

// ─── Model Badge Colors ───────────────────────────────────────────────────────

function getModelFamily(model: string): "opus" | "sonnet" | "haiku" | "unknown" {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  return "unknown";
}

function getModelBadgeStyle(family: ReturnType<typeof getModelFamily>) {
  switch (family) {
    case "opus":
      return "bg-chart-3/20 text-chart-3 border-chart-3/30";
    case "sonnet":
      return "bg-chart-2/20 text-chart-2 border-chart-2/30";
    case "haiku":
      return "bg-chart-5/20 text-chart-5 border-chart-5/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function getShortModel(model: string): string {
  // Extract short name: "claude-opus-4-6" -> "opus-4.6"
  const match = model.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (match) {
    const [, name, major, minor] = match;
    return `${name!.toLowerCase()}-${major}.${minor}`;
  }
  // Fallback: family + major version only
  const familyMatch = model.match(/(opus|sonnet|haiku)-(\d+)/i);
  if (familyMatch) {
    return `${familyMatch[1]!.toLowerCase()}-${familyMatch[2]}`;
  }
  return model.slice(0, 12);
}

// ─── Rank Badge ───────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  // Graduated opacity: rank 1 = 100%, rank 5 = 60%
  const opacity = 1 - (rank - 1) * 0.1;

  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold"
      style={{ opacity }}
    >
      {rank}
    </div>
  );
}

// ─── Cost Bar ─────────────────────────────────────────────────────────────────

function CostBar({ cost, maxCost }: { cost: number; maxCost: number }) {
  const widthPercent = maxCost > 0 ? (cost / maxCost) * 100 : 0;

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-chart-1 to-chart-1/60 transition-all duration-700 ease-out"
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

// ─── Prompt Row ───────────────────────────────────────────────────────────────

function PromptRow({
  prompt,
  rank,
  maxCost,
  percentOfTotal,
  expanded,
  onToggle,
}: PromptRowProps) {
  const modelFamily = getModelFamily(prompt.model);
  const modelBadgeStyle = getModelBadgeStyle(modelFamily);
  const shortModel = getShortModel(prompt.model);

  // Truncate prompt for collapsed view
  const truncatedPrompt = prompt.prompt.length > 60
    ? prompt.prompt.slice(0, 60) + "..."
    : prompt.prompt;

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <div
        className={cn(
          "group rounded-lg border border-transparent px-3 py-3 transition-all",
          "hover:border-border hover:bg-muted/50",
          expanded && "border-border bg-muted/30"
        )}
        style={{
          // Staggered animation delay based on rank
          animationDelay: `${(rank - 1) * 100}ms`,
        }}
      >
        {/* Main Row */}
        <CollapsibleTrigger className="flex w-full cursor-pointer items-start gap-3 text-left">
          <RankBadge rank={rank} />

          <div className="flex-1 min-w-0 space-y-2">
            {/* Cost bar row */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <CostBar cost={prompt.cost} maxCost={maxCost} />
              </div>
              <div className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(prompt.cost)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  ({percentOfTotal.toFixed(0)}%)
                </span>
              </div>
            </div>

            {/* Prompt preview */}
            <p className="text-sm text-muted-foreground leading-snug">
              "{truncatedPrompt}"
            </p>

            {/* Metadata row */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={cn("h-5 text-[10px] font-medium", modelBadgeStyle)}
              >
                {shortModel}
              </Badge>
              <span>{prompt.date}</span>
              {prompt.queryCount > 1 && (
                <span className="text-chart-2">{prompt.queryCount} calls</span>
              )}
              <span>{formatTokens(prompt.totalTokens)} tokens</span>
            </div>
          </div>

          {/* Expand indicator */}
          <div className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            <svg
              className={cn(
                "h-4 w-4 transition-transform",
                expanded && "rotate-180"
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </CollapsibleTrigger>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="mt-3 ml-9 rounded-md bg-muted/50 p-3">
            <p className="text-sm font-mono whitespace-pre-wrap break-all leading-relaxed">
              {prompt.prompt}
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExpensivePromptsCard({ data, loading }: ExpensivePromptsCardProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const topPrompts = data?.topPrompts?.slice(0, 5) ?? [];
  const maxCost = topPrompts[0]?.cost ?? 0;
  const totalOfTop5 = topPrompts.reduce((sum, p) => sum + p.cost, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Top Expensive Prompts</CardTitle>
          {totalOfTop5 > 0 && (
            <Badge variant="secondary" className="font-mono tabular-nums">
              Total: {formatCurrency(totalOfTop5)}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : topPrompts.length > 0 ? (
          <div className="space-y-1">
            {topPrompts.map((prompt, i) => (
              <PromptRow
                key={`${prompt.sessionId}-${i}`}
                prompt={prompt}
                rank={i + 1}
                maxCost={maxCost}
                totalOfTop5={totalOfTop5}
                percentOfTotal={totalOfTop5 > 0 ? (prompt.cost / totalOfTop5) * 100 : 0}
                expanded={expandedIndex === i}
                onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="text-3xl mb-2">📊</span>
            <p className="text-sm text-muted-foreground">No expensive prompts found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Run some sessions to see your top spenders
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
