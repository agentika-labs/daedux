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
const PRICING_TABLE: readonly (readonly [
  substring: string,
  pricing: ModelPricing,
])[] = [
  [
    "opus-4",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 15,
      outputPerMTok: 75,
    },
  ],
  [
    "sonnet-4",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 3,
      outputPerMTok: 15,
    },
  ],
  [
    "haiku-4",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 0.8,
      outputPerMTok: 4,
    },
  ],
  // Older models
  [
    "opus-3-5",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 15,
      outputPerMTok: 75,
    },
  ],
  [
    "sonnet-3-5",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 3,
      outputPerMTok: 15,
    },
  ],
  [
    "haiku-3-5",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 0.8,
      outputPerMTok: 4,
    },
  ],
];

/** Fallback pricing when model is unrecognized (Sonnet-tier) */
const DEFAULT_PRICING: ModelPricing = {
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 1.25,
  contextWindowSize: 200_000,
  inputPerMTok: 3,
  outputPerMTok: 15,
};

/** Resolve a full model ID (e.g. "claude-opus-4-6-20260210") to its pricing */
export const getPricing = (modelId: string): ModelPricing => {
  const normalized = modelId.toLowerCase();
  for (const [substring, pricing] of PRICING_TABLE) {
    if (normalized.includes(substring)) {
      return pricing;
    }
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
  }
) => {
  const uncachedInputCost =
    (tokens.uncachedInput / 1_000_000) * pricing.inputPerMTok;
  const cacheCreationCost =
    (tokens.cacheCreation / 1_000_000) *
    pricing.inputPerMTok *
    pricing.cacheWriteMultiplier;
  const cacheReadCost =
    (tokens.cacheRead / 1_000_000) *
    pricing.inputPerMTok *
    pricing.cacheReadMultiplier;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPerMTok;

  // What it would have cost if all input was uncached
  const fullInputTokens =
    tokens.uncachedInput + tokens.cacheCreation + tokens.cacheRead;
  const fullInputCost = (fullInputTokens / 1_000_000) * pricing.inputPerMTok;
  const actualInputCost = uncachedInputCost + cacheCreationCost + cacheReadCost;
  const savedByCaching = fullInputCost - actualInputCost;

  return {
    cacheCreationCost,
    cacheReadCost,
    outputCost,
    savedByCaching: Math.max(0, savedByCaching),
    totalCost:
      uncachedInputCost + cacheCreationCost + cacheReadCost + outputCost,
    uncachedInputCost,
  };
};

// Model display utilities are now in @shared/model-utils.ts

/** Get context window size in tokens for a model */
export const getContextWindowSize = (modelId: string): number =>
  getPricing(modelId).contextWindowSize;
