import { withYahooThrottle, YAHOO_SPARK_HEADERS } from "./yahooSpark.js";
import {
  isYahooRateLimited,
  markYahooRateLimited,
} from "../utils/yahooRateLimit.js";
import { logger } from "../utils/logger.js";
import type { OptionsFlowItem } from "../types/marketResearch.js";

interface YahooOptionContract {
  strike?: number;
  openInterest?: number;
  volume?: number;
  ask?: number;
}

interface YahooOptionsResult {
  expirationDates?: number[];
  options?: Array<{
    expirationDate?: number;
    calls?: YahooOptionContract[];
    puts?: YahooOptionContract[];
  }>;
}

interface YahooOptionsResponse {
  optionChain?: {
    result?: YahooOptionsResult[];
    error?: { description?: string };
  };
}

const MAX_EXPIRATIONS = 4;
const MAX_RESULTS = 20;

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatExpiration(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function contractToFlowItem(
  symbol: string,
  expiration: string,
  type: "call" | "put",
  contract: YahooOptionContract,
  minPremium: number,
): OptionsFlowItem | null {
  const volume = contract.volume;
  const openInterest = contract.openInterest;
  const ask = contract.ask;
  const strike = contract.strike;

  if (
    !isValidNumber(volume) ||
    volume <= 0 ||
    !isValidNumber(openInterest) ||
    openInterest <= 0 ||
    !isValidNumber(strike) ||
    !isValidNumber(ask)
  ) {
    return null;
  }

  const premium = Math.round(volume * ask * 100);
  if (premium < minPremium) {
    return null;
  }

  const volumeOiRatio = Number((volume / openInterest).toFixed(2));
  const unusual = volumeOiRatio >= 3;

  return {
    symbol,
    expiration,
    strike: Number(strike.toFixed(4)),
    type,
    volume: Math.round(volume),
    openInterest: Math.round(openInterest),
    volumeOiRatio,
    ask: Number(ask.toFixed(4)),
    premium,
    sentiment: type === "call" ? "bullish" : "bearish",
    timestamp: new Date().toISOString(),
    unusual,
    source: "yfinance",
  };
}

async function fetchOptionsChain(
  symbol: string,
  expirationTs?: number,
): Promise<YahooOptionsResult | null> {
  if (isYahooRateLimited()) {
    return null;
  }

  const dateParam = expirationTs != null ? `?date=${expirationTs}` : "";
  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}${dateParam}`;

  const response = await withYahooThrottle(() =>
    fetch(url, { headers: YAHOO_SPARK_HEADERS }),
  );

  if (response.status === 429) {
    markYahooRateLimited();
    return null;
  }

  if (!response.ok) {
    logger.warn("Yahoo options chain fetch failed", {
      symbol,
      status: response.status,
    });
    return null;
  }

  const data = (await response.json()) as YahooOptionsResponse;
  if (data.optionChain?.error?.description) {
    logger.warn("Yahoo options chain error", {
      symbol,
      error: data.optionChain.error.description,
    });
  }

  return data.optionChain?.result?.[0] ?? null;
}

/**
 * Options chain flow via Yahoo Finance (same data source as the yfinance Python library).
 */
export async function fetchYfinanceOptionsFlow(
  symbol: string,
  minPremium: number,
): Promise<{ flows: OptionsFlowItem[]; warnings: string[] }> {
  const upper = symbol.toUpperCase();
  const warnings: string[] = [
    "Options flow computed from yfinance volume/OI ratios — not real-time institutional flow. 15-min delay. For live unusual activity, set UNUSUAL_WHALES_API_TOKEN.",
  ];

  try {
    const base = await fetchOptionsChain(upper);
    if (!base) {
      warnings.push(`No options chain data returned for ${upper}`);
      return { flows: [], warnings };
    }

    const expirationDates = (base.expirationDates ?? []).slice(0, MAX_EXPIRATIONS);
    if (expirationDates.length === 0) {
      warnings.push(`No option expirations found for ${upper}`);
      return { flows: [], warnings };
    }

    const candidates: OptionsFlowItem[] = [];

    for (const expirationTs of expirationDates) {
      const chain =
        expirationTs === expirationDates[0] && base.options?.[0]
          ? base
          : await fetchOptionsChain(upper, expirationTs);
      const optionsBlock = chain?.options?.[0];
      if (!optionsBlock) {
        continue;
      }

      const expiration = formatExpiration(
        optionsBlock.expirationDate ?? expirationTs,
      );

      for (const call of optionsBlock.calls ?? []) {
        const item = contractToFlowItem(upper, expiration, "call", call, minPremium);
        if (item) {
          candidates.push(item);
        }
      }

      for (const put of optionsBlock.puts ?? []) {
        const item = contractToFlowItem(upper, expiration, "put", put, minPremium);
        if (item) {
          candidates.push(item);
        }
      }
    }

    const flows = candidates
      .sort((a, b) => b.premium - a.premium)
      .slice(0, MAX_RESULTS);

    if (flows.length === 0) {
      warnings.push(
        `No contracts met minPremium ${minPremium} with valid volume and open interest for ${upper}`,
      );
    }

    return { flows, warnings };
  } catch (error) {
    warnings.push(
      `yfinance options fetch failed for ${upper}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { flows: [], warnings };
  }
}
