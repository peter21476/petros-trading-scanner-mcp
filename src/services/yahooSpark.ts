import { USER_AGENT } from "./http.js";
import type { YahooQuote } from "../types/market.js";
import { finalizeQuote } from "../utils/quoteValidation.js";
import { logger } from "../utils/logger.js";
import {
  getRateLimitedSources,
  isYahooRateLimited,
  markYahooRateLimited,
} from "../utils/yahooRateLimit.js";

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const;
const DEFAULT_CHUNK_SIZE = 8;
const CHUNK_DELAY_MS = 400;
const MIN_REQUEST_GAP_MS = 300;
const MAX_RETRIES_PER_HOST = 2;

export const YAHOO_SPARK_HEADERS = {
  Accept: "application/json",
  "User-Agent": USER_AGENT,
};

interface YahooSparkMeta {
  symbol?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  preMarketPrice?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
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

export interface YahooSparkFetchResult {
  quotes: Map<string, YahooQuote>;
  yahooBatchResolved: number;
  yahooBatchRequested: number;
  rateLimited: boolean;
  warnings: string[];
}

let yahooQueue: Promise<void> = Promise.resolve();
let lastYahooRequestAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withYahooThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, MIN_REQUEST_GAP_MS - (now - lastYahooRequestAt));
    if (waitMs > 0) {
      await delay(waitMs);
    }
    lastYahooRequestAt = Date.now();
    return fn();
  };

  const result = yahooQueue.then(run, run);
  yahooQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function sparkMetaToQuote(meta: YahooSparkMeta): YahooQuote | null {
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

  const asOf =
    meta.regularMarketTime != null
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : null;

  return finalizeQuote({
    symbol,
    price,
    change,
    changePercent,
    previousClose,
    preMarketPrice: meta.preMarketPrice ?? null,
    preMarketChangePercent,
    volume: meta.regularMarketVolume ?? null,
    shortName: meta.shortName ?? meta.longName ?? symbol,
    source: "Yahoo Finance",
    asOf,
    isDelayed: false,
    multiSourceAgree: false,
    fallbackOnly: false,
  });
}

async function fetchSparkChunkOnce(
  symbols: string[],
  host: (typeof YAHOO_HOSTS)[number],
): Promise<{ status: number; quotes: Map<string, YahooQuote> }> {
  const map = new Map<string, YahooQuote>();
  if (symbols.length === 0) {
    return { status: 200, quotes: map };
  }

  const joined = symbols.map((symbol) => encodeURIComponent(symbol)).join(",");
  const url = `https://${host}/v7/finance/spark?symbols=${joined}&range=1d&interval=1d`;

  const response = await withYahooThrottle(() =>
    fetch(url, { headers: YAHOO_SPARK_HEADERS }),
  );

  if (!response.ok) {
    return { status: response.status, quotes: map };
  }

  const data = (await response.json()) as YahooSparkResponse;
  for (const item of data.spark?.result ?? []) {
    const meta = item.response?.[0]?.meta;
    if (!meta) {
      continue;
    }
    const quote = sparkMetaToQuote({
      ...meta,
      symbol: meta.symbol ?? item.symbol,
    });
    if (quote) {
      map.set(quote.symbol, quote);
    }
  }

  return { status: response.status, quotes: map };
}

async function fetchSparkChunk(
  symbols: string[],
): Promise<{ quotes: Map<string, YahooQuote>; rateLimited: boolean }> {
  const merged = new Map<string, YahooQuote>();
  let rateLimited = false;

  for (const host of YAHOO_HOSTS) {
    for (let attempt = 0; attempt < MAX_RETRIES_PER_HOST; attempt += 1) {
      if (attempt > 0) {
        const backoffMs = 1500 * attempt;
        logger.info("Yahoo spark retry after rate limit", {
          host,
          attempt,
          backoffMs,
          symbols,
        });
        await delay(backoffMs);
      }

      const result = await fetchSparkChunkOnce(symbols, host);
      if (result.status === 429) {
        rateLimited = true;
        markYahooRateLimited();
        continue;
      }

      if (result.status !== 200) {
        logger.warn("Yahoo spark chunk failed", {
          host,
          status: result.status,
          symbols,
        });
        break;
      }

      for (const [symbol, quote] of result.quotes) {
        merged.set(symbol, quote);
      }

      if (merged.size > 0) {
        return { quotes: merged, rateLimited: false };
      }
    }
  }

  return { quotes: merged, rateLimited };
}

async function fetchSparkChunkRecursive(
  symbols: string[],
  depth = 0,
): Promise<{ quotes: Map<string, YahooQuote>; rateLimited: boolean }> {
  const direct = await fetchSparkChunk(symbols);
  if (direct.quotes.size > 0) {
    return direct;
  }

  // Do not split/retry further when Yahoo is rate-limiting — more requests make it worse.
  if (direct.rateLimited || symbols.length === 1 || depth >= 1) {
    return direct;
  }

  const midpoint = Math.ceil(symbols.length / 2);
  const left = symbols.slice(0, midpoint);
  const right = symbols.slice(midpoint);

  await delay(CHUNK_DELAY_MS);
  const leftResult = await fetchSparkChunkRecursive(left, depth + 1);
  if (leftResult.quotes.size > 0) {
    return leftResult;
  }
  if (leftResult.rateLimited) {
    return leftResult;
  }

  await delay(CHUNK_DELAY_MS);
  const rightResult = await fetchSparkChunkRecursive(right, depth + 1);

  const merged = new Map<string, YahooQuote>([
    ...leftResult.quotes,
    ...rightResult.quotes,
  ]);

  return {
    quotes: merged,
    rateLimited: leftResult.rateLimited || rightResult.rateLimited,
  };
}

export async function fetchYahooSparkQuotes(
  symbols: string[],
  options?: { chunkSize?: number },
): Promise<YahooSparkFetchResult> {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].sort();
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const warnings: string[] = [];
  const quotes = new Map<string, YahooQuote>();

  if (isYahooRateLimited()) {
    const until = getRateLimitedSources()[0]?.until;
    warnings.push(
      until
        ? `Yahoo Finance skipped (rate-limited until ${until})`
        : "Yahoo Finance skipped (rate-limited)",
    );
    return {
      quotes,
      yahooBatchResolved: 0,
      yahooBatchRequested: unique.length,
      rateLimited: true,
      warnings,
    };
  }

  let rateLimited = false;

  for (let index = 0; index < unique.length; index += chunkSize) {
    const chunk = unique.slice(index, index + chunkSize);
    const chunkResult = await fetchSparkChunkRecursive(chunk);
    rateLimited = rateLimited || chunkResult.rateLimited;

    for (const [symbol, quote] of chunkResult.quotes) {
      quotes.set(symbol, quote);
    }

    if (index + chunkSize < unique.length) {
      await delay(CHUNK_DELAY_MS);
    }
  }

  if (quotes.size === 0 && rateLimited) {
    warnings.push(
      "Yahoo Finance rate-limited (HTTP 429); Yahoo requests paused for 30 minutes",
    );
  } else if (quotes.size === 0) {
    warnings.push("Yahoo Finance spark returned no quote data");
  } else if (quotes.size < unique.length) {
    warnings.push(
      `Yahoo Finance spark resolved ${quotes.size}/${unique.length} symbols`,
    );
  }

  return {
    quotes,
    yahooBatchResolved: quotes.size,
    yahooBatchRequested: unique.length,
    rateLimited,
    warnings,
  };
}

export async function fetchYahooSparkQuote(
  symbol: string,
): Promise<YahooQuote | null> {
  const result = await fetchYahooSparkQuotes([symbol]);
  return result.quotes.get(symbol.toUpperCase()) ?? null;
}
