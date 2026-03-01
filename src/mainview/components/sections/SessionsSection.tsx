import {
  ArrowRight01Icon,
  Clock01Icon,
  Coins01Icon,
  Search01Icon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  DashboardData,
  SessionSummary,
  ProjectSummary,
} from "@shared/rpc-types";

// ─── Stable Empty Arrays (prevent useMemo dep changes on rerenders) ──────────
const EMPTY_SESSIONS: SessionSummary[] = [];
const EMPTY_PROJECTS: ProjectSummary[] = [];
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  SortingState,
  PaginationState,
  FilterFn,
} from "@tanstack/react-table";
import { useState, useMemo, useDeferredValue, useEffect } from "react";

import { Section } from "@/components/layout/Section";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatTokens,
  formatDuration,
  cn,
  computeSmartProjectNames,
  shortenPath,
} from "@/lib/utils";
import type { SmartProjectName } from "@/lib/utils";

interface SessionsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

// Extended session type with pre-computed smart name for filtering/display
interface SessionRow extends SessionSummary {
  smartName: SmartProjectName;
}

// Custom global filter that searches project name and first prompt
const globalFilterFn: FilterFn<SessionRow> = (
  row,
  _columnId,
  filterValue: string
) => {
  const searchLower = filterValue.toLowerCase();
  const session = row.original;

  // Search in smart name (primary + secondary)
  const nameMatch =
    session.smartName.primary.toLowerCase().includes(searchLower) ||
    session.smartName.secondary.toLowerCase().includes(searchLower) ||
    session.smartName.full.toLowerCase().includes(searchLower);

  // Search in first prompt
  const promptMatch =
    session.firstPrompt?.toLowerCase().includes(searchLower) ?? false;

  return nameMatch || promptMatch;
};

export function SessionsSection({ data, loading }: SessionsSectionProps) {
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(
    null
  );
  const [showSubagents, setShowSubagents] = useState(false);

  const [sorting, setSorting] = useState<SortingState>([
    { desc: true, id: "cost" },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  // Debounced search - searchInput is the controlled value, deferredSearch
  // is the debounced value that triggers table filtering
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [globalFilter, setGlobalFilter] = useState("");

  // Sync deferred value to table filter
  useEffect(() => {
    setGlobalFilter(deferredSearch);
  }, [deferredSearch]);

  const sessions = data?.sessions ?? EMPTY_SESSIONS;

  // Reset pagination when underlying data changes (e.g., filter change)
  // This prevents trying to access non-existent pages when data shrinks
  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [sessions]);

  const tableData = useMemo(() => {
    // Filter subagents first
    const filtered = showSubagents
      ? sessions
      : sessions.filter((s) => !s.isSubagent);

    // Build projectPath → cwd lookup from projects data
    const projectCwdMap = new Map(
      (data?.projects ?? EMPTY_PROJECTS).map((p) => [p.projectPath, p.cwd])
    );

    // Build items for smart name calculation
    const allItems = filtered.map((s) => ({
      cwd: projectCwdMap.get(s.project),
      projectPath: s.project,
    }));

    // Pre-compute ALL smart names in O(n) instead of O(n²)
    const smartNameMap = computeSmartProjectNames(allItems);

    // Attach smart names to each session
    return filtered.map(
      (s): SessionRow => ({
        ...s,
        smartName: smartNameMap.get(s.project) ?? {
          full: s.project,
          primary: s.project,
          secondary: "",
        },
      })
    );
  }, [sessions, showSubagents, data?.projects]);

  // Column definitions
  const columns = useMemo<ColumnDef<SessionRow>[]>(
    () => [
      {
        accessorFn: (row) => row.smartName.primary,
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
                <div className="max-w-[200px] truncate font-medium">
                  {session.smartName.primary}
                </div>
                {session.smartName.secondary && (
                  <div className="text-muted-foreground text-xs">
                    in {session.smartName.secondary}
                  </div>
                )}
              </div>
            </div>
          );
        },
        enableSorting: false,
        header: "Project",
        id: "project",
      },
      {
        accessorKey: "startTime",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.date}
          </span>
        ),
        header: ({ column }) => (
          <SortableHeaderCell
            label="Date"
            sorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          />
        ),
        id: "date",
      },
      {
        accessorKey: "queryCount",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.queryCount}</span>
        ),
        header: ({ column }) => (
          <SortableHeaderCell
            label="Queries"
            sorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            align="right"
          />
        ),
        id: "queries",
        meta: { align: "right" },
      },
      {
        accessorKey: "turnCount",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.turnCount}</span>
        ),
        header: ({ column }) => (
          <SortableHeaderCell
            label="Turns"
            sorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            align="right"
          />
        ),
        id: "turns",
        meta: { align: "right" },
      },
      {
        accessorKey: "totalTokens",
        cell: ({ row }) => (
          <span className="text-sm">
            {formatTokens(row.original.totalTokens)}
          </span>
        ),
        header: ({ column }) => (
          <SortableHeaderCell
            label="Tokens"
            sorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            align="right"
          />
        ),
        id: "tokens",
        meta: { align: "right" },
      },
      {
        accessorKey: "totalCost",
        cell: ({ row }) => (
          <span className="text-sm font-medium">
            {formatCurrency(row.original.totalCost)}
          </span>
        ),
        header: ({ column }) => (
          <SortableHeaderCell
            label="Cost"
            sorted={column.getIsSorted()}
            onToggle={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            align="right"
          />
        ),
        id: "cost",
        meta: { align: "right" },
      },
      {
        cell: () => (
          <Button variant="ghost" size="icon-sm">
            <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
          </Button>
        ),
        enableSorting: false,
        header: () => <span className="sr-only">Details</span>,
        id: "details",
        meta: { align: "right" },
      },
    ],
    []
  );

  const table = useReactTable({
    columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    state: { globalFilter, pagination, sorting },
  });

  const totalFiltered = table.getFilteredRowModel().rows.length;
  const pageStart = pagination.pageIndex * pagination.pageSize + 1;
  const pageEnd = Math.min(
    (pagination.pageIndex + 1) * pagination.pageSize,
    totalFiltered
  );

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
              className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
            />
            <Input
              placeholder="Search sessions..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                // Reset to first page when searching
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
              className="w-[200px] pl-8"
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
            <div className="space-y-3 p-6">
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
                      <tr
                        key={headerGroup.id}
                        className="border-border text-muted-foreground border-b text-left text-sm"
                      >
                        {headerGroup.headers.map((header) => {
                          const align = (
                            header.column.columnDef.meta as
                              | { align?: string }
                              | undefined
                          )?.align;
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
                                : flexRender(
                                    header.column.columnDef.header,
                                    header.getContext()
                                  )}
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
                        className="border-border/50 hover:bg-muted/50 cursor-pointer border-b transition-colors last:border-0"
                        onClick={() => setSelectedSession(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const align = (
                            cell.column.columnDef.meta as
                              | { align?: string }
                              | undefined
                          )?.align;
                          return (
                            <td
                              key={cell.id}
                              className={cn(
                                "p-4",
                                align === "right" && "text-right"
                              )}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
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
                <div className="border-border flex items-center justify-between border-t p-4">
                  <span className="text-muted-foreground text-sm">
                    Showing {pageStart}–{pageEnd} of {totalFiltered} sessions
                  </span>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">
                        Per page:
                      </span>
                      <Select
                        value={pagination.pageSize.toString()}
                        onValueChange={(value) =>
                          setPagination({
                            pageIndex: 0,
                            pageSize: Number(value),
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-[70px]">
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
                        <HugeiconsIcon
                          icon={ArrowLeft01Icon}
                          className="h-4 w-4"
                        />
                      </Button>
                      <span className="px-2 text-sm">
                        Page {pagination.pageIndex + 1} of{" "}
                        {table.getPageCount()}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                      >
                        <HugeiconsIcon
                          icon={ArrowRight01Icon}
                          className="h-4 w-4"
                        />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground py-12 text-center">
              No sessions found
            </p>
          )}
        </CardContent>
      </Card>

      {/* Session Detail Drawer */}
      <Sheet
        open={!!selectedSession}
        onOpenChange={(open) => !open && setSelectedSession(null)}
      >
        <SheetContent className="flex w-[500px] flex-col overflow-hidden sm:max-w-[500px]">
          {selectedSession && (
            <>
              <SheetHeader className="flex-shrink-0">
                <SheetTitle>
                  {selectedSession.displayName ??
                    selectedSession.smartName.primary}
                </SheetTitle>
                <SheetDescription>
                  {shortenPath(selectedSession.smartName.full)}
                </SheetDescription>
              </SheetHeader>
              <ScrollArea className="min-h-0 flex-1">
                <div className="px-6 pt-4 pb-6">
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

function SortableHeaderCell({
  label,
  sorted,
  onToggle,
  align = "left",
}: SortableHeaderCellProps) {
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
      {sorted && (
        <span className="text-xs">{sorted === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );
}

function SessionDetail({ session }: { session: SessionRow }) {
  return (
    <div className="space-y-6">
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
          <MetricRow
            label="Tool Uses"
            value={session.toolUseCount.toString()}
          />
          <MetricRow label="Turns" value={session.turnCount.toString()} />
          <MetricRow
            label="Total Tokens"
            value={formatTokens(session.totalTokens)}
          />
          <MetricRow
            label="Cache Savings"
            value={formatCurrency(session.savedByCaching)}
          />
          <MetricRow
            label="Compactions"
            value={session.compactions.toString()}
          />
          <MetricRow
            label="Subagents"
            value={session.subagentCount.toString()}
          />
        </div>
      </div>

      {/* Token Breakdown */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Token Breakdown</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricRow
            label="Uncached Input"
            value={formatTokens(session.uncachedInput)}
          />
          <MetricRow
            label="Cache Read"
            value={formatTokens(session.cacheRead)}
          />
          <MetricRow
            label="Cache Creation"
            value={formatTokens(session.cacheCreation)}
          />
          <MetricRow label="Output" value={formatTokens(session.output)} />
        </div>
      </div>

      {/* File Activity */}
      {session.fileActivityDetails &&
        session.fileActivityDetails.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">File Activity</h4>
            <div className="max-h-[200px] space-y-1 overflow-y-auto">
              {session.fileActivityDetails.slice(0, 20).map((file, index) => (
                <div
                  key={`${file.filePath}-${file.tool}-${index}`}
                  className="flex items-center justify-between py-1 text-xs"
                >
                  <span className="text-muted-foreground max-w-[300px] truncate">
                    {file.filePath}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {file.tool}
                  </Badge>
                </div>
              ))}
              {session.fileActivityDetails.length > 20 && (
                <p className="text-muted-foreground pt-2 text-xs">
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
              .toSorted(([, a], [, b]) => b - a)
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
          <p className="text-muted-foreground bg-muted/50 rounded-lg p-3 text-sm">
            {session.firstPrompt.slice(0, 500)}
            {session.firstPrompt.length > 500 && "..."}
          </p>
        </div>
      )}
    </div>
  );
}

function StatItem({
  icon,
  label,
  value,
}: {
  icon: typeof Clock01Icon;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-muted/50 flex items-center gap-3 rounded-lg p-3">
      <HugeiconsIcon icon={icon} className="text-muted-foreground h-5 w-5" />
      <div>
        <p className="text-muted-foreground text-xs">{label}</p>
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
