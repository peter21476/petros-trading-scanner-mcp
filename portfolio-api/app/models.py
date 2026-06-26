from typing import Literal

from pydantic import BaseModel, Field


class EquityPosition(BaseModel):
    symbol: str
    shares: float
    averageCost: float
    currentPrice: float
    marketValue: float
    currentValue: float
    unrealizedGainLoss: float
    unrealizedGainLossPercent: float


class OptionPosition(BaseModel):
    symbol: str
    underlying: str
    type: Literal["call", "put"]
    strike: float
    expiration: str
    contracts: float
    averageCost: float
    currentPrice: float
    marketValue: float
    unrealizedGainLoss: float
    unrealizedGainLossPercent: float


class PortfolioResponse(BaseModel):
    accountNumber: str
    accountValue: float
    buyingPower: float
    cash: float
    equityPositions: list[EquityPosition]
    optionPositions: list[OptionPosition]
    updatedAt: str
    source: Literal["robinhood"] = "robinhood"
    warnings: list[str] = Field(default_factory=list)
