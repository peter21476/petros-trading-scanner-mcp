import { withYahooThrottle } from "./yahooSpark.js";
import {
  isYahooRateLimited,
  markYahooRateLimited,
} from "../utils/yahooRateLimit.js";
import { logger } from "../utils/logger.js";
import {
  clearYahooAuthCache,
  getYahooAuth,
  yahooAuthenticatedGet,
} from "./yahooCrumb.js";
import type { OhlcvBar, PriceInterval, PricePeriod } from "../types/marketResearch.js";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string };
  };
}

const CHART_HOSTS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
] as const;

export interface YahooChartFetchResult {
  bars: OhlcvBar[];
  warnings: string[];
  rateLimited: boolean;
}

function toBars(data: YahooChartResponse): OhlcvBar[] {
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) {
    return [];
  }

  const bars: OhlcvBar[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      volume == null
    ) {
      continue;
    }
    bars.push({
      date: new Date(timestamps[i]! * 1000).toISOString(),
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: Math.round(volume),
    });
  }
  return bars;
}

async function fetchYahooChartOnce(
  symbol: string,
  period: PricePeriod,
  interval: PriceInterval,
  host: (typeof CHART_HOSTS)[number],
): Promise<YahooChartFetchResult> {
  const warnings: string[] = [];
  const auth = await getYahooAuth();
  if (!auth) {
    return {
      bars: [],
      warnings: ["Yahoo auth unavailable for chart request"],
      rateLimited: false,
    };
  }

  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${period}&interval=${interval}&crumb=${encodeURIComponent(auth.crumb)}`;
  const response = await withYahooThrottle(() =>
    yahooAuthenticatedGet(url, symbol),
  );

  if (!response) {
    return { bars: [], warnings: ["Yahoo chart request failed"], rateLimited: false };
  }

  if (response.status === 429) {
    markYahooRateLimited();
    return {
      bars: [],
      warnings: ["Yahoo Finance rate-limited (HTTP 429)"],
      rateLimited: true,
    };
  }

  if (response.status === 401) {
    clearYahooAuthCache();
    warnings.push(`Yahoo chart unauthorized for ${symbol}`);
    return { bars: [], warnings, rateLimited: false };
  }

  if (!response.ok) {
    warnings.push(`Yahoo chart HTTP ${response.status} for ${symbol}`);
    return { bars: [], warnings, rateLimited: false };
  }

  const data = (await response.json()) as YahooChartResponse;
  if (data.chart?.error?.description) {
    warnings.push(data.chart.error.description);
  }

  return { bars: toBars(data), warnings, rateLimited: false };
}

/**
 * Fetch OHLCV bars from Yahoo Finance chart API (yfinance data source).
 */
export async function fetchYahooChart(
  symbol: string,
  period: PricePeriod,
  interval: PriceInterval,
): Promise<YahooChartFetchResult> {
  if (isYahooRateLimited()) {
    return {
      bars: [],
      warnings: ["Yahoo Finance rate-limited; use cached data if available"],
      rateLimited: true,
    };
  }

  const mergedWarnings: string[] = [];
  for (const host of CHART_HOSTS) {
    const result = await fetchYahooChartOnce(symbol, period, interval, host);
    mergedWarnings.push(...result.warnings);
    if (result.bars.length > 0) {
      return { bars: result.bars, warnings: mergedWarnings, rateLimited: result.rateLimited };
    }
  }

  logger.warn("[historical_prices] yfinance chart returned no bars", {
    symbol,
    period,
    interval,
  });
  return { bars: [], warnings: mergedWarnings, rateLimited: false };
}

/**
 * Fetch daily bars for SMA / 52-week calculations.
 */
export async function fetchYahooDailyBars(
  symbol: string,
  period: PricePeriod = "1y",
): Promise<YahooChartFetchResult> {
  return fetchYahooChart(symbol, period, "1d");
}
