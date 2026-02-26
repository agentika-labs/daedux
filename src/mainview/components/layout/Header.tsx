import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SECTIONS, scrollToSection, type SectionId } from "@/hooks/useActiveSection";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScheduleSettings } from "@/components/settings/ScheduleSettings";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon, Settings02Icon } from "@hugeicons/core-free-icons";
import { rpcRequest } from "@/hooks/useRPC";

// Detect macOS for traffic light padding
const isMacOS =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

export type FilterOption = "today" | "7d" | "30d" | "all";

interface HeaderProps {
  filter: FilterOption;
  onFilterChange: (filter: FilterOption) => void;
  activeSection: SectionId;
  onSync?: () => void;
  isSyncing?: boolean;
}

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

export function Header({
  filter,
  onFilterChange,
  activeSection,
  onSync,
  isSyncing,
}: HeaderProps) {
  const headerRef = useRef<HTMLElement>(null);

  // Calculate button bounds and send to main process for native drag exclusion zones
  const updateExclusionZones = useCallback(() => {
    if (!headerRef.current || !isMacOS) return;

    const buttons = headerRef.current.querySelectorAll('button, [role="button"]');
    const zones = Array.from(buttons).map((btn) => {
      const rect = btn.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    // Send zones to main process (fire and forget)
    rpcRequest("updateDragExclusionZones", { zones }).catch(() => {
      // Silently ignore errors - drag region is a nice-to-have
    });
  }, []);

  // Update exclusion zones on mount and resize
  useEffect(() => {
    if (!isMacOS) return;

    // Initial update after brief delay (let layout settle)
    const initialTimeout = setTimeout(updateExclusionZones, 100);

    // Update on resize
    window.addEventListener("resize", updateExclusionZones);

    return () => {
      clearTimeout(initialTimeout);
      window.removeEventListener("resize", updateExclusionZones);
    };
  }, [updateExclusionZones]);

  // Update exclusion zones when filter changes (button positions may shift)
  useEffect(() => {
    if (!isMacOS) return;
    const timeout = setTimeout(updateExclusionZones, 50);
    return () => clearTimeout(timeout);
  }, [filter, activeSection, updateExclusionZones]);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border"
    >
      <div className={cn("px-6 py-3", isMacOS && "pl-24")}>
        <div className="flex items-center justify-between">
          {/* Title and nav */}
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold">Daedux</h1>
            <Separator orientation="vertical" className="h-6" />
            <nav className="flex items-center gap-1">
              {SECTIONS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => scrollToSection(id)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                    activeSection === id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {/* Filter and sync */}
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-lg bg-muted p-1">
              {FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => onFilterChange(value)}
                  className={cn(
                    "px-3 py-1 text-sm font-medium rounded-md transition-colors",
                    filter === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {onSync && (
              <Button
                variant="outline"
                size="sm"
                onClick={onSync}
                disabled={isSyncing}
                className="gap-2"
              >
                <HugeiconsIcon
                  icon={RefreshIcon}
                  className={cn("h-4 w-4", isSyncing && "animate-spin")}
                />
                Sync
              </Button>
            )}

            {/* Settings */}
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon">
                    <HugeiconsIcon icon={Settings02Icon} className="h-4 w-4" />
                    <span className="sr-only">Settings</span>
                  </Button>
                }
              />
              <SheetContent side="right" className="w-full sm:max-w-2xl">
                <SheetHeader>
                  <SheetTitle>Settings</SheetTitle>
                  <SheetDescription>
                    Configure session warm-up schedules and other preferences.
                  </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1 min-h-0 overflow-hidden p-6 pt-0">
                  <ScheduleSettings />
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
