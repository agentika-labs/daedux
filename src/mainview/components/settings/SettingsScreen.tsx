/**
 * Settings screen component.
 *
 * Uses TanStack Query hooks for data - the route loader has already
 * prefetched all data on hover, so this renders instantly.
 */
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppSettings } from "@shared/rpc-types";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useIsDesktop } from "@/hooks/useApi";
import { rpcRequest } from "@/hooks/useRPC";
import {
  useSettingsQuery,
  useAppInfoQuery,
  useAnthropicUsageQuery,
  useUpdateSettingsMutation,
  useOtelStatusQuery,
} from "@/queries/settings";

import { AboutCard } from "./AboutCard";
import { DataCard } from "./DataCard";
import { OtelSettingsCard } from "./OtelSettingsCard";
import { ScheduleSettings } from "./ScheduleSettings";
import { ThemeToggle } from "./ThemeToggle";
import { UsageLimitsCard } from "./UsageLimitsCard";

// Detect macOS for traffic light padding
const isMacOS =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

export const SettingsScreen = () => {
  const isDesktop = useIsDesktop();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const { data: settings, isLoading: isLoadingSettings } = useSettingsQuery();
  const { data: appInfo, isLoading: isLoadingAppInfo } = useAppInfoQuery();
  const {
    data: usage,
    refetch: refetchUsage,
    isFetching: isRefreshingUsage,
  } = useAnthropicUsageQuery();
  const { data: otelStatus } = useOtelStatusQuery();

  const updateSettingsMutation = useUpdateSettingsMutation();

  const isLoading = isLoadingSettings || isLoadingAppInfo;

  // Focus management: focus heading on mount
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      headingRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleRefreshUsage = async () => {
    try {
      await refetchUsage();
    } catch (error) {
      console.error("Failed to refresh usage:", error);
    }
  };

  const handleThemeChange = async (theme: AppSettings["theme"]) => {
    try {
      if (isDesktop) {
        await rpcRequest("updateSettings", { theme });
      }
      updateSettingsMutation.mutate({ theme });
    } catch (error) {
      console.error("Failed to update theme:", error);
    }
  };

  // Calculate button bounds and send to main process for native drag exclusion zones
  const updateExclusionZones = useCallback(() => {
    if (!headerRef.current || !isMacOS || !isDesktop) {
      return;
    }
    const buttons = headerRef.current.querySelectorAll(
      'button, [role="button"], a'
    );
    const zones = [...buttons].map((btn) => {
      const rect = btn.getBoundingClientRect();
      return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
    });
    rpcRequest("updateDragExclusionZones", { zones }).catch(() => {
      // Silently ignore errors - drag region is a nice-to-have
    });
  }, [isDesktop]);

  // Update exclusion zones on mount and resize
  useEffect(() => {
    if (!isMacOS || !isDesktop) {
      return;
    }
    const initialTimeout = setTimeout(updateExclusionZones, 100);
    window.addEventListener("resize", updateExclusionZones);
    return () => {
      clearTimeout(initialTimeout);
      window.removeEventListener("resize", updateExclusionZones);
    };
  }, [updateExclusionZones, isDesktop]);

  return (
    <div className="flex h-full flex-col">
      <header
        ref={headerRef}
        className="bg-background desktop:bg-background/60 border-border sticky top-0 z-50 border-b desktop:backdrop-blur"
      >
        <div className={`px-6 py-3 ${isMacOS && isDesktop ? "pl-24" : ""}`}>
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-md h-9 w-9 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Return to dashboard"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
            </Link>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-lg font-semibold outline-none"
            >
              Settings
            </h1>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          {isDesktop && (
            <UsageLimitsCard
              usage={usage ?? null}
              isLoading={isLoading}
              onRefresh={handleRefreshUsage}
              isRefreshing={isRefreshingUsage}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Customize how Daedux looks.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Theme</p>
                  <p className="text-muted-foreground text-sm">
                    Choose between system, light, or dark mode.
                  </p>
                </div>
                <ThemeToggle
                  value={settings?.theme ?? "system"}
                  onChange={handleThemeChange}
                  disabled={isLoading}
                />
              </div>
            </CardContent>
          </Card>

          <ScheduleSettings />

          <DataCard />

          <OtelSettingsCard
            settings={settings?.otel}
            status={otelStatus ?? null}
            isLoading={isLoading}
            onSettingsChange={(otelSettings) => {
              const currentOtel = settings?.otel ?? {
                enabled: true,
                retentionDays: 30,
                roiHourlyDevCost: 50,
                roiMinutesPerLoc: 3,
                roiMinutesPerCommit: 15,
              };
              const newOtel = { ...currentOtel, ...otelSettings };
              updateSettingsMutation.mutate({ otel: newOtel });
            }}
          />

          <AboutCard
            appInfo={appInfo ?? null}
            isLoading={isLoading}
            isDesktop={isDesktop}
          />
        </div>
      </main>
    </div>
  );
};

export default SettingsScreen;
