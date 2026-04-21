import { Clock01Icon, Coins01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { modelFamily } from "@shared/model-utils";
import { HARNESS_LABELS } from "@shared/rpc-types";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getModelBadgeStyle } from "@/lib/model-styles";
import {
  formatCurrency,
  formatTokens,
  formatDuration,
  shortenPath,
  middleTruncatePath,
  cn,
} from "@/lib/utils";

import type { SessionRow } from "./SessionsSection";

interface SessionDetailSheetProps {
  session: SessionRow | null;
  onClose: () => void;
}

export function SessionDetailSheet({
  session,
  onClose,
}: SessionDetailSheetProps) {
  return (
    <Sheet open={!!session} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-[500px] flex-col overflow-hidden sm:max-w-[500px]">
        {session && (
          <>
            <SheetHeader className="flex-shrink-0">
              <SheetTitle>
                {session.displayName ?? session.smartName.primary}
              </SheetTitle>
              <SheetDescription>
                {shortenPath(session.smartName.full)}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-6 pt-4 pb-6">
                <SessionDetail session={session} />
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

function SessionDetail({ session }: { session: SessionRow }) {
  const totalTokens =
    session.uncachedInput +
    session.cacheRead +
    session.cacheCreation +
    session.output;
  const cacheHitPct =
    totalTokens > 0 ? Math.round((session.cacheRead / totalTokens) * 100) : 0;

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

      {/* Session Info */}
      <div className="space-y-3">
        <SectionTitle>Session Info</SectionTitle>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricRow label="Agent" value={HARNESS_LABELS[session.harness]} />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Model</span>
            <Badge
              variant="outline"
              className={cn(
                "text-xs border",
                getModelBadgeStyle(modelFamily(session.model))
              )}
            >
              {session.modelShort || session.model}
            </Badge>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="space-y-3">
        <SectionTitle>Metrics</SectionTitle>
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
            valueClassName="text-success"
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

      {/* Token Breakdown — stacked bar + cache ring */}
      <div className="space-y-3">
        <SectionTitle>Token Breakdown</SectionTitle>
        <TokenBreakdown
          uncachedInput={session.uncachedInput}
          cacheRead={session.cacheRead}
          cacheCreation={session.cacheCreation}
          output={session.output}
          totalTokens={totalTokens}
          cacheHitPct={cacheHitPct}
        />
      </div>

      {/* Tool Usage — horizontal bar chart */}
      {session.toolCounts && Object.keys(session.toolCounts).length > 0 && (
        <div className="space-y-3">
          <SectionTitle>Tool Usage</SectionTitle>
          <ToolUsageBars toolCounts={session.toolCounts} />
        </div>
      )}

      {/* File Activity — full scrollable list */}
      {session.fileActivityDetails &&
        session.fileActivityDetails.length > 0 && (
          <div className="space-y-3">
            <SectionTitle>
              File Activity{" "}
              <span className="font-normal text-muted-foreground normal-case tracking-normal">
                ({session.fileActivityDetails.length} files)
              </span>
            </SectionTitle>
            <FileActivitySection session={session} />
          </div>
        )}
    </div>
  );
}

// ─── Section Title ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-medium">{children}</h4>;
}

// ─── Stat Item ────────────────────────────────────────────────────────────────

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
        <p className="stat-value font-medium">{value}</p>
      </div>
    </div>
  );
}

// ─── Metric Row ───────────────────────────────────────────────────────────────

function MetricRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("stat-value font-medium", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

// ─── Token Breakdown Visualization ────────────────────────────────────────────

const TOKEN_SEGMENTS = [
  { key: "uncachedInput", label: "Uncached", color: "bg-chart-1" },
  { key: "cacheRead", label: "Cache Read", color: "bg-chart-2" },
  { key: "cacheCreation", label: "Cache Create", color: "bg-chart-4" },
  { key: "output", label: "Output", color: "bg-chart-5" },
] as const;

function TokenBreakdown({
  uncachedInput,
  cacheRead,
  cacheCreation,
  output,
  totalTokens,
  cacheHitPct,
}: {
  uncachedInput: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
  totalTokens: number;
  cacheHitPct: number;
}) {
  const values = { cacheCreation, cacheRead, output, uncachedInput };
  const pcts = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      totalTokens > 0 ? (v / totalTokens) * 100 : 0,
    ])
  );

  return (
    <div>
      <div className="flex items-center gap-3">
        {/* Stacked bar */}
        <div className="bg-muted flex h-[10px] flex-1 overflow-hidden rounded-full">
          {TOKEN_SEGMENTS.map(({ key, color }) => (
            <div
              key={key}
              className={color}
              style={{ width: `${pcts[key]}%` }}
            />
          ))}
        </div>
        {/* Cache ring */}
        <div
          className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-success) ${cacheHitPct}%, var(--color-muted) ${cacheHitPct}%)`,
          }}
        >
          <div className="bg-card flex h-[38px] w-[38px] flex-col items-center justify-center rounded-full">
            <span className="text-success text-[0.7rem] font-bold leading-none">
              {cacheHitPct}%
            </span>
            <span className="text-muted-foreground mt-px text-[0.45rem] uppercase tracking-wide">
              Cache
            </span>
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5">
        {TOKEN_SEGMENTS.map(({ key, label, color }) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <div className={cn("h-2 w-2 flex-shrink-0 rounded-sm", color)} />
            <span className="text-muted-foreground flex-1">{label}</span>
            <span className="stat-value font-medium">
              {formatTokens(values[key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tool Usage Bars ──────────────────────────────────────────────────────────

function ToolUsageBars({ toolCounts }: { toolCounts: Record<string, number> }) {
  const sorted = Object.entries(toolCounts)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 10);
  const maxCount = sorted[0]?.[1] ?? 1;

  return (
    <div className="space-y-1.5">
      {sorted.map(([tool, count]) => (
        <div key={tool} className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground w-20 flex-shrink-0 truncate text-right">
            {tool}
          </span>
          <div className="bg-muted h-[6px] flex-1 overflow-hidden rounded-full">
            <div
              className="bg-chart-1 h-full rounded-full"
              style={{ width: `${(count / maxCount) * 100}%` }}
            />
          </div>
          <span className="stat-value w-7 flex-shrink-0 text-right font-medium">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── File Activity ────────────────────────────────────────────────────────────

const FILE_OP_COLORS: Record<string, string> = {
  Edit: "bg-chart-2/10 text-chart-2",
  Read: "bg-chart-1/10 text-chart-1",
  Write: "bg-chart-3/10 text-chart-3",
};

function FileActivitySection({ session }: { session: SessionRow }) {
  return (
    <div>
      {/* Summary badges */}
      <div className="mb-3 flex gap-2">
        {session.fileReadCount > 0 && (
          <span className="bg-chart-1/10 text-chart-1 rounded-md px-2 py-0.5 text-[0.7rem] font-medium">
            Read: {session.fileReadCount}
          </span>
        )}
        {session.fileEditCount > 0 && (
          <span className="bg-chart-2/10 text-chart-2 rounded-md px-2 py-0.5 text-[0.7rem] font-medium">
            Edit: {session.fileEditCount}
          </span>
        )}
        {session.fileWriteCount > 0 && (
          <span className="bg-chart-3/10 text-chart-3 rounded-md px-2 py-0.5 text-[0.7rem] font-medium">
            Write: {session.fileWriteCount}
          </span>
        )}
      </div>
      {/* Full scrollable file list */}
      <div className="max-h-[320px] space-y-0.5 overflow-y-auto">
        {/* eslint-disable react/no-array-index-key -- Composite key required: same file+tool can appear multiple times */}
        {session.fileActivityDetails.map((file, index) => (
          <div
            key={`${file.filePath}-${file.tool}-${index}`}
            className="flex items-center justify-between py-1 text-xs"
          >
            <Tooltip>
              <TooltipTrigger
                render={<span />}
                className="text-muted-foreground max-w-[300px] truncate font-mono text-[0.65rem]"
              >
                {middleTruncatePath(file.filePath)}
              </TooltipTrigger>
              <TooltipContent>{shortenPath(file.filePath)}</TooltipContent>
            </Tooltip>
            <span
              className={cn(
                "flex-shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium",
                FILE_OP_COLORS[file.tool] ?? "bg-muted text-muted-foreground"
              )}
            >
              {file.tool}
            </span>
          </div>
        ))}
        {/* eslint-enable react/no-array-index-key */}
      </div>
    </div>
  );
}
