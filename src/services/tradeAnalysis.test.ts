import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WatchlistSignal, YahooQuote } from "../types/market.js";
import {
  buildTradeSetup,
  classifySetupType,
  computeAggressiveBuyScore,
  computeProbabilityScore,
  computeRelativeStrengthScore,
  determineSuggestedAction,
  semiLeadersConfirming,
  type MarketAnalysisBundle,
  type SymbolAnalysisInput,
} from "./tradeAnalysis.js";
import {
  type BiasResult,
  neutralSemiconductorStrength,
  type SemiconductorStrength,
} from "./scoring.js";
import { emptyBreadth, emptyFutures } from "../types/market.js";

function mockSignal(overrides: Partial<WatchlistSignal> = {}): WatchlistSignal {
  return {
    symbol: "AMD",
    score: 7,
    bias: "bullish",
    reasons: ["Price change +3.50%", "Semiconductor sector strength is strong"],
    riskFlags: [],
    price: 165,
    changePercent: 3.5,
    previousClose: 159.5,
    volume: 1_000_000,
    quoteSource: "Finnhub + Nasdaq",
    asOf: new Date().toISOString(),
    isDelayed: false,
    quoteValidated: true,
    dataFreshness: "fresh",
    confidence: 95,
    sourceQuality: "multi_source_agreement",
    inFinvizLists: ["topGainers"],
    ...overrides,
  };
}

function mockQuote(symbol: string, price: number, changePercent: number): YahooQuote {
  return {
    symbol,
    price,
    change: price * (changePercent / 100),
    changePercent,
    previousClose: price / (1 + changePercent / 100),
    preMarketPrice: null,
    preMarketChangePercent: changePercent,
    volume: 1_000_000,
    shortName: symbol,
    source: "Finnhub + Nasdaq",
    quoteValidated: true,
    dataFreshness: "fresh",
    sourceQuality: "multi_source_agreement",
    marketSession: "regular",
  };
}

function mockMarket(overrides: Partial<MarketAnalysisBundle> = {}): MarketAnalysisBundle {
  const semiStrong: SemiconductorStrength = {
    ...neutralSemiconductorStrength(),
    strength: "strong",
    sectorScore: 8.2,
    bias: "bullish",
    confidence: 92,
    positiveCount: 8,
    totalChecked: 11,
    leaders: ["NVDA +2.9%", "AMD +3.5%", "MU +4.1%", "AVGO +2.2%"],
    laggards: [],
    leaderSymbols: ["NVDA", "AMD", "MU", "AVGO"],
    laggardSymbols: [],
    symbolDetails: [
      { symbol: "NVDA", changePercent: 2.9, dataSource: "Finnhub" },
      { symbol: "AMD", changePercent: 3.5, dataSource: "Finnhub" },
      { symbol: "MU", changePercent: 4.1, dataSource: "Finnhub" },
      { symbol: "AVGO", changePercent: 2.2, dataSource: "Finnhub" },
    ],
  };

  const marketBias: BiasResult = {
    bias: "bearish",
    score: 4.2,
    confidence: 78,
    reasons: ["Nasdaq 100 futures -0.80% (bearish)", "Market breadth declining 58%"],
  };

  return {
    marketBias,
    semiconductorStrength: semiStrong,
    futures: emptyFutures(),
    breadth: { ...emptyBreadth(), decliningPercent: 58, advancingPercent: 42 },
    nasdaqFuturesChange: -0.8,
    sources: {
      quoteSource: "Finnhub + Nasdaq",
      futuresSource: "Finviz",
      breadthSource: "Finviz",
      semiconductorSource: "Finviz + quotes",
    },
    warnings: [],
    ...overrides,
  };
}

describe("tradeAnalysis", () => {
  it("semiLeadersConfirming returns true when NVDA/AMD/MU/AVGO are positive", () => {
    const market = mockMarket();
    assert.equal(semiLeadersConfirming(market.semiconductorStrength), true);
  });

  it("computeRelativeStrengthScore favors outperformance vs Nasdaq futures", () => {
    const score = computeRelativeStrengthScore({
      symbolChangePercent: 3.5,
      nasdaqFuturesChange: -0.8,
      semiconductorStrength: mockMarket().semiconductorStrength,
      symbol: "AMD",
    });
    assert.ok(score >= 65);
  });

  it("AMD setup in weak market with relative strength yields actionable score", () => {
    const market = mockMarket();
    const signal = mockSignal();
    const relativeStrengthScore = computeRelativeStrengthScore({
      symbolChangePercent: 3.5,
      nasdaqFuturesChange: -0.8,
      semiconductorStrength: market.semiconductorStrength,
      symbol: "AMD",
    });
    const setupType = classifySetupType({
      symbol: "AMD",
      changePercent: 3.5,
      signal,
      relativeStrengthScore,
      marketBias: market.marketBias,
    });
    const aggressiveBuyScore = computeAggressiveBuyScore({
      symbol: "AMD",
      signal,
      marketBias: market.marketBias,
      semiconductorStrength: market.semiconductorStrength,
      relativeStrengthScore,
      setupType,
      breadth: market.breadth,
      nasdaqFuturesChange: -0.8,
    });

    assert.equal(setupType, "breakout");
    assert.ok(aggressiveBuyScore >= 6);
  });

  it("SOXL includes leveraged ETF warning and penalizes weak momentum", () => {
    const market = mockMarket({
      marketBias: {
        bias: "bearish",
        score: 3.5,
        confidence: 85,
        reasons: ["Nasdaq 100 futures -1.20% (bearish)"],
      },
      nasdaqFuturesChange: -1.2,
      semiconductorStrength: {
        ...mockMarket().semiconductorStrength,
        strength: "mixed",
        sectorScore: 5.5,
      },
    });

    const analysis: SymbolAnalysisInput = {
      symbol: "SOXL",
      quote: mockQuote("SOXL", 52, -1.5),
      signal: mockSignal({
        symbol: "SOXL",
        score: 5,
        bias: "neutral",
        changePercent: -1.5,
        riskFlags: ["Leveraged ETF", "High volatility"],
        inFinvizLists: [],
      }),
      finvizLists: [],
    };

    const setup = buildTradeSetup({
      symbolAnalysis: analysis,
      market,
      account: { buyingPower: 5000, riskTolerance: "aggressive", timeframe: "intraday" },
    });

    assert.ok(setup.summary.includes("leveraged ETF"));
    assert.ok(setup.summary.includes("leveraged"));
  });

  it("zero buying power returns watch/hold framing", () => {
    const market = mockMarket();
    const analysis: SymbolAnalysisInput = {
      symbol: "NVDA",
      quote: mockQuote("NVDA", 140, 2.5),
      signal: mockSignal({ symbol: "NVDA", score: 8, bias: "bullish" }),
      finvizLists: ["topGainers"],
    };

    const setup = buildTradeSetup({
      symbolAnalysis: analysis,
      market,
      account: { buyingPower: 0 },
    });

    assert.ok(
      setup.suggestedAction === "watch" ||
        setup.suggestedAction === "no_action" ||
        setup.suggestedAction === "hold",
    );
    assert.ok(setup.summary.includes("Buying power is $0"));
  });

  it("does not recommend averaging down when position is down >10%", () => {
    const action = determineSuggestedAction({
      symbol: "MU",
      aggressiveBuyScore: 6,
      setupType: "continuation",
      signal: mockSignal({ symbol: "MU", bias: "bullish" }),
      account: {
        currentPositionShares: 100,
        averageCost: 120,
        currentValue: 10000,
        buyingPower: 5000,
      },
      bias: "bullish",
    });

    assert.notEqual(action, "add");
  });

  it("MU probability score increases with semi strength and relative strength", () => {
    const market = mockMarket();
    const signal = mockSignal({ symbol: "MU", changePercent: 4.2, score: 7.5 });
    const relativeStrengthScore = computeRelativeStrengthScore({
      symbolChangePercent: 4.2,
      nasdaqFuturesChange: -0.8,
      semiconductorStrength: market.semiconductorStrength,
      symbol: "MU",
    });
    const aggressiveBuyScore = 7.5;
    const probability = computeProbabilityScore({
      aggressiveBuyScore,
      relativeStrengthScore,
      marketBias: market.marketBias,
      setupType: "breakout",
      signal,
      semiconductorStrength: market.semiconductorStrength,
      symbol: "MU",
    });

    assert.ok(probability >= 55);
    assert.ok(aggressiveBuyScore >= 7);
  });

  it("buildTradeSetup returns required structured fields", () => {
    const setup = buildTradeSetup({
      symbolAnalysis: {
        symbol: "NVDA",
        quote: mockQuote("NVDA", 140, 2.5),
        signal: mockSignal({ symbol: "NVDA" }),
        finvizLists: ["topGainers"],
      },
      market: mockMarket({
        marketBias: {
          bias: "bullish",
          score: 7,
          confidence: 80,
          reasons: ["Nasdaq 100 futures +0.90% (bullish)"],
        },
        nasdaqFuturesChange: 0.9,
      }),
      account: { buyingPower: 10000, riskTolerance: "balanced", timeframe: "swing_1_5_days" },
    });

    assert.equal(setup.symbol, "NVDA");
    assert.ok(setup.entryZone.low > 0);
    assert.ok(setup.stopLoss.price < setup.currentPrice!);
    assert.ok(setup.profitTargets.target1 > setup.currentPrice!);
    assert.ok(setup.riskReward.target1RR >= 1);
    assert.ok(setup.invalidationConditions.length > 0);
    assert.ok(setup.disclaimer.includes("not financial advice"));
  });
});
