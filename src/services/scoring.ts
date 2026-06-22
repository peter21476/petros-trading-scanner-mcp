import {
  SEMICONDUCTOR_SYMBOLS,
  type DailyBriefingResponse,
  type FuturesResponse,
  type MarketBreadth,
  type PortfolioNote,
  type PortfolioPosition,
  type SemiconductorStrengthResponse,
  type SemiconductorSymbolDetail,
  type SnapshotStock,
  type WatchlistSignal,
  type YahooQuote,
} from "../types/market.js";

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

  const isSemi = SEMICONDUCTOR_SYMBOLS.includes(
    symbol.toUpperCase() as (typeof SEMICONDUCTOR_SYMBOLS)[number],
  );
  const isSoxl = symbol.toUpperCase() === "SOXL";

  if (isSemi && semiconductorStrength.strength === "strong") {
    score += 1.2;
    reasons.push("Semiconductor sector strength is strong");
  } else if (isSemi && semiconductorStrength.strength === "weak") {
    score -= 1.2;
    reasons.push("Semiconductor sector weakness");
  }

  if (isSoxl) {
    riskFlags.push("Leveraged ETF");
    riskFlags.push("High volatility");

    const nasdaqChange = input.nasdaqFuturesChange;
    if (
      semiconductorStrength.strength === "strong" &&
      nasdaqChange != null &&
      nasdaqChange > 0
    ) {
      score += 1.5;
      reasons.push("Strong semis + positive Nasdaq futures (SOXL tailwind)");
    } else if (
      nasdaqChange != null &&
      nasdaqChange < 0 &&
      semiconductorStrength.strength === "weak"
    ) {
      score -= 1.5;
      reasons.push("Negative Nasdaq futures + weak semiconductor leaders (SOXL headwind)");
    } else {
      reasons.push("SOXL setup mixed between Nasdaq futures and semiconductor breadth");
    }
  }

  if (marketBias.bias === "bullish") {
    score += 0.5;
    reasons.push("Overall market bias is bullish");
  } else if (marketBias.bias === "bearish") {
    score -= 0.5;
    reasons.push("Overall market bias is bearish");
  }

  score = clampScore(score);

  let bias: WatchlistSignal["bias"] = "neutral";
  if (score >= 6.5) {
    bias = "bullish";
  } else if (score <= 4) {
    bias = "bearish";
  }

  return {
    symbol: symbol.toUpperCase(),
    score,
    bias,
    reasons,
    riskFlags,
    price: quote?.price ?? null,
    changePercent,
    volume: quote?.volume ?? null,
    quoteSource: quote?.source ?? null,
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
