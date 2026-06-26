import { CACHE_TTL, getCachedWithMeta } from "./cache.js";
import { fetchFinnhubCandles } from "./finnhubCandles.js";
import { fetchYahooChart } from "./yahooChart.js";
import {
  averageVolume,
  bollingerBands,
  macd,
  rsi,
} from "../utils/technicalMath.js";
import type {
  IndicatorInterval,
  TechnicalIndicatorsResponse,
  TechnicalIndicatorValues,
} from "../types/marketResearch.js";

function intervalToChart(interval: IndicatorInterval): {
  period: "5d" | "3mo" | "1y";
  barInterval: "1h" | "1d";
} {
  if (interval === "1h") {
    return { period: "3mo", barInterval: "1h" };
  }
  return { period: "1y", barInterval: "1d" };
}

function interpretRsi(value: number | null): string {
  if (value == null) {
    return "insufficient data";
  }
  if (value >= 70) {
    return "overbought";
  }
  if (value <= 30) {
    return "oversold";
  }
  return "neutral";
}

function interpretMacd(
  value: number | null,
  signal: number | null,
  histogram: number | null,
): string {
  if (value == null || signal == null || histogram == null) {
    return "insufficient data";
  }
  if (histogram > 0 && value > signal) {
    return "bullish crossover";
  }
  if (histogram < 0 && value < signal) {
    return "bearish crossover";
  }
  if (value > signal) {
    return "bullish";
  }
  if (value < signal) {
    return "bearish";
  }
  return "neutral";
}

function interpretBollinger(
  price: number,
  upper: number | null,
  mid: number | null,
  lower: number | null,
): string {
  if (upper == null || mid == null || lower == null) {
    return "insufficient data";
  }
  const bandWidth = upper - lower;
  if (bandWidth <= 0) {
    return "neutral";
  }
  const upperDist = Math.abs(price - upper) / bandWidth;
  const lowerDist = Math.abs(price - lower) / bandWidth;
  if (upperDist < 0.1) {
    return "price near upper band";
  }
  if (lowerDist < 0.1) {
    return "price near lower band";
  }
  if (Math.abs(price - mid) / bandWidth < 0.15) {
    return "price near middle band";
  }
  return price > mid ? "above middle band" : "below middle band";
}

function interpretVolume(ratio: number | null): string {
  if (ratio == null) {
    return "insufficient data";
  }
  if (ratio >= 1.5) {
    return "elevated volume";
  }
  if (ratio <= 0.7) {
    return "below-average volume";
  }
  return "normal volume";
}

async function loadBars(
  symbol: string,
  interval: IndicatorInterval,
): Promise<{ bars: Array<{ close: number; volume: number }>; source: string; warnings: string[] }> {
  const { period, barInterval } = intervalToChart(interval);
  const finnhub = await fetchFinnhubCandles(symbol, period, barInterval);
  if (finnhub.bars.length > 0) {
    return { bars: finnhub.bars, source: "Finnhub", warnings: finnhub.warnings };
  }
  const yahoo = await fetchYahooChart(symbol, period, barInterval);
  return {
    bars: yahoo.bars,
    source: "Yahoo Finance",
    warnings: yahoo.warnings,
  };
}

function computeIndicators(
  bars: Array<{ close: number; volume: number }>,
): TechnicalIndicatorValues {
  const closes = bars.map((bar) => bar.close);
  const lastClose = closes.at(-1) ?? null;
  const rsi14 = rsi(closes, 14);
  const macdValues = macd(closes, 12, 26, 9);
  const bb = bollingerBands(closes, 20, 2);
  const avgVol = averageVolume(
    bars.map((bar) => ({
      date: "",
      open: bar.close,
      high: bar.close,
      low: bar.close,
      close: bar.close,
      volume: bar.volume,
    })),
    20,
  );
  const lastVolume = bars.at(-1)?.volume ?? null;
  const volumeRatio20Day =
    avgVol != null && lastVolume != null && avgVol > 0
      ? Number((lastVolume / avgVol).toFixed(2))
      : null;

  return {
    rsi14,
    rsiInterpretation: interpretRsi(rsi14),
    macd: {
      value: macdValues.macd,
      signal: macdValues.signal,
      histogram: macdValues.histogram,
      interpretation: interpretMacd(
        macdValues.macd,
        macdValues.signal,
        macdValues.histogram,
      ),
    },
    bollingerBands: {
      upper: bb.upper,
      mid: bb.mid,
      lower: bb.lower,
      interpretation:
        lastClose != null
          ? interpretBollinger(lastClose, bb.upper, bb.mid, bb.lower)
          : "insufficient data",
    },
    volumeRatio20Day,
    volumeInterpretation: interpretVolume(volumeRatio20Day),
  };
}

/**
 * RSI, MACD, Bollinger Bands, and volume ratio for a symbol.
 */
export async function getTechnicalIndicators(
  symbol: string,
  interval: IndicatorInterval,
): Promise<TechnicalIndicatorsResponse> {
  const upper = symbol.toUpperCase();
  const key = `indicators:${upper}:${interval}`;
  const { data, fromCache, cachedAt } = await getCachedWithMeta(
    key,
    CACHE_TTL.MARKET_DATA_MS,
    async () => {
      const { bars, source, warnings } = await loadBars(upper, interval);
      if (bars.length < 30) {
        warnings.push(`Limited bar history for ${upper} (${bars.length} bars)`);
      }
      return {
        source,
        warnings,
        indicators: computeIndicators(bars),
      };
    },
  );

  return {
    timestamp: new Date().toISOString(),
    source: data.source,
    dataFreshness: fromCache ? "cached" : "fresh",
    warnings: data.warnings,
    cached: fromCache,
    cachedAt,
    symbol: upper,
    interval,
    indicators: data.indicators,
  };
}
