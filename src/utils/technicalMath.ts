import type { OhlcvBar } from "../types/marketResearch.js";

/** Simple moving average over the last `period` closes. */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) {
    return null;
  }
  const slice = closes.slice(-period);
  return Number((slice.reduce((sum, value) => sum + value, 0) / period).toFixed(4));
}

/** Exponential moving average seeded with SMA. */
export function ema(closes: number[], period: number): number[] {
  if (closes.length === 0) {
    return [];
  }
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = closes.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = 0; i < closes.length; i += 1) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (i === period - 1) {
      prev = closes.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    } else {
      prev = closes[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

/** 14-period RSI (Wilder smoothing). */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) {
    return null;
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i]! - closes[i - 1]!;
    if (change >= 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export interface MacdResult {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

/** MACD (12/26/9). */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: null, signal: null, histogram: null };
  }

  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const fast = fastEma[i];
    const slow = slowEma[i];
    if (Number.isNaN(fast) || Number.isNaN(slow)) {
      macdLine.push(NaN);
    } else {
      macdLine.push(fast! - slow!);
    }
  }

  const validMacd = macdLine.filter((value) => !Number.isNaN(value));
  const signalEma = ema(validMacd, signalPeriod);
  const macdValue = validMacd.at(-1) ?? null;
  const signalValue = signalEma.at(-1) ?? null;
  if (macdValue == null || signalValue == null || Number.isNaN(signalValue)) {
    return { macd: null, signal: null, histogram: null };
  }

  return {
    macd: Number(macdValue.toFixed(4)),
    signal: Number(signalValue.toFixed(4)),
    histogram: Number((macdValue - signalValue).toFixed(4)),
  };
}

export interface BollingerResult {
  upper: number | null;
  mid: number | null;
  lower: number | null;
}

/** Bollinger Bands (20-period, 2 std dev). */
export function bollingerBands(closes: number[], period = 20, stdDev = 2): BollingerResult {
  if (closes.length < period) {
    return { upper: null, mid: null, lower: null };
  }
  const slice = closes.slice(-period);
  const mid = slice.reduce((sum, value) => sum + value, 0) / period;
  const variance =
    slice.reduce((sum, value) => sum + (value - mid) ** 2, 0) / period;
  const deviation = Math.sqrt(variance);
  return {
    mid: Number(mid.toFixed(4)),
    upper: Number((mid + stdDev * deviation).toFixed(4)),
    lower: Number((mid - stdDev * deviation).toFixed(4)),
  };
}

export function distancePercent(price: number, reference: number): number | null {
  if (reference === 0) {
    return null;
  }
  return Number((((price - reference) / reference) * 100).toFixed(4));
}

export function computePriceMetrics(
  dailyBars: OhlcvBar[],
  lastClose: number,
): {
  sma20: number | null;
  sma50: number | null;
  distanceFromSma20Percent: number | null;
  distanceFromSma50Percent: number | null;
  week52High: number | null;
  week52Low: number | null;
  distanceFrom52WeekHighPercent: number | null;
  distanceFrom52WeekLowPercent: number | null;
} {
  const closes = dailyBars.map((bar) => bar.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const yearBars = dailyBars.slice(-252);
  const highs = yearBars.map((bar) => bar.high);
  const lows = yearBars.map((bar) => bar.low);
  const week52High = highs.length > 0 ? Math.max(...highs) : null;
  const week52Low = lows.length > 0 ? Math.min(...lows) : null;

  return {
    sma20,
    sma50,
    distanceFromSma20Percent: sma20 != null ? distancePercent(lastClose, sma20) : null,
    distanceFromSma50Percent: sma50 != null ? distancePercent(lastClose, sma50) : null,
    week52High,
    week52Low,
    distanceFrom52WeekHighPercent:
      week52High != null ? distancePercent(lastClose, week52High) : null,
    distanceFrom52WeekLowPercent:
      week52Low != null ? distancePercent(lastClose, week52Low) : null,
  };
}

export function averageVolume(bars: OhlcvBar[], period = 20): number | null {
  if (bars.length < period) {
    return null;
  }
  const slice = bars.slice(-period);
  return slice.reduce((sum, bar) => sum + bar.volume, 0) / period;
}
