import { CACHE_TTL, getCached } from "./cache.js";
import { safeFetchJson } from "./http.js";
import {
  fetchAlphaVantageQuote,
  fetchAlphaVantageQuotes,
  isAlphaVantageEnabled,
} from "./alphaVantage.js";
import {
  fetchFinnhubQuote,
  fetchFinnhubQuotes,
  isFinnhubEnabled,
} from "./finnhub.js";
import { fetchYahooSparkQuote, fetchYahooSparkQuotes } from "./yahooSpark.js";
import type { FinvizHomepageData, ProviderTimestamps, SnapshotStock, SourceQuality, YahooQuote } from "../types/market.js";
import { parseNumber, parsePercent, parseVolume, signedChange } from "../utils/parseNumber.js";
import { getEasternDateKey, easternWallTimeToUtc } from "../utils/marketSession.js";
import { finalizeQuote } from "../utils/quoteValidation.js";
import {
  countBySourceQuality,
  isFinvizSource,
  isNasdaqSource,
  isPrimaryApiSource,
  resolveSourceQuality,
  stampQuoteSourceQuality,
} from "../utils/quoteConfidence.js";
import { getRateLimitedSources, isYahooRateLimited } from "../utils/yahooRateLimit.js";
import { logger } from "../utils/logger.js";

const QUOTE_RETRY_DELAY_MS = 400;

interface NasdaqQuoteResponse {
  data?: {
    symbol?: string;
    companyName?: string;
    primaryData?: {
      lastSalePrice?: string;
      netChange?: string;
      percentageChange?: string;
      volume?: string;
      lastTradeTimestamp?: string;
      isRealTime?: boolean;
    };
  };
}

function parseNasdaqTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const hasTime = /\d{1,2}:\d{2}/.test(value);
  if (!hasTime) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      const dateKey = getEasternDateKey(new Date(parsed));
      return easternWallTimeToUtc(dateKey, 16, 0).toISOString();
    }
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toISOString();
}

function mergeProviderTimestamps(
  a?: ProviderTimestamps,
  b?: ProviderTimestamps,
): ProviderTimestamps {
  return {
    finnhub: a?.finnhub ?? b?.finnhub,
    nasdaq: a?.nasdaq ?? b?.nasdaq,
    yahoo: a?.yahoo ?? b?.yahoo,
    finviz: a?.finviz ?? b?.finviz,
  };
}

export interface FinvizSnapshotContext {
  topGainers: SnapshotStock[];
  topLosers: SnapshotStock[];
  unusualVolume: SnapshotStock[];
  majorNews: SnapshotStock[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NASDAQ_HEADERS = {
  Accept: "application/json",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

async function fetchNasdaqQuote(
  symbol: string,
  assetClass: "stocks" | "etf",
): Promise<YahooQuote | null> {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetClass}`;
  const data = await safeFetchJson<NasdaqQuoteResponse>(url, {
    headers: NASDAQ_HEADERS,
  });

  const primary = data?.data?.primaryData;
  if (!primary?.lastSalePrice) {
    return null;
  }

  const price = parseNumber(primary.lastSalePrice);
  const changePercent = parsePercent(primary.percentageChange);
  const change = signedChange(primary.netChange);
  const volume = parseVolume(primary.volume ?? null);
  const previousClose =
    price != null && change != null ? Number((price - change).toFixed(4)) : null;

  if (price == null && changePercent == null) {
    return null;
  }

  const nasdaqRaw = primary.lastTradeTimestamp;
  const nasdaqAsOf = parseNasdaqTimestamp(nasdaqRaw);

  return finalizeQuote({
    symbol: symbol.toUpperCase(),
    price,
    change,
    changePercent,
    previousClose,
    preMarketPrice: null,
    preMarketChangePercent: changePercent,
    volume,
    shortName: data?.data?.companyName ?? symbol,
    source: "Nasdaq",
    asOf: nasdaqAsOf,
    isDelayed: primary.isRealTime === false,
    multiSourceAgree: false,
    fallbackOnly: true,
    providerTimestamps: {
      nasdaq: {
        iso: nasdaqAsOf,
        rawField: "lastTradeTimestamp",
        rawValue: nasdaqRaw,
      },
    },
  });
}

async function fetchNasdaqQuoteWithFallback(symbol: string): Promise<YahooQuote | null> {
  const stockQuote = await fetchNasdaqQuote(symbol, "stocks");
  if (stockQuote) {
    return stockQuote;
  }
  return fetchNasdaqQuote(symbol, "etf");
}

async function fetchNasdaqQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const map = new Map<string, YahooQuote>();
  await Promise.all(
    symbols.map(async (symbol) => {
      const quote = await fetchNasdaqQuoteWithFallback(symbol);
      if (quote) {
        map.set(symbol.toUpperCase(), quote);
      }
    }),
  );
  return map;
}

function buildFinvizQuoteIndex(
  snapshot: FinvizSnapshotContext,
): Map<string, YahooQuote> {
  const map = new Map<string, YahooQuote>();

  const ingest = (items: SnapshotStock[], listName: string) => {
    for (const item of items) {
      const symbol = item.symbol.toUpperCase();
      if (item.changePercent == null && item.price == null) {
        continue;
      }

      const existing = map.get(symbol);
      const price = item.price ?? existing?.price ?? null;
      const changePercent = item.changePercent ?? existing?.changePercent ?? null;
      let change = existing?.change ?? null;
      if (price != null && changePercent != null) {
        change = Number(((price * changePercent) / 100).toFixed(4));
      }

      map.set(symbol, finalizeQuote({
        symbol,
        price,
        change,
        changePercent,
        previousClose: null,
        preMarketPrice: null,
        preMarketChangePercent: changePercent,
        volume: item.volume ?? existing?.volume ?? null,
        shortName: item.name ?? existing?.shortName ?? symbol,
        source: existing?.source
          ? `${existing.source} + Finviz ${listName}`
          : `Finviz ${listName}`,
        asOf: null,
        isDelayed: true,
        multiSourceAgree: false,
        fallbackOnly: true,
      }));
    }
  };

  ingest(snapshot.majorNews, "major news");
  ingest(snapshot.topGainers, "top gainers");
  ingest(snapshot.topLosers, "top losers");
  ingest(snapshot.unusualVolume, "unusual volume");

  return map;
}

function finvizSnapshotFromHomepage(
  data?: FinvizHomepageData | null,
): FinvizSnapshotContext | null {
  if (!data) {
    return null;
  }

  return {
    topGainers: data.topGainers,
    topLosers: data.topLosers,
    unusualVolume: data.unusualVolume,
    majorNews: data.majorNews,
  };
}

function mergeQuote(
  primary: YahooQuote | undefined,
  fallback: YahooQuote | undefined,
): YahooQuote | undefined {
  if (!primary && !fallback) {
    return undefined;
  }
  if (!primary) {
    return stampQuoteSourceQuality(fallback!);
  }
  if (!fallback) {
    return stampQuoteSourceQuality(primary);
  }

  const sourceQuality = resolveSourceQuality(primary, fallback);

  const preferPrimary =
    isPrimaryApiSource(primary.source) ||
    (isNasdaqSource(primary.source) && !isPrimaryApiSource(fallback.source)) ||
    (!isFinvizSource(primary.source) && isFinvizSource(fallback.source));

  const chosen = preferPrimary ? primary : fallback;
  const other = preferPrimary ? fallback : primary;

  const price = chosen.price ?? other.price;
  const changePercent =
    chosen.preMarketChangePercent ??
    chosen.changePercent ??
    other.preMarketChangePercent ??
    other.changePercent ??
    null;
  const previousClose = chosen.previousClose ?? other.previousClose ?? null;

  let change = chosen.change ?? other.change ?? null;
  if (change == null && price != null && previousClose != null) {
    change = Number((price - previousClose).toFixed(4));
  }

  const providerTimestamps = mergeProviderTimestamps(
    primary.providerTimestamps,
    fallback.providerTimestamps,
  );

  return stampQuoteSourceQuality(
    finalizeQuote({
      symbol: chosen.symbol,
      price,
      change,
      changePercent,
      previousClose,
      preMarketPrice: chosen.preMarketPrice ?? other.preMarketPrice,
      preMarketChangePercent:
        chosen.preMarketChangePercent ?? other.preMarketChangePercent,
      volume: chosen.volume ?? other.volume,
      shortName: chosen.shortName ?? other.shortName,
      source: sourceQuality.source,
      asOf: chosen.asOf ?? other.asOf ?? null,
      isDelayed: chosen.isDelayed ?? other.isDelayed ?? false,
      multiSourceAgree: sourceQuality.multiSourceAgree,
      fallbackOnly: sourceQuality.fallbackOnly,
      sourceQuality: sourceQuality.sourceQuality,
      providerTimestamps,
    }),
  );
}

async function corroborateWithNasdaq(
  quotes: Map<string, YahooQuote>,
  symbols: string[],
): Promise<void> {
  for (const symbol of symbols) {
    const existing = quotes.get(symbol);
    if (!existing?.price || existing.multiSourceAgree) {
      continue;
    }

    if (isNasdaqSource(existing.source) || isFinvizSource(existing.source)) {
      continue;
    }

    const nasdaqQuote = await fetchNasdaqQuoteWithFallback(symbol);
    if (!nasdaqQuote) {
      continue;
    }

    const merged = mergeQuote(existing, nasdaqQuote);
    if (merged) {
      quotes.set(symbol, merged);
    }
  }
}

async function resolveSymbolQuote(
  symbol: string,
  finvizQuote: YahooQuote | undefined,
  providersAttempted: Set<string>,
): Promise<YahooQuote | null> {
  const upper = symbol.toUpperCase();
  let quote: YahooQuote | null = null;

  if (isFinnhubEnabled()) {
    providersAttempted.add("Finnhub");
    quote = await fetchFinnhubQuote(upper);
  }

  if (!quote?.price && isAlphaVantageEnabled()) {
    providersAttempted.add("Alpha Vantage");
    quote = await fetchAlphaVantageQuote(upper);
  }

  if (!quote?.price) {
    providersAttempted.add("Nasdaq");
    quote = await fetchNasdaqQuoteWithFallback(upper);
  }

  if (!quote?.price && !isYahooRateLimited()) {
    providersAttempted.add("Yahoo Finance");
    quote = await fetchYahooSparkQuote(upper);
  } else if (isYahooRateLimited()) {
    providersAttempted.add("Yahoo Finance (skipped — rate-limited)");
  }

  if (!quote?.price && finvizQuote) {
    providersAttempted.add("Finviz");
    quote = finvizQuote;
  }

  if (!quote) {
    return null;
  }

  if (!isNasdaqSource(quote.source) && !isFinvizSource(quote.source)) {
    const nasdaqQuote = await fetchNasdaqQuoteWithFallback(upper);
    if (nasdaqQuote) {
      quote = mergeQuote(quote, nasdaqQuote) ?? quote;
    }
  }

  return quote;
}

export async function fetchQuotes(
  symbols: string[],
  options?: {
    finvizSnapshot?: FinvizSnapshotContext | FinvizHomepageData | null;
  },
): Promise<{
  quotes: Map<string, YahooQuote>;
  warnings: string[];
  coverage: {
    requested: number;
    resolved: number;
    unresolved: string[];
  };
  diagnostics: {
    yahooBatchResolved: number;
    yahooBatchRequested: number;
    yahooSkipped: boolean;
    providersAttempted: string[];
    rateLimitedSources: Array<{ source: string; until: string }>;
    bySourceQuality: Partial<Record<SourceQuality, number>>;
  };
}> {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].sort();
  const cacheKey = `quotes:resolved:${unique.join(",")}:v2`;

  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const resolved = new Map<string, YahooQuote>();
    const providersAttempted = new Set<string>();

    const finvizContext =
      options?.finvizSnapshot && "topGainers" in options.finvizSnapshot
        ? options.finvizSnapshot
        : finvizSnapshotFromHomepage(options?.finvizSnapshot as FinvizHomepageData);

    const finvizQuotes = finvizContext
      ? buildFinvizQuoteIndex(finvizContext)
      : new Map<string, YahooQuote>();

    let finnhubBatch = new Map<string, YahooQuote>();
    if (isFinnhubEnabled()) {
      providersAttempted.add("Finnhub");
      finnhubBatch = await fetchFinnhubQuotes(unique);
    }

    let stillMissing = unique.filter((symbol) => !finnhubBatch.has(symbol));

    let alphaBatch = new Map<string, YahooQuote>();
    if (stillMissing.length > 0 && isAlphaVantageEnabled()) {
      providersAttempted.add("Alpha Vantage");
      alphaBatch = await fetchAlphaVantageQuotes(stillMissing);
    }

    stillMissing = stillMissing.filter((symbol) => !alphaBatch.has(symbol));

    let nasdaqBatch = new Map<string, YahooQuote>();
    if (stillMissing.length > 0) {
      providersAttempted.add("Nasdaq");
      nasdaqBatch = await fetchNasdaqQuotes(stillMissing);
    }

    stillMissing = stillMissing.filter((symbol) => !nasdaqBatch.has(symbol));

    let yahooResult = {
      quotes: new Map<string, YahooQuote>(),
      yahooBatchResolved: 0,
      yahooBatchRequested: stillMissing.length,
      rateLimited: isYahooRateLimited(),
      warnings: [] as string[],
    };

    if (stillMissing.length > 0) {
      if (isYahooRateLimited()) {
        providersAttempted.add("Yahoo Finance (skipped — rate-limited)");
        yahooResult.warnings.push(
          "Yahoo Finance skipped (rate-limited for 30 minutes after HTTP 429)",
        );
      } else {
        providersAttempted.add("Yahoo Finance");
        yahooResult = await fetchYahooSparkQuotes(stillMissing);
      }
      warnings.push(...yahooResult.warnings);
    }

    for (const symbol of unique) {
      const chainQuote =
        finnhubBatch.get(symbol) ??
        alphaBatch.get(symbol) ??
        nasdaqBatch.get(symbol) ??
        yahooResult.quotes.get(symbol);

      const merged = mergeQuote(chainQuote, finvizQuotes.get(symbol));
      if (merged) {
        resolved.set(symbol, merged);
      }
    }

    const unresolvedAfterBatch = unique.filter((symbol) => {
      const quote = resolved.get(symbol);
      return !quote || quote.price == null;
    });

    if (unresolvedAfterBatch.length > 0) {
      logger.info("Resolving remaining quotes individually", {
        symbols: unresolvedAfterBatch,
      });

      for (const symbol of unresolvedAfterBatch) {
        const quote = await resolveSymbolQuote(
          symbol,
          finvizQuotes.get(symbol),
          providersAttempted,
        );
        if (quote) {
          resolved.set(symbol, quote);
        }
        if (unresolvedAfterBatch.indexOf(symbol) < unresolvedAfterBatch.length - 1) {
          await delay(QUOTE_RETRY_DELAY_MS);
        }
      }
    }

    await corroborateWithNasdaq(resolved, unique);

    for (const symbol of unique) {
      const quote = resolved.get(symbol);
      if (!quote) {
        const finvizOnly = finvizQuotes.get(symbol);
        if (finvizOnly) {
          providersAttempted.add("Finviz");
          resolved.set(symbol, stampQuoteSourceQuality(finvizOnly));
        }
      } else if (quote.price == null) {
        const finvizOnly = finvizQuotes.get(symbol);
        if (finvizOnly) {
          providersAttempted.add("Finviz");
          resolved.set(
            symbol,
            mergeQuote(finvizOnly, quote) ?? stampQuoteSourceQuality(finvizOnly),
          );
        }
      }
    }

    const unresolved = unique.filter((symbol) => {
      const quote = resolved.get(symbol);
      return !quote || quote.price == null;
    });

    if (unresolved.length > 0) {
      warnings.push(`Could not resolve live quotes for: ${unresolved.join(", ")}`);
    }

    const rateLimitedSources = getRateLimitedSources();

    return {
      quotes: resolved,
      warnings,
      coverage: {
        requested: unique.length,
        resolved: unique.length - unresolved.length,
        unresolved,
      },
      diagnostics: {
        yahooBatchResolved: yahooResult.yahooBatchResolved,
        yahooBatchRequested: yahooResult.yahooBatchRequested,
        yahooSkipped: isYahooRateLimited(),
        providersAttempted: [...providersAttempted],
        rateLimitedSources,
        bySourceQuality: countBySourceQuality(resolved.values()),
      },
    };
  });
}

export function snapshotContextFromHomepage(
  data?: FinvizHomepageData | null,
): FinvizSnapshotContext | null {
  return finvizSnapshotFromHomepage(data);
}
