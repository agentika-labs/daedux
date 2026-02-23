import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

interface ScaleTier {
  range: string;
  score?: string;
  quality: string;
}

interface InfoTooltipProps {
  title: string;
  description: string;
  scale?: ScaleTier[];
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

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
        <TooltipContent
          side={side}
          className={cn(
            // Inverted colors for contrast
            "bg-foreground text-background",
            // Size and spacing
            "max-w-[280px] p-4",
            // Elevation
            "shadow-xl shadow-black/20",
            "border border-white/10",
            // Reset base tooltip rounded
            "!rounded-xl"
          )}
        >
          {/* Title - larger, bolder */}
          <p className="font-semibold text-sm tracking-tight">{title}</p>

          {/* Description - muted */}
          <p className="text-xs text-background/70 mt-1.5 leading-relaxed">
            {description}
          </p>

          {/* Scale tiers - visual treatment */}
          {scale && scale.length > 0 && (
            <div className="mt-3 pt-3 border-t border-background/15 space-y-1.5">
              {scale.map((tier) => (
                <div
                  key={tier.range}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-background/60 font-mono text-[11px]">
                    {tier.range}
                  </span>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-medium",
                      // Color-code by quality
                      tier.quality.includes("Low") &&
                        "bg-red-500/20 text-red-300",
                      tier.quality.includes("Good") &&
                        "bg-amber-500/20 text-amber-300",
                      tier.quality.includes("Optimal") &&
                        "bg-emerald-500/20 text-emerald-300",
                      // Fallback
                      !tier.quality.match(/Low|Good|Optimal/) &&
                        "bg-background/10 text-background/80"
                    )}
                  >
                    {tier.quality}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
