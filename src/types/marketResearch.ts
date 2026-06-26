import type { DataFreshness } from "./market.js";

export type PricePeriod = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y";
export type PriceInterval = "5m" | "15m" | "1h" | "1d";
export type IndicatorInterval = "1h" | "1d";

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalPriceMetrics {
  sma20: number | null;
  sma50: number | null;
  distanceFromSma20Percent: number | null;
  distanceFromSma50Percent: number | null;
  week52High: number | null;
  week52Low: number | null;
  distanceFrom52WeekHighPercent: number | null;
  distanceFrom52WeekLowPercent: number | null;
}

export interface SymbolHistoricalPrices {
  symbol: string;
  period: PricePeriod;
  interval: PriceInterval;
  bars: OhlcvBar[];
  metrics: HistoricalPriceMetrics;
}

export interface HistoricalPricesResponse {
  timestamp: string;
  source: string;
  dataFreshness: DataFreshness;
  warnings: string[];
  cached?: boolean;
  cachedAt?: string | null;
  symbols: SymbolHistoricalPrices[];
}

export interface TechnicalIndicatorValues {
  rsi14: number | null;
  rsiInterpretation: string;
  macd: {
    value: number | null;
    signal: number | null;
    histogram: number | null;
    interpretation: string;
  };
  bollingerBands: {
    upper: number | null;
    mid: number | null;
    lower: number | null;
    interpretation: string;
  };
  volumeRatio20Day: number | null;
  volumeInterpretation: string;
}

export interface TechnicalIndicatorsResponse {
  timestamp: string;
  source: string;
  dataFreshness: DataFreshness;
  warnings: string[];
  cached?: boolean;
  cachedAt?: string | null;
  symbol: string;
  interval: IndicatorInterval;
  indicators: TechnicalIndicatorValues;
}

export interface SectorRotationItem {
  name: string;
  etf: string;
  changePercent: number | null;
  volumeRatio: number | null;
  bias: "bullish" | "neutral" | "bearish";
}

export interface SectorRotationResponse {
  timestamp: string;
  source: string;
  dataFreshness: DataFreshness;
  warnings: string[];
  cached?: boolean;
  cachedAt?: string | null;
  sectors: SectorRotationItem[];
  rotationTheme: string;
}

export interface TickerNewsArticle {
  headline: string;
  source: string;
  publishedAt: string;
  url: string;
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
}

export interface TickerNewsResponse {
  timestamp: string;
  source: string;
  dataFreshness: DataFreshness;
  warnings: string[];
  cached?: boolean;
  cachedAt?: string | null;
  symbol: string;
  articles: TickerNewsArticle[];
  sentimentScore: number;
}

export interface OptionsFlowItem {
  symbol: string;
  expiration: string;
  strike: number;
  type: "call" | "put";
  volume: number;
  openInterest: number;
  volumeOiRatio: number | null;
  premium: number;
  sentiment: "bullish" | "bearish";
  timestamp: string;
  unusual: boolean;
}

export interface OptionsFlowResponse {
  timestamp: string;
  source: string;
  dataFreshness: DataFreshness;
  warnings: string[];
  cached?: boolean;
  cachedAt?: string | null;
  symbol: string | null;
  minPremium: number;
  flows: OptionsFlowItem[];
  note?: string;
}
