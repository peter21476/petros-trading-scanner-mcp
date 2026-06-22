import { CACHE_TTL, getCached } from "./cache.js";
import { safeFetchJson } from "./http.js";
import { fetchYahooQuote } from "./yahoo.js";
import type { FinvizHomepageData, SnapshotStock, YahooQuote } from "../types/market.js";
import { parseNumber, parsePercent, parseVolume, signedChange } from "../utils/parseNumber.js";
import { logger } from "../utils/logger.js";

const SPARK_BATCH_SIZE = 8;
const QUOTE_RETRY_DELAY_MS = 600;
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const;

interface YahooSparkMeta {
  symbol?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  preMarketPrice?: number;
  regularMarketVolume?: number;
  shortName?: string;
  longName?: string;
}

interface YahooSparkResponse {
  spark?: {
    result?: Array<{
      symbol?: string;
      response?: Array<{
        meta?: YahooSparkMeta;
      }>;
    }>;
    error?: { description?: string };
  };
}

interface NasdaqQuoteResponse {
  data?: {
    symbol?: string;
    companyName?: string;
    primaryData?: {
      lastSalePrice?: string;
      netChange?: string;
      percentageChange?: string;
      volume?: string;
    };
  };
}

const NASDAQ_HEADERS = {
  Accept: "application/json",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

export interface FinvizSnapshotContext {
  topGainers: SnapshotStock[];
  topLosers: SnapshotStock[];
  unusualVolume: SnapshotStock[];
  majorNews: SnapshotStock[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function metaToQuote(meta: YahooSparkMeta, source: string): YahooQuote | null {
  const symbol = meta.symbol?.toUpperCase();
  if (!symbol) {
    return null;
  }

  const price = meta.preMarketPrice ?? meta.regularMarketPrice ?? null;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;

  let change: number | null = null;
  let changePercent: number | null = null;
  let preMarketChangePercent: number | null = null;

  if (price != null && previousClose != null && previousClose !== 0) {
    change = Number((price - previousClose).toFixed(4));
    changePercent = Number(((change / previousClose) * 100).toFixed(4));
  }

  if (
    meta.preMarketPrice != null &&
    previousClose != null &&
    previousClose !== 0
  ) {
    preMarketChangePercent = Number(
      (((meta.preMarketPrice - previousClose) / previousClose) * 100).toFixed(4),
    );
  }

  if (price == null && changePercent == null) {
    return null;
  }

  return {
    symbol,
    price,
    change,
    changePercent,
    preMarketPrice: meta.preMarketPrice ?? null,
    preMarketChangePercent,
    volume: meta.regularMarketVolume ?? null,
    shortName: meta.shortName ?? meta.longName ?? symbol,
    source,
  };
}

async function fetchYahooSparkChunk(
  symbols: string[],
  host: (typeof YAHOO_HOSTS)[number],
): Promise<Map<string, YahooQuote>> {
  const map = new Map<string, YahooQuote>();
  if (symbols.length === 0) {
    return map;
  }

  const joined = symbols.map((symbol) => encodeURIComponent(symbol)).join(",");
  const url = `https://${host}/v7/finance/spark?symbols=${joined}&range=1d&interval=1d`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (response.status === 429) {
    throw new Error(`Yahoo spark rate limited on ${host}`);
  }

  if (!response.ok) {
    logger.warn("Yahoo spark chunk failed", { host, status: response.status, symbols });
    return map;
  }

  const data = (await response.json()) as YahooSparkResponse;
  for (const item of data.spark?.result ?? []) {
    const meta = item.response?.[0]?.meta;
    if (!meta) {
      continue;
    }
    const quote = metaToQuote(
      { ...meta, symbol: meta.symbol ?? item.symbol },
      "Yahoo Finance",
    );
    if (quote) {
      map.set(quote.symbol, quote);
    }
  }

  return map;
}

async function fetchYahooSparkBatchRecursive(
  symbols: string[],
  depth = 0,
): Promise<Map<string, YahooQuote>> {
  const map = new Map<string, YahooQuote>();
  if (symbols.length === 0) {
    return map;
  }

  let rateLimited = false;

  for (const host of YAHOO_HOSTS) {
    try {
      const chunkResult = await fetchYahooSparkChunk(symbols, host);
      for (const [symbol, quote] of chunkResult) {
        map.set(symbol, quote);
      }
      if (map.size > 0) {
        return map;
      }
    } catch (error) {
      if (String(error).includes("rate limited")) {
        rateLimited = true;
      }
      logger.warn("Yahoo spark host failed", { host, error: String(error) });
    }
  }

  if (rateLimited) {
    return map;
  }

  if (symbols.length === 1 || depth >= 1) {
    return map;
  }

  const midpoint = Math.ceil(symbols.length / 2);
  const left = symbols.slice(0, midpoint);
  const right = symbols.slice(midpoint);

  await delay(QUOTE_RETRY_DELAY_MS);
  const leftResult = await fetchYahooSparkBatchRecursive(left, depth + 1);
  await delay(QUOTE_RETRY_DELAY_MS);
  const rightResult = await fetchYahooSparkBatchRecursive(right, depth + 1);

  for (const [symbol, quote] of leftResult) {
    map.set(symbol, quote);
  }
  for (const [symbol, quote] of rightResult) {
    map.set(symbol, quote);
  }

  return map;
}

async function fetchYahooSparkBatch(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const map = new Map<string, YahooQuote>();

  for (let index = 0; index < symbols.length; index += SPARK_BATCH_SIZE) {
    const chunk = symbols.slice(index, index + SPARK_BATCH_SIZE);
    const chunkResult = await fetchYahooSparkBatchRecursive(chunk);
    for (const [symbol, quote] of chunkResult) {
      map.set(symbol, quote);
    }
    if (index + SPARK_BATCH_SIZE < symbols.length) {
      await delay(QUOTE_RETRY_DELAY_MS);
    }
  }

  return map;
}

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

  if (price == null && changePercent == null) {
    return null;
  }

  return {
    symbol: symbol.toUpperCase(),
    price,
    change,
    changePercent,
    preMarketPrice: null,
    preMarketChangePercent: changePercent,
    volume,
    shortName: data?.data?.companyName ?? symbol,
    source: "Nasdaq",
  };
}

async function fetchNasdaqQuoteWithFallback(symbol: string): Promise<YahooQuote | null> {
  const stockQuote = await fetchNasdaqQuote(symbol, "stocks");
  if (stockQuote) {
    return stockQuote;
  }
  return fetchNasdaqQuote(symbol, "etf");
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

      map.set(symbol, {
        symbol,
        price,
        change,
        changePercent,
        preMarketPrice: null,
        preMarketChangePercent: changePercent,
        volume: item.volume ?? existing?.volume ?? null,
        shortName: item.name ?? existing?.shortName ?? symbol,
        source: existing?.source
          ? `${existing.source} + Finviz ${listName}`
          : `Finviz ${listName}`,
      });
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

async function fetchMissingQuotesIndividually(
  symbols: string[],
): Promise<Map<string, YahooQuote>> {
  const map = new Map<string, YahooQuote>();

  for (const symbol of symbols) {
    let quote = await fetchNasdaqQuoteWithFallback(symbol);

    if (!quote || (quote.price == null && quote.changePercent == null)) {
      const yahooQuote = await fetchYahooQuote(symbol);
      quote = mergeQuote(yahooQuote ?? undefined, quote ?? undefined) ?? quote;
    }

    if (quote) {
      map.set(symbol, quote);
    }

    if (symbols.indexOf(symbol) < symbols.length - 1) {
      await delay(QUOTE_RETRY_DELAY_MS);
    }
  }

  return map;
}

function mergeQuote(
  primary: YahooQuote | undefined,
  fallback: YahooQuote | undefined,
): YahooQuote | undefined {
  if (!primary && !fallback) {
    return undefined;
  }
  if (!primary) {
    return fallback;
  }
  if (!fallback) {
    return primary;
  }

  const price = primary.price ?? fallback.price;
  const changePercent =
    primary.preMarketChangePercent ??
    primary.changePercent ??
    fallback.preMarketChangePercent ??
    fallback.changePercent ??
    null;

  let change = primary.change ?? fallback.change ?? null;
  if (change == null && price != null && changePercent != null) {
    change = Number(((price * changePercent) / 100).toFixed(4));
  }

  return {
    symbol: primary.symbol,
    price,
    change,
    changePercent,
    preMarketPrice: primary.preMarketPrice ?? fallback.preMarketPrice,
    preMarketChangePercent:
      primary.preMarketChangePercent ?? fallback.preMarketChangePercent,
    volume: primary.volume ?? fallback.volume,
    shortName: primary.shortName ?? fallback.shortName,
    source:
      primary.price != null
        ? primary.source ?? "Yahoo Finance"
        : fallback.source ?? primary.source ?? "Yahoo Finance",
  };
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
}> {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].sort();
  const cacheKey = `quotes:resolved:${unique.join(",")}`;

  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const resolved = new Map<string, YahooQuote>();

    const finvizContext =
      options?.finvizSnapshot && "topGainers" in options.finvizSnapshot
        ? options.finvizSnapshot
        : finvizSnapshotFromHomepage(options?.finvizSnapshot as FinvizHomepageData);

    const finvizQuotes = finvizContext
      ? buildFinvizQuoteIndex(finvizContext)
      : new Map<string, YahooQuote>();

    const yahooBatch = await fetchYahooSparkBatch(unique);
    if (yahooBatch.size === 0) {
      warnings.push("Yahoo Finance batch quote lookup returned no data; trying Nasdaq fallback");
    } else if (yahooBatch.size < unique.length) {
      warnings.push(
        `Yahoo Finance batch resolved ${yahooBatch.size}/${unique.length} symbols`,
      );
    }

    for (const symbol of unique) {
      const merged = mergeQuote(yahooBatch.get(symbol), finvizQuotes.get(symbol));
      if (merged) {
        resolved.set(symbol, merged);
      }
    }

    const stillMissing = unique.filter((symbol) => {
      const quote = resolved.get(symbol);
      return !quote || quote.price == null;
    });

    if (stillMissing.length > 0) {
      logger.info("Retrying missing quotes individually", {
        symbols: stillMissing,
      });
      const individual = await fetchMissingQuotesIndividually(stillMissing);
      for (const symbol of stillMissing) {
        const merged = mergeQuote(
          individual.get(symbol) ?? resolved.get(symbol),
          finvizQuotes.get(symbol),
        );
        if (merged) {
          resolved.set(symbol, merged);
        }
      }
    }

    for (const symbol of unique) {
      const quote = resolved.get(symbol);
      if (!quote) {
        const finvizOnly = finvizQuotes.get(symbol);
        if (finvizOnly) {
          resolved.set(symbol, finvizOnly);
        }
      } else if (quote.price == null && quote.changePercent == null) {
        const finvizOnly = finvizQuotes.get(symbol);
        if (finvizOnly) {
          resolved.set(symbol, mergeQuote(finvizOnly, quote) ?? finvizOnly);
        }
      }
    }

    const unresolved = unique.filter((symbol) => {
      const quote = resolved.get(symbol);
      return !quote || quote.price == null;
    });

    if (unresolved.length > 0) {
      warnings.push(
        `Could not resolve live quotes for: ${unresolved.join(", ")}`,
      );
    }

    if (resolved.size === 0 && finvizQuotes.size > 0) {
      warnings.push("Using Finviz snapshot quotes as primary fallback");
      for (const [symbol, quote] of finvizQuotes) {
        if (unique.includes(symbol)) {
          resolved.set(symbol, quote);
        }
      }
    }

    return {
      quotes: resolved,
      warnings,
      coverage: {
        requested: unique.length,
        resolved: unique.length - unresolved.length,
        unresolved,
      },
    };
  });
}

export function snapshotContextFromHomepage(
  data?: FinvizHomepageData | null,
): FinvizSnapshotContext | null {
  return finvizSnapshotFromHomepage(data);
}
