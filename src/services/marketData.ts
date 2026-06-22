import { CACHE_TTL, getCached } from "./cache.js";
import { fetchFinvizEarnings, fetchFinvizHomepage, safeFetchFinvizHomepage } from "./finviz.js";
import {
  fetchMarketWatchPremarket,
  finvizMoversToPremarket,
  snapshotToMover,
} from "./marketwatch.js";
import {
  buildSectorNotes,
  buildSuggestedQuestions,
  computeMarketBias,
  computeSemiconductorStrength,
  scoreWatchlistSymbol,
} from "./scoring.js";
import { fetchYahooFutures, fetchYahooNewsHeadline, fetchYahooQuotes } from "./yahoo.js";
import {
  emptyBreadth,
  emptyFutures,
  SEMICONDUCTOR_SYMBOLS,
  type DailyBriefingResponse,
  type EarningsCalendarResponse,
  type FinvizSnapshotResponse,
  type FuturesResponse,
  type MarketBreadthResponse,
  type PremarketMoversResponse,
  type WatchlistSignalsResponse,
} from "../types/market.js";

function mergeFutures(
  primary: FuturesResponse["futures"],
  fallback: FuturesResponse["futures"],
): FuturesResponse["futures"] {
  const merged = { ...primary };
  for (const key of Object.keys(merged) as Array<keyof FuturesResponse["futures"]>) {
    const current = merged[key];
    const alt = fallback[key];
    if (current?.last == null && alt?.last != null) {
      merged[key] = alt;
    }
  }
  return merged;
}

function hasAnyFuturesData(futures: FuturesResponse["futures"]): boolean {
  return Object.values(futures).some((quote) => quote.last != null);
}

export async function getFutures(): Promise<FuturesResponse> {
  return getCached("tool:futures", CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    let source = "Finviz";
    let futures = emptyFutures();

    const finviz = await safeFetchFinvizHomepage();
    if (finviz.warning) {
      warnings.push(finviz.warning);
    }
    if (finviz.data) {
      futures = finviz.data.futures;
    }

    if (!hasAnyFuturesData(futures)) {
      const yahoo = await fetchYahooFutures();
      futures = mergeFutures(futures, yahoo.futures);
      warnings.push(...yahoo.warnings);
      source = finviz.data ? "Finviz + Yahoo Finance" : "Yahoo Finance";
    }

    if (!hasAnyFuturesData(futures)) {
      warnings.push("Futures data may be delayed or unavailable from all sources");
    } else {
      warnings.push("Quotes may be delayed; verify before trading decisions");
    }

    return {
      timestamp: new Date().toISOString(),
      source,
      warnings,
      futures,
    };
  });
}

export async function getPremarketMovers(limit = 20): Promise<PremarketMoversResponse> {
  return getCached(`tool:premarket:${limit}`, CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const marketWatch = await fetchMarketWatchPremarket(limit);

    if (marketWatch.warning) {
      warnings.push(marketWatch.warning);
    }

    if (
      marketWatch.leaders.length > 0 ||
      marketWatch.laggards.length > 0 ||
      marketWatch.mostActive.length > 0
    ) {
      return {
        timestamp: new Date().toISOString(),
        source: "MarketWatch",
        warnings,
        leaders: marketWatch.leaders,
        laggards: marketWatch.laggards,
        mostActive: marketWatch.mostActive,
      };
    }

    const finviz = await safeFetchFinvizHomepage();
    if (finviz.warning) {
      warnings.push(finviz.warning);
    }

    const gainers = (finviz.data?.topGainers ?? []).map(snapshotToMover);
    const losers = (finviz.data?.topLosers ?? []).map(snapshotToMover);
    const active = (finviz.data?.unusualVolume ?? []).map(snapshotToMover);

    const fallback = finvizMoversToPremarket(gainers, losers, active, limit);
    warnings.push(
      "Using Finviz top movers/unusual volume as premarket fallback (MarketWatch unavailable)",
    );

    return {
      timestamp: new Date().toISOString(),
      source: "Finviz (fallback)",
      warnings,
      ...fallback,
    };
  });
}

export async function getMarketBreadth(): Promise<MarketBreadthResponse> {
  return getCached("tool:breadth", CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const finviz = await safeFetchFinvizHomepage();

    if (finviz.warning) {
      warnings.push(finviz.warning);
    }

    const breadth = finviz.data?.breadth ?? emptyBreadth();
    if (breadth.advancingPercent == null) {
      warnings.push("Market breadth data incomplete from Finviz");
    }

    return {
      timestamp: new Date().toISOString(),
      source: "Finviz",
      warnings,
      breadth,
    };
  });
}

export async function getFinvizSnapshot(): Promise<FinvizSnapshotResponse> {
  return getCached("tool:snapshot", CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const finviz = await safeFetchFinvizHomepage();

    if (finviz.warning) {
      warnings.push(finviz.warning);
    }

    if (!finviz.data) {
      warnings.push("Finviz snapshot unavailable");
      return {
        timestamp: new Date().toISOString(),
        source: "Finviz",
        warnings,
        topGainers: [],
        topLosers: [],
        newHighs: [],
        unusualVolume: [],
        majorNews: [],
        headlines: [],
        breadth: emptyBreadth(),
        futures: emptyFutures(),
      };
    }

    return {
      timestamp: new Date().toISOString(),
      source: "Finviz",
      warnings,
      topGainers: finviz.data.topGainers,
      topLosers: finviz.data.topLosers,
      newHighs: finviz.data.newHighs,
      unusualVolume: finviz.data.unusualVolume,
      majorNews: finviz.data.majorNews,
      headlines: finviz.data.headlines,
      breadth: finviz.data.breadth,
      futures: finviz.data.futures,
    };
  });
}

export async function getEarningsCalendar(days = 7): Promise<EarningsCalendarResponse> {
  return getCached(`tool:earnings:${days}`, CACHE_TTL.MARKET_DATA_MS, async () => {
    const { earnings, warnings } = await fetchFinvizEarnings(days);
    return {
      timestamp: new Date().toISOString(),
      source: "Finviz",
      warnings,
      earnings,
    };
  });
}

function finvizListsForSymbol(
  symbol: string,
  snapshot: {
    topGainers: { symbol: string }[];
    topLosers: { symbol: string }[];
    unusualVolume: { symbol: string }[];
    majorNews: { symbol: string }[];
  },
): string[] {
  const upper = symbol.toUpperCase();
  const lists: string[] = [];
  if (snapshot.topGainers.some((s) => s.symbol === upper)) lists.push("topGainers");
  if (snapshot.topLosers.some((s) => s.symbol === upper)) lists.push("topLosers");
  if (snapshot.unusualVolume.some((s) => s.symbol === upper)) lists.push("unusualVolume");
  if (snapshot.majorNews.some((s) => s.symbol === upper)) lists.push("majorNews");
  return lists;
}

export async function getWatchlistSignals(
  symbols: string[],
): Promise<WatchlistSignalsResponse> {
  return getCached(`tool:watchlist:${symbols.join(",")}`, CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const finviz = await safeFetchFinvizHomepage();
    if (finviz.warning) {
      warnings.push(finviz.warning);
    }

    const futuresResult = await getFutures();
    const breadth = finviz.data?.breadth ?? emptyBreadth();
    const marketBias = computeMarketBias(futuresResult.futures, breadth);

    const quoteSymbols = [
      ...new Set([...symbols.map((s) => s.toUpperCase()), ...SEMICONDUCTOR_SYMBOLS]),
    ];
    const quotes = await fetchYahooQuotes(quoteSymbols);
    if (quotes.size === 0) {
      warnings.push("Yahoo Finance quotes unavailable; using Finviz major news where possible");
    }
    const semiconductorStrength = computeSemiconductorStrength(
      quotes,
      finviz.data?.majorNews ?? [],
    );

    const snapshot = {
      topGainers: finviz.data?.topGainers ?? [],
      topLosers: finviz.data?.topLosers ?? [],
      unusualVolume: finviz.data?.unusualVolume ?? [],
      majorNews: finviz.data?.majorNews ?? [],
    };

    const signals = await Promise.all(
      symbols.map(async (symbol) => {
        const upper = symbol.toUpperCase();
        let quote = quotes.get(upper) ?? null;
        const headline = await fetchYahooNewsHeadline(upper);
        const finvizLists = finvizListsForSymbol(upper, snapshot);
        const majorNewsItem = snapshot.majorNews.find((item) => item.symbol === upper);

        if (!quote && majorNewsItem?.changePercent != null) {
          quote = {
            symbol: upper,
            price: majorNewsItem.price ?? null,
            change: null,
            changePercent: majorNewsItem.changePercent,
            preMarketPrice: null,
            preMarketChangePercent: majorNewsItem.changePercent,
            volume: majorNewsItem.volume ?? null,
            shortName: majorNewsItem.name ?? upper,
          };
        }

        return scoreWatchlistSymbol({
          symbol: upper,
          quote,
          finvizLists,
          headline,
          marketBias,
          semiconductorStrength,
          nasdaqFuturesChange: futuresResult.futures.nasdaq100.changePercent,
        });
      }),
    );

    return {
      timestamp: new Date().toISOString(),
      warnings,
      signals,
    };
  });
}

export async function getDailyBriefing(input: {
  focusSymbols: string[];
  portfolioContext?: string;
}): Promise<DailyBriefingResponse> {
  const cacheKey = `tool:briefing:${input.focusSymbols.join(",")}:${input.portfolioContext ?? ""}`;
  return getCached(cacheKey, CACHE_TTL.DAILY_REPORT_MS, async () => {
    const warnings: string[] = [];

    const [futuresResult, premarket, breadthResult, finviz, watchlistSignals] =
      await Promise.all([
        getFutures(),
        getPremarketMovers(15),
        getMarketBreadth(),
        safeFetchFinvizHomepage(),
        getWatchlistSignals(input.focusSymbols),
      ]);

    warnings.push(...(futuresResult.warnings ?? []));
    warnings.push(...(premarket.warnings ?? []));
    warnings.push(...(breadthResult.warnings ?? []));
    if (finviz.warning) warnings.push(finviz.warning);
    warnings.push(...(watchlistSignals.warnings ?? []));

    const quotes = await fetchYahooQuotes([...SEMICONDUCTOR_SYMBOLS]);
    const semiconductorStrength = computeSemiconductorStrength(
      quotes,
      finviz.data?.majorNews ?? [],
    );
    const marketBiasResult = computeMarketBias(
      futuresResult.futures,
      breadthResult.breadth,
    );

    const keyDrivers: string[] = [];
    if (finviz.data?.marketSummaryHeadline) {
      keyDrivers.push(finviz.data.marketSummaryHeadline);
    }
    if (premarket.leaders[0]) {
      keyDrivers.push(
        `Premarket leader: ${premarket.leaders[0].symbol} (${premarket.leaders[0].changePercent ?? "n/a"}%)`,
      );
    }
    if (futuresResult.futures.crudeOil.changePercent != null) {
      keyDrivers.push(
        `Crude oil futures ${futuresResult.futures.crudeOil.changePercent >= 0 ? "+" : ""}${futuresResult.futures.crudeOil.changePercent.toFixed(2)}%`,
      );
    }
    if (finviz.data?.headlines[0]?.title) {
      keyDrivers.push(finviz.data.headlines[0].title);
    }

    const risks: string[] = [
      "Data is for research only; quotes may be delayed.",
      "Leveraged ETFs (e.g. SOXL) carry elevated volatility risk.",
    ];
    if (marketBiasResult.bias === "bearish") {
      risks.push("Bearish futures/breadth backdrop may increase downside volatility.");
    }
    if (input.portfolioContext) {
      risks.push(`Portfolio context noted: ${input.portfolioContext}`);
    }

    const summaryParts = [
      `Market bias is ${marketBiasResult.bias}.`,
      `Nasdaq 100 futures ${futuresResult.futures.nasdaq100.changePercent ?? "n/a"}%.`,
      `Semiconductor strength: ${semiconductorStrength.strength}.`,
    ];

    return {
      timestamp: new Date().toISOString(),
      marketBias: marketBiasResult.bias,
      summary: summaryParts.join(" "),
      keyDrivers,
      futures: futuresResult.futures,
      premarketMovers: premarket,
      breadth: breadthResult.breadth,
      sectorNotes: buildSectorNotes(
        semiconductorStrength,
        futuresResult.futures,
        finviz.data?.majorNews ?? [],
      ),
      watchlistSignals: watchlistSignals.signals,
      risks,
      suggestedQuestions: buildSuggestedQuestions(
        input.focusSymbols,
        marketBiasResult.bias,
      ),
      warnings: [...new Set(warnings)],
    };
  });
}
