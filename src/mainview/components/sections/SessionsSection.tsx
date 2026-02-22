import { useState, useMemo } from "react";
import { Section } from "@/components/layout/Section";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatTokens, formatDuration, cn } from "@/lib/utils";
import type { DashboardData, SessionSummary } from "@shared/rpc-types";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Clock01Icon, Coins01Icon } from "@hugeicons/core-free-icons";

interface SessionsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

type SortField = "date" | "cost" | "tokens" | "queries";
type SortDirection = "asc" | "desc";

export function SessionsSection({ data, loading }: SessionsSectionProps) {
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [showSubagents, setShowSubagents] = useState(false);

  const sessions = data?.sessions ?? [];

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let filtered = showSubagents ? sessions : sessions.filter((s) => !s.isSubagent);

    filtered.sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortField) {
        case "date":
          aVal = a.startTime;
          bVal = b.startTime;
          break;
        case "cost":
          aVal = a.totalCost;
          bVal = b.totalCost;
          break;
        case "tokens":
          aVal = a.totalTokens;
          bVal = b.totalTokens;
          break;
        case "queries":
          aVal = a.queryCount;
          bVal = b.queryCount;
          break;
        default:
          return 0;
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [sessions, sortField, sortDirection, showSubagents]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  return (
    <Section id="sessions">
      <SectionHeader
        id="sessions-header"
        title="Sessions Browser"
        subtitle={`${filteredSessions.length} sessions`}
      >
        <div className="flex items-center gap-2">
          <Button
            variant={showSubagents ? "default" : "outline"}
            size="sm"
            onClick={() => setShowSubagents(!showSubagents)}
          >
            {showSubagents ? "Hide" : "Show"} Subagents
          </Button>
        </div>
      </SectionHeader>

      {/* Sessions Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredSessions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-sm text-muted-foreground">
                    <th className="p-4 font-medium">Project</th>
                    <SortableHeader
                      label="Date"
                      field="date"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Queries"
                      field="queries"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Tokens"
                      field="tokens"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Cost"
                      field="cost"
                      currentField={sortField}
                      direction={sortDirection}
                      onSort={handleSort}
                      align="right"
                    />
                    <th className="p-4 font-medium text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.slice(0, 50).map((session) => (
                    <tr
                      key={session.sessionId}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedSession(session)}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {session.isSubagent && (
                            <Badge variant="outline" className="text-xs">
                              Subagent
                            </Badge>
                          )}
                          <div>
                            <div className="font-medium truncate max-w-[200px]">
                              {session.displayName ?? session.project.split("/").pop()}
                            </div>
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {session.project}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{session.date}</td>
                      <td className="p-4 text-sm text-right">{session.queryCount}</td>
                      <td className="p-4 text-sm text-right">{formatTokens(session.totalTokens)}</td>
                      <td className="p-4 text-sm text-right font-medium">
                        {formatCurrency(session.totalCost)}
                      </td>
                      <td className="p-4 text-right">
                        <Button variant="ghost" size="icon-sm">
                          <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredSessions.length > 50 && (
                <div className="p-4 text-center text-sm text-muted-foreground border-t border-border">
                  Showing 50 of {filteredSessions.length} sessions
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-12">No sessions found</p>
          )}
        </CardContent>
      </Card>

      {/* Session Detail Drawer */}
      <Sheet open={!!selectedSession} onOpenChange={(open) => !open && setSelectedSession(null)}>
        <SheetContent className="w-[500px] sm:max-w-[500px]">
          {selectedSession && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {selectedSession.displayName ?? selectedSession.project.split("/").pop()}
                </SheetTitle>
                <SheetDescription>
                  {selectedSession.project}
                </SheetDescription>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-120px)] mt-6">
                <SessionDetail session={selectedSession} />
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

interface SortableHeaderProps {
  label: string;
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}

function SortableHeader({ label, field, currentField, direction, onSort, align = "left" }: SortableHeaderProps) {
  const isActive = field === currentField;

  return (
    <th
      className={cn(
        "p-4 font-medium cursor-pointer hover:text-foreground transition-colors",
        align === "right" && "text-right"
      )}
      onClick={() => onSort(field)}
    >
      <div className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
        {label}
        {isActive && (
          <span className="text-xs">{direction === "asc" ? "↑" : "↓"}</span>
        )}
      </div>
    </th>
  );
}

function SessionDetail({ session }: { session: SessionSummary }) {
  return (
    <div className="space-y-6 pr-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <StatItem
          icon={Clock01Icon}
          label="Duration"
          value={formatDuration(session.durationMs)}
        />
        <StatItem
          icon={Coins01Icon}
          label="Cost"
          value={formatCurrency(session.totalCost)}
        />
      </div>

      {/* Metrics */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Metrics</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricRow label="Queries" value={session.queryCount.toString()} />
          <MetricRow label="Tool Uses" value={session.toolUseCount.toString()} />
          <MetricRow label="Total Tokens" value={formatTokens(session.totalTokens)} />
          <MetricRow label="Cache Savings" value={formatCurrency(session.savedByCaching)} />
          <MetricRow label="Compactions" value={session.compactions.toString()} />
          <MetricRow label="Subagents" value={session.subagentCount.toString()} />
        </div>
      </div>

      {/* Token Breakdown */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Token Breakdown</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricRow label="Uncached Input" value={formatTokens(session.uncachedInput)} />
          <MetricRow label="Cache Read" value={formatTokens(session.cacheRead)} />
          <MetricRow label="Cache Creation" value={formatTokens(session.cacheCreation)} />
          <MetricRow label="Output" value={formatTokens(session.output)} />
        </div>
      </div>

      {/* File Activity */}
      {session.fileActivityDetails && session.fileActivityDetails.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">File Activity</h4>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {session.fileActivityDetails.slice(0, 20).map((file, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-xs">
                <span className="truncate max-w-[300px] text-muted-foreground">
                  {file.filePath}
                </span>
                <Badge variant="outline" className="text-xs">
                  {file.tool}
                </Badge>
              </div>
            ))}
            {session.fileActivityDetails.length > 20 && (
              <p className="text-xs text-muted-foreground pt-2">
                +{session.fileActivityDetails.length - 20} more files
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tool Usage */}
      {session.toolCounts && Object.keys(session.toolCounts).length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Tool Usage</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(session.toolCounts)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([tool, count]) => (
                <Badge key={tool} variant="outline" className="text-xs">
                  {tool}: {count}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* First Prompt */}
      {session.firstPrompt && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">First Prompt</h4>
          <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
            {session.firstPrompt.slice(0, 500)}
            {session.firstPrompt.length > 500 && "..."}
          </p>
        </div>
      )}
    </div>
  );
}

function StatItem({ icon, label, value }: { icon: typeof Clock01Icon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
      <HugeiconsIcon icon={icon} className="h-5 w-5 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
