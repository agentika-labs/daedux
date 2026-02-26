import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentPropsWithoutRef } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ScaleTier {
  range: string;
  score?: string;
  quality: string;
}

// ─── Styled Tooltip Content ───────────────────────────────────────────────────

export interface StyledTooltipContentProps
  extends Omit<ComponentPropsWithoutRef<typeof TooltipContent>, "children"> {
  title: string;
  description: string;
  scale?: ScaleTier[];
}

/**
 * Reusable styled tooltip content with title, description, and optional scale.
 * Use with any TooltipTrigger for consistent tooltip styling.
 */
export function StyledTooltipContent({
  title,
  description,
  scale,
  className,
  ...props
}: StyledTooltipContentProps) {
  return (
    <TooltipContent
      className={cn(
        // Dark elevated surface (matches popover)
        "bg-popover/95 backdrop-blur-xl",
        // High-contrast text for readability
        "text-foreground",
        // Size and spacing
        "max-w-[280px] p-4",
        // Subtle glow + border for definition
        "shadow-xl shadow-black/40",
        "border border-white/[0.08]",
        // Rounded corners
        "!rounded-xl",
        className
      )}
      {...props}
    >
      {/* Title - larger, bolder */}
      <p className="text-sm font-semibold tracking-tight">{title}</p>

      {/* Description - muted */}
      <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
        {description}
      </p>

      {/* Scale tiers - visual treatment */}
      {scale && scale.length > 0 && (
        <div className="border-border mt-3 space-y-1.5 border-t pt-3">
          {scale.map((tier) => (
            <div
              key={tier.range}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="text-muted-foreground font-mono text-[11px]">
                {tier.range}
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium",
                  // Color-code by quality
                  tier.quality.includes("Low") && "bg-red-500/20 text-red-300",
                  tier.quality.includes("Good") &&
                    "bg-amber-500/20 text-amber-300",
                  tier.quality.includes("Optimal") &&
                    "bg-emerald-500/20 text-emerald-300",
                  // Fallback
                  !/Low|Good|Optimal/.test(tier.quality) &&
                    "bg-muted text-muted-foreground"
                )}
              >
                {tier.quality}
              </span>
            </div>
          ))}
        </div>
      )}
    </TooltipContent>
  );
}

// ─── Info Tooltip (Icon Trigger) ──────────────────────────────────────────────

interface InfoTooltipProps {
  title: string;
  description: string;
  scale?: ScaleTier[];
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * Info icon with styled tooltip. For custom triggers, use StyledTooltipContent
 * with your own TooltipProvider/Tooltip/TooltipTrigger wrapper.
 */
export function InfoTooltip({
  title,
  description,
  scale,
  side = "top",
  className,
}: InfoTooltipProps) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "inline-flex items-center justify-center",
            "text-muted-foreground/50 hover:text-muted-foreground",
            "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
            className
          )}
          aria-label={`Info about ${title}`}
        >
          <HugeiconsIcon icon={InformationCircleIcon} size={14} />
        </TooltipTrigger>
        <StyledTooltipContent
          title={title}
          description={description}
          scale={scale}
          side={side}
        />
      </Tooltip>
    </TooltipProvider>
  );
}
