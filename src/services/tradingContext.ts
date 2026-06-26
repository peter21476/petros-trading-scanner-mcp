import { safeFetchFinvizHomepage } from "./finviz.js";
import { fetchQuotes } from "./quotes.js";
import {
  computeMarketBias,
  computeSemiconductorStrength,
  neutralSemiconductorStrength,
  scoreWatchlistSymbol,
  symbolUsesSemiconductorContext,
} from "./scoring.js";
import { getFutures } from "./marketData.js";
import { emptyBreadth, SEMICONDUCTOR_SYMBOLS } from "../types/market.js";
import type { MarketAnalysisBundle, SymbolAnalysisInput } from "./tradeAnalysis.js";

interface FinvizSnapshotLists {
  topGainers: { symbol: string }[];
  topLosers: { symbol: string }[];
  unusualVolume: { symbol: string }[];
  majorNews: { symbol: string }[];
}

function finvizListsForSymbol(symbol: string, snapshot: FinvizSnapshotLists): string[] {
  const upper = symbol.toUpperCase();
  const lists: string[] = [];
  if (snapshot.topGainers.some((s) => s.symbol === upper)) lists.push("topGainers");
  if (snapshot.topLosers.some((s) => s.symbol === upper)) lists.push("topLosers");
  if (snapshot.unusualVolume.some((s) => s.symbol === upper)) lists.push("unusualVolume");
  if (snapshot.majorNews.some((s) => s.symbol === upper)) lists.push("majorNews");
  return lists;
}

export async function loadTradingContext(symbols: string[]): Promise<{
  market: MarketAnalysisBundle;
  symbolAnalyses: Map<string, SymbolAnalysisInput>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const finviz = await safeFetchFinvizHomepage();
  if (finviz.warning) {
    warnings.push(finviz.warning);
  }

  const futuresResult = await getFutures();
  warnings.push(...(futuresResult.warnings ?? []));

  const breadth = finviz.data?.breadth ?? emptyBreadth();
  const marketBias = computeMarketBias(futuresResult.futures, breadth);
  const nasdaqFuturesChange = futuresResult.futures.nasdaq100.changePercent;

  const needsSemi = symbols.some((symbol) => symbolUsesSemiconductorContext(symbol));
  const quoteSymbols = [
    ...new Set([
      ...symbols.map((s) => s.toUpperCase()),
      ...(needsSemi ? [...SEMICONDUCTOR_SYMBOLS] : []),
    ]),
  ];

  const quoteResult = await fetchQuotes(quoteSymbols, {
    finvizSnapshot: finviz.data ?? null,
  });
  warnings.push(...quoteResult.warnings);

  if (quoteResult.diagnostics.yahooSkipped) {
    warnings.push("Yahoo Finance skipped (rate-limited)");
  }

  const semiconductorStrength = needsSemi
    ? computeSemiconductorStrength(quoteResult.quotes, finviz.data?.majorNews ?? [])
    : neutralSemiconductorStrength();

  const snapshot: FinvizSnapshotLists = {
    topGainers: finviz.data?.topGainers ?? [],
    topLosers: finviz.data?.topLosers ?? [],
    unusualVolume: finviz.data?.unusualVolume ?? [],
    majorNews: finviz.data?.majorNews ?? [],
  };

  const symbolAnalyses = new Map<string, SymbolAnalysisInput>();
  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const quote = quoteResult.quotes.get(upper) ?? null;
    const finvizLists = finvizListsForSymbol(upper, snapshot);
    const signal = scoreWatchlistSymbol({
      symbol: upper,
      quote,
      finvizLists,
      headline: null,
      marketBias,
      semiconductorStrength,
      nasdaqFuturesChange,
    });
    symbolAnalyses.set(upper, { symbol: upper, quote, signal, finvizLists });
  }

  const market: MarketAnalysisBundle = {
    marketBias,
    semiconductorStrength,
    futures: futuresResult.futures,
    breadth,
    nasdaqFuturesChange,
    sources: {
      quoteSource: quoteResult.quotes.values().next().value?.source ?? null,
      futuresSource: futuresResult.source,
      breadthSource: "Finviz",
      semiconductorSource: needsSemi ? "Finviz + quotes" : null,
    },
    warnings,
  };

  return { market, symbolAnalyses, warnings };
}
