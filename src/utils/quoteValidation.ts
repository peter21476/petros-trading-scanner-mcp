import { logger } from "./logger.js";
import type { YahooQuote } from "../types/market.js";
import { assessQuoteFreshness } from "./dataFreshness.js";
import { stampQuoteSourceQuality } from "./quoteConfidence.js";

const QUOTE_TOLERANCE_PERCENT = 0.75;

export function validateAndReconcileQuote(input: {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose?: number | null;
}): {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  quoteValidated: boolean;
} {
  let { price, change, changePercent } = input;
  let previousClose = input.previousClose ?? null;

  if (previousClose == null && price != null && change != null) {
    previousClose = Number((price - change).toFixed(4));
  }

  if (
    price == null &&
    previousClose != null &&
    changePercent != null &&
    previousClose !== 0
  ) {
    price = Number((previousClose * (1 + changePercent / 100)).toFixed(4));
    change = Number((price - previousClose).toFixed(4));
  }

  if (
    price != null &&
    change == null &&
    previousClose != null &&
    changePercent != null
  ) {
    change = Number((price - previousClose).toFixed(4));
  }

  if (
    price != null &&
    changePercent == null &&
    previousClose != null &&
    previousClose !== 0 &&
    change != null
  ) {
    changePercent = Number(((change / previousClose) * 100).toFixed(4));
  }

  if (price == null || changePercent == null) {
    return {
      price,
      change,
      changePercent,
      previousClose,
      quoteValidated: false,
    };
  }

  if (previousClose == null || previousClose === 0) {
    return { price, change, changePercent, previousClose, quoteValidated: true };
  }

  const impliedChange = price - previousClose;
  const impliedPercent = (impliedChange / previousClose) * 100;
  const percentDelta = Math.abs(impliedPercent - changePercent);

  if (percentDelta <= QUOTE_TOLERANCE_PERCENT) {
    return {
      price,
      change: change ?? Number(impliedChange.toFixed(4)),
      changePercent,
      previousClose,
      quoteValidated: true,
    };
  }

  const reconciledPrice = Number(
    (previousClose * (1 + changePercent / 100)).toFixed(4),
  );
  const reconciledChange = Number((reconciledPrice - previousClose).toFixed(4));

  logger.warn("Quote fields inconsistent; reconciled price from previous close and change %", {
    symbol: input.symbol,
    originalPrice: price,
    reconciledPrice,
    previousClose,
    changePercent,
  });

  return {
    price: reconciledPrice,
    change: reconciledChange,
    changePercent,
    previousClose,
    quoteValidated: false,
  };
}

export function finalizeQuote(
  base: Omit<YahooQuote, "quoteValidated"> & { quoteValidated?: boolean },
): YahooQuote {
  const reconciled = validateAndReconcileQuote({
    symbol: base.symbol,
    price: base.price,
    change: base.change,
    changePercent: base.changePercent,
    previousClose: base.previousClose,
  });

  const freshness = assessQuoteFreshness({
    asOf: base.asOf,
    providerTimestamps: base.providerTimestamps,
    isDelayed: base.isDelayed,
    quoteSource: base.source,
  });

  return stampQuoteSourceQuality({
    ...base,
    price: reconciled.price,
    change: reconciled.change,
    changePercent: reconciled.changePercent,
    previousClose: reconciled.previousClose,
    quoteValidated: reconciled.quoteValidated,
    asOf: freshness.asOf,
    dataFreshness: freshness.dataFreshness,
    marketSession: freshness.marketSession,
    freshnessAgeMinutes: freshness.freshnessAgeMinutes,
    freshnessReason: freshness.freshnessReason,
    providerTimestamps: freshness.providerTimestamps,
  });
}
