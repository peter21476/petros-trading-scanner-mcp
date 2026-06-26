import { safeFetchJson } from "./http.js";
import type {
  PortfolioEquityPosition,
  PortfolioOptionPosition,
  PortfolioSnapshot,
} from "../types/trading.js";
import { logger } from "../utils/logger.js";

interface PortfolioApiResponse {
  accountValue?: number;
  buyingPower?: number;
  equityPositions?: PortfolioEquityPosition[];
  optionPositions?: PortfolioOptionPosition[];
  positions?: PortfolioEquityPosition[];
  options?: PortfolioOptionPosition[];
}

export function isPortfolioApiConfigured(): boolean {
  return Boolean(process.env.PORTFOLIO_API_BASE_URL?.trim());
}

export async function fetchPortfolio(
  accountNumber: string,
): Promise<PortfolioSnapshot | null> {
  const baseUrl = process.env.PORTFOLIO_API_BASE_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  const apiKey = process.env.PORTFOLIO_API_KEY?.trim();
  const url = `${baseUrl.replace(/\/$/, "")}/accounts/${encodeURIComponent(accountNumber)}/portfolio`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const data = await safeFetchJson<PortfolioApiResponse>(url, { headers });
    if (!data) {
      return null;
    }

    const equityPositions = data.equityPositions ?? data.positions ?? [];
    const optionPositions = data.optionPositions ?? data.options ?? [];

    return {
      accountNumber,
      accountValue: data.accountValue ?? 0,
      buyingPower: data.buyingPower ?? 0,
      equityPositions,
      optionPositions,
      source: "portfolio_api",
    };
  } catch (error) {
    logger.warn("Portfolio API fetch failed", {
      accountNumber,
      error: String(error),
    });
    return null;
  }
}

export function portfolioFromAccountContext(input: {
  accountNumber: string;
  accountValue?: number;
  buyingPower?: number;
  equityPositions?: PortfolioEquityPosition[];
  optionPositions?: PortfolioOptionPosition[];
}): PortfolioSnapshot {
  return {
    accountNumber: input.accountNumber,
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
