import type { DataFreshness } from "../types/market.js";

export function computeQuoteConfidence(input: {
  dataFreshness?: DataFreshness;
  quoteValidated?: boolean;
  hasPrice?: boolean;
}): number {
  if (!input.hasPrice) {
    return 20;
  }

  if (input.quoteValidated !== true) {
    return input.dataFreshness === "fresh" ? 45 : 35;
  }

  if (input.dataFreshness === "fresh") {
    return 92;
  }

  return 75;
}

export function computeWatchlistConfidence(
  confidences: Array<number | undefined | null>,
): number {
  const values = confidences.filter(
    (value): value is number => value != null && !Number.isNaN(value),
  );
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
