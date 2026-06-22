import { safeFetchJson } from "./http.js";
import type { YahooQuote } from "../types/market.js";
import { parseNumber, parsePercent } from "../utils/parseNumber.js";
import { finalizeQuote } from "../utils/quoteValidation.js";

const ALPHA_VANTAGE_DELAY_MS = 1200;

interface AlphaVantageGlobalQuoteResponse {
  "Global Quote"?: Record<string, string>;
  Note?: string;
  Information?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAlphaVantageEnabled(): boolean {
  return Boolean(process.env.ALPHA_VANTAGE_API_KEY?.trim());
}

export async function fetchAlphaVantageQuote(
  symbol: string,
): Promise<YahooQuote | null> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const data = await safeFetchJson<AlphaVantageGlobalQuoteResponse>(url);
  if (data?.Note || data?.Information) {
    return null;
  }

  const gq = data?.["Global Quote"];
  if (!gq) {
    return null;
  }

  const price = parseNumber(gq["05. price"]);
  const change = parseNumber(gq["09. change"]);
  const changePercent = parsePercent(gq["10. change percent"]);
  const previousClose = parseNumber(gq["08. previous close"]);

  if (price == null) {
    return null;
  }

  return finalizeQuote({
    symbol: symbol.toUpperCase(),
    price,
    change,
    changePercent,
    previousClose,
    preMarketPrice: null,
    preMarketChangePercent: changePercent,
    volume: parseNumber(gq["06. volume"]),
    shortName: gq["01. symbol"] ?? symbol.toUpperCase(),
    source: "Alpha Vantage",
    asOf: null,
    isDelayed: false,
    multiSourceAgree: false,
    fallbackOnly: false,
  });
}

export async function fetchAlphaVantageQuotes(
  symbols: string[],
): Promise<Map<string, YahooQuote>> {
  const map = new Map<string, YahooQuote>();
  if (!isAlphaVantageEnabled()) {
    return map;
  }

  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index]!;
    const quote = await fetchAlphaVantageQuote(symbol);
    if (quote) {
      map.set(symbol.toUpperCase(), quote);
    }
    if (index < symbols.length - 1) {
      await delay(ALPHA_VANTAGE_DELAY_MS);
    }
  }

  return map;
}
