import { Section } from "@/components/layout/Section";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { InsightCard } from "@/components/shared/InsightCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn, formatPercent } from "@/lib/utils";
import type { DashboardData } from "@shared/rpc-types";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, CheckmarkCircle02Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";

interface ToolsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

export function ToolsSection({ data, loading }: ToolsSectionProps) {
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
          context={toolHealthReport.recommendation}
          type={
            toolHealthReport.frictionPoints.length === 0
              ? "success"
              : toolHealthReport.frictionPoints.length <= 2
                ? "warning"
                : "info"
          }
          priority={toolHealthReport.frictionPoints.length > 2 ? "high" : "medium"}
          className="mb-6"
        />
      )}

      {/* Tool Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Reliable Tools */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-5 w-5 text-success" />
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
            ) : toolHealthReport?.reliableTools && toolHealthReport.reliableTools.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {toolHealthReport.reliableTools.map((tool, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-success/5 border border-success/20"
                  >
                    <div>
                      <span className="font-medium text-sm">{tool.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {tool.totalCalls} calls
                      </span>
                    </div>
                    <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                      {formatPercent(tool.successRate)} success
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No reliable tools found</p>
            )}
          </CardContent>
        </Card>

        {/* Friction Points */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={AlertCircleIcon} className="h-5 w-5 text-destructive" />
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
            ) : toolHealthReport?.frictionPoints && toolHealthReport.frictionPoints.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {toolHealthReport.frictionPoints.map((tool, i) => (
                  <div
                    key={i}
                    className="py-2 px-3 rounded-lg bg-destructive/5 border border-destructive/20"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="font-medium text-sm">{tool.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {tool.totalCalls} calls
                        </span>
                      </div>
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                        {formatPercent(tool.errorRate)} errors
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      Top error: {tool.topError}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
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
          ) : toolHealthReport?.bashDeepDive && toolHealthReport.bashDeepDive.length > 0 ? (
            <div className="space-y-2">
              {toolHealthReport.bashDeepDive.map((category, i) => (
                <BashCategoryAccordion key={i} category={category} />
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No bash commands analyzed</p>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

interface BashCategory {
  category: string;
  totalCommands: number;
  errorCount: number;
  errorRate: number;
  topErrors: Array<{ message: string; count: number }>;
  fixSuggestions: string[];
}

function BashCategoryAccordion({ category }: { category: BashCategory }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasErrors = category.errorCount > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-3 px-4 rounded-lg hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              hasErrors ? "bg-destructive" : "bg-success"
            )}
          />
          <span className="font-medium capitalize">{category.category.replace(/_/g, " ")}</span>
          <span className="text-sm text-muted-foreground">
            {category.totalCommands} commands
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasErrors && (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
              {category.errorCount} errors
            </Badge>
          )}
          <HugeiconsIcon
            icon={isOpen ? ArrowUp01Icon : ArrowDown01Icon}
            className="h-4 w-4 text-muted-foreground"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 space-y-3">
          {category.topErrors.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Top Errors</p>
              <ul className="space-y-1">
                {category.topErrors.slice(0, 3).map((error, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-destructive font-mono text-xs">{error.count}x</span>
                    <span className="truncate">{error.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {category.fixSuggestions.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Fix Suggestions</p>
              <ul className="space-y-1">
                {category.fixSuggestions.map((suggestion, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-success">→</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {category.topErrors.length === 0 && category.fixSuggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">All commands in this category executed successfully.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
