/** Model pricing in dollars per million tokens */
export interface ModelPricing {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheWriteMultiplier: number;
  readonly cacheReadMultiplier: number;
  readonly contextWindowSize: number; // tokens
}

/**
 * Pricing table for Claude and OpenAI/Codex models.
 * Keys are substrings matched against the full model ID.
 * Order matters: first match wins (most specific first).
 *
 * Pricing sources:
 * - https://www.anthropic.com/pricing
 * - https://developers.openai.com/api/docs/pricing
 */
const PRICING_TABLE: readonly (readonly [
  substring: string,
  pricing: ModelPricing,
])[] = [
  // OpenAI text model pricing (standard tier: input / cached input / output)
  [
    "gpt-5.5-pro",
    {
      cacheReadMultiplier: 1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 272_000,
      inputPerMTok: 30,
      outputPerMTok: 180,
    },
  ],
  [
    "gpt-5.5",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 272_000,
      inputPerMTok: 5,
      outputPerMTok: 30,
    },
  ],
  [
    "gpt-5.4-pro",
    {
      cacheReadMultiplier: 1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 272_000,
      inputPerMTok: 30,
      outputPerMTok: 180,
    },
  ],
  [
    "gpt-5.4-mini",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 0.75,
      outputPerMTok: 4.5,
    },
  ],
  [
    "gpt-5.4-nano",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 0.2,
      outputPerMTok: 1.25,
    },
  ],
  [
    "gpt-5.4",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 272_000,
      inputPerMTok: 2.5,
      outputPerMTok: 15,
    },
  ],
  [
    "gpt-5.2-pro",
    {
      cacheReadMultiplier: 1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 21,
      outputPerMTok: 168,
    },
  ],
  [
    "gpt-5.2",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.75,
      outputPerMTok: 14,
    },
  ],
  [
    "gpt-5.1",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  [
    "gpt-5-pro",
    {
      cacheReadMultiplier: 1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 15,
      outputPerMTok: 120,
    },
  ],
  [
    "gpt-5-mini",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 0.25,
      outputPerMTok: 2,
    },
  ],
  [
    "gpt-5-nano",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 0.05,
      outputPerMTok: 0.4,
    },
  ],
  [
    "gpt-5",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  // OpenAI Codex / ChatGPT API pricing (input / cached input / output)
  // gpt-5.3 and gpt-5.2 tiers: $1.75 / $0.175 / $14 per MTok
  [
    "gpt-5.3-codex",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.75,
      outputPerMTok: 14,
    },
  ],
  [
    "gpt-5.2-codex",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.75,
      outputPerMTok: 14,
    },
  ],
  [
    "gpt-5.3-chat-latest",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.75,
      outputPerMTok: 14,
    },
  ],
  [
    "gpt-5.2-chat-latest",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.75,
      outputPerMTok: 14,
    },
  ],
  // gpt-5 / gpt-5.1 Codex and ChatGPT tiers: $1.25 / $0.125 / $10 per MTok
  [
    "gpt-5.1-codex-mini",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 0.25,
      outputPerMTok: 2,
    },
  ],
  [
    "gpt-5.1-codex-max",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  [
    "gpt-5.1-codex",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  [
    "gpt-5-codex",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  [
    "gpt-5.1-chat-latest",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  [
    "gpt-5-chat-latest",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  [
    "gpt-5-search-api",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 1.25,
      outputPerMTok: 10,
    },
  ],
  // Legacy/current ChatGPT and Codex model aliases
  [
    "chat-latest",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 400_000,
      inputPerMTok: 5,
      outputPerMTok: 30,
    },
  ],
  [
    "chatgpt-4o-latest",
    {
      cacheReadMultiplier: 1,
      cacheWriteMultiplier: 1,
      contextWindowSize: 128_000,
      inputPerMTok: 5,
      outputPerMTok: 15,
    },
  ],
  [
    "codex-mini-latest",
    {
      cacheReadMultiplier: 0.25,
      cacheWriteMultiplier: 1,
      contextWindowSize: 200_000,
      inputPerMTok: 1.5,
      outputPerMTok: 6,
    },
  ],
  // Opus 4.5/4.6 - cheaper tier ($5/$25)
  [
    "opus-4-5",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 5,
      outputPerMTok: 25,
    },
  ],
  [
    "opus-4-6",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 5,
      outputPerMTok: 25,
    },
  ],
  // Opus 4/4.1 - legacy tier ($15/$75)
  [
    "opus-4-1",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 15,
      outputPerMTok: 75,
    },
  ],
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
    "opus-3",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 15,
      outputPerMTok: 75,
    },
  ],
  // Sonnet - all versions same price ($3/$15)
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
    "sonnet-3",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 3,
      outputPerMTok: 15,
    },
  ],
  // Haiku 4.5 - new tier ($1/$5)
  [
    "haiku-4-5",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 1,
      outputPerMTok: 5,
    },
  ],
  // Haiku 4.x fallback (same as 4.5)
  [
    "haiku-4",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 1,
      outputPerMTok: 5,
    },
  ],
  // Haiku 3.5 ($0.80/$4)
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
  // Haiku 3 ($0.25/$1.25)
  [
    "haiku-3",
    {
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      contextWindowSize: 200_000,
      inputPerMTok: 0.25,
      outputPerMTok: 1.25,
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

const isOpenAiPricingKey = (substring: string): boolean =>
  substring.startsWith("gpt-") ||
  substring.startsWith("chat") ||
  substring.startsWith("codex-") ||
  substring.startsWith("o");

/** Resolve a full model ID (e.g. "claude-opus-4-6-20260210") to its pricing */
export const getPricing = (modelId: string): ModelPricing => {
  const normalized = modelId.toLowerCase();

  // OpenAI has overlapping model names like gpt-5, gpt-5.1, and
  // gpt-5.1-codex-mini. Prefer the longest matching OpenAI key so generic
  // fallback rows do not shadow more specific Codex/mini/pro variants.
  const openAiMatch = PRICING_TABLE.filter(([substring]) =>
    isOpenAiPricingKey(substring)
  )
    .filter(([substring]) => normalized.includes(substring))
    .toSorted(([a], [b]) => b.length - a.length)[0];
  if (openAiMatch) {
    return openAiMatch[1];
  }

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
