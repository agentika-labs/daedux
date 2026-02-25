import { describe, expect, test } from "bun:test"
import { calculateCost, getPricing } from "../../src/bun/utils/pricing"
import {
  extractModelDate,
  modelDisplayName,
  modelDisplayNameWithVersion,
  modelFamily,
} from "../../src/shared/model-utils"

describe("getPricing", () => {
  describe("model tier matching", () => {
    test("returns Opus 4 pricing for opus-4 models", () => {
      const pricing = getPricing("claude-opus-4-6-20260210")
      expect(pricing.inputPerMTok).toBe(15)
      expect(pricing.outputPerMTok).toBe(75)
      expect(pricing.cacheWriteMultiplier).toBe(1.25)
      expect(pricing.cacheReadMultiplier).toBe(0.1)
    })

    test("returns Sonnet 4 pricing for sonnet-4 models", () => {
      const pricing = getPricing("claude-sonnet-4-5-20251022")
      expect(pricing.inputPerMTok).toBe(3)
      expect(pricing.outputPerMTok).toBe(15)
    })

    test("returns Haiku 4 pricing for haiku-4 models", () => {
      const pricing = getPricing("claude-haiku-4-5-20251022")
      expect(pricing.inputPerMTok).toBe(0.8)
      expect(pricing.outputPerMTok).toBe(4)
    })

    test("returns Opus 3.5 pricing for opus-3-5 models", () => {
      const pricing = getPricing("claude-opus-3-5-20240620")
      expect(pricing.inputPerMTok).toBe(15)
      expect(pricing.outputPerMTok).toBe(75)
    })

    test("returns Sonnet 3.5 pricing for sonnet-3-5 models", () => {
      const pricing = getPricing("claude-sonnet-3-5-20240620")
      expect(pricing.inputPerMTok).toBe(3)
      expect(pricing.outputPerMTok).toBe(15)
    })

    test("returns Haiku 3.5 pricing for haiku-3-5 models", () => {
      const pricing = getPricing("claude-haiku-3-5-20240307")
      expect(pricing.inputPerMTok).toBe(0.8)
      expect(pricing.outputPerMTok).toBe(4)
    })
  })

  describe("case sensitivity", () => {
    test("is case insensitive - lowercase", () => {
      const pricing = getPricing("claude-opus-4-6")
      expect(pricing.inputPerMTok).toBe(15)
    })

    test("is case insensitive - uppercase", () => {
      const pricing = getPricing("CLAUDE-OPUS-4-6")
      expect(pricing.inputPerMTok).toBe(15)
    })

    test("is case insensitive - mixed case", () => {
      const pricing = getPricing("Claude-Opus-4-6")
      expect(pricing.inputPerMTok).toBe(15)
    })
  })

  describe("fallback behavior", () => {
    test("returns default pricing for unknown models", () => {
      const pricing = getPricing("gpt-4-turbo")
      expect(pricing.inputPerMTok).toBe(3) // Default = Sonnet tier
      expect(pricing.outputPerMTok).toBe(15)
    })

    test("returns default pricing for empty string", () => {
      const pricing = getPricing("")
      expect(pricing.inputPerMTok).toBe(3)
    })

    test("returns default pricing for garbage input", () => {
      const pricing = getPricing("asdfghjkl")
      expect(pricing.inputPerMTok).toBe(3)
    })
  })

  describe("first-match-wins behavior", () => {
    test("opus-4 matches before haiku-4 when both present", () => {
      // Model ID contains both substrings - first match (opus-4) should win
      const pricing = getPricing("opus-4-haiku-4-hybrid")
      expect(pricing.inputPerMTok).toBe(15) // Opus pricing, not Haiku
    })

    test("sonnet-4 matches before sonnet-3-5", () => {
      // Ensure ordering is correct in PRICING_TABLE
      const pricing = getPricing("claude-sonnet-4-5-20251022")
      expect(pricing.inputPerMTok).toBe(3)
    })
  })

  describe("substring matching", () => {
    test("matches opus-4 anywhere in string", () => {
      const pricing = getPricing("some-prefix-opus-4-suffix")
      expect(pricing.inputPerMTok).toBe(15)
    })

    test("matches with extra characters around model name", () => {
      const pricing = getPricing("my-custom-sonnet-4-variant")
      expect(pricing.inputPerMTok).toBe(3)
    })
  })
})

describe("calculateCost", () => {
  const sonnetPricing = getPricing("claude-sonnet-4-5")
  const opusPricing = getPricing("claude-opus-4-6")
  const haikuPricing = getPricing("claude-haiku-4-5")

  describe("zero and edge cases", () => {
    test("returns zero cost for zero tokens", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      expect(result.totalCost).toBe(0)
      expect(result.savedByCaching).toBe(0)
      expect(result.uncachedInputCost).toBe(0)
      expect(result.cacheCreationCost).toBe(0)
      expect(result.cacheReadCost).toBe(0)
      expect(result.outputCost).toBe(0)
    })

    test("handles very small token counts", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 1,
        cacheCreation: 0,
        cacheRead: 0,
        output: 1,
      })
      expect(result.totalCost).toBeGreaterThan(0)
      expect(result.totalCost).toBeLessThan(0.0001)
    })

    test("handles very large token counts", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 100_000_000, // 100M tokens
        cacheCreation: 0,
        cacheRead: 0,
        output: 100_000_000,
      })
      // 100M input at $3/MTok = $300, 100M output at $15/MTok = $1500
      expect(result.totalCost).toBe(1800)
    })
  })

  describe("input cost calculations", () => {
    test("calculates uncached input cost at $3/MTok for Sonnet", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      expect(result.uncachedInputCost).toBe(3)
      expect(result.totalCost).toBe(3)
    })

    test("calculates uncached input cost at $15/MTok for Opus", () => {
      const result = calculateCost(opusPricing, {
        uncachedInput: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      expect(result.uncachedInputCost).toBe(15)
    })

    test("calculates uncached input cost at $0.80/MTok for Haiku", () => {
      const result = calculateCost(haikuPricing, {
        uncachedInput: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      expect(result.uncachedInputCost).toBe(0.8)
    })

    test("scales linearly with token count", () => {
      const half = calculateCost(sonnetPricing, {
        uncachedInput: 500_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      const full = calculateCost(sonnetPricing, {
        uncachedInput: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      expect(full.uncachedInputCost).toBe(half.uncachedInputCost * 2)
    })
  })

  describe("output cost calculations", () => {
    test("calculates output cost at $15/MTok for Sonnet", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 1_000_000,
      })
      expect(result.outputCost).toBe(15)
      expect(result.totalCost).toBe(15)
    })

    test("calculates output cost at $75/MTok for Opus", () => {
      const result = calculateCost(opusPricing, {
        uncachedInput: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 1_000_000,
      })
      expect(result.outputCost).toBe(75)
    })

    test("calculates output cost at $4/MTok for Haiku", () => {
      const result = calculateCost(haikuPricing, {
        uncachedInput: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 1_000_000,
      })
      expect(result.outputCost).toBe(4)
    })
  })

  describe("cache pricing", () => {
    test("applies cache read discount (10% of input price)", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 0,
        cacheRead: 1_000_000,
        output: 0,
      })
      // Cache read = 10% of input price = $0.30
      expect(result.cacheReadCost).toBeCloseTo(0.3, 10)
      expect(result.totalCost).toBeCloseTo(0.3, 10)
    })

    test("applies cache write premium (125% of input price)", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 1_000_000,
        cacheRead: 0,
        output: 0,
      })
      // Cache write = 125% of input price = $3.75
      expect(result.cacheCreationCost).toBe(3.75)
      expect(result.totalCost).toBe(3.75)
    })

    test("cache read is 10x cheaper than uncached input", () => {
      const uncached = calculateCost(sonnetPricing, {
        uncachedInput: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      const cached = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 0,
        cacheRead: 1_000_000,
        output: 0,
      })
      expect(uncached.uncachedInputCost / cached.cacheReadCost).toBeCloseTo(
        10,
        10,
      )
    })

    test("cache write is 1.25x more expensive than uncached input", () => {
      const uncached = calculateCost(sonnetPricing, {
        uncachedInput: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      })
      const cacheWrite = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 1_000_000,
        cacheRead: 0,
        output: 0,
      })
      expect(cacheWrite.cacheCreationCost / uncached.uncachedInputCost).toBe(
        1.25,
      )
    })
  })

  describe("savedByCaching calculation", () => {
    test("calculates savings from cache reads", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 0,
        cacheRead: 1_000_000,
        output: 0,
      })
      // Without cache: $3.00, With cache: $0.30, Savings: $2.70
      expect(result.savedByCaching).toBe(2.7)
    })

    test("savedByCaching is zero when no caching used", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 1_000_000,
        cacheCreation: 0,
        cacheRead: 0,
        output: 1_000_000,
      })
      expect(result.savedByCaching).toBe(0)
    })

    test("savedByCaching accounts for cache write premium", () => {
      // Cache writes cost more, so savings is negative before clamping
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 1_000_000,
        cacheRead: 0,
        output: 0,
      })
      // Full cost would be $3, but we paid $3.75 for cache write
      // savedByCaching = $3 - $3.75 = -$0.75, clamped to 0
      expect(result.savedByCaching).toBe(0)
    })

    test("savedByCaching is non-negative (clamped to 0)", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 0,
        cacheCreation: 10_000_000, // Lots of cache writes = expensive
        cacheRead: 0,
        output: 0,
      })
      expect(result.savedByCaching).toBeGreaterThanOrEqual(0)
    })

    test("large cache read sessions show significant savings", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 100_000, // 100K uncached
        cacheCreation: 0,
        cacheRead: 900_000, // 900K cached (90% cache hit)
        output: 100_000,
      })
      // 900K cache reads saved (1 - 0.1) * $3/MTok * 0.9 = $2.43
      expect(result.savedByCaching).toBeCloseTo(2.43, 2)
    })
  })

  describe("mixed token scenarios", () => {
    test("calculates total cost with all token types", () => {
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 500_000, // $1.50
        cacheCreation: 200_000, // $0.75
        cacheRead: 300_000, // $0.09
        output: 100_000, // $1.50
      })
      expect(result.uncachedInputCost).toBeCloseTo(1.5, 2)
      expect(result.cacheCreationCost).toBeCloseTo(0.75, 2)
      expect(result.cacheReadCost).toBeCloseTo(0.09, 2)
      expect(result.outputCost).toBeCloseTo(1.5, 2)
      expect(result.totalCost).toBeCloseTo(3.84, 2)
    })

    test("real-world session scenario", () => {
      // Typical session: 50K prompt, 150K context (cached), 2K response
      const result = calculateCost(sonnetPricing, {
        uncachedInput: 50_000,
        cacheCreation: 0,
        cacheRead: 150_000,
        output: 2_000,
      })
      expect(result.totalCost).toBeGreaterThan(0)
      expect(result.savedByCaching).toBeGreaterThan(0)
    })
  })

  describe("model tier comparisons", () => {
    const tokens = {
      uncachedInput: 1_000_000,
      cacheCreation: 0,
      cacheRead: 0,
      output: 1_000_000,
    }

    test("Opus is 5x more expensive than Sonnet for input", () => {
      const opus = calculateCost(opusPricing, tokens)
      const sonnet = calculateCost(sonnetPricing, tokens)
      expect(opus.uncachedInputCost / sonnet.uncachedInputCost).toBe(5)
    })

    test("Opus is 5x more expensive than Sonnet for output", () => {
      const opus = calculateCost(opusPricing, tokens)
      const sonnet = calculateCost(sonnetPricing, tokens)
      expect(opus.outputCost / sonnet.outputCost).toBe(5)
    })

    test("Haiku is ~3.75x cheaper than Sonnet", () => {
      const haiku = calculateCost(haikuPricing, tokens)
      const sonnet = calculateCost(sonnetPricing, tokens)
      expect(sonnet.totalCost / haiku.totalCost).toBeCloseTo(3.75, 1)
    })
  })
})

describe("modelDisplayName", () => {
  test("extracts Opus family name", () => {
    expect(modelDisplayName("claude-opus-4-6-20260210")).toBe("Opus")
  })

  test("extracts Sonnet family name", () => {
    expect(modelDisplayName("claude-sonnet-4-5-20251022")).toBe("Sonnet")
  })

  test("extracts Haiku family name", () => {
    expect(modelDisplayName("claude-haiku-4-5-20251022")).toBe("Haiku")
  })

  test("is case insensitive", () => {
    expect(modelDisplayName("CLAUDE-OPUS-4-6")).toBe("Opus")
    expect(modelDisplayName("claude-SONNET-4-5")).toBe("Sonnet")
  })

  test("returns raw model ID for unknown models", () => {
    expect(modelDisplayName("gpt-4-turbo")).toBe("gpt-4-turbo")
    expect(modelDisplayName("llama-3")).toBe("llama-3")
  })

  test("returns raw model ID for empty string", () => {
    expect(modelDisplayName("")).toBe("")
  })
})

describe("modelDisplayNameWithVersion", () => {
  test("extracts Opus with version", () => {
    expect(modelDisplayNameWithVersion("claude-opus-4-6-20260210")).toBe(
      "Opus 4.6",
    )
  })

  test("extracts Sonnet with version", () => {
    expect(modelDisplayNameWithVersion("claude-sonnet-4-5-20251022")).toBe(
      "Sonnet 4.5",
    )
  })

  test("extracts Haiku with version", () => {
    expect(modelDisplayNameWithVersion("claude-haiku-4-5-20251022")).toBe(
      "Haiku 4.5",
    )
  })

  test("handles older 3.5 versions", () => {
    expect(modelDisplayNameWithVersion("claude-sonnet-3-5-20240620")).toBe(
      "Sonnet 3.5",
    )
    expect(modelDisplayNameWithVersion("claude-opus-3-5-20240620")).toBe(
      "Opus 3.5",
    )
  })

  test("falls back to family name when no version pattern", () => {
    expect(modelDisplayNameWithVersion("claude-opus")).toBe("Opus")
    expect(modelDisplayNameWithVersion("claude-sonnet")).toBe("Sonnet")
  })

  test("returns raw model ID for unknown models", () => {
    expect(modelDisplayNameWithVersion("gpt-4-turbo")).toBe("gpt-4-turbo")
  })

  test("is case insensitive", () => {
    expect(modelDisplayNameWithVersion("CLAUDE-OPUS-4-6-20260210")).toBe(
      "Opus 4.6",
    )
  })
})

describe("modelFamily", () => {
  test("identifies opus family", () => {
    expect(modelFamily("claude-opus-4-6")).toBe("opus")
    expect(modelFamily("claude-opus-3-5")).toBe("opus")
    expect(modelFamily("some-opus-variant")).toBe("opus")
  })

  test("identifies sonnet family", () => {
    expect(modelFamily("claude-sonnet-4-5")).toBe("sonnet")
    expect(modelFamily("claude-sonnet-3-5")).toBe("sonnet")
  })

  test("identifies haiku family", () => {
    expect(modelFamily("claude-haiku-4-5")).toBe("haiku")
    expect(modelFamily("claude-haiku-3-5")).toBe("haiku")
  })

  test("is case insensitive", () => {
    expect(modelFamily("CLAUDE-OPUS-4-6")).toBe("opus")
    expect(modelFamily("Claude-Sonnet-4-5")).toBe("sonnet")
  })

  test("returns unknown for unrecognized models", () => {
    expect(modelFamily("gpt-4")).toBe("unknown")
    expect(modelFamily("llama-3")).toBe("unknown")
    expect(modelFamily("")).toBe("unknown")
  })
})

describe("extractModelDate", () => {
  test("extracts date from standard model ID", () => {
    expect(extractModelDate("claude-opus-4-6-20260210")).toBe("2026-02-10")
  })

  test("extracts date from various models", () => {
    expect(extractModelDate("claude-sonnet-4-5-20251022")).toBe("2025-10-22")
    expect(extractModelDate("claude-haiku-4-5-20251001")).toBe("2025-10-01")
    expect(extractModelDate("claude-sonnet-3-5-20240620")).toBe("2024-06-20")
  })

  test("returns null when no date suffix", () => {
    expect(extractModelDate("claude-opus-4-6")).toBeNull()
    expect(extractModelDate("claude-sonnet")).toBeNull()
    expect(extractModelDate("gpt-4-turbo")).toBeNull()
  })

  test("returns null for invalid date format", () => {
    expect(extractModelDate("claude-opus-4-6-2026")).toBeNull()
    expect(extractModelDate("claude-opus-4-6-202602")).toBeNull()
    expect(extractModelDate("claude-opus-4-6-20261")).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(extractModelDate("")).toBeNull()
  })

  test("only matches 8-digit date at end of string", () => {
    expect(extractModelDate("20260210-claude-opus-4-6")).toBeNull()
    expect(extractModelDate("claude-20260210-opus-4-6")).toBeNull()
  })
})
