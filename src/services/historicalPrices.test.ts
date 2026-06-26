import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSummary } from "../services/historicalPrices.js";
import type { OhlcvBar } from "../types/marketResearch.js";

function barsFromCloses(closes: number[]): OhlcvBar[] {
  return closes.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000_000,
  }));
}

describe("historicalPrices", () => {
  it("builds SMA summary from closes", () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 + index * 0.5);
    const summary = buildSummary(barsFromCloses(closes), "3mo");
    assert.ok(summary.sma20 != null);
    assert.ok(summary.sma50 != null);
    assert.equal(summary.currentPrice, closes.at(-1));
    assert.ok(summary.distanceFromSma20Pct != null);
  });

  it("includes 52-week high/low only for 1y period", () => {
    const closes = [90, 95, 100, 105, 110];
    const oneYear = buildSummary(barsFromCloses(closes), "1y");
    const threeMonth = buildSummary(barsFromCloses(closes), "3mo");
    assert.equal(oneYear.week52High, 111);
    assert.equal(oneYear.week52Low, 89);
    assert.equal(threeMonth.week52High, null);
    assert.equal(threeMonth.week52Low, null);
  });
});
