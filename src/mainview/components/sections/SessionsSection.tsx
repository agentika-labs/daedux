import {
  ArrowRight01Icon,
  Clock01Icon,
  Search01Icon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  DashboardData,
  SessionSummary,
  ProjectSummary,
} from "@shared/rpc-types";
import { HARNESS_LABELS } from "@shared/rpc-types";
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
import { SessionDetailSheet } from "@/components/sections/SessionDetailSheet";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingBoundary } from "@/components/shared/LoadingBoundary";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatCurrency,
  formatTokens,
  cn,
  computeSmartProjectNames,
} from "@/lib/utils";
import type { SmartProjectName } from "@/lib/utils";

// ─── Stable Empty Arrays (prevent useMemo dep changes on rerenders) ──────────
const EMPTY_SESSIONS: SessionSummary[] = [];
const EMPTY_PROJECTS: ProjectSummary[] = [];

interface SessionsSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

// Extended session type with pre-computed smart name for filtering/display
export interface SessionRow extends SessionSummary {
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
        accessorKey: "harness",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {HARNESS_LABELS[row.original.harness]}
          </Badge>
        ),
        enableSorting: false,
        header: "Agent",
        id: "agent",
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
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    state: { globalFilter: deferredSearch, pagination, sorting },
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
          <LoadingBoundary
            loading={loading}
            skeleton="list"
            count={5}
            className="p-6"
          >
            {tableData.length > 0 ? (
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
                          className="table-row-hover border-border/50 hover:bg-muted/50 cursor-pointer border-b last:border-0"
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
              <EmptyState
                icon={Clock01Icon}
                title="No sessions found"
                description="Sessions appear here after you start using Claude Code."
              />
            )}
          </LoadingBoundary>
        </CardContent>
      </Card>

      {/* Session Detail Drawer */}
      <SessionDetailSheet
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
      />
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
