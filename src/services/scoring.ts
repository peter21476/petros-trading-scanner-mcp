import {
  SEMICONDUCTOR_SYMBOLS,
  type DailyBriefingResponse,
  type FuturesResponse,
  type MarketBreadth,
  type SnapshotStock,
  type WatchlistSignal,
  type YahooQuote,
} from "../types/market.js";

export type MarketBias = "bullish" | "neutral" | "bearish";

export interface BiasResult {
  bias: MarketBias;
  score: number;
  reasons: string[];
}

export interface SemiconductorStrength {
  strength: "strong" | "mixed" | "weak";
  positiveCount: number;
  totalChecked: number;
  leaders: string[];
  laggards: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Number(value.toFixed(1))));
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

  return { bias, score, reasons };
}

export function computeSemiconductorStrength(
  quotes: Map<string, YahooQuote>,
  majorNews: SnapshotStock[],
): SemiconductorStrength {
  const leaders: string[] = [];
  const laggards: string[] = [];
  let positiveCount = 0;
  let totalChecked = 0;

  const majorNewsMap = new Map(
    majorNews.map((item) => [item.symbol.toUpperCase(), item.changePercent ?? 0]),
  );

  for (const symbol of SEMICONDUCTOR_SYMBOLS) {
    const quote = quotes.get(symbol);
    const newsChange = majorNewsMap.get(symbol);
    const changePercent =
      quote?.preMarketChangePercent ??
      quote?.changePercent ??
      newsChange ??
      null;

    if (changePercent == null) {
      continue;
    }

    totalChecked += 1;
    if (changePercent > 0) {
      positiveCount += 1;
      leaders.push(`${symbol} +${changePercent.toFixed(2)}%`);
    } else if (changePercent < 0) {
      laggards.push(`${symbol} ${changePercent.toFixed(2)}%`);
    }
  }

  let strength: SemiconductorStrength["strength"] = "mixed";
  if (positiveCount >= 5) {
    strength = "strong";
  } else if (totalChecked > 0 && positiveCount <= 2 && laggards.length >= 5) {
    strength = "weak";
  }

  return { strength, positiveCount, totalChecked, leaders, laggards };
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
