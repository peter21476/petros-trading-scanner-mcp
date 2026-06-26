import { CACHE_TTL, getCached } from "./cache.js";
import { safeFetchFinvizHomepage } from "./finviz.js";
import { getPremarketMovers } from "./marketData.js";
import { portfolioFromAccountContext } from "./portfolio.js";
import { buildPortfolioRotationPlan } from "./portfolioRotation.js";
import {
  buildTradeSetup,
  classifyActionWindow,
  classifyMarketCondition,
  classifySetupType,
  type MarketAnalysisBundle,
  type SymbolAnalysisInput,
} from "./tradeAnalysis.js";
import { loadTradingContext } from "./tradingContext.js";
import {
  isLeveragedEtf,
  isSemiconductorSymbol,
} from "./scoring.js";
import {
  SEMICONDUCTOR_SYMBOLS,
  type SnapshotStock,
} from "../types/market.js";
import type {
  BestTradeCandidate,
  BestTradesTodayResponse,
  BestTradeSuggestedAction,
  PortfolioAccountContext,
  RiskTolerance,
  SetupType,
  TradeCandidateScores,
  TradeTimeframe,
} from "../types/trading.js";
import { TRADING_DISCLAIMER } from "../types/trading.js";
import { detectMarketSession } from "../utils/marketSession.js";

const MEGA_CAP_TECH = ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA"] as const;
const INDEX_ETFS = ["QQQ", "SOXL", "TQQQ", "SPY"] as const;
const HIGH_LIQUIDITY = new Set<string>([
  ...MEGA_CAP_TECH,
  ...INDEX_ETFS,
  ...SEMICONDUCTOR_SYMBOLS,
]);

const SCORE_WEIGHTS = {
  momentum: 0.2,
  relativeStrength: 0.15,
  volume: 0.15,
  catalyst: 0.15,
  trend: 0.1,
  riskReward: 0.1,
  liquidity: 0.05,
  marketAlignment: 0.1,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scaleToTen(value: number, min: number, max: number): number {
  if (max <= min) {
    return 5;
  }
  return clamp(((value - min) / (max - min)) * 10, 0, 10);
}

function mapSetupType(setupType: SetupType, changePercent: number | null): SetupType {
  if (setupType === "continuation" && changePercent != null && changePercent > 1.5) {
    return "momentum";
  }
  if (setupType === "continuation") {
    return "momentum";
  }
  return setupType;
}

function computeSubScores(input: {
  analysis: SymbolAnalysisInput;
  market: MarketAnalysisBundle;
  setup: ReturnType<typeof buildTradeSetup>;
}): TradeCandidateScores {
  const { analysis, market, setup } = input;
  const changePercent = analysis.signal.changePercent;
  const finvizLists = analysis.finvizLists;

  const momentumScore = scaleToTen(changePercent ?? 0, -3, 5);
  const relativeStrengthScore = scaleToTen(setup.relativeStrengthScore, 30, 85);

  let volumeScore = 4;
  if (finvizLists.includes("unusualVolume")) {
    volumeScore = 9;
  } else if (finvizLists.includes("topGainers")) {
    volumeScore = 7;
  }
  if ((analysis.quote?.volume ?? 0) > 5_000_000) {
    volumeScore = Math.max(volumeScore, 8);
  }

  let catalystScore = 3;
  if (finvizLists.includes("majorNews")) {
    catalystScore = 8;
  }
  if (analysis.signal.headline) {
    catalystScore = Math.max(catalystScore, 6);
  }
  if (finvizLists.includes("topGainers") || finvizLists.includes("unusualVolume")) {
    catalystScore = Math.max(catalystScore, 7);
  }

  const trendScore = scaleToTen(analysis.signal.score, 3, 8.5);
  const riskRewardScore = scaleToTen(setup.riskReward.target1RR, 0.8, 3);
  const liquidityScore = HIGH_LIQUIDITY.has(analysis.symbol) ? 9 : 5;

  let marketAlignmentScore = 5;
  if (market.marketBias.bias === "bullish" && analysis.signal.bias === "bullish") {
    marketAlignmentScore = 9;
  } else if (market.marketBias.bias === "bearish" && analysis.signal.bias === "bearish") {
    marketAlignmentScore = 3;
  } else if (market.marketBias.bias === "neutral") {
    marketAlignmentScore = 6;
  } else {
    marketAlignmentScore = 4;
  }

  return {
    momentumScore: Number(momentumScore.toFixed(1)),
    relativeStrengthScore: Number(relativeStrengthScore.toFixed(1)),
    volumeScore: Number(volumeScore.toFixed(1)),
    catalystScore: Number(catalystScore.toFixed(1)),
    trendScore: Number(trendScore.toFixed(1)),
    riskRewardScore: Number(riskRewardScore.toFixed(1)),
    liquidityScore: Number(liquidityScore.toFixed(1)),
    marketAlignmentScore: Number(marketAlignmentScore.toFixed(1)),
  };
}

function computeConvictionScore(
  scores: TradeCandidateScores,
  penalties: number,
): number {
  const weighted =
    scores.momentumScore * SCORE_WEIGHTS.momentum +
    scores.relativeStrengthScore * SCORE_WEIGHTS.relativeStrength +
    scores.volumeScore * SCORE_WEIGHTS.volume +
    scores.catalystScore * SCORE_WEIGHTS.catalyst +
    scores.trendScore * SCORE_WEIGHTS.trend +
    scores.riskRewardScore * SCORE_WEIGHTS.riskReward +
    scores.liquidityScore * SCORE_WEIGHTS.liquidity +
    scores.marketAlignmentScore * SCORE_WEIGHTS.marketAlignment;

  return clamp(Math.round(weighted * 10 - penalties), 0, 100);
}

function determineBestTradeAction(
  convictionScore: number,
  setupType: SetupType,
  isHeld: boolean,
): BestTradeSuggestedAction {
  if (setupType === "avoid" || convictionScore < 35) {
    return "avoid";
  }
  if (isHeld && convictionScore < 50) {
    return "trim";
  }
  if (isHeld && convictionScore >= 50) {
    return "hold";
  }
  if (convictionScore >= 70) {
    return "buy_watch";
  }
  if (convictionScore >= 45) {
    return "wait_for_trigger";
  }
  return "avoid";
}

function buildWhyThisTrade(
  symbol: string,
  scores: TradeCandidateScores,
  setupType: SetupType,
  convictionScore: number,
): string {
  const strengths: string[] = [];
  if (scores.relativeStrengthScore >= 7) {
    strengths.push("relative strength");
  }
  if (scores.momentumScore >= 7) {
    strengths.push("momentum");
  }
  if (scores.volumeScore >= 7) {
    strengths.push("volume confirmation");
  }
  if (scores.catalystScore >= 7) {
    strengths.push("catalyst support");
  }

  const label =
    strengths.length > 0
      ? strengths.join(", ")
      : "mixed signals";

  return `${symbol} candidate (${setupType}) scores ${convictionScore}/100 with ${label}. Research framework only — verify trigger before acting.`;
}

function buildCandidateRisks(input: {
  symbol: string;
  setup: ReturnType<typeof buildTradeSetup>;
  marketCondition: ReturnType<typeof classifyMarketCondition>;
  convictionScore: number;
}): string[] {
  const risks = [...input.setup.catalysts.bearishCatalysts.slice(0, 2)];
  if (input.setup.quoteWarnings.length > 0) {
    risks.push(input.setup.quoteWarnings[0]!);
  }
  if (isLeveragedEtf(input.symbol)) {
    risks.push("Leveraged ETF — amplified volatility and decay risk");
  }
  if (input.marketCondition === "choppy") {
    risks.push("Market is choppy — needs stronger confirmation");
  }
  if (input.convictionScore < 60) {
    risks.push("Moderate conviction — wait for entry trigger");
  }
  if (risks.length === 0) {
    risks.push("Verify quotes with broker before acting");
  }
  return [...new Set(risks)].slice(0, 5);
}

function buildCatalystList(analysis: SymbolAnalysisInput): string[] {
  const catalysts: string[] = [];
  if (analysis.finvizLists.includes("unusualVolume")) {
    catalysts.push("Unusual volume");
  }
  if (analysis.finvizLists.includes("topGainers")) {
    catalysts.push("Top gainer momentum");
  }
  if (analysis.finvizLists.includes("majorNews")) {
    catalysts.push("Major news catalyst");
  }
  if (isSemiconductorSymbol(analysis.symbol)) {
    catalysts.push("Semiconductor sector candidate");
  }
  if (MEGA_CAP_TECH.includes(analysis.symbol as (typeof MEGA_CAP_TECH)[number])) {
    catalysts.push("Mega-cap liquidity");
  }
  return catalysts.slice(0, 5);
}

export async function buildCandidateUniverse(input: {
  symbols?: string[];
  sourceWarnings: string[];
}): Promise<string[]> {
  if (input.symbols && input.symbols.length > 0) {
    return [...new Set(input.symbols.map((s) => s.toUpperCase()))];
  }

  const candidates = new Set<string>([
    ...MEGA_CAP_TECH,
    ...INDEX_ETFS,
    ...SEMICONDUCTOR_SYMBOLS,
  ]);

  const finviz = await safeFetchFinvizHomepage();
  if (finviz.warning) {
    input.sourceWarnings.push(finviz.warning);
  }

  const ingest = (items: SnapshotStock[]) => {
    for (const item of items.slice(0, 15)) {
      if (item.symbol) {
        candidates.add(item.symbol.toUpperCase());
      }
    }
  };

  if (finviz.data) {
    ingest(finviz.data.topGainers);
    ingest(finviz.data.unusualVolume);
    ingest(finviz.data.newHighs);
    ingest(finviz.data.majorNews);
  } else {
    input.sourceWarnings.push("Finviz snapshot unavailable for candidate universe");
  }

  try {
    const premarket = await getPremarketMovers(15);
    for (const bucket of [
      premarket.leaders,
      premarket.laggards,
      premarket.mostActive,
    ]) {
      for (const mover of bucket.slice(0, 10)) {
        if (mover.symbol) {
          candidates.add(mover.symbol.toUpperCase());
        }
      }
    }
  } catch {
    input.sourceWarnings.push("Premarket movers unavailable for candidate universe");
  }

  return [...candidates].slice(0, 40);
}

function scoreCandidate(input: {
  analysis: SymbolAnalysisInput;
  market: MarketAnalysisBundle;
  marketCondition: ReturnType<typeof classifyMarketCondition>;
  riskTolerance: RiskTolerance;
  timeframe: TradeTimeframe;
  heldSymbols: Set<string>;
}): BestTradeCandidate | null {
  const setup = buildTradeSetup({
    symbolAnalysis: input.analysis,
    market: input.market,
    account: {
      riskTolerance: input.riskTolerance,
      timeframe: input.timeframe,
    },
  });

  if (setup.currentPrice == null && setup.previousClose == null) {
    return null;
  }

  const scores = computeSubScores({
    analysis: input.analysis,
    market: input.market,
    setup,
  });

  let penalties = 0;
  if (input.marketCondition === "choppy") {
    penalties += 12;
  } else if (input.marketCondition === "riskOff") {
    penalties += 18;
  }
  if (
    isLeveragedEtf(input.analysis.symbol) &&
    scores.momentumScore < 7
  ) {
    penalties += 15;
  }
  if (setup.dataFreshness === "stale") {
    penalties += 20;
  }

  const convictionScore = computeConvictionScore(scores, penalties);
  const changePercent = input.analysis.signal.changePercent ?? null;
  const rawSetup = classifySetupType({
    symbol: input.analysis.symbol,
    changePercent,
    signal: input.analysis.signal,
    relativeStrengthScore: setup.relativeStrengthScore,
    marketBias: input.market.marketBias,
  });
  const setupType = mapSetupType(rawSetup, changePercent);
  const isHeld = input.heldSymbols.has(input.analysis.symbol);

  return {
    rank: 0,
    symbol: input.analysis.symbol,
    companyName: input.analysis.quote?.shortName ?? null,
    currentPrice: setup.currentPrice,
    bias: setup.bias,
    setupType,
    convictionScore,
    suggestedAction: determineBestTradeAction(convictionScore, setupType, isHeld),
    entryZone: setup.entryZone,
    stopLoss: setup.stopLoss,
    profitTargets: setup.profitTargets,
    riskReward: setup.riskReward,
    scores,
    catalysts: buildCatalystList(input.analysis),
    risks: buildCandidateRisks({
      symbol: input.analysis.symbol,
      setup,
      marketCondition: input.marketCondition,
      convictionScore,
    }),
    whyThisTrade: buildWhyThisTrade(
      input.analysis.symbol,
      scores,
      setupType,
      convictionScore,
    ),
    invalidationConditions: setup.invalidationConditions,
  };
}

export async function getBestTradesToday(input: {
  symbols?: string[];
  maxResults?: number;
  timeframe?: TradeTimeframe;
  riskTolerance?: RiskTolerance;
  accountContext?: PortfolioAccountContext;
}): Promise<BestTradesTodayResponse> {
  const maxResults = input.maxResults ?? 10;
  const timeframe = input.timeframe ?? "swing_1_5_days";
  const riskTolerance = input.riskTolerance ?? "balanced";
  const cacheKey = `tool:best-trades:${JSON.stringify({ ...input, maxResults })}`;

  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const sourceWarnings: string[] = [];
    const symbols = await buildCandidateUniverse({
      symbols: input.symbols,
      sourceWarnings,
    });

    const { market, symbolAnalyses, warnings } = await loadTradingContext(symbols);
    sourceWarnings.push(...warnings, ...market.warnings);

    const marketSession = detectMarketSession();
    const marketCondition = classifyMarketCondition({
      marketBias: market.marketBias,
      breadth: market.breadth,
      nasdaqFuturesChange: market.nasdaqFuturesChange,
    });
    const actionWindow = classifyActionWindow(marketCondition, marketSession);

    const portfolio = input.accountContext
      ? portfolioFromAccountContext(input.accountContext)
      : null;
    const heldSymbols = new Set(
      portfolio?.equityPositions.map((p) => p.symbol.toUpperCase()) ?? [],
    );

    const scored: BestTradeCandidate[] = [];
    for (const symbol of symbols) {
      const analysis = symbolAnalyses.get(symbol);
      if (!analysis) {
        continue;
      }
      const candidate = scoreCandidate({
        analysis,
        market,
        marketCondition,
        riskTolerance,
        timeframe,
        heldSymbols,
      });
      if (candidate) {
        scored.push(candidate);
      }
    }

    scored.sort((a, b) => b.convictionScore - a.convictionScore);
    const results = scored.slice(0, maxResults).map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

    const portfolioRotationPlan =
      portfolio != null
        ? buildPortfolioRotationPlan({ portfolio, results, heldSymbols })
        : undefined;

    const top = results[0];
    const summary = top
      ? `Top candidate: ${top.symbol} (${top.convictionScore}/100, ${top.setupType}). ${actionWindow} action window. ${TRADING_DISCLAIMER}`
      : `No high-conviction candidates found in current market conditions. ${TRADING_DISCLAIMER}`;

    return {
      timestamp: new Date().toISOString(),
      disclaimer: TRADING_DISCLAIMER,
      timeframe,
      riskTolerance,
      marketCondition,
      actionWindow,
      candidateCount: symbols.length,
      sources: market.sources,
      sourceWarnings: [...new Set(sourceWarnings)],
      results,
      portfolioRotationPlan,
      summary,
    };
  });
}
