import { CACHE_TTL, getCached } from "./cache.js";
import {
  ACCOUNT_CONTEXT_REQUIRED_MESSAGE,
  portfolioFromAccountContext,
} from "./portfolio.js";
import {
  buildAggressiveWatchlistEntry,
  buildIntradaySymbolDecision,
  buildTradeSetup,
  classifyActionWindow,
  classifyMarketCondition,
  computeAccountRiskLevel,
  computeConcentrationRisk,
  equityToAccountContext,
} from "./tradeAnalysis.js";
import { loadTradingContext } from "./tradingContext.js";
import type {
  AggressiveWatchlistRankingsResponse,
  IntradayDecisionCheckResponse,
  PortfolioAccountContext,
  PortfolioTradePlanResponse,
  TradeAccountContext,
  TradeSetupResponse,
  TradeTimeframe,
} from "../types/trading.js";
import { TRADING_DISCLAIMER } from "../types/trading.js";
import { detectMarketSession } from "../utils/marketSession.js";

export async function getTradeSetup(input: {
  symbol: string;
  accountContext?: TradeAccountContext;
}): Promise<TradeSetupResponse> {
  const symbol = input.symbol.toUpperCase();
  const cacheKey = `tool:trade-setup:${symbol}:${JSON.stringify(input.accountContext ?? {})}`;

  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const { market, symbolAnalyses, warnings } = await loadTradingContext([symbol]);
    const analysis = symbolAnalyses.get(symbol);
    if (!analysis) {
      throw new Error(`Unable to analyze ${symbol}`);
    }

    return buildTradeSetup({
      symbolAnalysis: analysis,
      market: {
        ...market,
        warnings: [...market.warnings, ...warnings],
      },
      account: input.accountContext,
    });
  });
}

export async function getAggressiveWatchlistRankings(input: {
  symbols: string[];
  timeframe?: TradeTimeframe;
}): Promise<AggressiveWatchlistRankingsResponse> {
  const symbols = input.symbols.map((s) => s.toUpperCase());
  const timeframe = input.timeframe ?? "swing_1_5_days";
  const cacheKey = `tool:aggressive-rankings:${symbols.join(",")}:${timeframe}`;

  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const { market, symbolAnalyses, warnings } = await loadTradingContext(symbols);
    const marketSession = detectMarketSession();
    const marketCondition = classifyMarketCondition({
      marketBias: market.marketBias,
      breadth: market.breadth,
      nasdaqFuturesChange: market.nasdaqFuturesChange,
    });
    const actionWindow = classifyActionWindow(marketCondition, marketSession);

    const setups = symbols
      .map((symbol) => {
        const analysis = symbolAnalyses.get(symbol);
        if (!analysis) {
          return null;
        }
        return buildTradeSetup({
          symbolAnalysis: analysis,
          market,
          account: { timeframe, riskTolerance: "aggressive" },
        });
      })
      .filter((setup): setup is TradeSetupResponse => setup != null)
      .sort((a, b) => b.aggressiveBuyScore - a.aggressiveBuyScore);

    const ranked = setups.map((setup, index) =>
      buildAggressiveWatchlistEntry(index + 1, setup),
    );

    return {
      timestamp: new Date().toISOString(),
      disclaimer: TRADING_DISCLAIMER,
      timeframe,
      marketCondition,
      actionWindow,
      sources: market.sources,
      warnings: [...new Set([...warnings, ...market.warnings])],
      ranked,
    };
  });
}

export async function getPortfolioTradePlan(input: {
  accountContext?: PortfolioAccountContext;
  timeframe?: TradeTimeframe;
}): Promise<PortfolioTradePlanResponse> {
  const timeframe = input.timeframe ?? "swing_1_5_days";
  const cacheKey = `tool:portfolio-plan:${timeframe}:${JSON.stringify(input.accountContext ?? {})}`;

  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const portfolioWarnings: string[] = [];
    const portfolio = input.accountContext
      ? portfolioFromAccountContext(input.accountContext)
      : null;

    if (!portfolio) {
      portfolioWarnings.push(ACCOUNT_CONTEXT_REQUIRED_MESSAGE);
    }

    const symbols =
      portfolio?.equityPositions.map((position) => position.symbol.toUpperCase()) ?? [];
    const { market, symbolAnalyses, warnings } = await loadTradingContext(
      symbols.length > 0 ? symbols : ["SPY", "QQQ", "NVDA"],
    );

    const marketSession = detectMarketSession();
    const marketCondition = classifyMarketCondition({
      marketBias: market.marketBias,
      breadth: market.breadth,
      nasdaqFuturesChange: market.nasdaqFuturesChange,
    });
    const actionWindow = classifyActionWindow(marketCondition, marketSession);

    const setups: TradeSetupResponse[] = [];
    for (const position of portfolio?.equityPositions ?? []) {
      const analysis = symbolAnalyses.get(position.symbol.toUpperCase());
      if (!analysis || !portfolio) {
        continue;
      }
      setups.push(
        buildTradeSetup({
          symbolAnalysis: analysis,
          market,
          account: equityToAccountContext(position, portfolio, timeframe),
        }),
      );
    }

    const bestOpportunities: string[] = [];
    const positionsToHold: string[] = [];
    const positionsToTrim: string[] = [];
    const positionsToAvoidAdding: string[] = [];

    for (const setup of setups) {
      if (setup.aggressiveBuyScore >= 7 && setup.suggestedAction === "buy") {
        bestOpportunities.push(`${setup.symbol}: ${setup.summary}`);
      }
      if (setup.suggestedAction === "hold" || setup.suggestedAction === "watch") {
        positionsToHold.push(setup.symbol);
      }
      if (setup.suggestedAction === "trim" || setup.suggestedAction === "sell") {
        positionsToTrim.push(setup.symbol);
      }
      if (
        setup.aggressiveBuyScore < 6 ||
        setup.setupType === "avoid" ||
        setup.suggestedAction === "watch"
      ) {
        positionsToAvoidAdding.push(setup.symbol);
      }
    }

    const topTradesToConsider = [...setups]
      .sort((a, b) => b.aggressiveBuyScore - a.aggressiveBuyScore)
      .slice(0, 3)
      .map((setup) => ({
        symbol: setup.symbol,
        action: setup.suggestedAction,
        aggressiveBuyScore: setup.aggressiveBuyScore,
        summary: setup.summary,
      }));

    const concentrationRisk = portfolio ? computeConcentrationRisk(portfolio) : [];
    const accountRiskLevel = portfolio
      ? computeAccountRiskLevel(portfolio, concentrationRisk)
      : "unknown";

    const topRisks = [
      ...concentrationRisk,
      marketCondition === "riskOff"
        ? "Risk-off market conditions"
        : marketCondition === "trendingDown"
          ? "Broad market trending down"
          : null,
      ...setups
        .filter((s) => s.quoteWarnings.length > 0)
        .map((s) => `${s.symbol}: ${s.quoteWarnings[0]}`),
      ...(portfolio?.buyingPower === 0
        ? ["Buying power is $0 — no new buy actions available"]
        : []),
    ]
      .filter((value): value is string => value != null)
      .slice(0, 3);

    const openingPlan =
      actionWindow === "aggressive"
        ? "Opening: favor high relative-strength names with confirmed triggers; size conservatively into first 15 minutes."
        : actionWindow === "defensive"
          ? "Opening: defensive posture — hold existing winners, avoid new aggressive entries until breadth improves."
          : "Opening: selective — wait for opening range break with volume before acting.";

    const middayPlan =
      marketCondition === "choppy"
        ? "Midday: choppy conditions — reduce size, tighten stops, avoid chasing."
        : "Midday: reassess positions against intraday VWAP/support; trim laggards.";

    const closingPlan =
      actionWindow === "avoid"
        ? "Closing: session closed or holiday — plan for next session only."
        : "Closing: avoid new entries late day unless strong momentum; protect gains with stops.";

    return {
      timestamp: new Date().toISOString(),
      disclaimer: TRADING_DISCLAIMER,
      accountValue: portfolio?.accountValue ?? null,
      buyingPower: portfolio?.buyingPower ?? null,
      holdings: {
        equity: portfolio?.equityPositions ?? [],
        options: portfolio?.optionPositions ?? [],
      },
      accountRiskLevel,
      concentrationRisk,
      bestOpportunities: bestOpportunities.slice(0, 5),
      positionsToHold,
      positionsToTrim,
      positionsToAvoidAdding,
      topTradesToConsider,
      topRisks,
      sessionPlan: {
        opening: openingPlan,
        midday: middayPlan,
        closing: closingPlan,
      },
      marketCondition,
      actionWindow,
      sources: market.sources,
      warnings: [...new Set([...portfolioWarnings, ...warnings, ...market.warnings])],
    };
  });
}

export async function getIntradayDecisionCheck(input: {
  symbols: string[];
  accountContext?: PortfolioAccountContext;
}): Promise<IntradayDecisionCheckResponse> {
  const symbols = input.symbols.map((s) => s.toUpperCase());
  const cacheKey = `tool:intraday-check:${symbols.join(",")}:${JSON.stringify(input.accountContext ?? {})}`;

  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const portfolio = input.accountContext
      ? portfolioFromAccountContext(input.accountContext)
      : null;

    if (!portfolio && input.accountContext === undefined) {
      warnings.push(
        "No accountContext supplied — decisions are market-only without position awareness.",
      );
    }

    const { market, symbolAnalyses, warnings: ctxWarnings } =
      await loadTradingContext(symbols);
    warnings.push(...ctxWarnings);

    const marketSession = detectMarketSession();
    const marketCondition = classifyMarketCondition({
      marketBias: market.marketBias,
      breadth: market.breadth,
      nasdaqFuturesChange: market.nasdaqFuturesChange,
    });
    const actionWindow = classifyActionWindow(marketCondition, marketSession);

    const symbolDecisions = symbols.map((symbol) => {
      const analysis = symbolAnalyses.get(symbol);
      if (!analysis) {
        return {
          symbol,
          actNow: false,
          action: "wait" as const,
          reason: "Quote data unavailable",
          triggerToAct: "Wait for quote resolution",
          riskLevel: "high" as const,
          aggressiveBuyScore: 0,
        };
      }

      const position = portfolio?.equityPositions.find(
        (p) => p.symbol.toUpperCase() === symbol,
      );
      const account: TradeAccountContext | undefined = position && portfolio
        ? equityToAccountContext(position, portfolio, "intraday")
        : {
            buyingPower: portfolio?.buyingPower ?? input.accountContext?.buyingPower,
            timeframe: "intraday",
            riskTolerance: "balanced",
          };

      const setup = buildTradeSetup({
        symbolAnalysis: analysis,
        market,
        account,
      });

      return buildIntradaySymbolDecision(
        setup,
        marketCondition,
        actionWindow,
        account,
      );
    });

    const watchNext = [
      `Nasdaq 100 futures: ${market.nasdaqFuturesChange != null ? `${market.nasdaqFuturesChange >= 0 ? "+" : ""}${market.nasdaqFuturesChange.toFixed(2)}%` : "unavailable"}`,
      `Market breadth advancing: ${market.breadth.advancingPercent ?? "n/a"}%`,
      symbolDecisions.find((d) => d.actNow)
        ? `Act now: ${symbolDecisions.filter((d) => d.actNow).map((d) => d.symbol).join(", ")}`
        : "No immediate act-now signals — wait for triggers",
    ];

    return {
      timestamp: new Date().toISOString(),
      disclaimer: TRADING_DISCLAIMER,
      marketSession,
      marketCondition,
      actionWindow,
      sources: market.sources,
      warnings: [...new Set([...warnings, ...market.warnings])],
      symbolDecisions,
      watchNext,
    };
  });
}
