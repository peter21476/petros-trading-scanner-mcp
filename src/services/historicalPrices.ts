import { CACHE_TTL, getCachedWithMeta } from "./cache.js";
import { fetchFinnhubCandles } from "./finnhubCandles.js";
import { fetchYahooChart, fetchYahooDailyBars } from "./yahooChart.js";
import { computePriceMetrics } from "../utils/technicalMath.js";
import type {
  HistoricalPricesResponse,
  PriceInterval,
  PricePeriod,
  SymbolHistoricalPrices,
} from "../types/marketResearch.js";

async function fetchSymbolHistory(
  symbol: string,
  period: PricePeriod,
  interval: PriceInterval,
): Promise<{
  bars: SymbolHistoricalPrices["bars"];
  metrics: SymbolHistoricalPrices["metrics"];
  source: string;
  warnings: string[];
  rateLimited: boolean;
}> {
  const upper = symbol.toUpperCase();
  const warnings: string[] = [];
  let bars: SymbolHistoricalPrices["bars"] = [];
  let source = "Yahoo Finance";
  let rateLimited = false;

  const finnhub = await fetchFinnhubCandles(upper, period, interval);
  warnings.push(...finnhub.warnings);
  if (finnhub.bars.length > 0) {
    bars = finnhub.bars;
    source = "Finnhub";
  } else {
    const yahoo = await fetchYahooChart(upper, period, interval);
    warnings.push(...yahoo.warnings);
    bars = yahoo.bars;
    rateLimited = yahoo.rateLimited;
  }

  if (bars.length === 0) {
    return {
      bars: [],
      metrics: {
        sma20: null,
        sma50: null,
        distanceFromSma20Percent: null,
        distanceFromSma50Percent: null,
        week52High: null,
        week52Low: null,
        distanceFrom52WeekHighPercent: null,
        distanceFrom52WeekLowPercent: null,
      },
      source,
      warnings: [...warnings, `No OHLCV data for ${upper}`],
      rateLimited,
    };
  }

  const daily =
    interval === "1d"
      ? bars
      : (await fetchYahooDailyBars(upper, "1y")).bars;
  const lastClose = bars.at(-1)!.close;
  const metrics = computePriceMetrics(daily, lastClose);

  return { bars, metrics, source, warnings, rateLimited };
}

function envelope(
  payload: Omit<
    HistoricalPricesResponse,
    "timestamp" | "dataFreshness" | "cached" | "cachedAt"
  >,
  fromCache: boolean,
  cachedAt: string | null,
  rateLimited: boolean,
): HistoricalPricesResponse {
  return {
    timestamp: new Date().toISOString(),
    dataFreshness: fromCache || rateLimited ? "cached" : "fresh",
    cached: fromCache || rateLimited,
    cachedAt: fromCache ? cachedAt : rateLimited ? new Date().toISOString() : null,
    ...payload,
  };
}

/**
 * OHLCV history with SMA and 52-week metrics for one or more symbols.
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
      const warnings: string[] = [];
      const results: SymbolHistoricalPrices[] = [];
      let source = "Yahoo Finance";
      let rateLimited = false;

      for (const symbol of symbols) {
        const result = await fetchSymbolHistory(symbol, period, interval);
        warnings.push(...result.warnings);
        if (result.source === "Finnhub") {
          source = "Finnhub";
        }
        rateLimited = rateLimited || result.rateLimited;
        results.push({
          symbol: symbol.toUpperCase(),
          period,
          interval,
          bars: result.bars,
          metrics: result.metrics,
        });
      }

      return { source, warnings, symbols: results, rateLimited };
    },
  );

  return envelope(data, fromCache, cachedAt, data.rateLimited);
}
