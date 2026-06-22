import {
  computeAggregateDataFreshness,
  computeDataFreshness,
} from "../utils/dataFreshness.js";
import {
  computeWatchlistConfidence,
  countBySourceQuality,
} from "../utils/quoteConfidence.js";
import { CACHE_TTL, getCached } from "./cache.js";
import { fetchFinvizEarnings, fetchFinvizHomepage, safeFetchFinvizHomepage } from "./finviz.js";
import {
  fetchMarketWatchPremarket,
  finvizMoversToPremarket,
  snapshotToMover,
} from "./marketwatch.js";
import {
  buildPortfolioNotes,
  buildSectorNotes,
  buildSuggestedQuestions,
  biasLabelWithConfidence,
  computeMarketBias,
  computeSemiconductorStrength,
  scoreWatchlistSymbol,
  toSemiconductorStrengthResponse,
} from "./scoring.js";
import {
  fetchYahooFutures,
  fetchYahooMovers,
  fetchYahooNewsHeadline,
} from "./yahoo.js";
import { fetchQuotes } from "./quotes.js";
import {
  emptyBreadth,
  emptyFutures,
  SEMICONDUCTOR_SYMBOLS,
  type DailyBriefingResponse,
  type EarningsCalendarResponse,
  type FinvizSnapshotResponse,
  type FuturesResponse,
  type MarketBreadthResponse,
  type NewsItem,
  type PremarketMoversResponse,
  type SemiconductorStrengthResponse,
  type WatchlistSignalsResponse,
} from "../types/market.js";
import { enrichHeadline } from "../utils/newsAnalysis.js";
import type { FinvizHomepageData } from "../types/market.js";

import type { SemiconductorStrength } from "./scoring.js";

function semiResultToStrength(
  semiResult: SemiconductorStrengthResponse,
): SemiconductorStrength {
  return {
    strength:
      semiResult.sectorScore >= 7
        ? "strong"
        : semiResult.sectorScore <= 4
          ? "weak"
          : "mixed",
    positiveCount: semiResult.leaders.length,
    totalChecked: semiResult.symbols.filter((item) => item.changePercent != null).length,
    leaderSymbols: semiResult.leaders,
    laggardSymbols: semiResult.laggards,
    leaders: semiResult.symbols
      .filter((item) => (item.changePercent ?? 0) > 0)
      .map((item) => `${item.symbol} +${item.changePercent!.toFixed(2)}%`),
    laggards: semiResult.symbols
      .filter((item) => (item.changePercent ?? 0) < 0)
      .map((item) => `${item.symbol} ${item.changePercent!.toFixed(2)}%`),
    sectorScore: semiResult.sectorScore,
    bias: semiResult.bias,
    confidence: semiResult.confidence,
    symbolDetails: semiResult.symbols,
  };
}

function buildBriefingNews(finviz: FinvizHomepageData | null): NewsItem[] {
  const news: NewsItem[] = [];

  if (finviz?.marketSummaryHeadline) {
    const enriched = enrichHeadline(finviz.marketSummaryHeadline, {
      finvizSentiment:
        finviz.marketSummarySentiment === "negative"
          ? "bad"
          : finviz.marketSummarySentiment === "positive"
            ? "good"
            : undefined,
      source: "Finviz market summary",
    });
    news.push({
      headline: enriched.headline,
      impact: enriched.impact,
      sentiment: enriched.sentiment,
      source: enriched.source,
    });
  }

  for (const headline of finviz?.headlines ?? []) {
    news.push({
      headline: headline.headline ?? headline.title,
      impact: headline.impact ?? "low",
      sentiment: headline.sentiment ?? "neutral",
      source: headline.source ?? "Finviz",
      url: headline.url,
      time: headline.time,
    });
  }

  return news
    .sort((a, b) => {
      const impactRank = { high: 0, medium: 1, low: 2 };
      return impactRank[a.impact] - impactRank[b.impact];
    })
    .slice(0, 12);
}

export async function getSemiconductorStrength(): Promise<SemiconductorStrengthResponse> {
  return getCached("tool:semiconductor", CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const finviz = await safeFetchFinvizHomepage();
    if (finviz.warning) {
      warnings.push(finviz.warning);
    }

    const finvizSnapshot = finviz.data ?? null;
    const quoteResult = await fetchQuotes([...SEMICONDUCTOR_SYMBOLS], {
      finvizSnapshot,
    });
    warnings.push(...quoteResult.warnings);

    const strength = computeSemiconductorStrength(
      quoteResult.quotes,
      finviz.data?.majorNews ?? [],
    );

    const sources = new Set<string>();
    for (const quote of quoteResult.quotes.values()) {
      if (quote.source) {
        sources.add(quote.source);
      }
    }
    if (sources.size === 0 && (finviz.data?.majorNews.length ?? 0) > 0) {
      sources.add("Finviz major news");
    }

    return toSemiconductorStrengthResponse(
      strength,
      sources.size > 0 ? [...sources].join(" + ") : "Finviz",
      warnings,
    );
  });
}

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

    const yahoo = await fetchYahooMovers(limit);
    warnings.push(...yahoo.warnings);

    if (
      yahoo.leaders.length > 0 ||
      yahoo.laggards.length > 0 ||
      yahoo.mostActive.length > 0
    ) {
      return {
        timestamp: new Date().toISOString(),
        source: "Yahoo Finance",
        warnings,
        leaders: yahoo.leaders.slice(0, limit),
        laggards: yahoo.laggards.slice(0, limit),
        mostActive: yahoo.mostActive.slice(0, limit),
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
      "Using Finviz top movers/unusual volume as final fallback",
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
    const quoteResult = await fetchQuotes(quoteSymbols, {
      finvizSnapshot: finviz.data ?? null,
    });
    const quotes = quoteResult.quotes;
    warnings.push(...quoteResult.warnings);

    const focusUpper = symbols.map((symbol) => symbol.toUpperCase());
    const quoteDiagnostics = {
      yahooBatchResolved: quoteResult.diagnostics.yahooBatchResolved,
      yahooBatchRequested: quoteResult.diagnostics.yahooBatchRequested,
      bySourceQuality: countBySourceQuality(
        focusUpper
          .map((symbol) => quotes.get(symbol))
          .filter((quote): quote is NonNullable<typeof quote> => quote != null),
      ),
    };

    if (quoteResult.diagnostics.yahooBatchResolved === 0) {
      warnings.push(
        "Yahoo Finance batch returned no data — quotes may be Nasdaq-only unless individual Yahoo corroboration succeeds",
      );
    }

    if (quoteResult.coverage.resolved === 0) {
      warnings.push("Live quote lookup failed; Finviz snapshot used where available");
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
        const quote = quotes.get(upper) ?? null;
        const headline = await fetchYahooNewsHeadline(upper);
        const finvizLists = finvizListsForSymbol(upper, snapshot);

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
      dataFreshness: computeAggregateDataFreshness(
        signals.map((signal) => signal.dataFreshness),
      ),
      confidence: computeWatchlistConfidence(
        signals.map((signal) => signal.confidence),
      ),
      quoteDiagnostics,
      warnings,
      signals,
    };
  });
}

export async function getDailyBriefing(input: {
  focusSymbols: string[];
  portfolioContext?: string;
  positions?: Array<{
    symbol: string;
    costBasis?: number;
    currentValue?: number;
  }>;
}): Promise<DailyBriefingResponse> {
  const cacheKey = `tool:briefing:${input.focusSymbols.join(",")}:${input.portfolioContext ?? ""}:${JSON.stringify(input.positions ?? [])}`;
  return getCached(cacheKey, CACHE_TTL.DAILY_REPORT_MS, async () => {
    const warnings: string[] = [];

    const [futuresResult, premarket, breadthResult, finviz, watchlistSignals, semiResult] =
      await Promise.all([
        getFutures(),
        getPremarketMovers(15),
        getMarketBreadth(),
        safeFetchFinvizHomepage(),
        getWatchlistSignals(input.focusSymbols),
        getSemiconductorStrength(),
      ]);

    warnings.push(...(futuresResult.warnings ?? []));
    warnings.push(...(premarket.warnings ?? []));
    warnings.push(...(breadthResult.warnings ?? []));
    if (finviz.warning) warnings.push(finviz.warning);
    warnings.push(...(watchlistSignals.warnings ?? []));
    warnings.push(...(semiResult.warnings ?? []));

    const marketBiasResult = computeMarketBias(
      futuresResult.futures,
      breadthResult.breadth,
    );

    const news = buildBriefingNews(finviz.data ?? null);
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
    for (const item of news.filter((entry) => entry.impact === "high").slice(0, 3)) {
      keyDrivers.push(item.headline);
    }

    const semiStrength = semiResultToStrength(semiResult);

    const portfolioNotes = buildPortfolioNotes({
      positions: input.positions,
      portfolioContext: input.portfolioContext,
      semiconductorStrength: semiStrength,
      marketBias: marketBiasResult,
      watchlistSignals: watchlistSignals.signals,
    });

    const risks: string[] = [
      "Data is for research only; quotes may be delayed.",
      "Leveraged ETFs (e.g. SOXL) carry elevated volatility risk.",
    ];
    if (marketBiasResult.bias === "bearish") {
      risks.push("Bearish futures/breadth backdrop may increase downside volatility.");
    }
    if (news.some((item) => item.impact === "high" && item.sentiment === "negative")) {
      risks.push("High-impact negative headlines may increase near-term volatility.");
    }
    if (input.portfolioContext) {
      risks.push(`Portfolio context noted: ${input.portfolioContext}`);
    }

    const summaryParts = [
      `${biasLabelWithConfidence(marketBiasResult.bias, marketBiasResult.confidence)} market bias (${marketBiasResult.confidence}% confidence).`,
      `Nasdaq 100 futures ${futuresResult.futures.nasdaq100.changePercent ?? "n/a"}%.`,
      semiResult.summary,
    ];

    const dataFreshness = computeAggregateDataFreshness([
      computeDataFreshness({ timestamp: futuresResult.timestamp }),
      computeDataFreshness({ timestamp: premarket.timestamp }),
      computeDataFreshness({ timestamp: breadthResult.timestamp }),
      ...watchlistSignals.signals.map((signal) => signal.dataFreshness),
    ]);

    return {
      timestamp: new Date().toISOString(),
      dataFreshness,
      marketBias: marketBiasResult.bias,
      confidence: marketBiasResult.confidence,
      summary: summaryParts.join(" "),
      sources: {
        futuresSource: futuresResult.source,
        premarketSource: premarket.source,
        breadthSource: breadthResult.source,
        newsSource: "Finviz",
        semiconductorSource: semiResult.source,
        watchlistSource: "Finviz + Yahoo Finance",
      },
      keyDrivers,
      news,
      futures: futuresResult.futures,
      premarketMovers: premarket,
      breadth: breadthResult.breadth,
      sectorNotes: buildSectorNotes(
        semiStrength,
        futuresResult.futures,
        finviz.data?.majorNews ?? [],
      ),
      watchlistSignals: watchlistSignals.signals,
      semiconductorStrength: {
        sectorScore: semiResult.sectorScore,
        bias: semiResult.bias,
        confidence: semiResult.confidence,
        leaders: semiResult.leaders,
        laggards: semiResult.laggards,
        summary: semiResult.summary,
      },
      portfolioNotes,
      risks,
      suggestedQuestions: buildSuggestedQuestions(
        input.focusSymbols,
        marketBiasResult.bias,
      ),
      warnings: [...new Set(warnings)],
    };
  });
}
