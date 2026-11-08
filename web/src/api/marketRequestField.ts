/** The header market as a request field; "All markets" (`null`) asks the global market (no field). */
export function marketRequestField(marketId: string | null): { market_id?: string } {
  return marketId === null ? {} : { market_id: marketId };
}
