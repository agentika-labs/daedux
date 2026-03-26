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
  const roiHourlyDevCost = settings?.roiHourlyDevCost ?? 50;
  const roiMinutesPerLoc = settings?.roiMinutesPerLoc ?? 3;
  const roiMinutesPerCommit = settings?.roiMinutesPerCommit ?? 15;

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      onSettingsChange({ enabled: checked });
    },
    [onSettingsChange]
  );

  const handleRetentionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const days = Number.parseInt(e.target.value, 10);
      if (!Number.isNaN(days) && days >= 1 && days <= 365) {
        onSettingsChange({ retentionDays: days });
      }
    },
    [onSettingsChange]
  );

  const handleRoiSettingChange = useCallback(
    (field: "roiHourlyDevCost" | "roiMinutesPerLoc" | "roiMinutesPerCommit") =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = Number.parseFloat(e.target.value);
        if (!Number.isNaN(value) && value >= 0) {
          onSettingsChange({ [field]: value });
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

        {/* ROI Calculation Settings */}
        <div className="border-border border-t pt-6">
          <h3 className="mb-4 text-sm font-medium">ROI Calculation Settings</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="roi-hourly" className="text-sm font-medium">
                  Hourly Developer Cost
                </Label>
                <p className="text-muted-foreground text-sm">
                  Your hourly rate for ROI calculations
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">$</span>
                <Input
                  id="roi-hourly"
                  type="number"
                  min={0}
                  step={5}
                  value={roiHourlyDevCost}
                  onChange={handleRoiSettingChange("roiHourlyDevCost")}
                  className="w-20"
                  disabled={isLoading}
                />
                <span className="text-muted-foreground text-sm">/hr</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="roi-loc" className="text-sm font-medium">
                  Baseline Minutes per LOC
                </Label>
                <p className="text-muted-foreground text-sm">
                  Time to write one line of code manually
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="roi-loc"
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={roiMinutesPerLoc}
                  onChange={handleRoiSettingChange("roiMinutesPerLoc")}
                  className="w-20"
                  disabled={isLoading}
                />
                <span className="text-muted-foreground text-sm">min</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="roi-commit" className="text-sm font-medium">
                  Baseline Minutes per Commit
                </Label>
                <p className="text-muted-foreground text-sm">
                  Time to create a commit manually
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="roi-commit"
                  type="number"
                  min={1}
                  step={5}
                  value={roiMinutesPerCommit}
                  onChange={handleRoiSettingChange("roiMinutesPerCommit")}
                  className="w-20"
                  disabled={isLoading}
                />
                <span className="text-muted-foreground text-sm">min</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
