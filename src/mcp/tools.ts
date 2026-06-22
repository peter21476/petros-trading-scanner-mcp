import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dailyBriefingInputSchema,
  earningsCalendarInputSchema,
  positionReviewInputSchema,
  premarketMoversInputSchema,
  watchlistSignalsInputSchema,
} from "./schemas.js";
import {
  getDailyBriefing,
  getEarningsCalendar,
  getFinvizSnapshot,
  getFutures,
  getMarketBreadth,
  getPositionReview,
  getPremarketMovers,
  getSemiconductorStrength,
  getWatchlistSignals,
} from "../services/marketData.js";

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "get_futures",
    {
      description:
        "Return current futures for Nasdaq 100, S&P 500, Dow, Russell 2000, crude oil, gold, and Bitcoin when available. Read-only market research data.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await getFutures());
      } catch (error) {
        return errorResult(`get_futures failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_premarket_movers",
    {
      description:
        "Return premarket leaders, laggards, and most active stocks. Uses MarketWatch when available, Finviz fallback otherwise.",
      inputSchema: {
        limit: premarketMoversInputSchema.shape.limit,
      },
    },
    async (input) => {
      try {
        const parsed = premarketMoversInputSchema.parse(input);
        return jsonResult(await getPremarketMovers(parsed.limit));
      } catch (error) {
        return errorResult(`get_premarket_movers failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_market_breadth",
    {
      description:
        "Return market breadth from Finviz: advancing/declining %, new highs/lows, and SMA50/SMA200 positioning.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await getMarketBreadth());
      } catch (error) {
        return errorResult(`get_market_breadth failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_finviz_snapshot",
    {
      description:
        "Return a compact Finviz-style snapshot: top gainers/losers, new highs, unusual volume, major news, headlines, breadth, and futures.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await getFinvizSnapshot());
      } catch (error) {
        return errorResult(`get_finviz_snapshot failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_earnings_calendar",
    {
      description: "Return upcoming earnings for the next N days (default 7) from Finviz.",
      inputSchema: {
        days: earningsCalendarInputSchema.shape.days,
      },
    },
    async (input) => {
      try {
        const parsed = earningsCalendarInputSchema.parse(input);
        return jsonResult(await getEarningsCalendar(parsed.days));
      } catch (error) {
        return errorResult(`get_earnings_calendar failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_watchlist_signals",
    {
      description:
        "Analyze a watchlist and return transparent scores (0-10), bias, reasons, and risk flags. Does not provide trade recommendations.",
      inputSchema: {
        symbols: watchlistSignalsInputSchema.shape.symbols,
      },
    },
    async (input) => {
      try {
        const parsed = watchlistSignalsInputSchema.parse(input);
        return jsonResult(await getWatchlistSignals(parsed.symbols));
      } catch (error) {
        return errorResult(`get_watchlist_signals failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_semiconductor_strength",
    {
      description:
        "Return semiconductor sector strength for NVDA, AMD, MU, AVGO, INTC, MRVL, WDC, TSM, AMAT, LRCX, SMCI with sector score, bias, confidence, leaders, laggards, and summary. Useful for SOXL workflow.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await getSemiconductorStrength());
      } catch (error) {
        return errorResult(`get_semiconductor_strength failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_position_review",
    {
      description:
        "Review any open stock or ETF position with action (hold/add/trim/exit), confidence, thesis, strengths, and risks. Applies sector context for semiconductors and index/leveraged ETFs; general symbols use market bias and symbol signals. Research only — not a trade recommendation.",
      inputSchema: {
        symbol: positionReviewInputSchema.shape.symbol,
        costBasis: positionReviewInputSchema.shape.costBasis,
        currentValue: positionReviewInputSchema.shape.currentValue,
      },
    },
    async (input) => {
      try {
        const parsed = positionReviewInputSchema.parse(input);
        return jsonResult(await getPositionReview(parsed));
      } catch (error) {
        return errorResult(`get_position_review failed: ${String(error)}`);
      }
    },
  );

  server.registerTool(
    "get_daily_briefing",
    {
      description:
        "Return a complete market briefing with per-section source attribution, market bias confidence, ranked news with impact/sentiment, semiconductor strength, portfolio-aware notes, and suggested follow-up questions.",
      inputSchema: {
        focusSymbols: dailyBriefingInputSchema.shape.focusSymbols,
        portfolioContext: dailyBriefingInputSchema.shape.portfolioContext,
        positions: dailyBriefingInputSchema.shape.positions,
      },
    },
    async (input) => {
      try {
        const parsed = dailyBriefingInputSchema.parse(input);
        return jsonResult(await getDailyBriefing(parsed));
      } catch (error) {
        return errorResult(`get_daily_briefing failed: ${String(error)}`);
      }
    },
  );
}
