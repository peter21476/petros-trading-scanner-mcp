import { CACHE_TTL, getCached } from "./cache.js";
import { safeFetchJson } from "./http.js";
import {
  emptyQuote,
  type FuturesResponse,
  type MoverStock,
  type QuotePoint,
  type YahooQuote,
  YAHOO_FUTURES_SYMBOLS,
} from "../types/market.js";
import { logger } from "../utils/logger.js";

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
  const data = await safeFetchJson<YahooScreenerResponse>(url);
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

interface YahooChartMeta {
  symbol: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  preMarketPrice?: number;
  regularMarketVolume?: number;
  shortName?: string;
  longName?: string;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
    }>;
    error?: { description?: string };
  };
}

function buildQuoteFromMeta(meta: YahooChartMeta): QuotePoint {
  const last =
    meta.preMarketPrice ??
    meta.regularMarketPrice ??
    null;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;

  let change: number | null = null;
  let changePercent: number | null = null;

  if (last != null && previousClose != null && previousClose !== 0) {
    change = last - previousClose;
    changePercent = (change / previousClose) * 100;
  }

  return {
    last,
    change: change == null ? null : Number(change.toFixed(4)),
    changePercent:
      changePercent == null ? null : Number(changePercent.toFixed(4)),
  };
}

async function fetchYahooChart(symbol: string): Promise<YahooChartMeta | null> {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=1m`;
  const data = await safeFetchJson<YahooChartResponse>(url);
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) {
    logger.warn("Yahoo chart missing meta", { symbol });
    return null;
  }
  return meta;
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuote | null> {
  return getCached(`yahoo:quote:${symbol}`, CACHE_TTL.MARKET_DATA_MS, async () => {
    const meta = await fetchYahooChart(symbol);
    if (!meta) {
      return null;
    }

    const quote = buildQuoteFromMeta(meta);
    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
    let preMarketChangePercent: number | null = null;

    if (
      meta.preMarketPrice != null &&
      previousClose != null &&
      previousClose !== 0
    ) {
      preMarketChangePercent =
        ((meta.preMarketPrice - previousClose) / previousClose) * 100;
    }

    return {
      symbol: meta.symbol ?? symbol,
      price: quote.last,
      change: quote.change,
      changePercent: quote.changePercent,
      preMarketPrice: meta.preMarketPrice ?? null,
      preMarketChangePercent:
        preMarketChangePercent == null
          ? null
          : Number(preMarketChangePercent.toFixed(4)),
      volume: meta.regularMarketVolume ?? null,
      shortName: meta.shortName ?? meta.longName ?? null,
    };
  });
}

const YAHOO_REQUEST_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const map = new Map<string, YahooQuote>();

  for (const symbol of unique) {
    const quote = await fetchYahooQuote(symbol);
    if (quote) {
      map.set(symbol, quote);
    }
    if (unique.indexOf(symbol) < unique.length - 1) {
      await delay(YAHOO_REQUEST_DELAY_MS);
    }
  }

  return map;
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

    for (let index = 0; index < entries.length; index += 1) {
      const [key, symbol] = entries[index]!;
      if (index > 0) {
        await delay(YAHOO_REQUEST_DELAY_MS);
      }
      const meta = await fetchYahooChart(symbol);
      if (!meta) {
        warnings.push(`Yahoo quote unavailable for ${symbol}`);
        continue;
      }
      futures[key] = buildQuoteFromMeta(meta);
    }

    return { futures, warnings };
  });
}

export async function fetchYahooNewsHeadline(symbol: string): Promise<string | null> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=1`;
  const data = await safeFetchJson<{
    news?: Array<{ title?: string }>;
  }>(url);

  return data?.news?.[0]?.title ?? null;
}
