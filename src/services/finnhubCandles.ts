import { safeFetchJson } from "./http.js";
import { isFinnhubEnabled } from "./finnhub.js";
import type { OhlcvBar, PriceInterval, PricePeriod } from "../types/marketResearch.js";

interface FinnhubCandleResponse {
  c?: number[];
  h?: number[];
  l?: number[];
  o?: number[];
  s?: string;
  t?: number[];
  v?: number[];
}

const PERIOD_SECONDS: Record<PricePeriod, number> = {
  "1d": 86_400,
  "5d": 5 * 86_400,
  "1mo": 30 * 86_400,
  "3mo": 90 * 86_400,
  "6mo": 180 * 86_400,
  "1y": 365 * 86_400,
};

const INTERVAL_RESOLUTION: Record<PriceInterval, string> = {
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "1d": "D",
};

function toBars(data: FinnhubCandleResponse): OhlcvBar[] {
  if (data.s !== "ok" || !data.t?.length) {
    return [];
  }
  const bars: OhlcvBar[] = [];
  for (let i = 0; i < data.t.length; i += 1) {
    const open = data.o?.[i];
    const high = data.h?.[i];
    const low = data.l?.[i];
    const close = data.c?.[i];
    const volume = data.v?.[i];
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
      date: new Date(data.t[i]! * 1000).toISOString(),
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
 * Fetch OHLCV candles from Finnhub /stock/candle when API key is configured.
 */
export async function fetchFinnhubCandles(
  symbol: string,
  period: PricePeriod,
  interval: PriceInterval,
): Promise<{ bars: OhlcvBar[]; warnings: string[] }> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token || !isFinnhubEnabled()) {
    return { bars: [], warnings: [] };
  }

  const to = Math.floor(Date.now() / 1000);
  const from = to - PERIOD_SECONDS[period];
  const resolution = INTERVAL_RESOLUTION[interval];
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${token}`;
  const data = await safeFetchJson<FinnhubCandleResponse>(url);
  if (!data) {
    return { bars: [], warnings: [`Finnhub candle unavailable for ${symbol}`] };
  }
  if (data.s === "no_data") {
    return { bars: [], warnings: [`Finnhub returned no data for ${symbol}`] };
  }

  return { bars: toBars(data), warnings: [] };
}
