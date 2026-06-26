import type {
  MarketBreadth,
  FuturesResponse,
  WatchlistSignal,
  YahooQuote,
} from "../types/market.js";
import type {
  ActionWindow,
  AggressiveWatchlistEntry,
  IntradayAction,
  IntradaySymbolDecision,
  MarketCondition,
  PortfolioEquityPosition,
  PortfolioSnapshot,
  ProfitTargets,
  RiskRewardMetrics,
  RiskTolerance,
  SetupType,
  StopLossLevel,
  SuggestedTradeAction,
  TradeAccountContext,
  TradeBias,
  TradeCatalysts,
  TradeSetupResponse,
  TradeSetupSources,
  TradeTimeframe,
  PriceZone,
} from "../types/trading.js";
import { TRADING_DISCLAIMER } from "../types/trading.js";
import { detectMarketSession } from "../utils/marketSession.js";
import {
  type BiasResult,
  type SemiconductorStrength,
  isLeveragedEtf,
  isSemiconductorEtf,
  isSemiconductorSymbol,
  symbolUsesSemiconductorContext,
} from "./scoring.js";

const SEMI_CONFIRMATION_SYMBOLS = ["NVDA", "AMD", "MU", "AVGO"] as const;

export interface SymbolAnalysisInput {
  symbol: string;
  quote: YahooQuote | null;
  signal: WatchlistSignal;
  finvizLists: string[];
}

export interface MarketAnalysisBundle {
  marketBias: BiasResult;
  semiconductorStrength: SemiconductorStrength;
  futures: FuturesResponse["futures"];
  breadth: MarketBreadth;
  nasdaqFuturesChange: number | null;
  sources: TradeSetupSources;
  warnings: string[];
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasPosition(account?: TradeAccountContext): boolean {
  return (
    (account?.currentPositionShares ?? 0) > 0 ||
    (account?.currentValue ?? 0) > 0
  );
}

function positionPnlPercent(account?: TradeAccountContext): number | null {
  if (
    account?.averageCost == null ||
    account.averageCost <= 0 ||
    account.currentValue == null
  ) {
    return null;
  }
  const shares = account.currentPositionShares;
  const costBasis =
    shares != null && shares > 0
      ? account.averageCost * shares
      : account.averageCost;
  if (costBasis <= 0) {
    return null;
  }
  return Number(
    (((account.currentValue - costBasis) / costBasis) * 100).toFixed(2),
  );
}

export function computeRelativeStrengthScore(input: {
  symbolChangePercent: number | null;
  nasdaqFuturesChange: number | null;
  semiconductorStrength: SemiconductorStrength;
  symbol: string;
}): number {
  let score = 50;
  const { symbolChangePercent, nasdaqFuturesChange, semiconductorStrength, symbol } =
    input;

  if (symbolChangePercent != null && nasdaqFuturesChange != null) {
    const relative = symbolChangePercent - nasdaqFuturesChange;
    if (relative > 2) {
      score += 25;
    } else if (relative > 0.5) {
      score += 15;
    } else if (relative < -2) {
      score -= 25;
    } else if (relative < -0.5) {
      score -= 15;
    }
  } else if (symbolChangePercent != null) {
    if (symbolChangePercent > 2) {
      score += 15;
    } else if (symbolChangePercent < -2) {
      score -= 15;
    }
  }

  if (symbolUsesSemiconductorContext(symbol)) {
    if (semiconductorStrength.strength === "strong") {
      score += 15;
    } else if (semiconductorStrength.strength === "weak") {
      score -= 15;
    }
  }

  return clamp(Math.round(score), 0, 100);
}

export function semiLeadersConfirming(
  semiconductorStrength: SemiconductorStrength,
): boolean {
  const leaderChanges = SEMI_CONFIRMATION_SYMBOLS.map((sym) => {
    const detail = semiconductorStrength.symbolDetails.find(
      (item) => item.symbol === sym,
    );
    return detail?.changePercent ?? null;
  }).filter((value): value is number => value != null);

  if (leaderChanges.length === 0) {
    return semiconductorStrength.strength === "strong";
  }

  const positiveCount = leaderChanges.filter((value) => value > 0).length;
  return positiveCount >= 3;
}

export function classifySetupType(input: {
  symbol: string;
  changePercent: number | null;
  signal: WatchlistSignal;
  relativeStrengthScore: number;
  marketBias: BiasResult;
}): SetupType {
  const { symbol, changePercent, signal, relativeStrengthScore, marketBias } =
    input;
  const inLosers = signal.inFinvizLists?.includes("topLosers") ?? false;
  const inGainers =
    signal.inFinvizLists?.includes("topGainers") ||
    signal.inFinvizLists?.includes("unusualVolume");

  if (
    signal.score <= 3 ||
    (changePercent != null && changePercent < -4 && marketBias.bias === "bearish")
  ) {
    return "avoid";
  }

  if (
    changePercent != null &&
    changePercent < -1.5 &&
    relativeStrengthScore >= 55 &&
    signal.bias !== "bearish"
  ) {
    return "reversal";
  }

  if (inGainers && changePercent != null && changePercent > 2) {
    return "breakout";
  }

  if (
    changePercent != null &&
    changePercent < 0.5 &&
    changePercent > -2 &&
    signal.bias === "bullish"
  ) {
    return "pullback";
  }

  if (signal.bias === "bullish" || (changePercent != null && changePercent > 0)) {
    return "continuation";
  }

  if (isLeveragedEtf(symbol) && marketBias.bias === "bearish") {
    return "avoid";
  }

  return signal.bias === "bearish" ? "avoid" : "continuation";
}

export function computeAggressiveBuyScore(input: {
  symbol: string;
  signal: WatchlistSignal;
  marketBias: BiasResult;
  semiconductorStrength: SemiconductorStrength;
  relativeStrengthScore: number;
  setupType: SetupType;
  breadth: MarketBreadth;
  nasdaqFuturesChange: number | null;
}): number {
  let score = input.signal.score;
  const { symbol, marketBias, semiconductorStrength, relativeStrengthScore, setupType } =
    input;

  if (setupType === "avoid") {
    return clamp(Math.round(score * 0.4), 0, 4);
  }

  if (relativeStrengthScore >= 65) {
    score += 1;
  } else if (relativeStrengthScore <= 35) {
    score -= 1.2;
  }

  if (marketBias.bias === "bearish") {
    if (relativeStrengthScore < 60) {
      score -= 1.5;
    } else {
      score -= 0.5;
    }
  } else if (marketBias.bias === "bullish") {
    score += 0.5;
  }

  const breadthWeak =
    input.breadth.decliningPercent != null && input.breadth.decliningPercent > 55;
  const futuresWeak =
    input.nasdaqFuturesChange != null && input.nasdaqFuturesChange < -0.5;

  if ((breadthWeak || futuresWeak) && relativeStrengthScore < 55) {
    score -= 1.5;
  }

  if (isLeveragedEtf(symbol)) {
    const momentumConfirmed =
      relativeStrengthScore >= 60 &&
      (symbolUsesSemiconductorContext(symbol)
        ? semiLeadersConfirming(semiconductorStrength) &&
          (input.nasdaqFuturesChange ?? 0) > -0.3
        : input.signal.bias === "bullish");
    if (!momentumConfirmed) {
      score -= 2;
    } else {
      score -= 0.5;
    }
  }

  if (isSemiconductorSymbol(symbol) && !semiLeadersConfirming(semiconductorStrength)) {
    score -= 0.8;
  }

  if (input.signal.dataFreshness === "stale") {
    score -= 1.5;
  } else if (input.signal.dataFreshness === "closed_session") {
    score -= 0.3;
  }

  return clamp(Number(score.toFixed(1)), 0, 10);
}

export function computeProbabilityScore(input: {
  aggressiveBuyScore: number;
  relativeStrengthScore: number;
  marketBias: BiasResult;
  setupType: SetupType;
  signal: WatchlistSignal;
  semiconductorStrength: SemiconductorStrength;
  symbol: string;
}): number {
  let probability = 45 + input.aggressiveBuyScore * 4;
  probability += (input.relativeStrengthScore - 50) * 0.25;

  if (input.marketBias.bias === "bullish") {
    probability += 8;
  } else if (input.marketBias.bias === "bearish") {
    probability -= 12;
  }

  if (input.setupType === "breakout" || input.setupType === "continuation") {
    probability += 5;
  } else if (input.setupType === "avoid") {
    probability -= 25;
  } else if (input.setupType === "reversal") {
    probability -= 5;
  }

  if (symbolUsesSemiconductorContext(input.symbol)) {
    if (input.semiconductorStrength.strength === "strong") {
      probability += 8;
    } else if (input.semiconductorStrength.strength === "weak") {
      probability -= 10;
    }
  }

  if (input.signal.dataFreshness === "stale") {
    probability -= 15;
  }

  if (isLeveragedEtf(input.symbol) && input.aggressiveBuyScore < 7) {
    probability -= 10;
  }

  return clamp(Math.round(probability), 0, 100);
}

function stopPercentFor(
  riskTolerance: RiskTolerance,
  timeframe: TradeTimeframe,
  isLeveraged: boolean,
): number {
  const table: Record<RiskTolerance, Record<TradeTimeframe, number>> = {
    conservative: { intraday: 1.5, swing_1_5_days: 2.5, swing_1_2_weeks: 4 },
    balanced: { intraday: 2.5, swing_1_5_days: 4, swing_1_2_weeks: 6 },
    aggressive: { intraday: 4, swing_1_5_days: 6, swing_1_2_weeks: 8 },
  };
  let pct = table[riskTolerance][timeframe];
  if (isLeveraged) {
    pct *= 0.75;
  }
  return pct;
}

export function computeTradeLevels(input: {
  price: number;
  previousClose: number | null;
  setupType: SetupType;
  riskTolerance: RiskTolerance;
  timeframe: TradeTimeframe;
  isLeveraged: boolean;
}): {
  entryZone: PriceZone;
  stopLoss: StopLossLevel;
  profitTargets: ProfitTargets;
  riskReward: RiskRewardMetrics;
} {
  const { price, previousClose, setupType, riskTolerance, timeframe, isLeveraged } =
    input;
  const stopPct = stopPercentFor(riskTolerance, timeframe, isLeveraged);

  let entryLow = price;
  let entryHigh = price;
  let entryRationale = "Enter near current price on confirmation.";

  switch (setupType) {
    case "breakout":
      entryLow = roundPrice(price * 1.001);
      entryHigh = roundPrice(price * 1.008);
      entryRationale = `Breakout entry above ${roundPrice(price)}; trigger on hold above prior high.`;
      break;
    case "pullback":
      entryLow = roundPrice(price * 0.985);
      entryHigh = roundPrice(price * 1.002);
      entryRationale = `Pullback entry toward support${previousClose != null ? ` near ${roundPrice(previousClose)}` : ""}.`;
      break;
    case "reversal":
      entryLow = roundPrice(price * 0.992);
      entryHigh = roundPrice(price * 1.01);
      entryRationale = "Reversal entry after reclaim of short-term support with volume.";
      break;
    case "avoid":
      entryLow = roundPrice(price * 0.99);
      entryHigh = roundPrice(price * 1.01);
      entryRationale = "No preferred entry — setup quality is poor.";
      break;
    default:
      entryLow = roundPrice(price * 0.997);
      entryHigh = roundPrice(price * 1.005);
      entryRationale = "Continuation entry on hold above current bid/ask zone.";
  }

  const entryMid = (entryLow + entryHigh) / 2;
  const stopPrice = roundPrice(entryMid * (1 - stopPct / 100));
  const riskPerShare = entryMid - stopPrice;

  const target1 = roundPrice(entryMid + riskPerShare * 1.5);
  const target2 = roundPrice(entryMid + riskPerShare * 2.5);
  const target3 = roundPrice(entryMid + riskPerShare * 4);

  const target1RR = riskPerShare > 0 ? Number((1.5).toFixed(2)) : 0;
  const target2RR = riskPerShare > 0 ? Number((2.5).toFixed(2)) : 0;
  const target3RR = riskPerShare > 0 ? Number((4).toFixed(2)) : 0;

  return {
    entryZone: {
      low: entryLow,
      high: entryHigh,
      rationale: entryRationale,
    },
    stopLoss: {
      price: stopPrice,
      percentRisk: Number(stopPct.toFixed(2)),
      rationale: `${stopPct.toFixed(1)}% stop below entry mid (${roundPrice(entryMid)}) for ${timeframe} ${riskTolerance} profile${isLeveraged ? "; tighter due to leverage" : ""}.`,
    },
    profitTargets: {
      target1,
      target2,
      target3,
    },
    riskReward: {
      target1RR,
      target2RR,
      target3RR,
    },
  };
}

export function deriveTradeBias(
  signal: WatchlistSignal,
  setupType: SetupType,
): TradeBias {
  if (setupType === "avoid") {
    return "bearish";
  }
  return signal.bias;
}

export function buildCatalysts(input: {
  symbol: string;
  signal: WatchlistSignal;
  marketBias: BiasResult;
  semiconductorStrength: SemiconductorStrength;
  nasdaqFuturesChange: number | null;
  finvizLists: string[];
}): TradeCatalysts {
  const bullish: string[] = [];
  const bearish: string[] = [];

  for (const reason of input.signal.reasons) {
    if (
      reason.includes("+") ||
      reason.includes("strong") ||
      reason.includes("bullish") ||
      reason.includes("tailwind") ||
      reason.includes("momentum")
    ) {
      bullish.push(reason);
    }
    if (
      reason.includes("-") ||
      reason.includes("weak") ||
      reason.includes("bearish") ||
      reason.includes("headwind") ||
      reason.includes("losers")
    ) {
      bearish.push(reason);
    }
  }

  if (input.marketBias.bias === "bullish") {
    bullish.push(...input.marketBias.reasons.slice(0, 2));
  } else if (input.marketBias.bias === "bearish") {
    bearish.push(...input.marketBias.reasons.slice(0, 2));
  }

  if (symbolUsesSemiconductorContext(input.symbol)) {
    if (input.semiconductorStrength.strength === "strong") {
      bullish.push(
        `Semiconductor sector strong (${input.semiconductorStrength.sectorScore}/10)`,
      );
      if (input.semiconductorStrength.leaders.length > 0) {
        bullish.push(`Semi leaders: ${input.semiconductorStrength.leaders.slice(0, 3).join(", ")}`);
      }
    } else if (input.semiconductorStrength.strength === "weak") {
      bearish.push("Semiconductor sector weakness");
    }
  }

  if (input.finvizLists.includes("topGainers")) {
    bullish.push("Finviz top gainer");
  }
  if (input.finvizLists.includes("topLosers")) {
    bearish.push("Finviz top loser");
  }
  if (input.finvizLists.includes("unusualVolume")) {
    bullish.push("Unusual volume flag");
  }

  if (
    input.nasdaqFuturesChange != null &&
    input.nasdaqFuturesChange > 0.5
  ) {
    bullish.push(`Nasdaq 100 futures +${input.nasdaqFuturesChange.toFixed(2)}%`);
  } else if (
    input.nasdaqFuturesChange != null &&
    input.nasdaqFuturesChange < -0.5
  ) {
    bearish.push(`Nasdaq 100 futures ${input.nasdaqFuturesChange.toFixed(2)}%`);
  }

  return {
    bullishCatalysts: [...new Set(bullish)].slice(0, 6),
    bearishCatalysts: [...new Set(bearish)].slice(0, 6),
  };
}

export function determineSuggestedAction(input: {
  symbol: string;
  aggressiveBuyScore: number;
  setupType: SetupType;
  signal: WatchlistSignal;
  account?: TradeAccountContext;
  bias: TradeBias;
}): SuggestedTradeAction {
  const { aggressiveBuyScore, setupType, signal, account, bias } = input;
  const pnl = positionPnlPercent(account);
  const ownsPosition = hasPosition(account);
  const buyingPower = account?.buyingPower;
  const zeroBuyingPower = buyingPower != null && buyingPower <= 0;

  if (setupType === "avoid" || aggressiveBuyScore <= 2) {
    return ownsPosition ? "trim" : "no_action";
  }

  if (zeroBuyingPower && !ownsPosition) {
    return aggressiveBuyScore >= 7 ? "watch" : "no_action";
  }

  if (zeroBuyingPower && ownsPosition) {
    if (aggressiveBuyScore <= 4 || bias === "bearish") {
      return pnl != null && pnl > 10 ? "trim" : "hold";
    }
    if (aggressiveBuyScore <= 3) {
      return "sell";
    }
    return "hold";
  }

  if (ownsPosition) {
    if (pnl != null && pnl <= -10) {
      if (setupType === "reversal" && aggressiveBuyScore >= 7) {
        return "hold";
      }
      return aggressiveBuyScore <= 4 ? "trim" : "hold";
    }

    if (bias === "bearish" || aggressiveBuyScore <= 4) {
      return pnl != null && pnl > 15 ? "trim" : "hold";
    }

    if (aggressiveBuyScore >= 8 && bias === "bullish" && pnl != null && pnl > -5) {
      return zeroBuyingPower ? "hold" : "add";
    }

    if (aggressiveBuyScore <= 3) {
      return "sell";
    }

    return "hold";
  }

  if (aggressiveBuyScore >= 7 && bias === "bullish" && !zeroBuyingPower) {
    return "buy";
  }
  if (aggressiveBuyScore >= 5 && aggressiveBuyScore < 7) {
    return "watch";
  }
  if (aggressiveBuyScore <= 4) {
    return "watch";
  }

  return "no_action";
}

export function buildInvalidationConditions(input: {
  symbol: string;
  stopLoss: StopLossLevel;
  setupType: SetupType;
  marketBias: BiasResult;
  semiconductorStrength: SemiconductorStrength;
}): string[] {
  const conditions = [
    `Price breaks below stop at ${input.stopLoss.price} (${input.stopLoss.percentRisk}% risk)`,
  ];

  if (input.setupType === "breakout") {
    conditions.push("Failed breakout — price falls back below entry trigger");
  }

  if (input.marketBias.bias === "bearish") {
    conditions.push("Market bias turns sharply bearish (Nasdaq futures accelerate lower)");
  }

  if (symbolUsesSemiconductorContext(input.symbol)) {
    conditions.push("Semiconductor sector breadth deteriorates (leaders roll over)");
    if (isSemiconductorEtf(input.symbol)) {
      conditions.push("NVDA/AMD/MU/AVGO lose relative strength vs Nasdaq");
    }
  }

  if (isLeveragedEtf(input.symbol)) {
    conditions.push("Leveraged ETF loses intraday momentum — volatility expansion without follow-through");
  }

  if (input.semiconductorStrength.strength === "weak") {
    conditions.push("Sector leadership fails to confirm");
  }

  return conditions.slice(0, 6);
}

export function classifyMarketCondition(input: {
  marketBias: BiasResult;
  breadth: MarketBreadth;
  nasdaqFuturesChange: number | null;
}): MarketCondition {
  const { marketBias, breadth, nasdaqFuturesChange } = input;
  const futures = nasdaqFuturesChange ?? 0;
  const declining = breadth.decliningPercent ?? 0;
  const advancing = breadth.advancingPercent ?? 0;

  if (
    marketBias.bias === "bearish" &&
    futures < -0.8 &&
    declining > 58
  ) {
    return "riskOff";
  }

  if (futures > 0.8 && advancing > 55 && marketBias.bias === "bullish") {
    return "trendingUp";
  }

  if (futures < -0.8 && declining > 55 && marketBias.bias === "bearish") {
    return "trendingDown";
  }

  if (
    Math.abs(futures) < 0.3 &&
    advancing > 45 &&
    advancing < 55
  ) {
    return "choppy";
  }

  if (futures > 0 && marketBias.bias === "bearish") {
    return "reversalAttempt";
  }

  if (marketBias.bias === "bullish") {
    return "trendingUp";
  }
  if (marketBias.bias === "bearish") {
    return "trendingDown";
  }

  return "choppy";
}

export function classifyActionWindow(
  marketCondition: MarketCondition,
  marketSession: ReturnType<typeof detectMarketSession>,
): ActionWindow {
  if (marketSession === "weekend" || marketSession === "holiday") {
    return "avoid";
  }

  switch (marketCondition) {
    case "trendingUp":
      return "aggressive";
    case "reversalAttempt":
      return "selective";
    case "choppy":
      return "selective";
    case "trendingDown":
    case "riskOff":
      return "defensive";
    default:
      return "selective";
  }
}

export function buildTradeSetup(input: {
  symbolAnalysis: SymbolAnalysisInput;
  market: MarketAnalysisBundle;
  account?: TradeAccountContext;
}): TradeSetupResponse {
  const { symbolAnalysis, market, account } = input;
  const symbol = symbolAnalysis.symbol.toUpperCase();
  const quote = symbolAnalysis.quote;
  const signal = symbolAnalysis.signal;
  const price = quote?.price ?? signal.price ?? null;
  const changePercent = signal.changePercent ?? null;
  const previousClose = quote?.previousClose ?? signal.previousClose ?? null;
  const marketSession = quote?.marketSession ?? detectMarketSession();
  const dataFreshness = signal.dataFreshness ?? "stale";
  const quoteWarnings: string[] = [];

  if (dataFreshness === "stale" || dataFreshness === "delayed") {
    quoteWarnings.push(
      signal.freshnessReason ??
        `Quote is ${dataFreshness}${signal.asOf ? ` (as of ${signal.asOf})` : ""}`,
    );
  }
  if (quote?.isDelayed) {
    quoteWarnings.push("Quote may be delayed — verify live price with broker");
  }
  if (price == null) {
    quoteWarnings.push("Current price unavailable — levels are estimated only");
  }

  const riskTolerance = account?.riskTolerance ?? "balanced";
  const timeframe = account?.timeframe ?? "swing_1_5_days";
  const relativeStrengthScore = computeRelativeStrengthScore({
    symbolChangePercent: changePercent,
    nasdaqFuturesChange: market.nasdaqFuturesChange,
    semiconductorStrength: market.semiconductorStrength,
    symbol,
  });

  const setupType = classifySetupType({
    symbol,
    changePercent,
    signal,
    relativeStrengthScore,
    marketBias: market.marketBias,
  });

  const aggressiveBuyScore = computeAggressiveBuyScore({
    symbol,
    signal,
    marketBias: market.marketBias,
    semiconductorStrength: market.semiconductorStrength,
    relativeStrengthScore,
    setupType,
    breadth: market.breadth,
    nasdaqFuturesChange: market.nasdaqFuturesChange,
  });

  const probabilityScore = computeProbabilityScore({
    aggressiveBuyScore,
    relativeStrengthScore,
    marketBias: market.marketBias,
    setupType,
    signal,
    semiconductorStrength: market.semiconductorStrength,
    symbol,
  });

  const bias = deriveTradeBias(signal, setupType);
  const referencePrice = price ?? previousClose ?? 100;
  const levels = computeTradeLevels({
    price: referencePrice,
    previousClose,
    setupType,
    riskTolerance,
    timeframe,
    isLeveraged: isLeveragedEtf(symbol),
  });

  const catalysts = buildCatalysts({
    symbol,
    signal,
    marketBias: market.marketBias,
    semiconductorStrength: market.semiconductorStrength,
    nasdaqFuturesChange: market.nasdaqFuturesChange,
    finvizLists: symbolAnalysis.finvizLists,
  });

  const suggestedAction = determineSuggestedAction({
    symbol,
    aggressiveBuyScore,
    setupType,
    signal,
    account,
    bias,
  });

  const invalidationConditions = buildInvalidationConditions({
    symbol,
    stopLoss: levels.stopLoss,
    setupType,
    marketBias: market.marketBias,
    semiconductorStrength: market.semiconductorStrength,
  });

  const confidence = clamp(
    Math.round(
      (probabilityScore * 0.45 +
        (signal.confidence ?? 70) * 0.35 +
        relativeStrengthScore * 0.2) *
        (dataFreshness === "stale" ? 0.85 : 1),
    ),
    0,
    100,
  );

  let summary = `${symbol}: ${setupType} setup, aggressive buy score ${aggressiveBuyScore}/10, probability ${probabilityScore}%. Suggested: ${suggestedAction}.`;

  if (isLeveragedEtf(symbol)) {
    const leverageLabel =
      symbol === "SOXL" || symbol === "SOXS" ? "3x leveraged" : "leveraged";
    summary += ` ${symbol} is a ${leverageLabel} ETF. It can move sharply intraday and is not ideal for averaging down without reversal confirmation.`;
  }

  if (account?.buyingPower != null && account.buyingPower <= 0) {
    summary +=
      " Buying power is $0, so no new buy action is available. Focus is hold/trim/sell decision only.";
  }

  const pnl = positionPnlPercent(account);
  if (pnl != null && pnl <= -10 && suggestedAction !== "add") {
    summary += ` Position is down ${Math.abs(pnl).toFixed(2)}% — averaging down not suggested without reversal confirmation.`;
  }

  if (
    isSemiconductorSymbol(symbol) &&
    !semiLeadersConfirming(market.semiconductorStrength)
  ) {
    summary +=
      " Semi leaders (NVDA/AMD/MU/AVGO) lack broad confirmation for aggressive entry.";
  }

  return {
    timestamp: new Date().toISOString(),
    disclaimer: TRADING_DISCLAIMER,
    symbol,
    currentPrice: price,
    previousClose,
    changePercent,
    marketSession,
    dataFreshness,
    quoteWarnings,
    sources: market.sources,
    bias,
    setupType,
    aggressiveBuyScore,
    probabilityScore,
    confidence,
    relativeStrengthScore,
    entryZone: levels.entryZone,
    stopLoss: levels.stopLoss,
    profitTargets: levels.profitTargets,
    riskReward: levels.riskReward,
    suggestedAction,
    invalidationConditions,
    catalysts,
    summary,
  };
}

export function buildAggressiveWatchlistEntry(
  rank: number,
  setup: TradeSetupResponse,
): AggressiveWatchlistEntry {
  return {
    rank,
    symbol: setup.symbol,
    aggressiveBuyScore: setup.aggressiveBuyScore,
    probabilityScore: setup.probabilityScore,
    relativeStrengthScore: setup.relativeStrengthScore,
    riskScore: clamp(100 - setup.probabilityScore + (setup.setupType === "avoid" ? 20 : 0), 0, 100),
    setupType: setup.setupType,
    suggestedAction: setup.suggestedAction,
    entryTrigger: `${setup.entryZone.low}–${setup.entryZone.high} (${setup.entryZone.rationale})`,
    stopLoss: setup.stopLoss.price,
    target1: setup.profitTargets.target1,
    target2: setup.profitTargets.target2,
    summary: setup.summary,
  };
}

export function buildIntradaySymbolDecision(
  setup: TradeSetupResponse,
  marketCondition: MarketCondition,
  actionWindow: ActionWindow,
  account?: TradeAccountContext,
): IntradaySymbolDecision {
  let action: IntradayAction = "wait";
  let actNow = false;
  let reason = setup.summary;
  let riskLevel: IntradaySymbolDecision["riskLevel"] = "moderate";

  if (actionWindow === "avoid") {
    action = hasPosition(account) ? "hold" : "wait";
    reason = "Market session or conditions favor waiting.";
  } else if (setup.setupType === "avoid" || setup.aggressiveBuyScore <= 3) {
    action = hasPosition(account) ? "hold" : "wait";
    reason = "Weak setup — no intraday edge.";
    riskLevel = "high";
  } else if (
    setup.aggressiveBuyScore >= 8 &&
    setup.bias === "bullish" &&
    actionWindow === "aggressive"
  ) {
    action = hasPosition(account) ? "add" : "buy";
    actNow = true;
    reason = "High-conviction bullish setup in favorable market window.";
    riskLevel = isLeveragedEtf(setup.symbol) ? "high" : "moderate";
  } else if (setup.aggressiveBuyScore >= 7 && setup.bias === "bullish") {
    action = hasPosition(account) ? "hold" : "buy";
    actNow = actionWindow !== "defensive";
    reason = "Actionable setup — confirm entry trigger before sizing.";
  } else if (setup.bias === "bearish" && hasPosition(account)) {
    action = setup.aggressiveBuyScore <= 4 ? "trim" : "hold";
    actNow = setup.aggressiveBuyScore <= 4;
    reason = "Bearish intraday signals for held position.";
    riskLevel = "high";
  } else if (setup.aggressiveBuyScore >= 5) {
    action = "wait";
    reason = "Possible setup but needs confirmation.";
  } else {
    action = "wait";
    reason = "No intraday trigger met.";
  }

  if (marketCondition === "riskOff" && action === "buy") {
    action = "wait";
    actNow = false;
    reason = "Risk-off market — defer new entries.";
    riskLevel = "high";
  }

  if (
    account?.buyingPower != null &&
    account.buyingPower <= 0 &&
    (action === "buy" || action === "add")
  ) {
    action = hasPosition(account) ? "hold" : "wait";
    actNow = false;
    reason = "No buying power available for new entries.";
  }

  const triggerToAct =
    actNow || action === "buy" || action === "add"
      ? `Trigger: price holds in ${setup.entryZone.low}–${setup.entryZone.high}`
      : setup.invalidationConditions[0] ?? "Wait for setup improvement";

  return {
    symbol: setup.symbol,
    actNow,
    action,
    reason,
    triggerToAct,
    riskLevel,
    aggressiveBuyScore: setup.aggressiveBuyScore,
  };
}

export function equityToAccountContext(
  position: PortfolioEquityPosition,
  portfolio: PortfolioSnapshot,
  timeframe?: TradeTimeframe,
): TradeAccountContext {
  return {
    currentPositionShares: position.shares,
    averageCost: position.averageCost,
    currentValue: position.currentValue ?? position.marketValue,
    buyingPower: portfolio.buyingPower,
    riskTolerance: "balanced",
    timeframe,
  };
}

export function computeConcentrationRisk(
  portfolio: PortfolioSnapshot,
): string[] {
  const risks: string[] = [];
  if (portfolio.accountValue <= 0) {
    return risks;
  }

  const sorted = [...portfolio.equityPositions].sort((a, b) => {
    const aVal = a.marketValue ?? a.currentValue ?? 0;
    const bVal = b.marketValue ?? b.currentValue ?? 0;
    return bVal - aVal;
  });

  for (const position of sorted.slice(0, 3)) {
    const value = position.marketValue ?? position.currentValue ?? 0;
    const pct = (value / portfolio.accountValue) * 100;
    if (pct >= 25) {
      risks.push(
        `${position.symbol} is ${pct.toFixed(1)}% of account — concentration risk`,
      );
    }
  }

  const leveraged = portfolio.equityPositions.filter((p) =>
    isLeveragedEtf(p.symbol),
  );
  if (leveraged.length > 0) {
    risks.push(
      `Leveraged ETF exposure: ${leveraged.map((p) => p.symbol).join(", ")}`,
    );
  }

  return risks;
}

export function computeAccountRiskLevel(
  portfolio: PortfolioSnapshot,
  concentrationRisks: string[],
): "low" | "moderate" | "high" | "unknown" {
  if (portfolio.accountValue <= 0) {
    return "unknown";
  }
  if (concentrationRisks.length >= 2) {
    return "high";
  }
  if (concentrationRisks.length === 1) {
    return "moderate";
  }
  return "low";
}
