import logging
import re
from datetime import datetime, timezone
from typing import Any

import robin_stocks.robinhood as rh

from app.cache import portfolio_cache
from app.config import get_settings
from app.models import EquityPosition, OptionPosition, PortfolioResponse

logger = logging.getLogger(__name__)

_session_authenticated = False
LOGIN_ERROR_HINT = (
    "Robinhood login failed. Check credentials, MFA code, or session expiry."
)


def to_float(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def round_money(value: float) -> float:
    return round(value, 2)


def round_percent(value: float) -> float:
    return round(value, 2)


def pnl_percent(cost_basis: float, market_value: float) -> float:
    if cost_basis <= 0:
        return 0.0
    return round_percent(((market_value - cost_basis) / cost_basis) * 100)


def build_occ_symbol(
    underlying: str,
    expiration: str,
    option_type: str,
    strike: float,
) -> str:
    date_part = expiration.replace("-", "")
    if len(date_part) == 8:
        yymmdd = date_part[2:]
    else:
        yymmdd = date_part
    cp = "C" if option_type.lower() == "call" else "P"
    strike_int = int(round(strike * 1000))
    return f"{underlying.upper()}{yymmdd}{cp}{strike_int:08d}"


def authenticate_robinhood(force: bool = False) -> None:
    global _session_authenticated

    if _session_authenticated and not force:
        return

    settings = get_settings()
    mfa_code = settings["robinhood_mfa_code"] or None

    logger.info("Authenticating Robinhood session")
    try:
        login_result = rh.login(
            settings["robinhood_username"],
            settings["robinhood_password"],
            mfa_code=mfa_code,
            store_session=True,
            expiresIn=86400,
        )
    except Exception as exc:
        logger.error("Robinhood login raised an exception: %s", type(exc).__name__)
        _session_authenticated = False
        raise RuntimeError(LOGIN_ERROR_HINT) from exc

    if login_result in (None, False):
        logger.error("Robinhood login returned no session")
        _session_authenticated = False
        raise RuntimeError(LOGIN_ERROR_HINT)

    _session_authenticated = True
    logger.info("Robinhood session established")


def resolve_robinhood_account_number(account_label: str) -> str | None:
    """Match path account label to Robinhood account_number when possible."""
    try:
        profile = rh.load_account_profile() or {}
    except Exception:
        profile = {}

    candidates = [
        profile.get("account_number"),
        profile.get("rhs_account_number"),
        profile.get("account_number_masked"),
    ]
    normalized_label = account_label.strip().lower()
    for candidate in candidates:
        if candidate and str(candidate).lower() == normalized_label:
            return str(candidate)

    # Friendly labels (e.g. "Agentic") map to the active logged-in account.
    return str(profile.get("account_number") or profile.get("rhs_account_number") or "")


def get_buying_power() -> tuple[float, float]:
    account = rh.load_account_profile() or {}
    buying_power = to_float(account.get("buying_power"))
    cash = to_float(account.get("cash"))

    if buying_power <= 0 and cash > 0:
        buying_power = cash

    try:
        phoenix = rh.load_phoenix_account() or {}
        portfolio_equity = phoenix.get("portfolio_equity") or {}
        if buying_power <= 0:
            buying_power = to_float(portfolio_equity.get("buying_power"))
        if cash <= 0:
            cash = to_float(phoenix.get("cash"), cash)
    except Exception:
        pass

    return round_money(buying_power), round_money(cash)


def get_account_value() -> float:
    portfolio = rh.load_portfolio_profile() or {}
    equity = to_float(portfolio.get("equity"))
    if equity > 0:
        return round_money(equity)

    extended = to_float(portfolio.get("extended_hours_equity"))
    if extended > 0:
        return round_money(extended)

    account = rh.load_account_profile() or {}
    return round_money(to_float(account.get("equity")))


def _symbol_from_instrument_url(instrument_url: str | None) -> str | None:
    if not instrument_url:
        return None
    try:
        return rh.get_symbol_by_url(instrument_url)
    except Exception:
        return None


def _latest_prices(symbols: list[str]) -> dict[str, float]:
    if not symbols:
        return {}

    unique_symbols = sorted({symbol.upper() for symbol in symbols if symbol})
    prices: dict[str, float] = {}

    try:
        latest = rh.get_latest_price(unique_symbols)
        if isinstance(latest, dict):
            for symbol, value in latest.items():
                price = to_float(value, 0.0)
                if price > 0:
                    prices[symbol.upper()] = price
        elif isinstance(latest, list):
            for symbol, value in zip(unique_symbols, latest, strict=False):
                price = to_float(value, 0.0)
                if price > 0:
                    prices[symbol.upper()] = price
        elif isinstance(latest, str) and len(unique_symbols) == 1:
            price = to_float(latest, 0.0)
            if price > 0:
                prices[unique_symbols[0]] = price
    except Exception as exc:
        logger.warning("Failed to fetch latest prices: %s", type(exc).__name__)

    missing = [symbol for symbol in unique_symbols if symbol not in prices]
    for symbol in missing:
        try:
            quote = rh.get_stock_quote_by_symbol(symbol) or {}
            price = to_float(quote.get("last_trade_price") or quote.get("mark_price"))
            if price > 0:
                prices[symbol] = price
        except Exception:
            continue

    return prices


def get_equity_positions() -> list[EquityPosition]:
    raw_positions = rh.get_open_stock_positions() or []
    symbols: list[str] = []

    for position in raw_positions:
        symbol = _symbol_from_instrument_url(position.get("instrument"))
        shares = to_float(position.get("quantity"))
        if symbol and shares > 0:
            symbols.append(symbol.upper())

    price_map = _latest_prices(symbols)
    equity_positions: list[EquityPosition] = []

    for position in raw_positions:
        symbol = _symbol_from_instrument_url(position.get("instrument"))
        shares = to_float(position.get("quantity"))
        if not symbol or shares <= 0:
            continue

        average_cost = to_float(position.get("average_buy_price"))
        current_price = price_map.get(symbol.upper(), average_cost)
        market_value = round_money(current_price * shares)
        cost_basis = round_money(average_cost * shares)
        unrealized = round_money(market_value - cost_basis)

        equity_positions.append(
            EquityPosition(
                symbol=symbol.upper(),
                shares=round(shares, 4),
                averageCost=round_money(average_cost),
                currentPrice=round_money(current_price),
                marketValue=market_value,
                currentValue=market_value,
                unrealizedGainLoss=unrealized,
                unrealizedGainLossPercent=pnl_percent(cost_basis, market_value),
            )
        )

    equity_positions.sort(key=lambda item: item.symbol)
    return equity_positions


def _option_details(position: dict[str, Any]) -> dict[str, Any]:
    if position.get("chain_symbol") and position.get("expiration_date"):
        return position

    option_url = position.get("option") or position.get("option_id")
    if not option_url:
        return position

    option_id = str(option_url).rstrip("/").split("/")[-1]
    try:
        instrument = rh.get_option_instrument_data_by_id(option_id) or {}
        merged = {**position, **instrument}
        return merged
    except Exception:
        return position


def get_option_positions() -> list[OptionPosition]:
    raw_positions = rh.get_open_option_positions() or []
    option_positions: list[OptionPosition] = []

    for position in raw_positions:
        details = _option_details(position)
        contracts = to_float(details.get("quantity"))
        if contracts <= 0:
            continue

        underlying = (
            details.get("chain_symbol")
            or details.get("symbol")
            or _symbol_from_instrument_url(details.get("instrument"))
            or "UNKNOWN"
        )
        expiration = str(details.get("expiration_date") or "")
        strike = to_float(details.get("strike_price"))
        raw_type = str(details.get("type") or details.get("option_type") or "call").lower()
        option_type = "put" if "put" in raw_type else "call"
        average_cost = to_float(details.get("average_price"))

        current_price = average_cost
        try:
            market_data = rh.get_option_market_data(
                underlying,
                expiration,
                str(strike),
                option_type,
            )
            if market_data:
                mark = to_float(
                    market_data.get("adjusted_mark_price")
                    or market_data.get("mark_price")
                    or market_data.get("last_trade_price")
                )
                if mark > 0:
                    current_price = mark
        except Exception:
            pass

        market_value = round_money(current_price * contracts * 100)
        cost_basis = round_money(average_cost * contracts * 100)
        unrealized = round_money(market_value - cost_basis)
        occ_symbol = build_occ_symbol(underlying, expiration, option_type, strike)

        option_positions.append(
            OptionPosition(
                symbol=occ_symbol,
                underlying=underlying.upper(),
                type=option_type,
                strike=round_money(strike),
                expiration=expiration,
                contracts=round(contracts, 4),
                averageCost=round_money(average_cost),
                currentPrice=round_money(current_price),
                marketValue=market_value,
                unrealizedGainLoss=unrealized,
                unrealizedGainLossPercent=pnl_percent(cost_basis, market_value),
            )
        )

    option_positions.sort(key=lambda item: item.symbol)
    return option_positions


def build_portfolio_response(account_number: str) -> PortfolioResponse:
    settings = get_settings()
    cache_key = f"portfolio:{account_number.lower()}"
    cached = portfolio_cache.get(cache_key)
    if cached is not None:
        logger.info("Serving cached portfolio response for account label=%s", account_number)
        return cached

    warnings: list[str] = []

    try:
        authenticate_robinhood()
        resolved_account = resolve_robinhood_account_number(account_number)
        if resolved_account and resolved_account.lower() != account_number.lower():
            warnings.append(
                f"Account label '{account_number}' mapped to active Robinhood account."
            )
    except RuntimeError:
        raise
    except Exception as exc:
        logger.error("Robinhood authentication failure: %s", type(exc).__name__)
        raise RuntimeError(LOGIN_ERROR_HINT) from exc

    try:
        buying_power, cash = get_buying_power()
        account_value = get_account_value()
        equity_positions = get_equity_positions()
        option_positions = get_option_positions()
    except Exception as exc:
        message = str(exc)
        if re.search(r"login|auth|token|401|403", message, re.IGNORECASE):
            logger.warning("Robinhood session may have expired; retrying login")
            authenticate_robinhood(force=True)
            buying_power, cash = get_buying_power()
            account_value = get_account_value()
            equity_positions = get_equity_positions()
            option_positions = get_option_positions()
        else:
            logger.error("Robinhood portfolio fetch failed: %s", type(exc).__name__)
            raise RuntimeError(
                "Unable to fetch Robinhood portfolio data. Try again shortly."
            ) from exc

    if not equity_positions and not option_positions:
        warnings.append("No open equity or option positions returned by Robinhood.")

    if account_value <= 0:
        computed = round_money(
            sum(position.marketValue for position in equity_positions)
            + sum(position.marketValue for position in option_positions)
            + cash
        )
        if computed > 0:
            account_value = computed
            warnings.append("Account value estimated from positions and cash.")

    response = PortfolioResponse(
        accountNumber=account_number,
        accountValue=account_value,
        buyingPower=buying_power,
        cash=cash,
        equityPositions=equity_positions,
        optionPositions=option_positions,
        updatedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        warnings=warnings,
    )

    portfolio_cache.set(cache_key, response, int(settings["cache_seconds"]))
    logger.info(
        "Portfolio built account=%s equities=%d options=%d",
        account_number,
        len(equity_positions),
        len(option_positions),
    )
    return response
