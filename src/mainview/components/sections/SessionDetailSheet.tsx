import { Clock01Icon, Coins01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  formatCurrency,
  formatTokens,
  formatDuration,
  shortenPath,
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
        <h4 className="text-sm font-medium">Session Info</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricRow label="Agent" value={HARNESS_LABELS[session.harness]} />
          <MetricRow
            label="Model"
            value={session.modelShort || session.model}
          />
        </div>
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
              {/* eslint-disable react/no-array-index-key -- Composite key required: same file+tool can appear multiple times (e.g., multiple Read/Edit on same file), so filePath+tool isn't unique */}
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
              {/* eslint-enable react/no-array-index-key */}
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
