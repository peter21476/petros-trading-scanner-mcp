import { CACHE_TTL, getCachedWithMeta } from "./cache.js";
import { safeFetchJson } from "./http.js";
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

const NO_API_NOTE =
  "Options flow requires UNUSUAL_WHALES_API_TOKEN (paid Unusual Whales API). Set the env var to enable live unusual activity; otherwise this tool returns an empty flows array.";

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
      if (!isUnusualWhalesEnabled()) {
        return {
          source: "none",
          warnings: [NO_API_NOTE],
          flows: [] as OptionsFlowItem[],
          note: NO_API_NOTE,
        };
      }

      const result = await fetchUnusualWhalesFlow(upper ?? undefined, minPremium);
      warnings.push(...result.warnings);
      if (result.flows.length === 0) {
        warnings.push("No unusual options flow matched the filters");
      }

      return {
        source: "Unusual Whales",
        warnings,
        flows: result.flows,
        note: undefined,
      };
    },
  );

  return {
    timestamp: new Date().toISOString(),
    source: data.source,
    dataFreshness: fromCache ? "cached" : data.source === "none" ? "delayed" : "fresh",
    warnings: data.warnings,
    cached: fromCache,
    cachedAt,
    symbol: upper,
    minPremium,
    flows: data.flows,
    note: data.note,
  };
}
