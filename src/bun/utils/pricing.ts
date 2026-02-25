/** Model pricing in dollars per million tokens */
export interface ModelPricing {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheWriteMultiplier: number;
  readonly cacheReadMultiplier: number;
  readonly contextWindowSize: number; // tokens
}

/**
 * Pricing table for Claude models.
 * Keys are substrings matched against the full model ID.
 * Order matters: first match wins (most specific first).
 */
const PRICING_TABLE: ReadonlyArray<readonly [substring: string, pricing: ModelPricing]> = [
  ["opus-4", { inputPerMTok: 15, outputPerMTok: 75, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, contextWindowSize: 200_000 }],
  ["sonnet-4", { inputPerMTok: 3, outputPerMTok: 15, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, contextWindowSize: 200_000 }],
  ["haiku-4", { inputPerMTok: 0.80, outputPerMTok: 4, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, contextWindowSize: 200_000 }],
  // Older models
  ["opus-3-5", { inputPerMTok: 15, outputPerMTok: 75, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, contextWindowSize: 200_000 }],
  ["sonnet-3-5", { inputPerMTok: 3, outputPerMTok: 15, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, contextWindowSize: 200_000 }],
  ["haiku-3-5", { inputPerMTok: 0.80, outputPerMTok: 4, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, contextWindowSize: 200_000 }],
];

/** Fallback pricing when model is unrecognized (Sonnet-tier) */
const DEFAULT_PRICING: ModelPricing = {
  inputPerMTok: 3,
  outputPerMTok: 15,
  cacheWriteMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
  contextWindowSize: 200_000,
};

/** Resolve a full model ID (e.g. "claude-opus-4-6-20260210") to its pricing */
export const getPricing = (modelId: string): ModelPricing => {
  const normalized = modelId.toLowerCase();
  for (const [substring, pricing] of PRICING_TABLE) {
    if (normalized.includes(substring)) return pricing;
  }
  return DEFAULT_PRICING;
};

/** Calculate cost in dollars for a set of token counts */
export const calculateCost = (
  pricing: ModelPricing,
  tokens: {
    readonly uncachedInput: number;
    readonly cacheCreation: number;
    readonly cacheRead: number;
    readonly output: number;
  },
) => {
  const uncachedInputCost = (tokens.uncachedInput / 1_000_000) * pricing.inputPerMTok;
  const cacheCreationCost = (tokens.cacheCreation / 1_000_000) * pricing.inputPerMTok * pricing.cacheWriteMultiplier;
  const cacheReadCost = (tokens.cacheRead / 1_000_000) * pricing.inputPerMTok * pricing.cacheReadMultiplier;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPerMTok;

  // What it would have cost if all input was uncached
  const fullInputTokens = tokens.uncachedInput + tokens.cacheCreation + tokens.cacheRead;
  const fullInputCost = (fullInputTokens / 1_000_000) * pricing.inputPerMTok;
  const actualInputCost = uncachedInputCost + cacheCreationCost + cacheReadCost;
  const savedByCaching = fullInputCost - actualInputCost;

  return {
    uncachedInputCost,
    cacheCreationCost,
    cacheReadCost,
    outputCost,
    totalCost: uncachedInputCost + cacheCreationCost + cacheReadCost + outputCost,
    savedByCaching: Math.max(0, savedByCaching),
  };
};

// Model display utilities are now in @shared/model-utils.ts

/** Get context window size in tokens for a model */
export const getContextWindowSize = (modelId: string): number => {
  return getPricing(modelId).contextWindowSize;
};
