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
  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between">
          {/* Title and nav */}
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold">Claude Usage Monitor</h1>
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
              <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden">
                <SheetHeader>
                  <SheetTitle>Settings</SheetTitle>
                  <SheetDescription>
                    Configure session warm-up schedules and other preferences.
                  </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1 p-6 pt-0">
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
