export interface QuotePoint {
  last: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface FuturesQuote extends QuotePoint {
  name?: string;
}

export interface FuturesResponse {
  timestamp: string;
  source: string;
  warnings?: string[];
  futures: {
    nasdaq100: QuotePoint;
    sp500: QuotePoint;
    dow: QuotePoint;
    russell2000: QuotePoint;
    crudeOil: QuotePoint;
    gold: QuotePoint;
    bitcoin?: QuotePoint;
  };
}

export interface MoverStock {
  symbol: string;
  name: string;
  price: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface PremarketMoversResponse {
  timestamp: string;
  source: string;
  warnings?: string[];
  leaders: MoverStock[];
  laggards: MoverStock[];
  mostActive: MoverStock[];
}

export interface MarketBreadth {
  advancingPercent: number | null;
  decliningPercent: number | null;
  newHighPercent: number | null;
  newLowPercent: number | null;
  aboveSma50Percent: number | null;
  belowSma50Percent: number | null;
  aboveSma200Percent: number | null;
  belowSma200Percent: number | null;
}

export interface MarketBreadthResponse {
  timestamp: string;
  source: string;
  warnings?: string[];
  breadth: MarketBreadth;
}

export interface SnapshotStock {
  symbol: string;
  name?: string;
  price?: number | null;
  changePercent?: number | null;
  volume?: number | null;
  signal?: string;
}

export interface HeadlineItem {
  time?: string;
  title: string;
  url?: string;
  headline?: string;
  impact?: "high" | "medium" | "low";
  sentiment?: "positive" | "negative" | "neutral";
  source?: string;
}

export interface NewsItem {
  headline: string;
  impact: "high" | "medium" | "low";
  sentiment: "positive" | "negative" | "neutral";
  source?: string;
  url?: string;
  time?: string;
}

export interface BriefingSources {
  futuresSource: string;
  premarketSource: string;
  breadthSource: string;
  newsSource: string;
  semiconductorSource: string;
  watchlistSource: string;
  earningsSource?: string;
}

export interface PortfolioPosition {
  symbol: string;
  costBasis?: number;
  currentValue?: number;
}

export interface PortfolioNote {
  symbol: string;
  note: string;
  pnlPercent?: number | null;
  thesisStatus: "intact" | "mixed" | "weakened";
}

export type PositionAction = "hold" | "add" | "trim" | "exit";

export interface PositionReviewResponse {
  timestamp: string;
  symbol: string;
  costBasis?: number;
  currentValue?: number;
  pnlPercent?: number | null;
  action: PositionAction;
  confidence: number;
  thesis: string;
  strengths: string[];
  risks: string[];
  signalScore?: number;
  sources?: {
    quoteSource?: string | null;
    semiconductorSource?: string | null;
    futuresSource: string;
  };
  warnings?: string[];
}

export interface SemiconductorSymbolDetail {
  symbol: string;
  changePercent: number | null;
  dataSource: string;
}

export interface SemiconductorStrengthResponse {
  timestamp: string;
  source: string;
  warnings?: string[];
  sectorScore: number;
  bias: "bullish" | "neutral" | "bearish";
  confidence: number;
  leaders: string[];
  laggards: string[];
  summary: string;
  symbols: SemiconductorSymbolDetail[];
}

export interface FinvizSnapshotResponse {
  timestamp: string;
  source: string;
  warnings?: string[];
  topGainers: SnapshotStock[];
  topLosers: SnapshotStock[];
  newHighs: SnapshotStock[];
  unusualVolume: SnapshotStock[];
  majorNews: SnapshotStock[];
  headlines: HeadlineItem[];
  breadth: MarketBreadth;
  futures: FuturesResponse["futures"];
}

export interface EarningsEntry {
  date: string;
  time: "before_open" | "after_close" | "unknown";
  symbol: string;
  company: string;
}

export interface EarningsCalendarResponse {
  timestamp: string;
  source: string;
  warnings?: string[];
  earnings: EarningsEntry[];
}

export type DataFreshness = "fresh" | "stale";

export type SourceQuality =
  | "multi_source_agreement"
  | "yahoo_only"
  | "nasdaq_only"
  | "finviz_only"
  | "yahoo_finviz"
  | "unavailable";

export interface QuoteDiagnostics {
  yahooBatchResolved: number;
  yahooBatchRequested: number;
  bySourceQuality: Partial<Record<SourceQuality, number>>;
}

export interface WatchlistSignal {
  symbol: string;
  score: number;
  bias: "bullish" | "neutral" | "bearish";
  reasons: string[];
  riskFlags: string[];
  price?: number | null;
  changePercent?: number | null;
  previousClose?: number | null;
  volume?: number | null;
  quoteSource?: string | null;
  asOf?: string | null;
  isDelayed?: boolean;
  quoteValidated?: boolean;
  dataFreshness?: DataFreshness;
  confidence?: number;
  sourceQuality?: SourceQuality;
  headline?: string | null;
  inFinvizLists?: string[];
}

export interface WatchlistSignalsResponse {
  timestamp: string;
  dataFreshness: DataFreshness;
  confidence: number;
  quoteDiagnostics?: QuoteDiagnostics;
  warnings?: string[];
  signals: WatchlistSignal[];
}

export interface SectorNotes {
  semiconductors: string;
  technology: string;
  energy: string;
}

export interface DailyBriefingResponse {
  timestamp: string;
  dataFreshness: DataFreshness;
  marketBias: "bullish" | "neutral" | "bearish";
  confidence: number;
  summary: string;
  sources: BriefingSources;
  keyDrivers: string[];
  news: NewsItem[];
  futures: FuturesResponse["futures"];
  premarketMovers: PremarketMoversResponse;
  breadth: MarketBreadth;
  sectorNotes: SectorNotes;
  watchlistSignals: WatchlistSignal[];
  semiconductorStrength: Pick<
    SemiconductorStrengthResponse,
    "sectorScore" | "bias" | "confidence" | "leaders" | "laggards" | "summary"
  >;
  portfolioNotes: PortfolioNote[];
  risks: string[];
  suggestedQuestions: string[];
  warnings?: string[];
}

export interface YahooQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose?: number | null;
  preMarketPrice: number | null;
  preMarketChangePercent: number | null;
  volume: number | null;
  shortName: string | null;
  source?: string;
  asOf?: string | null;
  isDelayed?: boolean;
  quoteValidated?: boolean;
  dataFreshness?: DataFreshness;
  multiSourceAgree?: boolean;
  fallbackOnly?: boolean;
  sourceQuality?: SourceQuality;
}

export interface FinvizHomepageData {
  futures: FuturesResponse["futures"];
  breadth: MarketBreadth;
  topGainers: SnapshotStock[];
  topLosers: SnapshotStock[];
  newHighs: SnapshotStock[];
  unusualVolume: SnapshotStock[];
  majorNews: SnapshotStock[];
  headlines: HeadlineItem[];
  marketSummaryHeadline?: string;
  marketSummarySentiment?: "positive" | "negative" | "neutral";
}

export const SEMICONDUCTOR_SYMBOLS = [
  "NVDA",
  "AMD",
  "MU",
  "AVGO",
  "INTC",
  "MRVL",
  "WDC",
  "TSM",
  "AMAT",
  "LRCX",
  "SMCI",
] as const;

export const FUTURES_LABEL_MAP: Record<string, keyof FuturesResponse["futures"]> = {
  "nasdaq 100": "nasdaq100",
  "s&p 500": "sp500",
  "s&amp;p 500": "sp500",
  dow: "dow",
  "russell 2000": "russell2000",
  "crude oil": "crudeOil",
  gold: "gold",
  "btc/usd": "bitcoin",
};

export const YAHOO_FUTURES_SYMBOLS: Record<keyof FuturesResponse["futures"], string> = {
  nasdaq100: "NQ=F",
  sp500: "ES=F",
  dow: "YM=F",
  russell2000: "RTY=F",
  crudeOil: "CL=F",
  gold: "GC=F",
  bitcoin: "BTC-USD",
};

export function emptyQuote(): QuotePoint {
  return { last: null, change: null, changePercent: null };
}

export function emptyFutures(): FuturesResponse["futures"] {
  return {
    nasdaq100: emptyQuote(),
    sp500: emptyQuote(),
    dow: emptyQuote(),
    russell2000: emptyQuote(),
    crudeOil: emptyQuote(),
    gold: emptyQuote(),
    bitcoin: emptyQuote(),
  };
}

export function emptyBreadth(): MarketBreadth {
  return {
    advancingPercent: null,
    decliningPercent: null,
    newHighPercent: null,
    newLowPercent: null,
    aboveSma50Percent: null,
    belowSma50Percent: null,
    aboveSma200Percent: null,
    belowSma200Percent: null,
  };
}
