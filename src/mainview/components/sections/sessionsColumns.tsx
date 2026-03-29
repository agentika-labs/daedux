import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HARNESS_LABELS } from "@shared/rpc-types";
import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatTokens, cn } from "@/lib/utils";

import type { SessionRow } from "@/components/sections/SessionsSection";

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

// ─── Column Definitions ──────────────────────────────────────────────────────

export const sessionsColumns: ColumnDef<SessionRow>[] = [
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
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
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
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
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
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
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
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
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
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
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
];
