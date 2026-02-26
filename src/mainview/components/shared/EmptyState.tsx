import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: typeof Folder01Icon;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon = Folder01Icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className
      )}
    >
      <div className="bg-muted mb-4 rounded-full p-4">
        <HugeiconsIcon icon={icon} className="text-muted-foreground h-8 w-8" />
      </div>
      <h3 className="mb-1 text-lg font-medium">{title}</h3>
      {description && (
        <p className="text-muted-foreground mb-4 max-w-sm text-sm">
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="text-primary text-sm hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
