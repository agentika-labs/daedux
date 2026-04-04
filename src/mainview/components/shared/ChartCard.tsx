import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  annotation?: string;
  loading?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  annotation,
  loading = false,
  className,
  children,
}: ChartCardProps) {
  return (
    <div className={cn("flex min-h-0 flex-col px-6 py-4", className)}>
      <div className="flex shrink-0 items-start justify-between">
        <div>
          <span className="text-muted-foreground text-[0.6875rem] font-medium uppercase tracking-widest">
            {title}
          </span>
          {subtitle && (
            <p className="text-muted-foreground mt-0.5 text-xs">{subtitle}</p>
          )}
        </div>
        {annotation && (
          <span className="text-muted-foreground text-[11px]">
            {annotation}
          </span>
        )}
      </div>
      <div className="mt-2 min-h-0 flex-1">
        {loading ? <Skeleton className="h-full w-full" /> : children}
      </div>
    </div>
  );
}
