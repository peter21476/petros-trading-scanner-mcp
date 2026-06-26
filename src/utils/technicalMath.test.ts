import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bollingerBands, macd, rsi, sma } from "../utils/technicalMath.js";

describe("technicalMath", () => {
  const closes = [
    44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
    46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21,
    46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42,
    42.66, 43.13,
  ];

  it("computes SMA", () => {
    const value = sma(closes, 20);
    assert.ok(value != null);
    assert.ok(value > 40 && value < 50);
  });

  it("computes RSI in 0-100 range", () => {
    const value = rsi(closes, 14);
    assert.ok(value != null);
    assert.ok(value >= 0 && value <= 100);
  });

  it("computes MACD components", () => {
    const extended = [...closes, ...closes, ...closes];
    const values = macd(extended, 12, 26, 9);
    assert.ok(values.macd != null);
    assert.ok(values.signal != null);
    assert.ok(values.histogram != null);
  });

  it("computes Bollinger bands with upper > mid > lower", () => {
    const bands = bollingerBands(closes, 20, 2);
    assert.ok(bands.upper != null && bands.mid != null && bands.lower != null);
    assert.ok(bands.upper! > bands.mid!);
    assert.ok(bands.mid! > bands.lower!);
  });
});
