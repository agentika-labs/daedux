import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  id: string;
  title: string;
  subtitle?: string;
  className?: string;
  children?: React.ReactNode;
}

export function SectionHeader({
  id,
  title,
  subtitle,
  className,
  children,
}: SectionHeaderProps) {
  return (
    <div
      id={id}
      className={cn(
        "flex items-center justify-between py-4 scroll-mt-20",
        className
      )}
    >
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
