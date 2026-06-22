import { safeFetchJson } from "./http.js";
import type { YahooQuote } from "../types/market.js";
import { finalizeQuote } from "../utils/quoteValidation.js";

interface FinnhubQuoteResponse {
  c?: number;
  d?: number;
  dp?: number;
  pc?: number;
  t?: number;
}

export function isFinnhubEnabled(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

export async function fetchFinnhubQuote(symbol: string): Promise<YahooQuote | null> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    return null;
  }

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`;
  const data = await safeFetchJson<FinnhubQuoteResponse>(url);
  if (!data || data.c == null || data.c === 0) {
    return null;
  }

  const price = Number(data.c.toFixed(4));
  const change = data.d != null ? Number(data.d.toFixed(4)) : null;
  const changePercent = data.dp != null ? Number(data.dp.toFixed(4)) : null;
  const previousClose = data.pc != null ? Number(data.pc.toFixed(4)) : null;
  const finnhubAsOf =
    data.t != null ? new Date(data.t * 1000).toISOString() : null;

  return finalizeQuote({
    symbol: symbol.toUpperCase(),
    price,
    change,
    changePercent,
    previousClose,
    preMarketPrice: null,
    preMarketChangePercent: changePercent,
    volume: null,
    shortName: symbol.toUpperCase(),
    source: "Finnhub",
    asOf: finnhubAsOf,
    isDelayed: false,
    multiSourceAgree: false,
    fallbackOnly: false,
    providerTimestamps: {
      finnhub: {
        iso: finnhubAsOf,
        rawField: "t",
        rawValue: data.t != null ? String(data.t) : undefined,
      },
    },
  });
}

export async function fetchFinnhubQuotes(
  symbols: string[],
): Promise<Map<string, YahooQuote>> {
  const map = new Map<string, YahooQuote>();
  if (!isFinnhubEnabled()) {
    return map;
  }

  await Promise.all(
    symbols.map(async (symbol) => {
      const quote = await fetchFinnhubQuote(symbol);
      if (quote) {
        map.set(symbol.toUpperCase(), quote);
      }
    }),
  );

  return map;
}
