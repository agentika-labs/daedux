import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type PaginationState,
  type FilterFn,
} from "@tanstack/react-table";
import { Section } from "@/components/layout/Section";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatTokens, formatDuration, cn, getSmartProjectName, shortenPath, type SmartProjectName } from "@/lib/utils";
import type { DashboardData, SessionSummary } from "@shared/rpc-types";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Clock01Icon, Coins01Icon, Search01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";

interface SessionsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

// Extended session type with pre-computed smart name for filtering/display
interface SessionRow extends SessionSummary {
  smartName: SmartProjectName;
}

// Custom global filter that searches project name and first prompt
const globalFilterFn: FilterFn<SessionRow> = (row, _columnId, filterValue: string) => {
  const searchLower = filterValue.toLowerCase();
  const session = row.original;

  // Search in smart name (primary + secondary)
  const nameMatch =
    session.smartName.primary.toLowerCase().includes(searchLower) ||
    session.smartName.secondary.toLowerCase().includes(searchLower) ||
    session.smartName.full.toLowerCase().includes(searchLower);

  // Search in first prompt
  const promptMatch = session.firstPrompt?.toLowerCase().includes(searchLower) ?? false;

  return nameMatch || promptMatch;
};

export function SessionsSection({ data, loading }: SessionsSectionProps) {
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [showSubagents, setShowSubagents] = useState(false);

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [globalFilter, setGlobalFilter] = useState("");

  const sessions = data?.sessions ?? [];

  // Pre-compute table data with smart names attached
  const tableData = useMemo(() => {
    // Filter subagents first
    const filtered = showSubagents ? sessions : sessions.filter((s) => !s.isSubagent);

    // Build projectPath → cwd lookup from projects data
    const projectCwdMap = new Map((data?.projects ?? []).map((p) => [p.projectPath, p.cwd]));

    // Build items for smart name calculation
    const allItems = filtered.map((s) => ({
      projectPath: s.project,
      cwd: projectCwdMap.get(s.project),
    }));

    // Attach smart names to each session
    return filtered.map((s): SessionRow => ({
      ...s,
      smartName: getSmartProjectName({ projectPath: s.project, cwd: projectCwdMap.get(s.project) }, allItems),
    }));
  }, [sessions, showSubagents, data?.projects]);

  // Column definitions
  const columns = useMemo<ColumnDef<SessionRow>[]>(
    () => [
      {
        id: "project",
        header: "Project",
        accessorFn: (row) => row.smartName.primary,
        enableSorting: false,
        cell: ({ row }) => {
          const session = row.original;
          return (
            <div className="flex items-center gap-2">
              {session.isSubagent && (
                <Badge variant="outline" className="text-xs">
                  Subagent
                </Badge>
              )}
              <div>
                <div className="font-medium truncate max-w-[200px]">{session.smartName.primary}</div>
                {session.smartName.secondary && (
                  <div className="text-xs text-muted-foreground">in {session.smartName.secondary}</div>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: "date",
        header: ({ column }) => (
          <SortableHeaderCell
            label="Date"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        accessorKey: "startTime",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.date}</span>
        ),
      },
      {
        id: "queries",
        header: ({ column }) => (
          <SortableHeaderCell
            label="Queries"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
            align="right"
          />
        ),
        accessorKey: "queryCount",
        cell: ({ row }) => <span className="text-sm">{row.original.queryCount}</span>,
        meta: { align: "right" },
      },
      {
        id: "tokens",
        header: ({ column }) => (
          <SortableHeaderCell
            label="Tokens"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
            align="right"
          />
        ),
        accessorKey: "totalTokens",
        cell: ({ row }) => <span className="text-sm">{formatTokens(row.original.totalTokens)}</span>,
        meta: { align: "right" },
      },
      {
        id: "cost",
        header: ({ column }) => (
          <SortableHeaderCell
            label="Cost"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
            align="right"
          />
        ),
        accessorKey: "totalCost",
        cell: ({ row }) => (
          <span className="text-sm font-medium">{formatCurrency(row.original.totalCost)}</span>
        ),
        meta: { align: "right" },
      },
      {
        id: "details",
        header: () => <span className="sr-only">Details</span>,
        enableSorting: false,
        cell: () => (
          <Button variant="ghost" size="icon-sm">
            <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
          </Button>
        ),
        meta: { align: "right" },
      },
    ],
    []
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, pagination, globalFilter },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const totalFiltered = table.getFilteredRowModel().rows.length;
  const pageStart = pagination.pageIndex * pagination.pageSize + 1;
  const pageEnd = Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalFiltered);

  return (
    <Section id="sessions">
      <SectionHeader
        id="sessions-header"
        title="Sessions Browser"
        subtitle={`${totalFiltered} sessions`}
      >
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            />
            <Input
              placeholder="Search sessions..."
              value={globalFilter}
              onChange={(e) => {
                setGlobalFilter(e.target.value);
                // Reset to first page when searching
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              className="pl-8 w-[200px]"
            />
          </div>
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
          ) : tableData.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id} className="border-b border-border text-left text-sm text-muted-foreground">
                        {headerGroup.headers.map((header) => {
                          const align = (header.column.columnDef.meta as { align?: string } | undefined)?.align;
                          return (
                            <th
                              key={header.id}
                              className={cn(
                                "p-4 font-medium",
                                align === "right" && "text-right"
                              )}
                            >
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                          );
                        })}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => setSelectedSession(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align;
                          return (
                            <td
                              key={cell.id}
                              className={cn("p-4", align === "right" && "text-right")}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalFiltered > 10 && (
                <div className="flex items-center justify-between p-4 border-t border-border">
                  <span className="text-sm text-muted-foreground">
                    Showing {pageStart}–{pageEnd} of {totalFiltered} sessions
                  </span>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Per page:</span>
                      <Select
                        value={pagination.pageSize.toString()}
                        onValueChange={(value) =>
                          setPagination({ pageIndex: 0, pageSize: Number(value) })
                        }
                      >
                        <SelectTrigger className="w-[70px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                      >
                        <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
                      </Button>
                      <span className="text-sm px-2">
                        Page {pagination.pageIndex + 1} of {table.getPageCount()}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                      >
                        <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground py-12">No sessions found</p>
          )}
        </CardContent>
      </Card>

      {/* Session Detail Drawer */}
      <Sheet open={!!selectedSession} onOpenChange={(open) => !open && setSelectedSession(null)}>
        <SheetContent className="w-[500px] sm:max-w-[500px] flex flex-col overflow-hidden">
          {selectedSession && (
            <>
              <SheetHeader className="flex-shrink-0">
                <SheetTitle>
                  {selectedSession.displayName ?? selectedSession.smartName.primary}
                </SheetTitle>
                <SheetDescription>
                  {shortenPath(selectedSession.smartName.full)}
                </SheetDescription>
              </SheetHeader>
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-6 pb-6 pt-4">
                  <SessionDetail session={selectedSession} />
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

interface SortableHeaderCellProps {
  label: string;
  sorted: false | "asc" | "desc";
  onToggle: () => void;
  align?: "left" | "right";
}

function SortableHeaderCell({ label, sorted, onToggle, align = "left" }: SortableHeaderCellProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 hover:text-foreground transition-colors",
        align === "right" && "justify-end w-full"
      )}
      onClick={onToggle}
    >
      {label}
      {sorted && <span className="text-xs">{sorted === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function SessionDetail({ session }: { session: SessionRow }) {
  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <StatItem icon={Clock01Icon} label="Duration" value={formatDuration(session.durationMs)} />
        <StatItem icon={Coins01Icon} label="Cost" value={formatCurrency(session.totalCost)} />
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
                <span className="truncate max-w-[300px] text-muted-foreground">{file.filePath}</span>
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
