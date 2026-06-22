import type { DataFreshness, YahooQuote } from "../types/market.js";

const PRICE_AGREEMENT_TOLERANCE_PERCENT = 0.15;

export function pricesAgree(
  a: number | null | undefined,
  b: number | null | undefined,
): boolean {
  if (a == null || b == null || a === 0) {
    return false;
  }
  return Math.abs((a - b) / a) * 100 <= PRICE_AGREEMENT_TOLERANCE_PERCENT;
}

export function isYahooSource(source?: string | null): boolean {
  return source?.includes("Yahoo") ?? false;
}

export function isNasdaqSource(source?: string | null): boolean {
  return source?.startsWith("Nasdaq") ?? false;
}

export function isFinvizSource(source?: string | null): boolean {
  return source?.includes("Finviz") ?? false;
}

export function resolveSourceQuality(
  primary?: YahooQuote,
  fallback?: YahooQuote,
): {
  multiSourceAgree: boolean;
  fallbackOnly: boolean;
  source: string;
} {
  if (!primary && !fallback) {
    return { multiSourceAgree: false, fallbackOnly: true, source: "unavailable" };
  }

  if (!primary) {
    return {
      multiSourceAgree: false,
      fallbackOnly: !isYahooSource(fallback?.source),
      source: fallback?.source ?? "unknown",
    };
  }

  if (!fallback) {
    return {
      multiSourceAgree: false,
      fallbackOnly: !isYahooSource(primary.source),
      source: primary.source ?? "Yahoo Finance",
    };
  }

  const yahoo = isYahooSource(primary.source)
    ? primary
    : isYahooSource(fallback.source)
      ? fallback
      : null;
  const nasdaq = isNasdaqSource(primary.source)
    ? primary
    : isNasdaqSource(fallback.source)
      ? fallback
      : null;

  const multiSourceAgree =
    yahoo != null && nasdaq != null && pricesAgree(yahoo.price, nasdaq.price);

  const hasYahoo =
    isYahooSource(primary.source) || isYahooSource(fallback.source);
  const fallbackOnly = !hasYahoo;

  let source: string;
  if (multiSourceAgree) {
    source = "Yahoo Finance + Nasdaq";
  } else if (isFinvizSource(primary.source) && isYahooSource(fallback.source)) {
    const finvizLabel = primary.source?.split(" + ").pop() ?? primary.source ?? "Finviz";
    source = `${fallback.source ?? "Yahoo Finance"} + ${finvizLabel}`;
  } else if (isFinvizSource(fallback.source) && isYahooSource(primary.source)) {
    const finvizLabel = fallback.source?.split(" + ").pop() ?? fallback.source ?? "Finviz";
    source = `${primary.source ?? "Yahoo Finance"} + ${finvizLabel}`;
  } else if (hasYahoo) {
    source = isYahooSource(primary.source)
      ? (primary.source ?? "Yahoo Finance")
      : (fallback.source ?? "Yahoo Finance");
  } else {
    source = primary.source ?? fallback.source ?? "unknown";
  }

  return { multiSourceAgree, fallbackOnly, source };
}

export function computeQuoteConfidence(input: {
  dataFreshness?: DataFreshness;
  quoteValidated?: boolean;
  hasPrice?: boolean;
  multiSourceAgree?: boolean;
  fallbackOnly?: boolean;
}): number {
  if (!input.hasPrice) {
    return 50;
  }

  if (input.quoteValidated !== true) {
    return input.dataFreshness === "fresh" ? 45 : 35;
  }

  let confidence = input.dataFreshness === "fresh" ? 90 : 75;

  if (input.multiSourceAgree) {
    confidence += 5;
  }
  if (input.fallbackOnly) {
    confidence -= 5;
  }

  return Math.max(0, Math.min(100, confidence));
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

export function confidenceFromQuote(quote?: YahooQuote | null): number {
  if (!quote) {
    return 50;
  }

  return computeQuoteConfidence({
    dataFreshness: quote.dataFreshness,
    quoteValidated: quote.quoteValidated,
    hasPrice: quote.price != null,
    multiSourceAgree: quote.multiSourceAgree,
    fallbackOnly: quote.fallbackOnly,
  });
}
