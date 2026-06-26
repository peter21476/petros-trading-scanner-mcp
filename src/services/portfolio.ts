import type {
  PortfolioEquityPosition,
  PortfolioOptionPosition,
  PortfolioSnapshot,
} from "../types/trading.js";

export function portfolioFromAccountContext(input: {
  accountValue?: number;
  buyingPower?: number;
  equityPositions?: PortfolioEquityPosition[];
  optionPositions?: PortfolioOptionPosition[];
}): PortfolioSnapshot | null {
  const hasPositions =
    (input.equityPositions?.length ?? 0) > 0 ||
    (input.optionPositions?.length ?? 0) > 0;
  const hasAccountData =
    input.accountValue != null || input.buyingPower != null || hasPositions;

  if (!hasAccountData) {
    return null;
  }

  return {
    accountNumber: "accountContext",
    accountValue: input.accountValue ?? 0,
    buyingPower: input.buyingPower ?? 0,
    equityPositions: input.equityPositions ?? [],
    optionPositions: input.optionPositions ?? [],
    source: "account_context",
  };
}

export function computePositionPnlPercent(
  averageCost: number,
  currentValue: number,
  shares: number,
): number | null {
  if (shares <= 0 || averageCost <= 0) {
    return null;
  }
  const costBasis = averageCost * shares;
  if (costBasis <= 0) {
    return null;
  }
  const value = currentValue > 0 ? currentValue : averageCost * shares;
  return Number((((value - costBasis) / costBasis) * 100).toFixed(2));
}

export const ACCOUNT_CONTEXT_REQUIRED_MESSAGE =
  "No accountContext supplied. Use the ChatGPT Robinhood connector to provide positions and buying power.";
