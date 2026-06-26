import type { DataFreshness, MarketSession } from "./market.js";

export type TradeBias = "bullish" | "bearish" | "neutral";
export type SetupType =
  | "breakout"
  | "pullback"
  | "reversal"
  | "continuation"
  | "avoid";
export type RiskTolerance = "conservative" | "balanced" | "aggressive";
export type TradeTimeframe = "intraday" | "swing_1_5_days" | "swing_1_2_weeks";
export type SuggestedTradeAction =
  | "buy"
  | "add"
  | "hold"
  | "trim"
  | "sell"
  | "no_action"
  | "watch";
export type MarketCondition =
  | "trendingUp"
  | "trendingDown"
  | "choppy"
  | "reversalAttempt"
  | "riskOff";
export type ActionWindow = "aggressive" | "selective" | "defensive" | "avoid";
export type IntradayAction = "buy" | "add" | "hold" | "trim" | "sell" | "wait";

export interface TradeAccountContext {
  currentPositionShares?: number;
  averageCost?: number;
  currentValue?: number;
  buyingPower?: number;
  riskTolerance?: RiskTolerance;
  timeframe?: TradeTimeframe;
}

export interface PortfolioEquityPosition {
  symbol: string;
  shares: number;
  averageCost: number;
  currentValue?: number;
  marketValue?: number;
}

export interface PortfolioOptionPosition {
  symbol: string;
  underlying: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  contracts: number;
  marketValue?: number;
}

export interface PortfolioSnapshot {
  accountNumber: string;
  accountValue: number;
  buyingPower: number;
  equityPositions: PortfolioEquityPosition[];
  optionPositions: PortfolioOptionPosition[];
  source: string;
  warnings?: string[];
}

export interface PriceZone {
  low: number;
  high: number;
  rationale: string;
}

export interface StopLossLevel {
  price: number;
  percentRisk: number;
  rationale: string;
}

export interface ProfitTargets {
  target1: number;
  target2: number;
  target3?: number;
}

export interface RiskRewardMetrics {
  target1RR: number;
  target2RR: number;
  target3RR?: number;
}

export interface TradeCatalysts {
  bullishCatalysts: string[];
  bearishCatalysts: string[];
}

export interface TradeSetupSources {
  quoteSource?: string | null;
  futuresSource?: string;
  breadthSource?: string;
  semiconductorSource?: string | null;
}

export interface TradeSetupResponse {
  timestamp: string;
  disclaimer: string;
  symbol: string;
  currentPrice: number | null;
  previousClose: number | null;
  changePercent: number | null;
  marketSession: MarketSession;
  dataFreshness: DataFreshness;
  quoteWarnings: string[];
  sources: TradeSetupSources;
  bias: TradeBias;
  setupType: SetupType;
  aggressiveBuyScore: number;
  probabilityScore: number;
  confidence: number;
  relativeStrengthScore: number;
  entryZone: PriceZone;
  stopLoss: StopLossLevel;
  profitTargets: ProfitTargets;
  riskReward: RiskRewardMetrics;
  suggestedAction: SuggestedTradeAction;
  invalidationConditions: string[];
  catalysts: TradeCatalysts;
  summary: string;
}

export interface AggressiveWatchlistEntry {
  rank: number;
  symbol: string;
  aggressiveBuyScore: number;
  probabilityScore: number;
  relativeStrengthScore: number;
  riskScore: number;
  setupType: SetupType;
  suggestedAction: SuggestedTradeAction;
  entryTrigger: string;
  stopLoss: number;
  target1: number;
  target2: number;
  summary: string;
}

export interface AggressiveWatchlistRankingsResponse {
  timestamp: string;
  disclaimer: string;
  timeframe: TradeTimeframe;
  marketCondition: MarketCondition;
  actionWindow: ActionWindow;
  sources: TradeSetupSources;
  warnings: string[];
  ranked: AggressiveWatchlistEntry[];
}

export interface PortfolioTradePlanResponse {
  timestamp: string;
  disclaimer: string;
  accountNumber: string;
  accountValue: number | null;
  buyingPower: number | null;
  holdings: {
    equity: PortfolioEquityPosition[];
    options: PortfolioOptionPosition[];
  };
  accountRiskLevel: "low" | "moderate" | "high" | "unknown";
  concentrationRisk: string[];
  bestOpportunities: string[];
  positionsToHold: string[];
  positionsToTrim: string[];
  positionsToAvoidAdding: string[];
  topTradesToConsider: Array<{
    symbol: string;
    action: SuggestedTradeAction;
    aggressiveBuyScore: number;
    summary: string;
  }>;
  topRisks: string[];
  sessionPlan: {
    opening: string;
    midday: string;
    closing: string;
  };
  marketCondition: MarketCondition;
  actionWindow: ActionWindow;
  sources: TradeSetupSources;
  warnings: string[];
}

export interface IntradaySymbolDecision {
  symbol: string;
  actNow: boolean;
  action: IntradayAction;
  reason: string;
  triggerToAct: string;
  riskLevel: "low" | "moderate" | "high";
  aggressiveBuyScore: number;
}

export interface IntradayDecisionCheckResponse {
  timestamp: string;
  disclaimer: string;
  marketSession: MarketSession;
  marketCondition: MarketCondition;
  actionWindow: ActionWindow;
  sources: TradeSetupSources;
  warnings: string[];
  symbolDecisions: IntradaySymbolDecision[];
  watchNext: string[];
}

export const TRADING_DISCLAIMER =
  "Research and trading framework only — not financial advice. Verify prices with your broker before acting.";
