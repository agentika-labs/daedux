import { RefreshIcon, Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useCallback } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SECTIONS, scrollToSection } from "@/hooks/useActiveSection";
import type { SectionId } from "@/hooks/useActiveSection";
import { rpcRequest } from "@/hooks/useRPC";
import { cn } from "@/lib/utils";

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
  { label: "Today", value: "today" },
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "All", value: "all" },
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
    if (!headerRef.current || !isMacOS) {
      return;
    }

    const buttons = headerRef.current.querySelectorAll(
      'button, [role="button"], a'
    );
    const zones = [...buttons].map((btn) => {
      const rect = btn.getBoundingClientRect();
      return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
    });

    // Send zones to main process (fire and forget)
    rpcRequest("updateDragExclusionZones", { zones }).catch(() => {
      // Silently ignore errors - drag region is a nice-to-have
    });
  }, []);

  // Update exclusion zones on mount and resize
  useEffect(() => {
    if (!isMacOS) {
      return;
    }

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
    if (!isMacOS) {
      return;
    }
    const timeout = setTimeout(updateExclusionZones, 50);
    return () => clearTimeout(timeout);
  }, [filter, activeSection, updateExclusionZones]);

  return (
    <header
      ref={headerRef}
      className="bg-background/80 supports-[backdrop-filter]:bg-background/60 border-border sticky top-0 z-50 border-b backdrop-blur"
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
                  type="button"
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
            <div className="bg-muted flex items-center rounded-lg p-1">
              {FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  type="button"
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
              <div className="bg-muted flex items-center rounded-lg p-1">
                <Button
                  variant="ghost"
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
              </div>
            )}
            <div className="bg-muted flex items-center rounded-lg p-1">
              <Link
                to="/settings"
                preload="intent"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-sm" }),
                  "rounded-md"
                )}
                aria-label="Open settings"
              >
                <HugeiconsIcon icon={Settings02Icon} className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
