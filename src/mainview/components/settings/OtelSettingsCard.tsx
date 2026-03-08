import {
  WifiIcon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { OtelSettings, OtelStatus } from "@shared/rpc-types";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatNumber, formatRelativeTime } from "@/lib/utils";

// ─── Component ──────────────────────────────────────────────────────────────

interface OtelSettingsCardProps {
  settings: OtelSettings | undefined;
  status: OtelStatus | null;
  isLoading?: boolean;
  onSettingsChange: (settings: Partial<OtelSettings>) => void;
}

export const OtelSettingsCard = ({
  settings,
  status,
  isLoading,
  onSettingsChange,
}: OtelSettingsCardProps) => {
  const enabled = settings?.enabled ?? true;
  const retentionDays = settings?.retentionDays ?? 30;

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      onSettingsChange({ enabled: checked });
    },
    [onSettingsChange]
  );

  const handleRetentionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const days = Number.parseInt(e.target.value, 10);
      if (!isNaN(days) && days >= 1 && days <= 365) {
        onSettingsChange({ retentionDays: days });
      }
    },
    [onSettingsChange]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={WifiIcon}
            className="text-muted-foreground h-5 w-5"
          />
          <CardTitle>OpenTelemetry Receiver</CardTitle>
        </div>
        <CardDescription>
          Receive real-time metrics and events from Claude Code via OTLP.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Enabled Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">OTEL Receiver</Label>
            <p className="text-muted-foreground text-sm">
              Accept telemetry data on port 4318
            </p>
          </div>
          <Button
            variant={enabled ? "default" : "outline"}
            size="sm"
            onClick={() => handleToggleEnabled(!enabled)}
            disabled={isLoading}
          >
            {enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>

        {/* Status Indicator */}
        {status && (
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="mb-2 flex items-center gap-2">
              <HugeiconsIcon
                icon={
                  status.sessionCount > 0
                    ? CheckmarkCircle02Icon
                    : AlertCircleIcon
                }
                className={cn(
                  "h-4 w-4",
                  status.sessionCount > 0
                    ? "text-success"
                    : "text-muted-foreground"
                )}
              />
              <span className="text-sm font-medium">
                {status.sessionCount > 0 ? "Receiving Data" : "No Data Yet"}
              </span>
            </div>
            <div className="text-muted-foreground grid grid-cols-2 gap-2 text-sm">
              <div>
                Sessions: <strong>{formatNumber(status.sessionCount)}</strong>
              </div>
              <div>
                Events: <strong>{formatNumber(status.eventCount)}</strong>
              </div>
              <div>
                Metrics: <strong>{formatNumber(status.metricCount)}</strong>
              </div>
              <div>
                Last received:{" "}
                <strong>
                  {status.lastReceivedAt
                    ? formatRelativeTime(status.lastReceivedAt)
                    : "Never"}
                </strong>
              </div>
            </div>
          </div>
        )}

        {/* Retention Days */}
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="otel-retention" className="text-sm font-medium">
              Data Retention
            </Label>
            <p className="text-muted-foreground text-sm">
              Delete OTEL data older than this
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="otel-retention"
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={handleRetentionChange}
              className="w-20"
              disabled={isLoading}
            />
            <span className="text-muted-foreground text-sm">days</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
