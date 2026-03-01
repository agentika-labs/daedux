import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
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
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>
          {annotation && (
            <span className="text-muted-foreground bg-muted rounded px-2 py-1 text-xs">
              {annotation}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
