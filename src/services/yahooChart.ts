import { safeFetchJson } from "./http.js";
import { withYahooThrottle } from "./yahooSpark.js";
import {
  isYahooRateLimited,
  markYahooRateLimited,
} from "../utils/yahooRateLimit.js";
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

/**
 * Fetch OHLCV bars from Yahoo Finance chart API.
 */
export async function fetchYahooChart(
  symbol: string,
  period: PricePeriod,
  interval: PriceInterval,
): Promise<YahooChartFetchResult> {
  const warnings: string[] = [];
  if (isYahooRateLimited()) {
    return {
      bars: [],
      warnings: ["Yahoo Finance rate-limited; use cached data if available"],
      rateLimited: true,
    };
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${period}&interval=${interval}`;
  const response = await withYahooThrottle(() =>
    fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    }),
  );

  if (response.status === 429) {
    markYahooRateLimited();
    return {
      bars: [],
      warnings: ["Yahoo Finance rate-limited (HTTP 429)"],
      rateLimited: true,
    };
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
 * Fetch daily bars for SMA / 52-week calculations.
 */
export async function fetchYahooDailyBars(
  symbol: string,
  period: PricePeriod = "1y",
): Promise<YahooChartFetchResult> {
  return fetchYahooChart(symbol, period, "1d");
}
