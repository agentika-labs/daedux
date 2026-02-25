import type { ModelFamily } from "@shared/model-utils";

/**
 * Get Tailwind classes for model badge styling based on family.
 * Uses chart colors for consistency with other dashboard visualizations.
 */
export const getModelBadgeStyle = (family: ModelFamily): string => {
  switch (family) {
    case "opus":
      return "bg-chart-3/20 text-chart-3 border-chart-3/30";
    case "sonnet":
      return "bg-chart-2/20 text-chart-2 border-chart-2/30";
    case "haiku":
      return "bg-chart-5/20 text-chart-5 border-chart-5/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
};
