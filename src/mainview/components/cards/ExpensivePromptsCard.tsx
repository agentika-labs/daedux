import { modelFamily, modelBadgeId } from "@shared/model-utils";
import type { DashboardData } from "@shared/rpc-types";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useExpandedIndex } from "@/hooks/useExpandedIndex";
import { getModelBadgeStyle } from "@/lib/model-styles";
import { formatCurrency, formatTokens, cn } from "@/lib/utils";

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

// ─── Rank Badge ───────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  // Graduated opacity: rank 1 = 100%, rank 5 = 60%
  const opacity = 1 - (rank - 1) * 0.1;

  return (
    <div
      className="bg-foreground text-background flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
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
    <div className="bg-muted relative h-2 w-full overflow-hidden rounded-full">
      <div
        className="from-chart-1 to-chart-1/60 absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-all duration-700 ease-out"
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
  const family = modelFamily(prompt.model);
  const badgeStyle = getModelBadgeStyle(family);
  const badgeLabel = modelBadgeId(prompt.model);

  // Truncate prompt for collapsed view
  const truncatedPrompt =
    prompt.prompt.length > 60
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

          <div className="min-w-0 flex-1 space-y-2">
            {/* Cost bar row */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <CostBar cost={prompt.cost} maxCost={maxCost} />
              </div>
              <div className="flex shrink-0 items-baseline gap-1.5">
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(prompt.cost)}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  ({percentOfTotal.toFixed(0)}%)
                </span>
              </div>
            </div>

            {/* Prompt preview */}
            <p className="text-muted-foreground text-sm leading-snug">
              "{truncatedPrompt}"
            </p>

            {/* Metadata row */}
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <Badge
                variant="outline"
                className={cn("h-5 text-[10px] font-medium", badgeStyle)}
              >
                {badgeLabel}
              </Badge>
              <span>{prompt.date}</span>
              {prompt.queryCount > 1 && (
                <span className="text-chart-2">{prompt.queryCount} calls</span>
              )}
              <span>{formatTokens(prompt.totalTokens)} tokens</span>
            </div>
          </div>

          {/* Expand indicator */}
          <div className="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </CollapsibleTrigger>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="mt-3 ml-9 rounded-md border-l-2 border-chart-1/40 bg-muted/30 py-3 pr-4 pl-4">
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
              {prompt.prompt}
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExpensivePromptsCard({
  data,
  loading,
}: ExpensivePromptsCardProps) {
  const { isExpanded, toggle } = useExpandedIndex();

  const topPrompts = data?.topPrompts?.slice(0, 5) ?? [];
  const maxCost = topPrompts[0]?.cost ?? 0;
  const totalOfTop5 = topPrompts.reduce((sum, p) => sum + p.cost, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Top Expensive Prompts
          </CardTitle>
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
            {/* Skeleton placeholders - index keys safe for static arrays that never reorder/filter */}
            {[1, 2, 3].map((i) => (
              <div key={`skeleton-${i}`} className="flex gap-3">
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
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
            {topPrompts.map((prompt, index) => (
              <PromptRow
                key={`${prompt.sessionId}-${index}`}
                prompt={prompt}
                rank={index + 1}
                maxCost={maxCost}
                totalOfTop5={totalOfTop5}
                percentOfTotal={
                  totalOfTop5 > 0 ? (prompt.cost / totalOfTop5) * 100 : 0
                }
                expanded={isExpanded(index)}
                onToggle={() => toggle(index)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="mb-2 text-3xl">📊</span>
            <p className="text-muted-foreground text-sm">
              No expensive prompts found
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Run some sessions to see your top spenders
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
