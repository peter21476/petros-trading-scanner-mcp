import { CACHE_TTL, getCachedWithMeta } from "./cache.js";
import { fetchYahooChart } from "./yahooChart.js";
import { fetchQuotes } from "./quotes.js";
import { averageVolume } from "../utils/technicalMath.js";
import type { SectorRotationItem, SectorRotationResponse } from "../types/marketResearch.js";

export const SECTOR_ETFS: Record<string, string> = {
  XLK: "Technology",
  XLF: "Financials",
  XLV: "Healthcare",
  XLE: "Energy",
  XLI: "Industrials",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLU: "Utilities",
  XLRE: "Real Estate",
  XLB: "Materials",
  XLC: "Communication Services",
};

const DEFENSIVE_SECTORS = new Set(["Utilities", "Healthcare", "Consumer Staples"]);

function sectorBias(
  changePercent: number | null,
  volumeRatio: number | null,
): "bullish" | "neutral" | "bearish" {
  if (changePercent == null) {
    return "neutral";
  }
  const elevatedVolume = (volumeRatio ?? 1) >= 1.1;
  if (changePercent >= 0.35 || (changePercent > 0.1 && elevatedVolume)) {
    return "bullish";
  }
  if (changePercent <= -0.35 || (changePercent < -0.1 && elevatedVolume)) {
    return "bearish";
  }
  return "neutral";
}

function buildRotationTheme(sectors: SectorRotationItem[]): string {
  const ranked = [...sectors].sort(
    (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity),
  );
  const leaders = ranked.slice(0, 2).map((item) => item.name);
  const laggards = ranked.slice(-2).map((item) => item.name);
  const defensiveLeading =
    leaders.filter((name) => DEFENSIVE_SECTORS.has(name)).length >= 2;
  const cyclicalLeading = leaders.some((name) =>
    ["Technology", "Consumer Discretionary", "Financials", "Energy"].includes(name),
  );

  if (defensiveLeading) {
    return `Defensive rotation: ${leaders.join(" and ")} leading, ${laggards.join(" and ")} lagging`;
  }
  if (cyclicalLeading) {
    return `Risk-on rotation: ${leaders.join(" and ")} leading, ${laggards.join(" and ")} lagging`;
  }
  return `Mixed rotation: ${leaders.join(" and ")} leading, ${laggards.join(" and ")} lagging`;
}

/**
 * Today's S&P 500 sector ETF performance sorted by change %.
 */
export async function getSectorRotation(): Promise<SectorRotationResponse> {
  const { data, fromCache, cachedAt } = await getCachedWithMeta(
    "sector-rotation",
    CACHE_TTL.MARKET_DATA_MS,
    async () => {
      const warnings: string[] = [];
      const etfs = Object.keys(SECTOR_ETFS);
      const { quotes } = await fetchQuotes(etfs);
      const sectors: SectorRotationItem[] = [];

      for (const etf of etfs) {
        const quote = quotes.get(etf);
        const changePercent = quote?.changePercent ?? null;
        let volumeRatio: number | null = null;

        const chart = await fetchYahooChart(etf, "1mo", "1d");
        warnings.push(...chart.warnings);
        const avgVol = averageVolume(chart.bars, 20);
        const todayVol = chart.bars.at(-1)?.volume ?? quote?.volume ?? null;
        if (avgVol != null && todayVol != null && avgVol > 0) {
          volumeRatio = Number((todayVol / avgVol).toFixed(2));
        }

        sectors.push({
          name: SECTOR_ETFS[etf]!,
          etf,
          changePercent,
          volumeRatio,
          bias: sectorBias(changePercent, volumeRatio),
        });
      }

      sectors.sort(
        (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity),
      );

      const quoteSources = [...quotes.values()].map((quote) => quote.source);
      const source = quoteSources.includes("Finnhub")
        ? "Finnhub + Yahoo Finance"
        : "Yahoo Finance";

      return {
        source,
        warnings,
        sectors,
        rotationTheme: buildRotationTheme(sectors),
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
    sectors: data.sectors,
    rotationTheme: data.rotationTheme,
  };
}
