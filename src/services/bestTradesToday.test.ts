import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPortfolioRotationPlan } from "./portfolioRotation.js";
import { portfolioFromAccountContext } from "./portfolio.js";
import type { BestTradeCandidate } from "../types/trading.js";

function mockCandidate(
  symbol: string,
  convictionScore: number,
  suggestedAction: BestTradeCandidate["suggestedAction"],
): BestTradeCandidate {
  return {
    rank: 1,
    symbol,
    companyName: symbol,
    currentPrice: 100,
    bias: "bullish",
    setupType: "momentum",
    convictionScore,
    suggestedAction,
    entryZone: { low: 99, high: 101, rationale: "test" },
    stopLoss: { price: 97, percentRisk: 3, rationale: "test" },
    profitTargets: { target1: 103, target2: 106 },
    riskReward: { target1RR: 1.5, target2RR: 2.5 },
    scores: {
      momentumScore: 8,
      relativeStrengthScore: 8,
      volumeScore: 7,
      catalystScore: 7,
      trendScore: 7,
      riskRewardScore: 8,
      liquidityScore: 9,
      marketAlignmentScore: 8,
    },
    catalysts: ["Unusual volume"],
    risks: ["Verify quotes with broker"],
    whyThisTrade: "Test candidate",
    invalidationConditions: ["Breaks below stop"],
  };
}

describe("portfolio and rotation", () => {
  it("portfolioFromAccountContext builds snapshot from connector data", () => {
    const snapshot = portfolioFromAccountContext({
      accountValue: 90.04,
      buyingPower: 0,
      equityPositions: [
        {
          symbol: "SOXL",
          shares: 0.182748,
          averageCost: 273.6,
          currentValue: 40,
          marketValue: 40,
        },
        {
          symbol: "AMD",
          shares: 0.095706,
          averageCost: 522.43,
          currentValue: 50,
          marketValue: 50,
        },
      ],
      optionPositions: [],
    });

    assert.ok(snapshot);
    assert.equal(snapshot!.buyingPower, 0);
    assert.equal(snapshot!.equityPositions.length, 2);
    assert.equal(snapshot!.source, "account_context");
  });

  it("buildPortfolioRotationPlan handles zero buying power", () => {
    const portfolio = portfolioFromAccountContext({
      accountValue: 90.04,
      buyingPower: 0,
      equityPositions: [
        {
          symbol: "SOXL",
          shares: 0.18,
          averageCost: 273.6,
          currentValue: 40,
        },
        {
          symbol: "AMD",
          shares: 0.09,
          averageCost: 522.43,
          currentValue: 50,
        },
      ],
    })!;

    const results = [
      mockCandidate("NVDA", 91, "buy_watch"),
      mockCandidate("AMD", 62, "wait_for_trigger"),
      mockCandidate("SOXL", 38, "trim"),
    ];

    const plan = buildPortfolioRotationPlan({
      portfolio,
      results,
      heldSymbols: new Set(["SOXL", "AMD"]),
    });

    assert.equal(plan.canBuyNow, false);
    assert.equal(plan.buyingPower, 0);
    assert.ok(plan.summary.includes("No buying power"));
    assert.ok(plan.positionsToAvoidAdding.includes("SOXL"));
  });
});
