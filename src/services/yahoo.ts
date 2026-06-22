import { CACHE_TTL, getCached } from "./cache.js";
import { safeFetchJson } from "./http.js";
import { fetchYahooSparkQuote, fetchYahooSparkQuotes, withYahooThrottle } from "./yahooSpark.js";
import {
  emptyQuote,
  type FuturesResponse,
  type MoverStock,
  type YahooQuote,
  YAHOO_FUTURES_SYMBOLS,
} from "../types/market.js";

interface YahooScreenerQuote {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
}

interface YahooScreenerResponse {
  finance?: {
    result?: Array<{
      title?: string;
      quotes?: YahooScreenerQuote[];
    }>;
    error?: { description?: string };
  };
}

const YAHOO_SCREENER_IDS = {
  leaders: "day_gainers",
  laggards: "day_losers",
  mostActive: "most_actives",
} as const;

function screenerQuoteToMover(quote: YahooScreenerQuote): MoverStock | null {
  const symbol = quote.symbol?.trim();
  if (!symbol) {
    return null;
  }

  const price = quote.preMarketPrice ?? quote.regularMarketPrice ?? null;
  const change = quote.preMarketChange ?? quote.regularMarketChange ?? null;
  const changePercent =
    quote.preMarketChangePercent ?? quote.regularMarketChangePercent ?? null;
  const volume = quote.regularMarketVolume ?? null;

  return {
    symbol,
    name: quote.shortName ?? quote.longName ?? symbol,
    price,
    change: change == null ? null : Number(change.toFixed(4)),
    changePercent: changePercent == null ? null : Number(changePercent.toFixed(4)),
    volume,
  };
}

async function fetchYahooScreener(scrId: string, count: number): Promise<MoverStock[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`;
  const data = await withYahooThrottle(() => safeFetchJson<YahooScreenerResponse>(url));
  const quotes = data?.finance?.result?.[0]?.quotes ?? [];

  return quotes
    .map(screenerQuoteToMover)
    .filter((mover): mover is MoverStock => mover != null);
}

export async function fetchYahooMovers(limit: number): Promise<{
  leaders: MoverStock[];
  laggards: MoverStock[];
  mostActive: MoverStock[];
  warnings: string[];
}> {
  return getCached(`yahoo:movers:${limit}`, CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const [leaders, laggards, mostActive] = await Promise.all([
      fetchYahooScreener(YAHOO_SCREENER_IDS.leaders, limit),
      fetchYahooScreener(YAHOO_SCREENER_IDS.laggards, limit),
      fetchYahooScreener(YAHOO_SCREENER_IDS.mostActive, limit),
    ]);

    if (leaders.length === 0 && laggards.length === 0 && mostActive.length === 0) {
      warnings.push("Yahoo Finance screener returned no mover data");
    } else {
      warnings.push(
        "Yahoo movers use day gainers/losers/actives; premarket fields used when available",
      );
    }

    return { leaders, laggards, mostActive, warnings };
  });
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuote | null> {
  return getCached(
    `yahoo:quote:${symbol}`,
    CACHE_TTL.MARKET_DATA_MS,
    () => fetchYahooSparkQuote(symbol),
    { skipCacheWhen: (value) => value == null },
  );
}

export async function fetchYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const { fetchQuotes } = await import("./quotes.js");
  const result = await fetchQuotes(symbols);
  return result.quotes;
}

export async function fetchYahooFutures(): Promise<{
  futures: FuturesResponse["futures"];
  warnings: string[];
}> {
  return getCached("yahoo:futures", CACHE_TTL.MARKET_DATA_MS, async () => {
    const futures = {
      nasdaq100: emptyQuote(),
      sp500: emptyQuote(),
      dow: emptyQuote(),
      russell2000: emptyQuote(),
      crudeOil: emptyQuote(),
      gold: emptyQuote(),
      bitcoin: emptyQuote(),
    };

    const warnings: string[] = [];
    const entries = Object.entries(YAHOO_FUTURES_SYMBOLS) as Array<
      [keyof FuturesResponse["futures"], string]
    >;
    const symbols = entries.map(([, yahooSymbol]) => yahooSymbol);
    const sparkResult = await fetchYahooSparkQuotes(symbols);
    warnings.push(...sparkResult.warnings);

    for (const [key, yahooSymbol] of entries) {
      const quote =
        sparkResult.quotes.get(yahooSymbol.toUpperCase()) ??
        sparkResult.quotes.get(yahooSymbol);
      if (!quote) {
        warnings.push(`Yahoo quote unavailable for ${yahooSymbol}`);
        continue;
      }
      futures[key] = {
        last: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
      };
    }

    return { futures, warnings };
  });
}

export async function fetchYahooNewsHeadline(symbol: string): Promise<string | null> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=1`;
  const data = await withYahooThrottle(() =>
    safeFetchJson<{
      news?: Array<{ title?: string }>;
    }>(url),
  );

  return data?.news?.[0]?.title ?? null;
}
