import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  Copy01Icon,
  Cancel01Icon,
  AlertDiamondIcon,
  Search01Icon,
  LockIcon,
  Wifi02Icon,
  CodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ConfidenceLevel, DashboardData } from "@shared/rpc-types";
import { useState } from "react";

import { Section } from "@/components/layout/Section";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useExpandedIndex } from "@/hooks/useExpandedIndex";
import { InsightCard } from "@/components/shared/InsightCard";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  parseError,
  matchSuggestionToError,
  formatRecommendation,
  stripXmlTags,
  getSeverityFromErrorRate,
  CATEGORY_STYLES,
} from "@/lib/error-parsing";
import type { ErrorCategory } from "@/lib/error-parsing";
import { cn, formatPercent, formatOccurrenceCount } from "@/lib/utils";

interface ToolsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

export function ToolsSection({ data, loading }: ToolsSectionProps) {
  const frictionExpansion = useExpandedIndex();
  const bashExpansion = useExpandedIndex();

  const toolHealthReport = data?.toolHealthReportCard;

  return (
    <Section id="tools">
      <SectionHeader
        id="tools-header"
        title="Tool Health"
        subtitle="Track tool reliability and identify friction points"
      />

      {/* Health Headline */}
      {toolHealthReport && (
        <InsightCard
          headline={toolHealthReport.headline}
          context={formatRecommendation(toolHealthReport.recommendation)}
          type={
            toolHealthReport.frictionPoints.length === 0
              ? "success"
              : toolHealthReport.frictionPoints.length <= 2
                ? "warning"
                : "info"
          }
          priority={
            toolHealthReport.frictionPoints.length > 2 ? "high" : "medium"
          }
          className="mb-6"
        />
      )}

      {/* Tool Lists */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Reliable Tools */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="text-success h-5 w-5"
              />
              Reliable Tools
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : toolHealthReport?.reliableTools &&
              toolHealthReport.reliableTools.length > 0 ? (
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-3">
                {toolHealthReport.reliableTools.map((tool, i) => (
                  <div
                    key={i}
                    className="bg-success/5 border-success/20 flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{tool.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {tool.totalCalls} calls
                      </span>
                      <ConfidenceBadge confidence={tool.confidence} />
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-success/10 text-success border-success/30"
                      title={`Wilson lower bound: ${tool.reliabilityScore?.toFixed(1)}%`}
                    >
                      {formatPercent(tool.successRate)} success
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-8 text-center">
                No reliable tools found
              </p>
            )}
          </CardContent>
        </Card>

        {/* Friction Points */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon
                icon={AlertCircleIcon}
                className="text-destructive h-5 w-5"
              />
              Friction Points
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : toolHealthReport?.frictionPoints &&
              toolHealthReport.frictionPoints.length > 0 ? (
              <div className="max-h-[400px] space-y-2 overflow-y-auto pr-3">
                {/* Sort by friction score descending (worst first) */}
                {[...toolHealthReport.frictionPoints]
                  .toSorted((a, b) => (b.frictionScore ?? b.errorRate) - (a.frictionScore ?? a.errorRate))
                  .map((tool, i) => (
                    <FrictionPointCard
                      key={i}
                      name={tool.name}
                      totalCalls={tool.totalCalls}
                      errorRate={tool.errorRate}
                      topError={tool.topError}
                      errorCount={Math.round(tool.totalCalls * tool.errorRate)}
                      expanded={frictionExpansion.isExpanded(i)}
                      onToggle={() => frictionExpansion.toggle(i)}
                      confidence={tool.confidence}
                      frictionScore={tool.frictionScore}
                    />
                  ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-8 text-center">
                No friction points - all tools are working well
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bash Deep Dive */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Bash Command Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : toolHealthReport?.bashDeepDive &&
            toolHealthReport.bashDeepDive.length > 0 ? (
            <div className="space-y-2">
              {toolHealthReport.bashDeepDive.map((category, i) => (
                <BashCategoryAccordion
                  key={i}
                  category={category}
                  expanded={bashExpansion.isExpanded(i)}
                  onToggle={() => bashExpansion.toggle(i)}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground py-8 text-center">
              No bash commands analyzed
            </p>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

/** Confidence badge showing statistical confidence level */
function ConfidenceBadge({ confidence }: { confidence?: ConfidenceLevel }) {
  if (!confidence) return null;

  const styles: Record<ConfidenceLevel, { bg: string; text: string; label: string }> = {
    high: {
      bg: "bg-success/10",
      label: "high confidence",
      text: "text-success",
    },
    medium: {
      bg: "bg-warning/10",
      label: "medium",
      text: "text-warning",
    },
    low: {
      bg: "bg-muted",
      label: "low sample",
      text: "text-muted-foreground",
    },
  };

  const style = styles[confidence];

  return (
    <span
      className={cn(
        "rounded px-1 py-0.5 text-[10px] font-medium",
        style.bg,
        style.text
      )}
      title={`Statistical confidence: ${confidence} (based on sample size)`}
    >
      {style.label}
    </span>
  );
}

/** Icon mapping for error categories */
const CATEGORY_ICONS: Record<ErrorCategory, typeof AlertCircleIcon> = {
  exit_code: AlertDiamondIcon,
  file_not_found: Search01Icon,
  generic: AlertCircleIcon,
  network_error: Wifi02Icon,
  permission_denied: LockIcon,
  stack_trace: CodeIcon,
  user_rejection: Cancel01Icon,
};

/** Tailwind-safe border classes by severity tier (avoids dynamic class purging issues) */
const SEVERITY_BADGE_BORDER: Record<string, string> = {
  critical: "border-destructive/30",
  severe: "border-destructive/30",
  moderate: "border-warning/30",
  minimal: "border-border/30",
};

// ─── Friction Point Card ─────────────────────────────────────────────────────

interface FrictionPointCardProps {
  name: string;
  totalCalls: number;
  errorRate: number;
  topError: string;
  errorCount: number;
  expanded: boolean;
  onToggle: () => void;
  confidence?: ConfidenceLevel;
  frictionScore?: number;
}

function FrictionPointCard({
  name,
  totalCalls,
  errorRate,
  topError,
  errorCount,
  expanded,
  onToggle,
  confidence,
  frictionScore,
}: FrictionPointCardProps) {
  const severity = getSeverityFromErrorRate(errorRate);
  const parsed = parseError(topError);
  const Icon = CATEGORY_ICONS[parsed.category];
  const cleanedError = stripXmlTags(topError);
  const cleanedSummary = stripXmlTags(parsed.summary);
  const { copied, copy } = useCopyToClipboard();

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <div
        className={cn(
          "rounded-lg border",
          severity.bgClass,
          severity.borderClass
        )}
      >
        {/* Header */}
        <CollapsibleTrigger className="w-full text-left">
          <div className="px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <HugeiconsIcon
                  icon={Icon}
                  className={cn("h-4 w-4 shrink-0", severity.badgeTextClass)}
                />
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {totalCalls} calls
                </span>
                <ConfidenceBadge confidence={confidence} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs px-1.5 py-0",
                    severity.badgeBgClass,
                    severity.badgeTextClass,
                    SEVERITY_BADGE_BORDER[severity.tier]
                  )}
                  title={
                    frictionScore
                      ? `Wilson upper bound: ${frictionScore.toFixed(1)}% (worst-case error rate)`
                      : undefined
                  }
                >
                  {formatPercent(errorRate)} errors
                </Badge>
                <HugeiconsIcon
                  icon={expanded ? ArrowUp01Icon : ArrowDown01Icon}
                  className="text-muted-foreground h-4 w-4"
                />
              </div>
            </div>

            {/* Summary (always visible) */}
            <p className="text-muted-foreground truncate text-xs">
              {cleanedSummary}
            </p>
          </div>
        </CollapsibleTrigger>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="border-border/30 border-t px-3 py-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">
                Error Details ({formatOccurrenceCount(errorCount)} occurrences)
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copy(cleanedError);
                }}
                className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                title="Copy full error message"
              >
                {copied ? (
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="text-success h-3.5 w-3.5"
                  />
                ) : (
                  <HugeiconsIcon icon={Copy01Icon} className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {/* Full error message */}
            <pre className="text-muted-foreground bg-muted/30 mb-2 rounded p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {cleanedError}
            </pre>

            {/* Category badge with severity */}
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {parsed.category.replaceAll("_", " ")}
              </Badge>
              <span className={cn("text-[10px]", severity.badgeTextClass)}>
                {severity.label}
              </span>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface SmartErrorCardProps {
  message: string;
  count: number;
  suggestion?: string;
}

function SmartErrorCard({ message, count, suggestion }: SmartErrorCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const parsed = parseError(message);
  const style = CATEGORY_STYLES[parsed.category];
  const Icon = CATEGORY_ICONS[parsed.category];

  return (
    <div className={cn("rounded-lg border", style.bgClass, style.borderClass)}>
      {/* Header: icon + summary + count badge + copy button */}
      <div className="border-border/30 flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <HugeiconsIcon
            icon={Icon}
            className={cn("h-4 w-4 shrink-0", style.textClass)}
          />
          <span className="truncate text-sm font-medium">{parsed.summary}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="px-1.5 py-0 text-xs">
            {formatOccurrenceCount(count)}
          </Badge>
          <button
            type="button"
            onClick={() => copy(message)}
            className="text-muted-foreground hover:text-foreground p-1 transition-colors"
            title="Copy full error message"
          >
            {copied ? (
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="text-success h-3.5 w-3.5"
              />
            ) : (
              <HugeiconsIcon icon={Copy01Icon} className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible body for stack traces / verbose errors */}
      <div className="px-3 py-2">
        <pre className="text-muted-foreground font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {isExpanded ? parsed.originalMessage : parsed.truncatedMessage}
        </pre>
        {parsed.isExpandable && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-primary mt-1 flex items-center gap-1 text-xs hover:underline"
          >
            <HugeiconsIcon
              icon={isExpanded ? ArrowUp01Icon : ArrowDown01Icon}
              className="h-3 w-3"
            />
            {isExpanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>

      {/* Inline suggestion (green accent) */}
      {suggestion && (
        <div className="bg-success/5 border-success/20 rounded-b-lg border-t px-3 py-2">
          <span className="text-success flex items-start gap-1.5 text-xs">
            <span className="shrink-0">→</span>
            <span>{suggestion}</span>
          </span>
        </div>
      )}
    </div>
  );
}

interface BashCategory {
  category: string;
  totalCommands: number;
  errorCount: number;
  errorRate: number;
  topErrors: { message: string; count: number }[];
  fixSuggestions: string[];
}

interface BashCategoryAccordionProps {
  category: BashCategory;
  expanded: boolean;
  onToggle: () => void;
}

function BashCategoryAccordion({ category, expanded, onToggle }: BashCategoryAccordionProps) {
  const hasErrors = category.errorCount > 0;

  // Success state: simple row, no accordion
  if (!hasErrors) {
    return (
      <div className="flex items-center justify-between rounded-lg px-4 py-3 bg-success/5 border border-success/20">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-success" />
          <span className="font-medium capitalize">
            {category.category.replaceAll("_", " ")}
          </span>
          <span className="text-muted-foreground text-sm">
            {category.totalCommands} commands
          </span>
        </div>
        <Badge
          variant="outline"
          className="bg-success/10 text-success border-success/30"
        >
          All successful
        </Badge>
      </div>
    );
  }

  // Error state: full accordion with expandable details
  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center justify-between rounded-lg px-4 py-3 transition-colors">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-destructive" />
          <span className="font-medium capitalize">
            {category.category.replaceAll("_", " ")}
          </span>
          <span className="text-muted-foreground text-sm">
            {category.totalCommands} commands
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="bg-destructive/10 text-destructive border-destructive/30"
          >
            {category.errorCount} errors
          </Badge>
          <HugeiconsIcon
            icon={expanded ? ArrowUp01Icon : ArrowDown01Icon}
            className="text-muted-foreground h-4 w-4"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 px-4 pb-4">
          <div>
            <p className="mb-2 text-sm font-medium">Top Errors</p>
            <div className="space-y-2">
              {category.topErrors.slice(0, 3).map((error, i) => {
                const parsed = parseError(error.message);
                const matchedSuggestion = matchSuggestionToError(
                  parsed,
                  category.fixSuggestions
                );
                return (
                  <SmartErrorCard
                    key={i}
                    message={error.message}
                    count={error.count}
                    suggestion={matchedSuggestion}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
