import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contractToFlowItem } from "../services/yfinanceOptions.js";

describe("yfinanceOptions", () => {
  it("flags unusual when volume/OI >= 3 and premium meets threshold", () => {
    const item = contractToFlowItem(
      "DKNG",
      "2026-07-18",
      "call",
      { strike: 25, volume: 1500, openInterest: 300, ask: 1.25 },
      50_000,
    );
    assert.ok(item);
    assert.equal(item.unusual, true);
    assert.equal(item.volumeOiRatio, 5);
    assert.equal(item.premium, 187_500);
    assert.equal(item.sentiment, "bullish");
    assert.equal(item.source, "yfinance");
  });

  it("excludes contracts below minPremium", () => {
    const item = contractToFlowItem(
      "DKNG",
      "2026-07-18",
      "put",
      { strike: 25, volume: 10, openInterest: 100, ask: 1 },
      50_000,
    );
    assert.equal(item, null);
  });

  it("excludes zero volume or open interest", () => {
    assert.equal(
      contractToFlowItem("AAPL", "2026-01-01", "call", {
        strike: 100,
        volume: 0,
        openInterest: 100,
        ask: 2,
      }, 1000),
      null,
    );
    assert.equal(
      contractToFlowItem("AAPL", "2026-01-01", "put", {
        strike: 100,
        volume: 100,
        openInterest: 0,
        ask: 2,
      }, 1000),
      null,
    );
  });

  it("marks puts as bearish", () => {
    const item = contractToFlowItem(
      "AAPL",
      "2026-01-01",
      "put",
      { strike: 200, volume: 5000, openInterest: 1000, ask: 2.5 },
      50_000,
    );
    assert.ok(item);
    assert.equal(item.sentiment, "bearish");
    assert.equal(item.type, "put");
  });
});
