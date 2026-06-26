import { safeFetchJson } from "./http.js";
import { logger } from "../utils/logger.js";

const ROBINHOOD_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface RobinhoodChainResult {
  id?: string;
  symbol?: string;
  expiration_dates?: string[];
}

interface RobinhoodChainsResponse {
  results?: RobinhoodChainResult[];
}

/**
 * Public Robinhood options chain metadata (expirations only — no volume/OI without broker auth).
 */
export async function fetchRobinhoodOptionExpirations(
  symbol: string,
): Promise<{ expirations: string[]; chainId: string | null; warnings: string[] }> {
  const upper = symbol.toUpperCase();
  const url = `https://api.robinhood.com/options/chains/?equity_symbol=${encodeURIComponent(upper)}`;
  const data = await safeFetchJson<RobinhoodChainsResponse>(url, {
    headers: {
      "User-Agent": ROBINHOOD_UA,
      Accept: "application/json",
    },
  });

  if (!data?.results?.length) {
    return {
      expirations: [],
      chainId: null,
      warnings: [`Robinhood options chain unavailable for ${upper}`],
    };
  }

  const chain = data.results[0]!;
  const expirations = (chain.expiration_dates ?? []).slice(0, 4);
  logger.info("[options_flow] Robinhood expirations fallback", {
    symbol: upper,
    chainId: chain.id,
    expirations,
  });

  return {
    expirations,
    chainId: chain.id ?? null,
    warnings: [],
  };
}

/** Convert YYYY-MM-DD to Yahoo options `date` unix seconds (UTC midnight). */
export function expirationDateToUnix(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}
