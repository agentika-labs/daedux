/**
 * Centralized semantic color/style system for consistent theming across components.
 * Use these instead of inline color mappings for visual consistency.
 */

export type SemanticVariant =
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "muted"
  | "tip";

export interface SemanticStyle {
  /** Background color class (e.g., for card backgrounds) */
  bg: string;
  /** Border color class */
  border: string;
  /** Text color class (for icons, labels) */
  text: string;
  /** Badge background class (more intense than bg) */
  badgeBg: string;
  /** Button/link color with hover state */
  button: string;
}

/**
 * Core semantic style definitions.
 * These use CSS variables for theme compatibility.
 */
export const SEMANTIC_STYLES: Record<SemanticVariant, SemanticStyle> = {
  destructive: {
    badgeBg: "bg-destructive/10",
    bg: "bg-destructive/5",
    border: "border-destructive/30",
    button: "text-destructive hover:text-destructive/80",
    text: "text-destructive",
  },
  info: {
    badgeBg: "bg-chart-2/10",
    bg: "bg-chart-2/5",
    border: "border-chart-2/30",
    button: "text-chart-2 hover:text-chart-2/80",
    text: "text-chart-2",
  },
  muted: {
    badgeBg: "bg-muted",
    bg: "bg-muted/50",
    border: "border-border/50",
    button: "text-muted-foreground hover:text-foreground",
    text: "text-muted-foreground",
  },
  success: {
    badgeBg: "bg-success/10",
    bg: "bg-success/5",
    border: "border-success/30",
    button: "text-success hover:text-success/80",
    text: "text-success",
  },
  tip: {
    badgeBg: "bg-chart-1/10",
    bg: "bg-chart-1/5",
    border: "border-chart-1/30",
    button: "text-chart-1 hover:text-chart-1/80",
    text: "text-chart-1",
  },
  warning: {
    badgeBg: "bg-chart-4/10",
    bg: "bg-chart-4/5",
    border: "border-chart-4/30",
    button: "text-chart-4 hover:text-chart-4/80",
    text: "text-chart-4",
  },
};

/**
 * Get semantic styles for a given variant.
 * Returns all style classes for the variant.
 */
export function getSemanticStyles(variant: SemanticVariant): SemanticStyle {
  return SEMANTIC_STYLES[variant];
}

/**
 * Get the combined background + border classes for a container.
 */
export function getContainerClasses(variant: SemanticVariant): string {
  const styles = SEMANTIC_STYLES[variant];
  return `${styles.bg} ${styles.border}`;
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

/**
 * Check if a string is a valid semantic variant.
 */
export function isSemanticVariant(value: string): value is SemanticVariant {
  return value in SEMANTIC_STYLES;
}
