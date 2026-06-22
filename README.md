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
| `get_daily_briefing` | Full briefing with source attribution, confidence, news severity, portfolio notes |

### Data sources (free/public)

1. **Finviz** — futures, breadth, snapshot, earnings API
2. **Yahoo Finance** — batch spark API for quotes/futures; individual chart fallback
3. **Nasdaq** — quote fallback when Yahoo is rate-limited (price, change %, volume)
4. **Finviz snapshot** — top gainers/losers/unusual volume/major news as secondary fallback
5. **MarketWatch** — premarket movers (often blocked on cloud hosts with HTTP 401)
6. **Yahoo Finance screeners** — day gainers/losers/actives when MarketWatch is blocked

Caching: **5 minutes** for market data, **15 minutes** for daily briefings.

Watchlist quotes resolve in order: **Yahoo batch → Nasdaq → Finviz snapshot → Yahoo individual**. Each signal includes `quoteSource`, `price`, `changePercent`, and `volume` when available.

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

**The tools return data, scores, and reasons only — not buy/sell recommendations.** ChatGPT interprets the output; you make your own decisions.

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
    cache.ts
    http.ts
  types/
    market.ts
  utils/
    parseNumber.ts
    logger.ts
```

---

## Disclaimer

**Development note:** This is a research assistant only. It does not provide financial advice and does not place trades. Market data may be delayed or incomplete. Always verify quotes and consult your own judgment before trading.
