import { CACHE_TTL, getCachedWithMeta } from "./cache.js";
import { safeFetchJson } from "./http.js";
import { fetchYfinanceOptionsFlow } from "./yfinanceOptions.js";
import type { OptionsFlowItem, OptionsFlowResponse } from "../types/marketResearch.js";

const UNUSUAL_WHALES_BASE = "https://api.unusualwhales.com";

interface UnusualWhalesFlowAlert {
  ticker?: string;
  expiry?: string;
  strike?: number | string;
  type?: string;
  volume?: number;
  open_interest?: number;
  volume_oi_ratio?: number;
  total_premium?: number;
  created_at?: string;
  underlying_price?: number;
  price?: number;
}

export function isUnusualWhalesEnabled(): boolean {
  return Boolean(process.env.UNUSUAL_WHALES_API_TOKEN?.trim());
}

function parseFlowItem(item: UnusualWhalesFlowAlert): OptionsFlowItem | null {
  const symbol = item.ticker?.toUpperCase();
  if (!symbol) {
    return null;
  }

  const typeRaw = (item.type ?? "").toLowerCase();
  const type: "call" | "put" = typeRaw.includes("put") ? "put" : "call";
  const volume = Number(item.volume ?? 0);
  const openInterest = Number(item.open_interest ?? 0);
  const volumeOiRatio =
    item.volume_oi_ratio != null
      ? Number(item.volume_oi_ratio)
      : openInterest > 0
        ? Number((volume / openInterest).toFixed(2))
        : null;
  const premium = Number(item.total_premium ?? item.price ?? 0);
  const unusual = openInterest > 0 && volume >= openInterest * 3;

  const bullish = type === "call";
  return {
    symbol,
    expiration: item.expiry ?? "",
    strike: Number(item.strike ?? 0),
    type,
    volume,
    openInterest,
    volumeOiRatio,
    premium,
    sentiment: bullish ? "bullish" : "bearish",
    timestamp: item.created_at ?? new Date().toISOString(),
    unusual,
  };
}

async function fetchUnusualWhalesFlow(
  symbol: string | undefined,
  minPremium: number,
): Promise<{ flows: OptionsFlowItem[]; warnings: string[] }> {
  const token = process.env.UNUSUAL_WHALES_API_TOKEN?.trim();
  if (!token) {
    return { flows: [], warnings: [] };
  }

  const params = new URLSearchParams({
    min_premium: String(minPremium),
    limit: "50",
  });
  if (symbol) {
    params.set("ticker_symbol", symbol.toUpperCase());
  }

  const url = `${UNUSUAL_WHALES_BASE}/api/option-trades/flow-alerts?${params}`;
  const data = await safeFetchJson<{ data?: UnusualWhalesFlowAlert[] } | UnusualWhalesFlowAlert[]>(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "UW-CLIENT-API-ID": "100001",
      },
    },
  );

  const rows = Array.isArray(data) ? data : (data?.data ?? []);
  const flows = rows
    .map(parseFlowItem)
    .filter((item): item is OptionsFlowItem => item != null);

  return { flows, warnings: [] };
}

const YFINANCE_FALLBACK_NOTE =
  "Unusual activity flagged where volume/OI >= 3x. Powered by yfinance fallback.";

const MARKET_WIDE_YFINANCE_MESSAGE =
  "Market-wide options flow requires UNUSUAL_WHALES_API_TOKEN. yfinance fallback only supports single-symbol lookups.";

/**
 * Unusual options activity from Unusual Whales when configured.
 */
export async function getOptionsFlow(
  symbol: string | undefined,
  minPremium: number,
): Promise<OptionsFlowResponse> {
  const upper = symbol?.toUpperCase() ?? null;
  const key = `options-flow:${upper ?? "market"}:${minPremium}`;

  const { data, fromCache, cachedAt } = await getCachedWithMeta(
    key,
    CACHE_TTL.MARKET_DATA_MS,
    async () => {
      const warnings: string[] = [];

      if (isUnusualWhalesEnabled()) {
        const result = await fetchUnusualWhalesFlow(upper ?? undefined, minPremium);
        warnings.push(...result.warnings);
        if (result.flows.length === 0) {
          warnings.push("No unusual options flow matched the filters");
        }

        return {
          source: "Unusual Whales",
          dataFreshness: "fresh" as const,
          warnings,
          flows: result.flows,
          note: undefined,
        };
      }

      // yfinance fallback — used when UNUSUAL_WHALES_API_TOKEN is not configured
      if (!upper) {
        return {
          source: "yfinance (fallback)",
          dataFreshness: "delayed" as const,
          warnings: [MARKET_WIDE_YFINANCE_MESSAGE],
          flows: [] as OptionsFlowItem[],
          note: MARKET_WIDE_YFINANCE_MESSAGE,
        };
      }

      try {
        const result = await fetchYfinanceOptionsFlow(upper, minPremium);
        return {
          source: "yfinance (fallback)",
          dataFreshness: "delayed" as const,
          warnings: result.warnings,
          flows: result.flows,
          note: YFINANCE_FALLBACK_NOTE,
        };
      } catch (error) {
        return {
          source: "yfinance (fallback)",
          dataFreshness: "delayed" as const,
          warnings: [
            `yfinance options fetch failed for ${upper}: ${error instanceof Error ? error.message : String(error)}`,
          ],
          flows: [] as OptionsFlowItem[],
          note: YFINANCE_FALLBACK_NOTE,
        };
      }
    },
  );

  return {
    timestamp: new Date().toISOString(),
    source: data.source,
    dataFreshness: fromCache ? "cached" : data.dataFreshness,
    warnings: data.warnings,
    cached: fromCache,
    cachedAt,
    symbol: upper,
    minPremium,
    flows: data.flows,
    note: data.note,
  };
}
