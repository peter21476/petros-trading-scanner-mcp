import { withYahooThrottle } from "./yahooSpark.js";
import {
  isYahooRateLimited,
  markYahooRateLimited,
} from "../utils/yahooRateLimit.js";
import { logger } from "../utils/logger.js";
import {
  expirationDateToUnix,
  fetchRobinhoodOptionExpirations,
} from "./robinhoodOptions.js";
import {
  clearYahooAuthCache,
  getYahooAuth,
  YAHOO_OPTIONS_USER_AGENT,
  yahooAuthenticatedGet,
} from "./yahooCrumb.js";
import type { OptionsFlowItem } from "../types/marketResearch.js";

interface YahooOptionContract {
  strike?: number;
  openInterest?: number;
  volume?: number;
  ask?: number;
  bid?: number;
  lastPrice?: number;
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

const YAHOO_OPTIONS_HOSTS = [
  "query2.finance.yahoo.com",
  "query1.finance.yahoo.com",
] as const;

const MAX_EXPIRATIONS = 4;
const MAX_RESULTS = 20;

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatExpiration(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function contractPrice(contract: YahooOptionContract): number | null {
  if (isValidNumber(contract.ask) && contract.ask > 0) {
    return contract.ask;
  }
  if (isValidNumber(contract.lastPrice) && contract.lastPrice > 0) {
    return contract.lastPrice;
  }
  if (
    isValidNumber(contract.bid) &&
    isValidNumber(contract.ask) &&
    contract.bid > 0 &&
    contract.ask > 0
  ) {
    return (contract.bid + contract.ask) / 2;
  }
  if (isValidNumber(contract.bid) && contract.bid > 0) {
    return contract.bid;
  }
  return null;
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
  const price = contractPrice(contract);
  const strike = contract.strike;

  if (
    !isValidNumber(volume) ||
    volume <= 0 ||
    !isValidNumber(openInterest) ||
    openInterest <= 0 ||
    !isValidNumber(strike) ||
    price == null
  ) {
    return null;
  }

  const premium = Math.round(volume * price * 100);
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
    ask: Number(price.toFixed(4)),
    premium,
    sentiment: type === "call" ? "bullish" : "bearish",
    timestamp: new Date().toISOString(),
    unusual,
    source: "yfinance",
  };
}

function parseOptionsResponse(data: YahooOptionsResponse): YahooOptionsResult | null {
  if (data.optionChain?.error?.description) {
    logger.warn("Yahoo options chain error", {
      error: data.optionChain.error.description,
    });
  }
  return data.optionChain?.result?.[0] ?? null;
}

async function fetchOptionsChainOnce(
  symbol: string,
  host: (typeof YAHOO_OPTIONS_HOSTS)[number],
  expirationTs?: number,
): Promise<YahooOptionsResult | null> {
  const auth = await getYahooAuth();
  if (!auth) {
    return null;
  }

  const dateParam = expirationTs != null ? `&date=${expirationTs}` : "";
  const url = `https://${host}/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(auth.crumb)}${dateParam}`;

  const response = await withYahooThrottle(() =>
    yahooAuthenticatedGet(url, symbol),
  );

  if (!response) {
    return null;
  }

  if (response.status === 429) {
    markYahooRateLimited();
    return null;
  }

  if (response.status === 401) {
    clearYahooAuthCache();
    logger.warn("Yahoo options unauthorized — invalid cookie/crumb", {
      symbol,
      host,
    });
    return null;
  }

  if (!response.ok) {
    logger.warn("Yahoo options chain HTTP error", {
      symbol,
      host,
      status: response.status,
    });
    return null;
  }

  const data = (await response.json()) as YahooOptionsResponse;
  return parseOptionsResponse(data);
}

async function fetchOptionsChain(
  symbol: string,
  expirationTs?: number,
): Promise<YahooOptionsResult | null> {
  if (isYahooRateLimited()) {
    logger.warn("[options_flow] Yahoo rate-limited — skipping options fetch", { symbol });
    return null;
  }

  for (const host of YAHOO_OPTIONS_HOSTS) {
    const result = await fetchOptionsChainOnce(symbol, host, expirationTs);
    if (result) {
      return result;
    }
  }

  return null;
}

function expirationStringsToUnix(dates: string[]): number[] {
  return dates.map(expirationDateToUnix);
}

function collectCandidates(
  symbol: string,
  chain: YahooOptionsResult,
  expirationTs: number,
  minPremium: number,
): OptionsFlowItem[] {
  const optionsBlock = chain.options?.[0];
  if (!optionsBlock) {
    return [];
  }

  const expiration = formatExpiration(optionsBlock.expirationDate ?? expirationTs);
  const items: OptionsFlowItem[] = [];

  for (const call of optionsBlock.calls ?? []) {
    const item = contractToFlowItem(symbol, expiration, "call", call, minPremium);
    if (item) {
      items.push(item);
    }
  }

  for (const put of optionsBlock.puts ?? []) {
    const item = contractToFlowItem(symbol, expiration, "put", put, minPremium);
    if (item) {
      items.push(item);
    }
  }

  return items;
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
    logger.info("[options_flow] fetching Yahoo options chain", {
      symbol: upper,
      userAgent: YAHOO_OPTIONS_USER_AGENT.slice(0, 40),
    });

    const base = await fetchOptionsChain(upper);
    let expirationDates = (base?.expirationDates ?? []).slice(0, MAX_EXPIRATIONS);

    logger.info(`[options_flow] ${upper} expirations from yfinance`, {
      symbol: upper,
      expirations: expirationDates.map(formatExpiration),
      count: expirationDates.length,
    });

    if (expirationDates.length === 0) {
      const robinhood = await fetchRobinhoodOptionExpirations(upper);
      warnings.push(...robinhood.warnings);
      if (robinhood.expirations.length > 0) {
        expirationDates = expirationStringsToUnix(robinhood.expirations);
        warnings.push(
          `Yahoo returned no expirations; using Robinhood chain dates for ${upper}`,
        );
        logger.info(`[options_flow] ${upper} expirations from Robinhood fallback`, {
          expirations: robinhood.expirations,
        });
      } else {
        warnings.push(`No option expirations found for ${upper}`);
        return { flows: [], warnings };
      }
    }

    const candidates: OptionsFlowItem[] = [];

    for (const expirationTs of expirationDates) {
      const chain =
        base?.expirationDates?.[0] === expirationTs && base.options?.[0]
          ? base
          : await fetchOptionsChain(upper, expirationTs);
      if (!chain) {
        warnings.push(
          `Failed to load options chain for ${upper} expiry ${formatExpiration(expirationTs)}`,
        );
        continue;
      }

      candidates.push(...collectCandidates(upper, chain, expirationTs, minPremium));
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
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[options_flow] yfinance fetch failed", { symbol: upper, error: message });
    warnings.push(`yfinance options fetch failed for ${upper}: ${message}`);
    return { flows: [], warnings };
  }
}
