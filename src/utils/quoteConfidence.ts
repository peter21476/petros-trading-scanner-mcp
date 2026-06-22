import type { DataFreshness, SourceQuality, YahooQuote } from "../types/market.js";

const PRICE_AGREEMENT_TOLERANCE_PERCENT = 0.15;

const PRIMARY_API_PREFIXES = ["Finnhub", "Alpha Vantage", "Yahoo Finance"] as const;

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

export function isFinnhubSource(source?: string | null): boolean {
  return source?.startsWith("Finnhub") ?? false;
}

export function isAlphaVantageSource(source?: string | null): boolean {
  return source?.startsWith("Alpha Vantage") ?? false;
}

export function isPrimaryApiSource(source?: string | null): boolean {
  if (!source) {
    return false;
  }
  return PRIMARY_API_PREFIXES.some((prefix) => source.startsWith(prefix));
}

function baseSourceLabel(source?: string | null): string {
  if (!source) {
    return "unknown";
  }
  if (isFinnhubSource(source)) {
    return "Finnhub";
  }
  if (isAlphaVantageSource(source)) {
    return "Alpha Vantage";
  }
  if (isYahooSource(source)) {
    return "Yahoo Finance";
  }
  if (isNasdaqSource(source)) {
    return "Nasdaq";
  }
  if (isFinvizSource(source)) {
    return source.split(" + ").pop() ?? "Finviz";
  }
  return source;
}

function sourceRank(source?: string | null): number {
  if (isFinnhubSource(source)) {
    return 1;
  }
  if (isAlphaVantageSource(source)) {
    return 2;
  }
  if (isNasdaqSource(source)) {
    return 3;
  }
  if (isYahooSource(source)) {
    return 4;
  }
  if (isFinvizSource(source)) {
    return 5;
  }
  return 99;
}

function sourceIncludesProvider(
  source: string,
  provider: "Finnhub" | "Alpha Vantage" | "Yahoo Finance" | "Nasdaq" | "Finviz",
): boolean {
  return source.split(" + ").some((part) => part.trim().startsWith(provider));
}

function classifyCompositeSourceQuality(quote: {
  source: string;
  multiSourceAgree?: boolean;
}): SourceQuality | null {
  const hasNasdaq = sourceIncludesProvider(quote.source, "Nasdaq");
  const hasFinnhub = sourceIncludesProvider(quote.source, "Finnhub");
  const hasAlphaVantage = sourceIncludesProvider(quote.source, "Alpha Vantage");
  const hasYahoo = sourceIncludesProvider(quote.source, "Yahoo Finance");
  const hasPrimary = hasFinnhub || hasAlphaVantage || hasYahoo;

  if (hasPrimary && hasNasdaq) {
    return quote.multiSourceAgree
      ? "multi_source_agreement"
      : "multi_source_partial";
  }

  return null;
}

export function classifySourceQuality(quote?: {
  source?: string | null;
  multiSourceAgree?: boolean;
  price?: number | null;
} | null): SourceQuality {
  if (!quote || quote.price == null) {
    return "unavailable";
  }

  const source = quote.source ?? "";

  const composite = classifyCompositeSourceQuality({
    source,
    multiSourceAgree: quote.multiSourceAgree,
  });
  if (composite) {
    return composite;
  }

  if (quote.multiSourceAgree) {
    return "multi_source_agreement";
  }

  if (isFinnhubSource(source)) {
    return "finnhub_only";
  }
  if (isAlphaVantageSource(source)) {
    return "alpha_vantage_only";
  }
  if (isYahooSource(source) && isFinvizSource(source)) {
    return "yahoo_finviz";
  }
  if (isYahooSource(source)) {
    return "yahoo_only";
  }
  if (isNasdaqSource(source)) {
    return "nasdaq_only";
  }
  if (isFinvizSource(source)) {
    return "finviz_only";
  }

  return "unavailable";
}

export function stampQuoteSourceQuality(quote: YahooQuote): YahooQuote {
  const sourceQuality = classifySourceQuality(quote);
  return { ...quote, sourceQuality };
}

export function countBySourceQuality(
  quotes: Iterable<YahooQuote>,
): Partial<Record<SourceQuality, number>> {
  const counts: Partial<Record<SourceQuality, number>> = {};
  for (const quote of quotes) {
    const key = quote.sourceQuality ?? classifySourceQuality(quote);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function resolveSourceQuality(
  primary?: YahooQuote,
  fallback?: YahooQuote,
): {
  multiSourceAgree: boolean;
  fallbackOnly: boolean;
  source: string;
  sourceQuality: SourceQuality;
} {
  if (!primary && !fallback) {
    return {
      multiSourceAgree: false,
      fallbackOnly: true,
      source: "unavailable",
      sourceQuality: "unavailable",
    };
  }

  const candidates = [primary, fallback].filter(
    (quote): quote is YahooQuote => quote != null,
  );

  const primaryApi = candidates.find((quote) => isPrimaryApiSource(quote.source));
  const nasdaq = candidates.find((quote) => isNasdaqSource(quote.source));

  if (
    primaryApi &&
    nasdaq &&
    pricesAgree(primaryApi.price, nasdaq.price)
  ) {
    return {
      multiSourceAgree: true,
      fallbackOnly: false,
      source: `${baseSourceLabel(primaryApi.source)} + Nasdaq`,
      sourceQuality: "multi_source_agreement",
    };
  }

  const best = [...candidates].sort(
    (a, b) => sourceRank(a.source) - sourceRank(b.source),
  )[0]!;

  if (primaryApi && nasdaq) {
    return {
      multiSourceAgree: false,
      fallbackOnly: false,
      source: `${baseSourceLabel(primaryApi.source)} + Nasdaq`,
      sourceQuality: "multi_source_partial",
    };
  }

  return {
    multiSourceAgree: false,
    fallbackOnly: isNasdaqSource(best.source) || isFinvizSource(best.source),
    source: best.source ?? "unknown",
    sourceQuality: classifySourceQuality(best),
  };
}

export function computeQuoteConfidence(input: {
  sourceQuality?: SourceQuality;
  multiSourceAgree?: boolean;
  hasPrice?: boolean;
  quoteValidated?: boolean;
}): number {
  if (!input.hasPrice) {
    return 50;
  }

  if (input.multiSourceAgree || input.sourceQuality === "multi_source_agreement") {
    return 95;
  }
  if (input.sourceQuality === "multi_source_partial") {
    return 85;
  }
  if (input.sourceQuality === "nasdaq_only") {
    return 70;
  }
  if (input.sourceQuality === "finviz_only" || input.sourceQuality === "yahoo_finviz") {
    return 55;
  }
  if (input.sourceQuality === "finnhub_only" || input.sourceQuality === "alpha_vantage_only") {
    return input.quoteValidated === false ? 65 : 80;
  }
  if (input.sourceQuality === "yahoo_only") {
    return input.quoteValidated === false ? 60 : 75;
  }

  return input.quoteValidated === false ? 45 : 70;
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
    sourceQuality: quote.sourceQuality ?? classifySourceQuality(quote),
    multiSourceAgree: quote.multiSourceAgree,
    hasPrice: quote.price != null,
    quoteValidated: quote.quoteValidated,
  });
}
