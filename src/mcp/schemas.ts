import { z } from "zod";

export const premarketMoversInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
});

export const earningsCalendarInputSchema = z.object({
  days: z.number().int().min(1).max(30).default(7),
});

export const watchlistSignalsInputSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(30),
});

export const portfolioPositionSchema = z.object({
  symbol: z.string().min(1).max(10),
  costBasis: z.number().positive().optional(),
  currentValue: z.number().positive().optional(),
});

export const dailyBriefingInputSchema = z.object({
  focusSymbols: z.array(z.string().min(1).max(10)).min(1).max(30),
  portfolioContext: z.string().max(500).optional(),
  positions: z.array(portfolioPositionSchema).max(20).optional(),
});

export type PremarketMoversInput = z.infer<typeof premarketMoversInputSchema>;
export type EarningsCalendarInput = z.infer<typeof earningsCalendarInputSchema>;
export type WatchlistSignalsInput = z.infer<typeof watchlistSignalsInputSchema>;

export const positionReviewInputSchema = z.object({
  symbol: z.string().min(1).max(10),
  costBasis: z.number().positive().optional(),
  currentValue: z.number().positive().optional(),
  portfolioContext: z.string().max(500).optional(),
});

export type PositionReviewInput = z.infer<typeof positionReviewInputSchema>;

export const equityPositionSchema = z.object({
  symbol: z.string().min(1).max(10),
  shares: z.number().positive(),
  averageCost: z.number().positive(),
  currentValue: z.number().positive().optional(),
  marketValue: z.number().positive().optional(),
});

export const optionPositionSchema = z.object({
  symbol: z.string().min(1).max(20),
  underlying: z.string().min(1).max(10),
  type: z.enum(["call", "put"]),
  strike: z.number().positive(),
  expiration: z.string().min(1),
  contracts: z.number().positive(),
  marketValue: z.number().optional(),
});

export const portfolioAccountContextSchema = z.object({
  accountValue: z.number().positive().optional(),
  buyingPower: z.number().optional(),
  equityPositions: z.array(equityPositionSchema).optional(),
  optionPositions: z.array(optionPositionSchema).optional(),
});

export const tradeAccountContextSchema = portfolioAccountContextSchema.extend({
  currentPositionShares: z.number().optional(),
  averageCost: z.number().positive().optional(),
  currentValue: z.number().positive().optional(),
  riskTolerance: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  timeframe: z
    .enum(["intraday", "swing_1_5_days", "swing_1_2_weeks"])
    .optional(),
});

export const tradeSetupInputSchema = z.object({
  symbol: z.string().min(1).max(10),
  accountContext: tradeAccountContextSchema.optional(),
});

export const aggressiveWatchlistRankingsInputSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(30),
  timeframe: z
    .enum(["intraday", "swing_1_5_days", "swing_1_2_weeks"])
    .optional(),
});

export const portfolioTradePlanInputSchema = z.object({
  accountContext: portfolioAccountContextSchema.optional(),
  timeframe: z
    .enum(["intraday", "swing_1_5_days", "swing_1_2_weeks"])
    .optional(),
});

export const intradayDecisionCheckInputSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(20),
  accountContext: portfolioAccountContextSchema.optional(),
});

export const bestTradesTodayInputSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(40).optional(),
  maxResults: z.number().int().min(1).max(25).optional(),
  timeframe: z
    .enum(["intraday", "swing_1_5_days", "swing_1_2_weeks"])
    .optional(),
  riskTolerance: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  accountContext: portfolioAccountContextSchema.optional(),
});

export type TradeSetupInput = z.infer<typeof tradeSetupInputSchema>;
export type AggressiveWatchlistRankingsInput = z.infer<
  typeof aggressiveWatchlistRankingsInputSchema
>;
export type PortfolioTradePlanInput = z.infer<typeof portfolioTradePlanInputSchema>;
export type IntradayDecisionCheckInput = z.infer<
  typeof intradayDecisionCheckInputSchema
>;
export type BestTradesTodayInput = z.infer<typeof bestTradesTodayInputSchema>;

export const historicalPricesInputSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(10),
  period: z.enum(["1d", "5d", "1mo", "3mo", "6mo", "1y"]).default("1mo"),
  interval: z.enum(["5m", "15m", "1h", "1d"]).default("1d"),
});

export const technicalIndicatorsInputSchema = z.object({
  symbol: z.string().min(1).max(10),
  interval: z.enum(["1h", "1d"]).default("1d"),
});

export const tickerNewsInputSchema = z.object({
  symbol: z.string().min(1).max(10),
  limit: z.number().int().min(1).max(10).default(5),
});

export const optionsFlowInputSchema = z.object({
  symbol: z.string().min(1).max(10).optional(),
  minPremium: z.number().int().min(1000).default(50_000),
});

export type HistoricalPricesInput = z.infer<typeof historicalPricesInputSchema>;
export type TechnicalIndicatorsInput = z.infer<typeof technicalIndicatorsInputSchema>;
export type TickerNewsInput = z.infer<typeof tickerNewsInputSchema>;
export type OptionsFlowInput = z.infer<typeof optionsFlowInputSchema>;
