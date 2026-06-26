# Petros Trading Scanner MCP

Read-only **Model Context Protocol (MCP)** server for short-term stock and ETF **market research**. It helps ChatGPT analyze futures, premarket movers, market breadth, sector strength, earnings, watchlist signals, and daily briefings.

**This server does not place trades.** Trade execution is handled separately (e.g. Robinhood). It does not store personal data or broker credentials.

## Features

| Tool | Description |
|------|-------------|
| `get_futures` | Nasdaq 100, S&P 500, Dow, Russell 2000, crude, gold, Bitcoin |
| `get_premarket_movers` | Leaders, laggards, most active (MarketWatch → Yahoo → Finviz fallback) |
| `get_market_breadth` | Finviz advancing/declining, highs/lows, SMA50/SMA200 |
| `get_finviz_snapshot` | Homepage-style snapshot: movers, news, headlines, breadth, futures |
| `get_earnings_calendar` | Upcoming earnings (Finviz API) |
| `get_watchlist_signals` | Transparent 0–10 scores, bias, reasons, risk flags |
| `get_semiconductor_strength` | Sector score, bias, confidence, leaders/laggards for 11 semi names (SOXL workflow) |
| `get_position_review` | Single-position review: action, confidence, thesis, strengths, risks — plus market bias, sector strength, watchlist signal, and account P/L |
| `get_trade_setup` | Aggressive trade setup: entry/stop/targets, risk/reward, catalysts, suggested action (research framework) |
| `get_portfolio_trade_plan` | Account-aware plan: holdings, concentration risk, trim/hold lists, top trades, session plan |
| `get_aggressive_watchlist_rankings` | Rank watchlist by near-term opportunity with triggers and stops |
| `get_intraday_decision_check` | “Should I act now?” — per-symbol intraday decisions after market open |
| `get_best_trades_today` | Highest-conviction short-term candidates with transparent sub-scores and optional rotation plan |
| `get_historical_prices` | OHLCV history with 20/50-day SMA distance and 52-week high/low (Finnhub or Yahoo) |
| `get_technical_indicators` | RSI, MACD, Bollinger Bands, volume ratio with interpretation hints |
| `get_sector_rotation` | All 11 S&P 500 sector ETFs ranked by today's performance with rotation theme |
| `get_ticker_news` | Recent ticker news with per-article sentiment and overall sentiment score |
| `get_options_flow` | Unusual options activity via Unusual Whales API when `UNUSUAL_WHALES_API_TOKEN` is set |
| `get_daily_briefing` | Full briefing with source attribution, confidence, news severity, portfolio notes |

### Data sources (free/public)

1. **Finviz** — futures, breadth, snapshot, earnings API
2. **Finnhub** — optional primary quotes when `FINNHUB_API_KEY` is set
3. **Alpha Vantage** — optional quotes when `ALPHA_VANTAGE_API_KEY` is set
4. **Unusual Whales** — optional options flow when `UNUSUAL_WHALES_API_TOKEN` is set (paid API)
5. **Nasdaq** — quote provider (price, change %, volume)
6. **Yahoo Finance** — spark batch only when not rate-limited (30 min cooldown after HTTP 429)
7. **MarketWatch** — premarket movers (often blocked on cloud hosts with HTTP 401)
8. **Yahoo Finance screeners** — day gainers/losers/actives when MarketWatch is blocked

Caching: **5 minutes** for market data, **15 minutes** for daily briefings.

Watchlist quotes resolve in order: **Finnhub → Alpha Vantage → Nasdaq → Yahoo (if not rate-limited) → Finviz**. Yahoo is skipped for 30 minutes after HTTP 429. Check `quoteDiagnostics.rateLimitedSources` to see active blocks.

**Note:** MarketWatch frequently returns **HTTP 401** from Heroku and other cloud servers due to bot protection. The server automatically falls back to Yahoo Finance, then Finviz. To skip MarketWatch entirely, set `MARKETWATCH_ENABLED=false` in Heroku config vars.

---

## Local development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone <your-repo-url>
cd mcp-trading
cp .env.example .env
npm install
npm run dev
```

Server starts on `http://localhost:3000` by default.

- Health: `GET /health`
- MCP: `POST /mcp` (Streamable HTTP)

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production build |

### Optional API key

Set `MCP_SERVER_API_KEY` in `.env`. When set, all `/mcp` routes require:

```http
Authorization: Bearer <your-key>
```

---

## Deploy to Heroku

```bash
heroku create petros-trading-scanner
heroku config:set MCP_SERVER_API_KEY=your-secret-key
git push heroku main
```

Heroku sets `PORT` automatically. The app binds to `0.0.0.0` and uses `process.env.PORT`.

Verify deployment:

```bash
curl https://petros-trading-scanner.herokuapp.com/health
```

---

## Connect to ChatGPT Developer Mode

1. Deploy the server (Heroku or another HTTPS host).
2. In **ChatGPT → Settings → Connectors / Developer Mode**, add a custom MCP server.
3. Use your public MCP URL, for example:
   - `https://petros-trading-scanner.herokuapp.com/mcp`
4. If you configured `MCP_SERVER_API_KEY`, add the Bearer token in the connector auth settings.

The server implements **Streamable HTTP** (`POST /mcp`) compatible with ChatGPT Apps / Developer Mode.

---

## Example prompts

- "Use my Trading Scanner MCP to get today's daily briefing."
- "Check futures and premarket movers."
- "Analyze SOXL based on semiconductor strength."
- "Give me a market bias for today."
- "Run semiconductor strength for my SOXL workflow."
- "Run watchlist signals for SOXL, MU, NVDA, AMD, AVGO, INTC, MRVL, WDC."
- "Review my SOXL position — cost basis $50, current value $51.17."
- "Review my AAPL position — cost basis $180, current value $195."

### Example: position review tool input

Works for any stock or ETF (`SOXL`, `NVDA`, `AAPL`, `TQQQ`, etc.):

```json
{
  "symbol": "SOXL",
  "costBasis": 50,
  "currentValue": 51.17
}
```

Expected shape (values vary with live market data):

```json
{
  "action": "hold",
  "confidence": 76,
  "thesis": "Semiconductor sector remains strong despite weak futures.",
  "strengths": ["..."],
  "risks": ["..."]
}
```

### Example: daily briefing tool input

```json
{
  "focusSymbols": ["SOXL", "MU", "NVDA", "AMD", "AVGO", "INTC", "MRVL", "WDC"],
  "portfolioContext": "Holding SOXL from starter account",
  "positions": [
    {
      "symbol": "SOXL",
      "costBasis": 50,
      "currentValue": 51.17
    }
  ]
}
```

The briefing now includes:

- `sources.futuresSource`, `sources.premarketSource`, `sources.breadthSource`, etc.
- `confidence` (0–100) alongside `marketBias`
- `news[]` with `impact` (`high` | `medium` | `low`) and `sentiment`
- `portfolioNotes[]` with thesis status per position
- `semiconductorStrength` summary block

---

## Scoring (transparent, not advice)

Market bias uses:

- Nasdaq 100 futures ±0.5%
- S&P 500 futures ±0.3%
- Advancing/declining breadth above 55%

**Confidence** (0–100) increases as the bias score moves away from neutral and more signals agree. Example: `marketBias: "bearish"` with `confidence: 72` = moderately-to-strongly bearish, not a mild lean.

Semiconductor strength tracks NVDA, AMD, MU, AVGO, INTC, MRVL, WDC, TSM, AMAT, LRCX, SMCI. **Strong** if 5+ are positive premarket or in major news.

SOXL scoring considers semiconductor strength + Nasdaq futures direction. Leveraged ETF risk flags are always included.

### Quote verification

Watchlist signals and semiconductor strength include extra fields so you can sanity-check prices:

| Field | Meaning |
| --- | --- |
| `price` | Last regular (or premarket) sale from Yahoo/Nasdaq |
| `previousClose` | Prior session close used to compute change % |
| `changePercent` | Derived from `price` vs `previousClose` (or source-reported) |
| `asOf` | ISO timestamp of the quote (when available) |
| `quoteSource` | e.g. `Yahoo Finance`, `Nasdaq`, `Finviz topGainers` |
| `quoteValidated` | `true` when price, change, and % are internally consistent |
| `dataFreshness` | `"fresh"`, `"delayed"`, `"stale"`, `"closed_session"`, or `"cached"` — session-aware for quotes; research tools use `cached` when serving TTL cache or after rate limits |
| `marketSession` | Current US session: `premarket`, `regular`, `after_hours`, `overnight`, `weekend`, `holiday` |
| `freshnessAgeMinutes` | Minutes between `asOf` and server time |
| `freshnessReason` | Human-readable explanation of the freshness classification |
| `providerTimestamps` | Per-provider debug: `finnhub.t`, `nasdaq.lastTradeTimestamp`, etc. |
| `sourceQuality` | `"multi_source_agreement"`, `"multi_source_partial"`, `"finnhub_only"`, `"nasdaq_only"`, `"finviz_only"`, etc. |
| `confidence` | Primary+Nasdaq agreement=95, partial agreement=85, Nasdaq only=70, Finviz only=55 |
| `isDelayed` | `true` for Finviz-only fallback quotes (change % only) |

**Parser note:** Nasdaq quotes use `primaryData.lastSalePrice` — not market cap, 52-week high, or volume. If a price looks wrong, check `previousClose` and `asOf`: when change % looks realistic but the level seems off, the upstream feed (Yahoo/Nasdaq) may be reporting a different session or a forward-dated close. Cross-check with your broker.

Daily briefings also include top-level `dataFreshness` — aggregated from futures, premarket, breadth, and watchlist quotes (`stale` if any quote is stale; `closed_session` when all quotes reflect the last completed session).

`get_watchlist_signals` returns overall `confidence`, `quoteDiagnostics` (including `rateLimitedSources` and `providersAttempted`).

### `get_position_review`

Combines market bias, semiconductor sector strength (when relevant), watchlist scoring, and optional account data into a single position review.

**Input:**
```json
{
  "symbol": "SOXL",
  "costBasis": 50,
  "currentValue": 51.17,
  "portfolioContext": "Core semi swing position, 3–5 day hold"
}
```

**Output highlights:**
- `action` — `hold`, `add`, `trim`, or `exit` (research framing, not a trade order)
- `confidence` — weighted from quote quality, watchlist score, market bias, and sector strength
- `account` — cost basis, current value, P/L %, optional context
- `marketBias` — bullish/neutral/bearish with confidence and reasons (futures + breadth)
- `sectorStrength` — semiconductor sector score when symbol is semi-related; otherwise `applicable: false`
- `watchlistSignal` — full symbol score (0–10), bias, reasons, risk flags, quote metadata

**The tools return data, scores, and reasons only — not buy/sell recommendations.** ChatGPT interprets the output; you make your own decisions.

### Aggressive trading tools (research framework)

All tools include timestamps, data sources, disclaimers, and quote freshness warnings. **The MCP does not fetch broker data** — pass `accountContext` from the ChatGPT Robinhood connector.

| Tool | Purpose |
|------|---------|
| `get_best_trades_today` | Top conviction candidates (0–100) with sub-scores, entry/stop/targets, rotation plan |
| `get_trade_setup` | One-symbol setup: entry zone, stop, targets, R/R, catalysts |
| `get_aggressive_watchlist_rankings` | Rank symbols by `aggressiveBuyScore` (0–10) |
| `get_intraday_decision_check` | Post-open go/no-go with `actNow`, triggers, and `actionWindow` |
| `get_portfolio_trade_plan` | Account plan from `accountContext` (holdings, trim lists, session plan) |

### ChatGPT Robinhood connector workflow

The MCP is **read-only** and does not log into Robinhood. Use ChatGPT’s built-in Robinhood connector to fetch account data, then pass it into MCP tools:

1. Use ChatGPT **Robinhood connector** → get accounts, buying power, equity positions, option positions.
2. Build an `accountContext` object (see example below).
3. Call MCP tools with that context:
   - `get_best_trades_today`
   - `get_portfolio_trade_plan`
   - `get_intraday_decision_check`
   - `get_trade_setup` (optional per-symbol context)

**Example `accountContext`:**

```json
{
  "accountValue": 90.04,
  "buyingPower": 0,
  "equityPositions": [
    {
      "symbol": "SOXL",
      "shares": 0.182748,
      "averageCost": 273.60,
      "currentValue": 40.00,
      "marketValue": 40.00
    },
    {
      "symbol": "AMD",
      "shares": 0.095706,
      "averageCost": 522.43,
      "currentValue": 50.00,
      "marketValue": 50.00
    }
  ],
  "optionPositions": []
}
```

**Example: `get_best_trades_today`**

```json
{
  "timeframe": "intraday",
  "riskTolerance": "aggressive",
  "maxResults": 10,
  "accountContext": { "...": "..." }
}
```

**Conviction scoring (`get_best_trades_today`):** weighted sub-scores (momentum 20%, relative strength 15%, volume 15%, catalyst 15%, trend 10%, risk/reward 10%, liquidity 5%, market alignment 10%) → `convictionScore` 0–100.

Run tests: `npm test`

---

## Project structure

```text
src/
  index.ts
  server.ts
  mcp/
    tools.ts
    schemas.ts
  services/
    finviz.ts
    marketwatch.ts
    yahoo.ts
    scoring.ts
    marketData.ts
    tradeAnalysis.ts
    bestTradesToday.ts
    tradingContext.ts
    tradingTools.ts
    portfolio.ts
    cache.ts
    http.ts
  types/
    market.ts
    trading.ts
  utils/
    parseNumber.ts
    logger.ts
    quoteValidation.ts
    newsAnalysis.ts
    dataFreshness.ts
    quoteConfidence.ts
```

---

## Disclaimer

**Development note:** This is a research assistant only. It does not provide financial advice and does not place trades. Market data may be delayed or incomplete. Always verify quotes and consult your own judgment before trading.
