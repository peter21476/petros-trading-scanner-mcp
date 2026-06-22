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

export const dailyBriefingInputSchema = z.object({
  focusSymbols: z.array(z.string().min(1).max(10)).min(1).max(30),
  portfolioContext: z.string().max(500).optional(),
});

export type PremarketMoversInput = z.infer<typeof premarketMoversInputSchema>;
export type EarningsCalendarInput = z.infer<typeof earningsCalendarInputSchema>;
export type WatchlistSignalsInput = z.infer<typeof watchlistSignalsInputSchema>;
export type DailyBriefingInput = z.infer<typeof dailyBriefingInputSchema>;
