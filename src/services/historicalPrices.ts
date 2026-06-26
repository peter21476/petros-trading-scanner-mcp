import { CACHE_TTL, getCachedWithMeta } from "./cache.js";
import { fetchYahooChart } from "./yahooChart.js";
import { logger } from "../utils/logger.js";
import { distancePercent, sma } from "../utils/technicalMath.js";
import type {
  HistoricalPriceSummary,
  HistoricalPricesResponse,
  OhlcvBar,
  PriceInterval,
  PricePeriod,
  SymbolHistoricalPrices,
} from "../types/marketResearch.js";

const YFINANCE_WARNING =
  "Price data from yfinance — 15-min delay during market hours.";

export function buildSummary(
  bars: OhlcvBar[],
  period: PricePeriod,
): HistoricalPriceSummary {
  const closes = bars.map((bar) => bar.close);
  const currentPrice =
    closes.length > 0 ? Number(closes.at(-1)!.toFixed(4)) : null;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);

  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const week52High =
    period === "1y" && highs.length > 0
      ? Number(Math.max(...highs).toFixed(4))
      : null;
  const week52Low =
    period === "1y" && lows.length > 0
      ? Number(Math.min(...lows).toFixed(4))
      : null;

  return {
    currentPrice,
    sma20,
    sma50,
    distanceFromSma20Pct:
      currentPrice != null && sma20 != null
        ? distancePercent(currentPrice, sma20)
        : null,
    distanceFromSma50Pct:
      currentPrice != null && sma50 != null
        ? distancePercent(currentPrice, sma50)
        : null,
    week52High,
    week52Low,
  };
}

async function fetchSymbolHistory(
  symbol: string,
  period: PricePeriod,
  interval: PriceInterval,
): Promise<SymbolHistoricalPrices> {
  const upper = symbol.toUpperCase();

  try {
    logger.info("[historical_prices] fetching yfinance history", {
      symbol: upper,
      period,
      interval,
    });

    const { bars, warnings } = await fetchYahooChart(upper, period, interval);
    if (warnings.length > 0) {
      logger.debug("[historical_prices] yfinance warnings", {
        symbol: upper,
        warnings,
      });
    }

    if (bars.length === 0) {
      return {
        symbol: upper,
        period,
        interval,
        error: "No data returned from yfinance",
      };
    }

    return {
      symbol: upper,
      period,
      interval,
      bars,
      summary: buildSummary(bars, period),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("[historical_prices] yfinance fetch failed", {
      symbol: upper,
      error: message,
    });
    return {
      symbol: upper,
      period,
      interval,
      error: `yfinance fetch failed: ${message}`,
    };
  }
}

/**
 * OHLCV history with SMA and 52-week summary via yfinance (Yahoo Finance).
 */
export async function getHistoricalPrices(
  symbols: string[],
  period: PricePeriod,
  interval: PriceInterval,
): Promise<HistoricalPricesResponse> {
  const key = `historical:${symbols.join(",")}:${period}:${interval}`;
  const { data, fromCache, cachedAt } = await getCachedWithMeta(
    key,
    CACHE_TTL.MARKET_DATA_MS,
    async () => {
      const warnings: string[] = [YFINANCE_WARNING];
      const results: SymbolHistoricalPrices[] = [];

      for (const symbol of symbols) {
        results.push(await fetchSymbolHistory(symbol, period, interval));
      }

      return { warnings, results };
    },
  );

  return {
    timestamp: new Date().toISOString(),
    source: "yfinance",
    dataFreshness: fromCache ? "cached" : "delayed",
    warnings: data.warnings,
    cached: fromCache,
    cachedAt,
    results: data.results,
  };
}
