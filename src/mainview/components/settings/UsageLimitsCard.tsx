import { AlertCircleIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AnthropicUsage, AnthropicUsageWindow } from "@shared/rpc-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface UsageLimitsCardProps {
  usage: AnthropicUsage | null;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const WARNING_THRESHOLD = 70;

const formatSubscriptionType = (type: string): string => {
  const tierMap: Record<string, string> = {
    enterprise: "Claude Enterprise",
    free: "Claude Free",
    max: "Claude Max",
    pro: "Claude Pro",
    team: "Claude Team",
  };
  return tierMap[type.toLowerCase()] ?? `Claude ${type}`;
};

interface UsageProgressProps {
  label: string;
  hint?: string;
  window: AnthropicUsageWindow | null;
}

const UsageProgress = ({ label, hint, window }: UsageProgressProps) => {
  if (!window) {
    return null;
  }

  const isWarning = window.percentUsed >= WARNING_THRESHOLD;
  const labelText = hint ? `${label} (${hint})` : label;
  const formattedValue = `${Math.round(window.percentUsed)}%`;

  return (
    <div className="space-y-2">
      <Progress value={window.percentUsed}>
        <ProgressLabel className="flex w-full items-center justify-between">
          <span className="flex items-center gap-1.5">
            {labelText}
            {isWarning && (
              <HugeiconsIcon
                icon={AlertCircleIcon}
                className="text-warning size-3.5"
                aria-label="High usage warning"
              />
            )}
          </span>
          <span
            className={cn(
              "text-muted-foreground ml-auto text-sm tabular-nums",
              isWarning && "text-warning font-medium"
            )}
          >
            {formattedValue}
          </span>
        </ProgressLabel>
      </Progress>
      {window.resetAtRaw && (
        <p className="text-muted-foreground text-xs">
          Resets {window.resetAtRaw}
        </p>
      )}
    </div>
  );
};

const UsageLimitsSkeleton = () => (
  <div className="space-y-6">
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-3 w-full" />
    </div>
  </div>
);

const UnavailableState = ({ onRefresh }: { onRefresh: () => void }) => (
  <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-6 text-center">
    <p className="text-sm">Usage data unavailable</p>
    <Button variant="outline" size="sm" onClick={onRefresh}>
      <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
      Try Again
    </Button>
  </div>
);

export const UsageLimitsCard = ({
  usage,
  isLoading,
  onRefresh,
  isRefreshing,
}: UsageLimitsCardProps) => {
  const isUnavailable = usage?.source === "unavailable";
  const showRefreshButton = isLoading || (usage && !isUnavailable);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account & Usage</CardTitle>
        <CardDescription>Your Claude Code usage limits.</CardDescription>
        {showRefreshButton && (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing || isLoading}
              aria-label="Refresh usage data"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={cn("size-4", isRefreshing && "animate-spin")}
                data-icon="inline-start"
              />
              Refresh
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading ? (
          <UsageLimitsSkeleton />
        ) : isUnavailable || !usage ? (
          <UnavailableState onRefresh={onRefresh} />
        ) : (
          <>
            {/* Subscription Badge */}
            {usage.subscription?.type && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">
                  Subscription
                </span>
                <Badge variant="secondary">
                  {formatSubscriptionType(usage.subscription.type)}
                </Badge>
              </div>
            )}

            {/* Usage Windows Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <UsageProgress label="Session" hint="5h" window={usage.session} />
              <UsageProgress label="Weekly" hint="7d" window={usage.weekly} />
              {usage.sonnet && (
                <UsageProgress label="Sonnet" window={usage.sonnet} />
              )}
              {usage.opus && <UsageProgress label="Opus" window={usage.opus} />}
            </div>

            {/* Extra Usage (Max overage) */}
            {usage.extraUsage && (
              <div className="border-border space-y-2 border-t pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    Extra Usage
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      usage.extraUsage.percentUsed >= 100 && "text-warning"
                    )}
                  >
                    ${usage.extraUsage.spentUsd.toFixed(2)}
                    {usage.extraUsage.limitUsd !== null && (
                      <> / ${usage.extraUsage.limitUsd.toFixed(2)}</>
                    )}
                    {usage.extraUsage.percentUsed >= 100 && (
                      <HugeiconsIcon
                        icon={AlertCircleIcon}
                        className="text-warning ml-1.5 inline size-3.5"
                        aria-label="Over budget warning"
                      />
                    )}
                  </span>
                </div>
                {usage.extraUsage.resetAtRaw && (
                  <p className="text-muted-foreground text-xs">
                    Resets {usage.extraUsage.resetAtRaw}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
