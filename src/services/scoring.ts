import {
  SEMICONDUCTOR_SYMBOLS,
  type DailyBriefingResponse,
  type FuturesResponse,
  type MarketBreadth,
  type PortfolioNote,
  type PortfolioPosition,
  type PositionAction,
  type PositionReviewResponse,
  type SemiconductorStrengthResponse,
  type SemiconductorSymbolDetail,
  type SnapshotStock,
  type WatchlistSignal,
  type YahooQuote,
} from "../types/market.js";
import { confidenceFromQuote } from "../utils/quoteConfidence.js";

export type MarketBias = "bullish" | "neutral" | "bearish";

export interface BiasResult {
  bias: MarketBias;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface SemiconductorStrength {
  strength: "strong" | "mixed" | "weak";
  positiveCount: number;
  totalChecked: number;
  leaderSymbols: string[];
  laggardSymbols: string[];
  leaders: string[];
  laggards: string[];
  sectorScore: number;
  bias: MarketBias;
  confidence: number;
  symbolDetails: SemiconductorSymbolDetail[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Number(value.toFixed(1))));
}

export function computeBiasConfidence(score: number, reasonCount: number): number {
  const distance = Math.abs(score - 5);
  const base = distance * 20 + 32;
  const agreementBoost = Math.min(18, reasonCount * 4);
  return Math.min(100, Math.round(base + agreementBoost));
}

export function biasLabelWithConfidence(bias: MarketBias, confidence: number): string {
  const intensity =
    confidence >= 75 ? "Strongly" : confidence >= 55 ? "Moderately" : "Slightly";
  if (bias === "neutral") {
    return "Neutral";
  }
  return `${intensity} ${bias}`;
}

export function computeMarketBias(
  futures: FuturesResponse["futures"],
  breadth: MarketBreadth,
): BiasResult {
  let score = 5;
  const reasons: string[] = [];

  const nasdaqChange = futures.nasdaq100.changePercent;
  if (nasdaqChange != null) {
    if (nasdaqChange > 0.5) {
      score += 1.5;
      reasons.push(`Nasdaq 100 futures +${nasdaqChange.toFixed(2)}% (bullish)`);
    } else if (nasdaqChange < -0.5) {
      score -= 1.5;
      reasons.push(`Nasdaq 100 futures ${nasdaqChange.toFixed(2)}% (bearish)`);
    }
  }

  const spChange = futures.sp500.changePercent;
  if (spChange != null) {
    if (spChange > 0.3) {
      score += 1;
      reasons.push(`S&P 500 futures +${spChange.toFixed(2)}% (bullish)`);
    } else if (spChange < -0.3) {
      score -= 1;
      reasons.push(`S&P 500 futures ${spChange.toFixed(2)}% (bearish)`);
    }
  }

  if (breadth.advancingPercent != null && breadth.advancingPercent > 55) {
    score += 1;
    reasons.push(`Market breadth advancing ${breadth.advancingPercent}%`);
  }
  if (breadth.decliningPercent != null && breadth.decliningPercent > 55) {
    score -= 1;
    reasons.push(`Market breadth declining ${breadth.decliningPercent}%`);
  }

  score = clampScore(score);

  let bias: MarketBias = "neutral";
  if (score >= 6.5) {
    bias = "bullish";
  } else if (score <= 4) {
    bias = "bearish";
  }

  return {
    bias,
    score,
    confidence: computeBiasConfidence(score, reasons.length),
    reasons,
  };
}

export function computeSemiconductorStrength(
  quotes: Map<string, YahooQuote>,
  majorNews: SnapshotStock[],
): SemiconductorStrength {
  const leaderSymbols: string[] = [];
  const laggardSymbols: string[] = [];
  const leaders: string[] = [];
  const laggards: string[] = [];
  const symbolDetails: SemiconductorSymbolDetail[] = [];
  let positiveCount = 0;
  let totalChecked = 0;
  let scoreSum = 0;

  const majorNewsMap = new Map(
    majorNews.map((item) => [item.symbol.toUpperCase(), item]),
  );

  for (const symbol of SEMICONDUCTOR_SYMBOLS) {
    const quote = quotes.get(symbol);
    const newsItem = majorNewsMap.get(symbol);
    const newsChange = newsItem?.changePercent ?? null;
    const changePercent =
      quote?.preMarketChangePercent ??
      quote?.changePercent ??
      newsChange ??
      null;

    const dataSource = quote?.source
      ?? (newsChange != null ? "Finviz major news" : "unavailable");

    symbolDetails.push({
      symbol,
      changePercent,
      dataSource,
    });

    if (changePercent == null) {
      continue;
    }

    totalChecked += 1;
    scoreSum += changePercent;

    if (changePercent > 0) {
      positiveCount += 1;
      leaderSymbols.push(symbol);
      leaders.push(`${symbol} +${changePercent.toFixed(2)}%`);
    } else if (changePercent < 0) {
      laggardSymbols.push(symbol);
      laggards.push(`${symbol} ${changePercent.toFixed(2)}%`);
    }
  }

  let strength: SemiconductorStrength["strength"] = "mixed";
  if (positiveCount >= 5) {
    strength = "strong";
  } else if (totalChecked > 0 && positiveCount <= 2 && laggardSymbols.length >= 5) {
    strength = "weak";
  }

  let sectorScore = 5;
  if (totalChecked > 0) {
    const averageChange = scoreSum / totalChecked;
    sectorScore = clampScore(5 + averageChange / 2);
    if (strength === "strong") {
      sectorScore = clampScore(Math.max(sectorScore, 7.5));
    } else if (strength === "weak") {
      sectorScore = clampScore(Math.min(sectorScore, 3.5));
    }
  }

  let bias: MarketBias = "neutral";
  if (sectorScore >= 6.5) {
    bias = "bullish";
  } else if (sectorScore <= 4) {
    bias = "bearish";
  }

  const confidence = computeBiasConfidence(
    sectorScore,
    positiveCount + laggardSymbols.length,
  );

  return {
    strength,
    positiveCount,
    totalChecked,
    leaderSymbols,
    laggardSymbols,
    leaders,
    laggards,
    sectorScore,
    bias,
    confidence,
    symbolDetails,
  };
}

export function buildSemiconductorSummary(strength: SemiconductorStrength): string {
  if (strength.strength === "strong") {
    return `Semiconductors outperforming market with ${strength.positiveCount}/${strength.totalChecked} tracked names positive.`;
  }
  if (strength.strength === "weak") {
    return `Semiconductor weakness with ${strength.laggardSymbols.length}/${strength.totalChecked} tracked names negative.`;
  }
  if (strength.leaderSymbols.length > 0) {
    return `Mixed semiconductor tape; leaders include ${strength.leaderSymbols.slice(0, 3).join(", ")}.`;
  }
  return "Semiconductor strength mixed with limited live quote coverage.";
}

export function toSemiconductorStrengthResponse(
  strength: SemiconductorStrength,
  source: string,
  warnings: string[] = [],
): SemiconductorStrengthResponse {
  return {
    timestamp: new Date().toISOString(),
    source,
    warnings,
    sectorScore: strength.sectorScore,
    bias: strength.bias,
    confidence: strength.confidence,
    leaders: strength.leaderSymbols,
    laggards: strength.laggardSymbols,
    summary: buildSemiconductorSummary(strength),
    symbols: strength.symbolDetails,
  };
}

export function buildPortfolioNotes(input: {
  positions?: PortfolioPosition[];
  portfolioContext?: string;
  semiconductorStrength: SemiconductorStrength;
  marketBias: BiasResult;
  watchlistSignals: WatchlistSignal[];
}): PortfolioNote[] {
  const notes: PortfolioNote[] = [];
  const positions = input.positions ?? [];

  for (const position of positions) {
    const symbol = position.symbol.toUpperCase();
    const signal = input.watchlistSignals.find((item) => item.symbol === symbol);
    const pnlPercent =
      position.costBasis != null &&
      position.currentValue != null &&
      position.costBasis > 0
        ? Number(
            (
              ((position.currentValue - position.costBasis) / position.costBasis) *
              100
            ).toFixed(2),
          )
        : null;

    let thesisStatus: PortfolioNote["thesisStatus"] = "mixed";
    let note = `${symbol} position noted`;

    const isSoxl = symbol === "SOXL";
    const semiStrong = input.semiconductorStrength.strength === "strong";
    const semiWeak = input.semiconductorStrength.strength === "weak";

    if (isSoxl) {
      if (semiStrong && input.marketBias.bias !== "bearish") {
        thesisStatus = "intact";
        note =
          "Semiconductor strength remains positive. Current SOXL thesis remains intact.";
      } else if (semiWeak && input.marketBias.bias === "bearish") {
        thesisStatus = "weakened";
        note =
          "Semiconductor weakness and bearish market bias weaken the SOXL thesis.";
      } else {
        thesisStatus = "mixed";
        note =
          "SOXL thesis is mixed as semiconductor strength and market bias are not fully aligned.";
      }
    } else if (signal?.bias === "bullish" && semiStrong) {
      thesisStatus = "intact";
      note = `${symbol} aligns with strong semiconductor leadership and bullish watchlist signal.`;
    } else if (signal?.bias === "bearish" || semiWeak) {
      thesisStatus = "weakened";
      note = `${symbol} faces weaker sector or symbol-level signals.`;
    } else {
      thesisStatus = "mixed";
      note = `${symbol} setup is mixed based on current sector and symbol signals.`;
    }

    if (pnlPercent != null) {
      note += ` Position P/L: ${pnlPercent >= 0 ? "+" : ""}${pnlPercent}% vs cost basis.`;
    }

    notes.push({
      symbol,
      note,
      pnlPercent,
      thesisStatus,
    });
  }

  if (notes.length === 0 && input.portfolioContext) {
    notes.push({
      symbol: "PORTFOLIO",
      note: input.portfolioContext,
      pnlPercent: null,
      thesisStatus: input.semiconductorStrength.strength === "strong" ? "intact" : "mixed",
    });
  }

  return notes;
}

export function scoreWatchlistSymbol(input: {
  symbol: string;
  quote?: YahooQuote | null;
  finvizLists: string[];
  headline?: string | null;
  marketBias: BiasResult;
  semiconductorStrength: SemiconductorStrength;
  nasdaqFuturesChange?: number | null;
}): WatchlistSignal {
  const { symbol, quote, finvizLists, headline, marketBias, semiconductorStrength } =
    input;

  let score = 5;
  const reasons: string[] = [];
  const riskFlags: string[] = [];

  const changePercent =
    quote?.preMarketChangePercent ?? quote?.changePercent ?? null;

  if (changePercent != null) {
    if (changePercent > 2) {
      score += 1.5;
      reasons.push(`Price change +${changePercent.toFixed(2)}%`);
    } else if (changePercent > 0) {
      score += 0.5;
      reasons.push(`Price change +${changePercent.toFixed(2)}%`);
    } else if (changePercent < -2) {
      score -= 1.5;
      reasons.push(`Price change ${changePercent.toFixed(2)}%`);
    } else if (changePercent < 0) {
      score -= 0.5;
      reasons.push(`Price change ${changePercent.toFixed(2)}%`);
    }
  }

  if (finvizLists.includes("majorNews")) {
    score += 0.8;
    reasons.push("Appears in Finviz major news");
  }
  if (finvizLists.includes("topGainers") || finvizLists.includes("unusualVolume")) {
    score += 0.7;
    reasons.push("Finviz momentum/unusual volume flag");
  }
  if (finvizLists.includes("topLosers")) {
    score -= 1;
    reasons.push("Appears in Finviz top losers");
  }

  if (headline) {
    reasons.push(`Recent headline: ${headline}`);
  }

  const isSemi = isSemiconductorSymbol(symbol.toUpperCase());
  const isSemiEtf = isSemiconductorEtf(symbol.toUpperCase());
  const isLeveraged = isLeveragedEtf(symbol.toUpperCase());

  if (isSemi && semiconductorStrength.strength === "strong") {
    score += 1.2;
    reasons.push("Semiconductor sector strength is strong");
  } else if (isSemi && semiconductorStrength.strength === "weak") {
    score -= 1.2;
    reasons.push("Semiconductor sector weakness");
  }

  if (isLeveraged) {
    riskFlags.push("Leveraged ETF");
    riskFlags.push("High volatility");
  }

  if (isSemiEtf || isLeveragedEtf(symbol.toUpperCase())) {
    const nasdaqChange = input.nasdaqFuturesChange;
    if (
      semiconductorStrength.strength === "strong" &&
      nasdaqChange != null &&
      nasdaqChange > 0
    ) {
      score += 1.5;
      reasons.push("Strong semis + positive Nasdaq futures (sector ETF tailwind)");
    } else if (
      nasdaqChange != null &&
      nasdaqChange < 0 &&
      semiconductorStrength.strength === "weak"
    ) {
      score -= 1.5;
      reasons.push("Negative Nasdaq futures + weak semiconductor leaders (sector ETF headwind)");
    } else if (isSemiEtf) {
      reasons.push("Sector ETF setup mixed between Nasdaq futures and semiconductor breadth");
    }
  }

  if (marketBias.bias === "bullish") {
    score += 0.5;
    reasons.push("Overall market bias is bullish");
  } else if (marketBias.bias === "bearish") {
    score -= 0.5;
    reasons.push("Overall market bias is bearish");
  }

  if (quote?.quoteValidated === false) {
    riskFlags.push("Quote fields were reconciled — verify price against broker");
  }
  if (quote?.dataFreshness === "stale") {
    riskFlags.push(
      quote?.freshnessReason ??
        (quote?.asOf
          ? `Quote data is stale (as of ${quote.asOf})`
          : "Quote data is stale or missing timestamp"),
    );
  }

  score = clampScore(score);

  let bias: WatchlistSignal["bias"] = "neutral";
  if (score >= 6.5) {
    bias = "bullish";
  } else if (score <= 4) {
    bias = "bearish";
  }

  const dataFreshness = quote?.dataFreshness ?? "stale";
  const quoteValidated = quote?.quoteValidated ?? false;
  const confidence = confidenceFromQuote(quote);

  return {
    symbol: symbol.toUpperCase(),
    score,
    bias,
    reasons,
    riskFlags,
    price: quote?.price ?? null,
    changePercent,
    previousClose: quote?.previousClose ?? null,
    volume: quote?.volume ?? null,
    quoteSource: quote?.source ?? null,
    asOf: quote?.asOf ?? null,
    isDelayed: quote?.isDelayed ?? false,
    quoteValidated,
    dataFreshness,
    confidence,
    sourceQuality: quote?.sourceQuality ?? "unavailable",
    providerTimestamps: quote?.providerTimestamps,
    marketSession: quote?.marketSession,
    freshnessAgeMinutes: quote?.freshnessAgeMinutes,
    freshnessReason: quote?.freshnessReason,
    headline: headline ?? null,
    inFinvizLists: finvizLists,
  };
}

export function buildSectorNotes(
  semiconductorStrength: SemiconductorStrength,
  futures: FuturesResponse["futures"],
  majorNews: SnapshotStock[],
): DailyBriefingResponse["sectorNotes"] {
  const techSymbols = ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA"];
  const techPositive = majorNews.filter(
    (item) =>
      techSymbols.includes(item.symbol) && (item.changePercent ?? 0) > 0,
  ).length;

  const semiLabel =
    semiconductorStrength.strength === "strong"
      ? "Strong"
      : semiconductorStrength.strength === "weak"
        ? "Weak"
        : "Mixed";

  const semiDetail =
    semiconductorStrength.leaders.length > 0
      ? ` Leaders: ${semiconductorStrength.leaders.slice(0, 4).join(", ")}.`
      : semiconductorStrength.leaderSymbols.length > 0
        ? ` Leaders: ${semiconductorStrength.leaderSymbols.slice(0, 4).join(", ")}.`
        : "";

  const crudeChange = futures.crudeOil.changePercent;
  const energyLabel =
    crudeChange != null && crudeChange > 1
      ? "Strong"
      : crudeChange != null && crudeChange < -1
        ? "Weak"
        : "Mixed";

  const energyDetail =
    crudeChange != null
      ? ` Crude oil futures ${crudeChange >= 0 ? "+" : ""}${crudeChange.toFixed(2)}%.`
      : "";

  const techLabel =
    techPositive >= 3 ? "Strong" : techPositive <= 1 ? "Mixed/weak" : "Mixed";

  return {
    semiconductors: `${semiLabel} — ${semiconductorStrength.positiveCount}/${semiconductorStrength.totalChecked || SEMICONDUCTOR_SYMBOLS.length} tracked semis positive.${semiDetail}`,
    technology: `${techLabel} — ${techPositive} mega-cap tech names positive in Finviz major news.`,
    energy: `${energyLabel} —${energyDetail}`,
  };
}

export function buildSuggestedQuestions(
  focusSymbols: string[],
  marketBias: MarketBias,
): string[] {
  const primary = focusSymbols[0] ?? "SOXL";
  const questions = [
    `Should I hold ${primary}?`,
    "Which semiconductor names are strongest premarket?",
    `Give me a market bias for today (${marketBias}).`,
    "What are the biggest premarket movers and why?",
    "Any earnings this week that could move my watchlist?",
  ];
  return questions.slice(0, 5);
}

function computePnlPercent(
  costBasis?: number,
  currentValue?: number,
): number | null {
  if (
    costBasis == null ||
    currentValue == null ||
    costBasis <= 0
  ) {
    return null;
  }
  return Number((((currentValue - costBasis) / costBasis) * 100).toFixed(2));
}

const SEMICONDUCTOR_ETFS = new Set(["SOXL", "SOXS", "SMH", "SOXX"]);
const LEVERAGED_ETFS = new Set([
  "SOXL",
  "SOXS",
  "TQQQ",
  "SQQQ",
  "UPRO",
  "SPXU",
  "TNA",
  "TZA",
  "TECL",
  "TECS",
  "FAS",
  "FAZ",
  "LABU",
  "LABD",
  "UDOW",
  "SDOW",
]);
const INDEX_ETFS = new Set(["QQQ", "SPY", "IWM", "DIA"]);

export function isSemiconductorSymbol(symbol: string): boolean {
  return SEMICONDUCTOR_SYMBOLS.includes(
    symbol.toUpperCase() as (typeof SEMICONDUCTOR_SYMBOLS)[number],
  );
}

export function isSemiconductorEtf(symbol: string): boolean {
  return SEMICONDUCTOR_ETFS.has(symbol.toUpperCase());
}

export function isLeveragedEtf(symbol: string): boolean {
  return LEVERAGED_ETFS.has(symbol.toUpperCase());
}

export function symbolUsesSemiconductorContext(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return isSemiconductorSymbol(upper) || isSemiconductorEtf(upper);
}

export function neutralSemiconductorStrength(): SemiconductorStrength {
  return {
    strength: "mixed",
    positiveCount: 0,
    totalChecked: 0,
    leaderSymbols: [],
    laggardSymbols: [],
    leaders: [],
    laggards: [],
    sectorScore: 5,
    bias: "neutral",
    confidence: 50,
    symbolDetails: [],
  };
}

type SectorRelevance = "semiconductor" | "broad_market" | "none";

interface SymbolReviewContext {
  symbol: string;
  isSemiconductor: boolean;
  isSemiconductorEtf: boolean;
  isLeveragedEtf: boolean;
  isIndexEtf: boolean;
  sectorRelevance: SectorRelevance;
}

function analyzeSymbolReviewContext(
  symbol: string,
  signal: WatchlistSignal,
): SymbolReviewContext {
  const upper = symbol.toUpperCase();
  const isSemiconductor = isSemiconductorSymbol(upper);
  const isSemiEtf = isSemiconductorEtf(upper);
  const isLeveraged =
    isLeveragedEtf(upper) ||
    signal.riskFlags.some((flag) => /leveraged/i.test(flag));
  const isIndexEtf = INDEX_ETFS.has(upper);

  let sectorRelevance: SectorRelevance = "none";
  if (isSemiconductor || isSemiEtf) {
    sectorRelevance = "semiconductor";
  } else if (isIndexEtf || isLeveragedEtf(upper)) {
    sectorRelevance = "broad_market";
  }

  return {
    symbol: upper,
    isSemiconductor,
    isSemiconductorEtf: isSemiEtf,
    isLeveragedEtf: isLeveraged,
    isIndexEtf,
    sectorRelevance,
  };
}

function buildSectorStrengthSection(
  context: SymbolReviewContext,
  strength: SemiconductorStrength,
): PositionReviewResponse["sectorStrength"] {
  if (context.sectorRelevance === "none") {
    return { applicable: false };
  }

  return {
    applicable: true,
    sectorScore: strength.sectorScore,
    strength: strength.strength,
    bias: strength.bias,
    confidence: strength.confidence,
    leaders: strength.leaders.slice(0, 4),
    laggards: strength.laggards.slice(0, 4),
    summary: buildSemiconductorSummary(strength),
  };
}

function determinePositionAction(input: {
  context: SymbolReviewContext;
  signal: WatchlistSignal;
  semiconductorStrength: SemiconductorStrength;
  marketBias: BiasResult;
  pnlPercent: number | null;
}): PositionAction {
  const { context, signal, semiconductorStrength, marketBias, pnlPercent } = input;
  const semiStrong = semiconductorStrength.strength === "strong";
  const semiWeak = semiconductorStrength.strength === "weak";
  const sectorAlignedWeak =
    context.sectorRelevance === "semiconductor" &&
    semiWeak &&
    marketBias.bias === "bearish" &&
    signal.bias === "bearish";

  if (
    pnlPercent != null &&
    pnlPercent <= -25 &&
    (signal.score <= 5 || signal.bias === "bearish")
  ) {
    return "exit";
  }

  if (signal.score <= 3.5 || sectorAlignedWeak) {
    return "exit";
  }

  if (pnlPercent != null && pnlPercent <= -15 && signal.score <= 5.5) {
    return "trim";
  }

  if (
    signal.score <= 4.5 ||
    signal.bias === "bearish" ||
    (context.sectorRelevance === "semiconductor" &&
      semiWeak &&
      marketBias.bias === "bearish")
  ) {
    return "trim";
  }

  const sectorSupportsAdd =
    context.sectorRelevance === "none" ||
    (context.sectorRelevance === "semiconductor" && semiStrong) ||
    (context.sectorRelevance === "broad_market" && marketBias.bias === "bullish");

  if (
    signal.score >= 7.5 &&
    signal.bias === "bullish" &&
    sectorSupportsAdd &&
    marketBias.bias !== "bearish" &&
    (pnlPercent == null || pnlPercent > -10)
  ) {
    return "add";
  }

  if (pnlPercent != null && pnlPercent >= 25 && signal.score < 6.5) {
    return "trim";
  }

  return "hold";
}

function buildPositionThesis(input: {
  context: SymbolReviewContext;
  signal: WatchlistSignal;
  semiconductorStrength: SemiconductorStrength;
  marketBias: BiasResult;
  nasdaqFuturesChange?: number | null;
  pnlPercent: number | null;
  portfolioContext?: string;
}): string {
  const {
    context,
    signal,
    semiconductorStrength,
    marketBias,
    nasdaqFuturesChange,
    pnlPercent,
    portfolioContext,
  } = input;
  const { symbol, sectorRelevance } = context;
  const semiStrong = semiconductorStrength.strength === "strong";
  const semiWeak = semiconductorStrength.strength === "weak";
  const futuresWeak = nasdaqFuturesChange != null && nasdaqFuturesChange < 0;
  const futuresStrong = nasdaqFuturesChange != null && nasdaqFuturesChange > 0;

  if (sectorRelevance === "semiconductor") {
    if (semiStrong && futuresWeak) {
      return `${symbol} thesis: semiconductor sector remains strong despite weak futures.`;
    }
    if (semiStrong && marketBias.bias !== "bearish") {
      return `${symbol} thesis remains supported by strong semiconductor sector leadership.`;
    }
    if (semiWeak && marketBias.bias === "bearish") {
      return `${symbol} thesis is under pressure from semiconductor weakness and bearish market tone.`;
    }
    return `${symbol} setup is mixed between semiconductor breadth and broader market direction.`;
  }

  if (sectorRelevance === "broad_market") {
    if (marketBias.bias === "bullish" && futuresStrong) {
      return `${symbol} aligns with bullish market bias and positive index futures.`;
    }
    if (marketBias.bias === "bearish" && futuresWeak) {
      return `${symbol} faces headwinds from bearish market bias and weak index futures.`;
    }
    return `${symbol} setup is mixed between symbol momentum and broader market direction.`;
  }

  if (signal.bias === "bullish" && marketBias.bias === "bullish") {
    return `${symbol} shows bullish symbol and market signals.`;
  }
  if (signal.bias === "bearish" || marketBias.bias === "bearish") {
    return `${symbol} faces weaker symbol or market-level signals.`;
  }

  let thesis = `${symbol} setup is ${signal.bias} with ${marketBias.bias} overall market bias.`;
  if (pnlPercent != null) {
    thesis += ` Position is ${pnlPercent >= 0 ? "up" : "down"} ${Math.abs(pnlPercent).toFixed(2)}% vs cost basis.`;
  }
  if (portfolioContext) {
    thesis += ` Context: ${portfolioContext}`;
  }
  return thesis;
}

function buildPositionStrengths(input: {
  context: SymbolReviewContext;
  signal: WatchlistSignal;
  semiconductorStrength: SemiconductorStrength;
  marketBias: BiasResult;
  nasdaqFuturesChange?: number | null;
  pnlPercent: number | null;
}): string[] {
  const strengths: string[] = [];
  const { context, signal, semiconductorStrength, marketBias, nasdaqFuturesChange, pnlPercent } =
    input;

  if (pnlPercent != null && pnlPercent > 0) {
    strengths.push(`Position up ${pnlPercent.toFixed(2)}% vs cost basis`);
  }

  if (context.sectorRelevance === "semiconductor") {
    if (semiconductorStrength.strength === "strong") {
      strengths.push(
        `Semiconductor sector score ${semiconductorStrength.sectorScore}/10 (${semiconductorStrength.confidence}% confidence)`,
      );
      if (semiconductorStrength.leaders.length > 0) {
        strengths.push(
          `Semi leaders: ${semiconductorStrength.leaders.slice(0, 4).join(", ")}`,
        );
      }
    }
  }

  if (signal.bias === "bullish") {
    strengths.push(`Watchlist signal is bullish (${signal.score}/10)`);
  } else if (signal.score >= 6) {
    strengths.push(`Moderately constructive symbol score (${signal.score}/10)`);
  }

  if (marketBias.bias === "bullish") {
    strengths.push(`Market bias is bullish (${marketBias.confidence}% confidence)`);
  }

  if (
    (context.sectorRelevance === "broad_market" || context.isLeveragedEtf) &&
    nasdaqFuturesChange != null &&
    nasdaqFuturesChange > 0
  ) {
    strengths.push(`Nasdaq 100 futures positive (+${nasdaqFuturesChange.toFixed(2)}%)`);
  }

  for (const reason of signal.reasons) {
    if (
      reason.includes("+") ||
      reason.includes("strong") ||
      reason.includes("bullish") ||
      reason.includes("tailwind") ||
      reason.includes("momentum")
    ) {
      strengths.push(reason);
    }
  }

  if (signal.sourceQuality === "multi_source_agreement") {
    strengths.push("Quote corroborated across multiple data sources");
  }

  return [...new Set(strengths)].slice(0, 6);
}

function buildPositionRisks(input: {
  context: SymbolReviewContext;
  signal: WatchlistSignal;
  semiconductorStrength: SemiconductorStrength;
  marketBias: BiasResult;
  nasdaqFuturesChange?: number | null;
  pnlPercent: number | null;
}): string[] {
  const risks: string[] = [...input.signal.riskFlags];
  const { context, signal, semiconductorStrength, marketBias, nasdaqFuturesChange, pnlPercent } =
    input;

  if (pnlPercent != null && pnlPercent < 0) {
    risks.push(`Position down ${Math.abs(pnlPercent).toFixed(2)}% vs cost basis`);
  }
  if (pnlPercent != null && pnlPercent >= 20 && signal.score < 7) {
    risks.push("Large unrealized gain with only moderate symbol momentum");
  }

  if (context.isLeveragedEtf && !risks.some((r) => /leveraged/i.test(r))) {
    risks.push("Leveraged ETF — amplified gains and losses");
  }

  if (
    context.sectorRelevance === "semiconductor" &&
    semiconductorStrength.strength === "weak"
  ) {
    risks.push("Semiconductor sector showing broad weakness");
    if (semiconductorStrength.laggards.length > 0) {
      risks.push(
        `Semi laggards: ${semiconductorStrength.laggards.slice(0, 4).join(", ")}`,
      );
    }
  }

  if (marketBias.bias === "bearish") {
    risks.push(`Bearish market bias (${marketBias.confidence}% confidence)`);
  }

  if (
    (context.sectorRelevance === "broad_market" || context.isLeveragedEtf) &&
    nasdaqFuturesChange != null &&
    nasdaqFuturesChange < 0
  ) {
    risks.push(`Nasdaq 100 futures negative (${nasdaqFuturesChange.toFixed(2)}%)`);
  }

  if (signal.bias === "bearish") {
    risks.push(`Bearish watchlist signal (${signal.score}/10)`);
  }

  if (signal.dataFreshness === "stale") {
    risks.push("Quote data may be stale — verify live prices");
  }

  if (signal.sourceQuality === "nasdaq_only") {
    risks.push("Quote sourced from Nasdaq only");
  }
  if (signal.sourceQuality === "finviz_only") {
    risks.push("Quote sourced from Finviz snapshot only");
  }

  for (const reason of signal.reasons) {
    if (
      reason.includes("headwind") ||
      reason.includes("losers") ||
      reason.includes("weak") ||
      reason.includes("bearish") ||
      (reason.includes("Price change") && reason.includes("-"))
    ) {
      risks.push(reason);
    }
  }

  return [...new Set(risks)].slice(0, 8);
}

function computePositionConfidence(input: {
  context: SymbolReviewContext;
  signal: WatchlistSignal;
  semiconductorStrength: SemiconductorStrength;
  marketBias: BiasResult;
  action: PositionAction;
}): number {
  const quoteConfidence = input.signal.confidence ?? 70;
  const semiConfidence = input.semiconductorStrength.confidence;
  const biasConfidence = input.marketBias.confidence;
  const signalScoreComponent = (input.signal.score / 10) * 100;

  const semiWeight =
    input.context.sectorRelevance === "semiconductor" ? 0.35 : 0.05;
  const quoteWeight = 0.3;
  const biasWeight = 0.2;
  const signalWeight = 0.15;
  const remainder = 1 - quoteWeight - semiWeight - biasWeight - signalWeight;

  let confidence = Math.round(
    quoteConfidence * quoteWeight +
      semiConfidence * semiWeight +
      biasConfidence * (biasWeight + remainder) +
      signalScoreComponent * signalWeight,
  );

  if (input.signal.sourceQuality === "multi_source_agreement") {
    confidence += 3;
  }
  if (input.signal.dataFreshness === "stale") {
    confidence -= 5;
  }
  if (
    input.action === "hold" &&
    input.context.sectorRelevance === "semiconductor" &&
    input.semiconductorStrength.strength === "strong"
  ) {
    confidence += 4;
  }

  return Math.max(0, Math.min(100, confidence));
}

export function reviewPosition(input: {
  symbol: string;
  costBasis?: number;
  currentValue?: number;
  portfolioContext?: string;
  signal: WatchlistSignal;
  marketBias: BiasResult;
  semiconductorStrength: SemiconductorStrength;
  nasdaqFuturesChange?: number | null;
  sources?: PositionReviewResponse["sources"];
  warnings?: string[];
}): PositionReviewResponse {
  const symbol = input.symbol.toUpperCase();
  const pnlPercent = computePnlPercent(input.costBasis, input.currentValue);
  const context = analyzeSymbolReviewContext(symbol, input.signal);

  const action = determinePositionAction({
    context,
    signal: input.signal,
    semiconductorStrength: input.semiconductorStrength,
    marketBias: input.marketBias,
    pnlPercent,
  });

  const thesis = buildPositionThesis({
    context,
    signal: input.signal,
    semiconductorStrength: input.semiconductorStrength,
    marketBias: input.marketBias,
    nasdaqFuturesChange: input.nasdaqFuturesChange,
    pnlPercent,
    portfolioContext: input.portfolioContext,
  });

  const strengths = buildPositionStrengths({
    context,
    signal: input.signal,
    semiconductorStrength: input.semiconductorStrength,
    marketBias: input.marketBias,
    nasdaqFuturesChange: input.nasdaqFuturesChange,
    pnlPercent,
  });

  const risks = buildPositionRisks({
    context,
    signal: input.signal,
    semiconductorStrength: input.semiconductorStrength,
    marketBias: input.marketBias,
    nasdaqFuturesChange: input.nasdaqFuturesChange,
    pnlPercent,
  });

  const confidence = computePositionConfidence({
    context,
    signal: input.signal,
    semiconductorStrength: input.semiconductorStrength,
    marketBias: input.marketBias,
    action,
  });

  return {
    timestamp: new Date().toISOString(),
    symbol,
    costBasis: input.costBasis,
    currentValue: input.currentValue,
    pnlPercent,
    action,
    confidence,
    thesis,
    strengths,
    risks,
    signalScore: input.signal.score,
    account: {
      costBasis: input.costBasis,
      currentValue: input.currentValue,
      pnlPercent,
      portfolioContext: input.portfolioContext,
    },
    marketBias: {
      bias: input.marketBias.bias,
      confidence: input.marketBias.confidence,
      reasons: input.marketBias.reasons,
    },
    sectorStrength: buildSectorStrengthSection(context, input.semiconductorStrength),
    watchlistSignal: input.signal,
    sources: input.sources,
    warnings: input.warnings,
  };
}
