export interface TokenInputBreakdown {
  readonly uncachedInput: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface TokenBreakdown extends TokenInputBreakdown {
  readonly output: number;
}

/** Total request input seen by the model, including cache read/write components. */
export const totalInputWithCache = (tokens: TokenInputBreakdown): number =>
  tokens.uncachedInput + tokens.cacheRead + tokens.cacheWrite;

/** Total billable token volume represented in dashboard totals. */
export const totalBillableTokens = (tokens: TokenBreakdown): number =>
  totalInputWithCache(tokens) + tokens.output;

/** Cache hit ratio: cache reads as a share of the full input context for requests. */
export const cacheHitRatio = (tokens: TokenInputBreakdown): number => {
  const denom = totalInputWithCache(tokens);
  return denom > 0 ? tokens.cacheRead / denom : 0;
};
