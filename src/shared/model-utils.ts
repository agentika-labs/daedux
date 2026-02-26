/** Model family type for consistent color grouping across frontend and backend */
export type ModelFamily = "opus" | "sonnet" | "haiku" | "unknown";

/**
 * Extract just the model family for color grouping.
 * All Opus versions should use the same color family.
 */
export const modelFamily = (modelId: string): ModelFamily => {
  const lower = modelId.toLowerCase();
  if (lower.includes("opus")) {
    return "opus";
  }
  if (lower.includes("sonnet")) {
    return "sonnet";
  }
  if (lower.includes("haiku")) {
    return "haiku";
  }
  return "unknown";
};

/** Short display name for a model ID (family only, no version) */
export const modelDisplayName = (modelId: string): string => {
  const lower = modelId.toLowerCase();
  if (lower.includes("opus")) {
    return "Opus";
  }
  if (lower.includes("sonnet")) {
    return "Sonnet";
  }
  if (lower.includes("haiku")) {
    return "Haiku";
  }
  return modelId;
};

/**
 * Extract family + version from model ID for display and aggregation.
 * e.g., "claude-opus-4-6-20260210" → "Opus 4.6"
 * e.g., "claude-sonnet-4-5-20251022" → "Sonnet 4.5"
 */
export const modelDisplayNameWithVersion = (modelId: string): string => {
  const lower = modelId.toLowerCase();
  // Match patterns like "opus-4-6", "sonnet-4-5", "haiku-4-5"
  const versionMatch = lower.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (versionMatch) {
    const [, family, major, minor] = versionMatch;
    const familyName = family!.charAt(0).toUpperCase() + family!.slice(1);
    return `${familyName} ${major}.${minor}`;
  }
  // Fallback to family-only name
  return modelDisplayName(modelId);
};

/**
 * Lowercase badge identifier for UI badges.
 * e.g., "claude-opus-4-6-20260210" → "opus-4.6"
 * e.g., "claude-sonnet-4-5" → "sonnet-4.5"
 */
export const modelBadgeId = (modelId: string): string => {
  const lower = modelId.toLowerCase();
  // Match patterns like "opus-4-6", "sonnet-4-5", "haiku-4-5"
  const versionMatch = lower.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (versionMatch) {
    const [, family, major, minor] = versionMatch;
    return `${family}-${major}.${minor}`;
  }
  // Fallback: family + major version only (e.g., "opus-4")
  const familyMatch = lower.match(/(opus|sonnet|haiku)-(\d+)/);
  if (familyMatch) {
    return `${familyMatch[1]}-${familyMatch[2]}`;
  }
  // Last resort: truncate raw model ID
  return modelId.slice(0, 12);
};

/**
 * Extract date stamp from model ID.
 * e.g., "claude-opus-4-6-20260210" → "2026-02-10"
 */
export const extractModelDate = (modelId: string): string | null => {
  const match = modelId.match(/(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month}-${day}`;
  }
  return null;
};
