import type { DataFreshness, ProviderTimestamps } from "../types/market.js";
import {
  detectMarketSession,
  getEasternDateKey,
  isSameEasternDay,
  previousTradingDateKey,
  type MarketSession,
} from "./marketSession.js";

export type { DataFreshness } from "../types/market.js";

const REGULAR_FRESH_MINUTES = 20;
const REGULAR_DELAYED_MINUTES = 180;
const PREMARKET_FRESH_MINUTES = 240;
const AFTER_HOURS_FRESH_MINUTES = 240;

export interface FreshnessAssessment {
  dataFreshness: DataFreshness;
  asOf: string | null;
  marketSession: MarketSession;
  freshnessAgeMinutes: number | null;
  freshnessReason: string;
  providerTimestamps: ProviderTimestamps;
  serverTime: string;
}

function minutesBetween(older: Date, newer: Date): number {
  return Math.round((newer.getTime() - older.getTime()) / 60_000);
}

function parseTimestamp(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

export function pickBestAsOf(
  asOf?: string | null,
  providerTimestamps?: ProviderTimestamps,
): Date | null {
  const candidates = [
    parseTimestamp(asOf),
    parseTimestamp(providerTimestamps?.finnhub?.iso),
    parseTimestamp(providerTimestamps?.nasdaq?.iso),
    parseTimestamp(providerTimestamps?.yahoo?.iso),
    parseTimestamp(providerTimestamps?.finviz?.iso),
  ].filter((value): value is Date => value != null);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((latest, current) =>
    current.getTime() > latest.getTime() ? current : latest,
  );
}

function isLastTradingSessionClose(
  quoteTime: Date,
  now: Date,
  marketSession: MarketSession,
): boolean {
  const quoteDay = getEasternDateKey(quoteTime);
  const today = getEasternDateKey(now);
  const expectedPreviousCloseDay = previousTradingDateKey(today);

  if (quoteDay !== expectedPreviousCloseDay && quoteDay !== today) {
    return false;
  }

  const quoteSession = detectMarketSession(quoteTime);
  const atRegularClose =
    quoteSession === "regular" || quoteSession === "after_hours";

  if (
    marketSession === "weekend" ||
    marketSession === "holiday" ||
    marketSession === "overnight" ||
    marketSession === "premarket"
  ) {
    return atRegularClose || quoteDay === expectedPreviousCloseDay;
  }

  if (marketSession === "after_hours" && isSameEasternDay(quoteTime, now)) {
    return atRegularClose;
  }

  return false;
}

export function assessQuoteFreshness(input: {
  asOf?: string | null;
  providerTimestamps?: ProviderTimestamps;
  isDelayed?: boolean;
  quoteSource?: string | null;
  fetchedAt?: Date;
}): FreshnessAssessment {
  const now = input.fetchedAt ?? new Date();
  const marketSession = detectMarketSession(now);
  const providerTimestamps = input.providerTimestamps ?? {};
  const quoteTime = pickBestAsOf(input.asOf, providerTimestamps);
  const freshnessAgeMinutes =
    quoteTime != null ? minutesBetween(quoteTime, now) : null;

  if (!quoteTime) {
    if (input.isDelayed) {
      return {
        dataFreshness: "delayed",
        asOf: null,
        marketSession,
        freshnessAgeMinutes: null,
        freshnessReason: "No provider timestamp; delayed snapshot quote",
        providerTimestamps,
        serverTime: now.toISOString(),
      };
    }
    return {
      dataFreshness: "stale",
      asOf: null,
      marketSession,
      freshnessAgeMinutes: null,
      freshnessReason: "No provider timestamp available",
      providerTimestamps,
      serverTime: now.toISOString(),
    };
  }

  const asOf = quoteTime.toISOString();
  const quoteSession = detectMarketSession(quoteTime);
  const sameDay = isSameEasternDay(quoteTime, now);

  if (marketSession === "weekend" || marketSession === "holiday") {
    if (isLastTradingSessionClose(quoteTime, now, marketSession)) {
      return {
        dataFreshness: "closed_session",
        asOf,
        marketSession,
        freshnessAgeMinutes,
        freshnessReason: `Market is ${marketSession}; quote reflects last regular-session close`,
        providerTimestamps,
        serverTime: now.toISOString(),
      };
    }
  }

  if (marketSession === "premarket") {
    if (sameDay && quoteSession === "premarket") {
      return {
        dataFreshness: "fresh",
        asOf,
        marketSession,
        freshnessAgeMinutes,
        freshnessReason: "Quote timestamp is from current premarket session",
        providerTimestamps,
        serverTime: now.toISOString(),
      };
    }
    if (
      isLastTradingSessionClose(quoteTime, now, marketSession) ||
      (freshnessAgeMinutes != null && freshnessAgeMinutes <= PREMARKET_FRESH_MINUTES)
    ) {
      return {
        dataFreshness: "closed_session",
        asOf,
        marketSession,
        freshnessAgeMinutes,
        freshnessReason:
          "Premarket active; quote reflects prior regular-session close (providers may not stamp premarket time)",
        providerTimestamps,
        serverTime: now.toISOString(),
      };
    }
  }

  if (marketSession === "regular") {
    if (sameDay && freshnessAgeMinutes != null) {
      if (freshnessAgeMinutes <= REGULAR_FRESH_MINUTES) {
        return {
          dataFreshness: "fresh",
          asOf,
          marketSession,
          freshnessAgeMinutes,
          freshnessReason: "Quote timestamp is within regular-session freshness window",
          providerTimestamps,
          serverTime: now.toISOString(),
        };
      }
      if (freshnessAgeMinutes <= REGULAR_DELAYED_MINUTES) {
        return {
          dataFreshness: "delayed",
          asOf,
          marketSession,
          freshnessAgeMinutes,
          freshnessReason: "Quote timestamp is from today but older than live window",
          providerTimestamps,
          serverTime: now.toISOString(),
        };
      }
    }
  }

  if (marketSession === "after_hours") {
    if (
      sameDay &&
      (quoteSession === "after_hours" || quoteSession === "regular")
    ) {
      return {
        dataFreshness:
          freshnessAgeMinutes != null &&
          freshnessAgeMinutes <= AFTER_HOURS_FRESH_MINUTES
            ? "fresh"
            : "closed_session",
        asOf,
        marketSession,
        freshnessAgeMinutes,
        freshnessReason: "After-hours session; quote is from today's regular or after-hours trade",
        providerTimestamps,
        serverTime: now.toISOString(),
      };
    }
  }

  if (marketSession === "overnight" && isLastTradingSessionClose(quoteTime, now, marketSession)) {
    return {
      dataFreshness: "closed_session",
      asOf,
      marketSession,
      freshnessAgeMinutes,
      freshnessReason: "Overnight; quote reflects last regular-session close",
      providerTimestamps,
      serverTime: now.toISOString(),
    };
  }

  if (isLastTradingSessionClose(quoteTime, now, marketSession)) {
    return {
      dataFreshness: "closed_session",
      asOf,
      marketSession,
      freshnessAgeMinutes,
      freshnessReason: `Quote is from last completed regular session (${quoteSession})`,
      providerTimestamps,
      serverTime: now.toISOString(),
    };
  }

  if (input.isDelayed) {
    return {
      dataFreshness: "delayed",
      asOf,
      marketSession,
      freshnessAgeMinutes,
      freshnessReason: "Delayed quote without current-session timestamp",
      providerTimestamps,
      serverTime: now.toISOString(),
    };
  }

  return {
    dataFreshness: "stale",
    asOf,
    marketSession,
    freshnessAgeMinutes,
    freshnessReason: `Quote timestamp (${asOf}) is too old for current ${marketSession} session`,
    providerTimestamps,
    serverTime: now.toISOString(),
  };
}

/** @deprecated Use assessQuoteFreshness — kept for feed-level timestamps */
export function computeDataFreshness(input: {
  asOf?: string | null;
  isDelayed?: boolean;
  timestamp?: string | null;
}): DataFreshness {
  return assessQuoteFreshness({
    asOf: input.asOf ?? input.timestamp,
    isDelayed: input.isDelayed,
  }).dataFreshness;
}

export function computeAggregateDataFreshness(
  values: Array<DataFreshness | undefined | null>,
): DataFreshness {
  if (values.length === 0) {
    return "stale";
  }

  if (values.some((value) => value === "stale")) {
    return "stale";
  }
  if (values.some((value) => value === "delayed")) {
    return "delayed";
  }
  if (values.every((value) => value === "closed_session")) {
    return "closed_session";
  }
  if (values.every((value) => value === "fresh" || value === "closed_session")) {
    return "fresh";
  }

  return "delayed";
}
