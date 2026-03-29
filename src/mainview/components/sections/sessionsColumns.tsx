import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { modelFamily } from "@shared/model-utils";
import type { ColumnDef } from "@tanstack/react-table";

import type { SessionRow } from "@/components/sections/SessionsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getModelBadgeStyle } from "@/lib/model-styles";
import {
  formatCurrency,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  cn,
} from "@/lib/utils";

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

// ─── Table Meta (passed from SessionsSection) ──────────────────────────────

export interface SessionsTableMeta {
  maxCost: number;
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
      <Tooltip>
        <TooltipTrigger className="text-left" render={<div />}>
          <div className="text-sm">
            {formatRelativeTime(row.original.startTime)}
          </div>
          <div className="text-muted-foreground text-[0.7rem]">
            {row.original.date}
          </div>
        </TooltipTrigger>
        <TooltipContent>{row.original.date}</TooltipContent>
      </Tooltip>
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
    accessorKey: "durationMs",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {formatDuration(row.original.durationMs)}
      </span>
    ),
    header: ({ column }) => (
      <SortableHeaderCell
        label="Duration"
        sorted={column.getIsSorted()}
        onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
        align="right"
      />
    ),
    id: "duration",
    meta: { align: "right" },
  },
  {
    accessorKey: "queryCount",
    cell: ({ row }) => (
      <span className="stat-value text-sm">{row.original.queryCount}</span>
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
    accessorKey: "totalTokens",
    cell: ({ row }) => {
      const session = row.original;
      const cacheRatio =
        session.totalTokens > 0 ? session.cacheRead / session.totalTokens : 0;
      const cacheColor =
        cacheRatio > 0.5
          ? "bg-success"
          : cacheRatio > 0.25
            ? "bg-chart-4"
            : "bg-destructive";
      return (
        <div className="text-right">
          <span className="stat-value text-sm">
            {formatTokens(session.totalTokens)}
          </span>
          <div className="bg-muted ml-auto mt-1 h-[3px] w-12 overflow-hidden rounded-full">
            <div
              className={cn("h-full rounded-full", cacheColor)}
              style={{ width: `${Math.min(cacheRatio * 100, 100)}%` }}
            />
          </div>
        </div>
      );
    },
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
    cell: ({ cell, row }) => {
      const cost = row.original.totalCost;
      const meta = cell.getContext().table.options.meta as
        | SessionsTableMeta
        | undefined;
      const maxCost = meta?.maxCost ?? 1;
      const widthPct = maxCost > 0 ? (cost / maxCost) * 100 : 0;
      return (
        <div className="relative flex items-center justify-end">
          <div
            className="bg-chart-1/8 absolute inset-y-0 right-0 rounded-sm"
            style={{ width: `${widthPct}%` }}
          />
          <span className="stat-value relative text-sm font-medium">
            {formatCurrency(cost)}
          </span>
        </div>
      );
    },
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
    accessorKey: "model",
    cell: ({ row }) => {
      const family = modelFamily(row.original.model);
      return (
        <Badge
          variant="outline"
          className={cn("text-xs border", getModelBadgeStyle(family))}
        >
          {row.original.modelShort || "Unknown"}
        </Badge>
      );
    },
    enableSorting: false,
    header: "Model",
    id: "model",
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
