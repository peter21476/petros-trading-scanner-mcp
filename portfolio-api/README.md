# Robinhood Portfolio API

Read-only FastAPI service that exposes your Robinhood portfolio to the **Trading MCP** server. It uses the unofficial [`robin_stocks`](https://github.com/jmfernandes/robin_stocks) library and **does not place trades**.

## Features

- `GET /health` — service health check
- `GET /portfolio/{accountNumber}` — equity + option positions, buying power, account value
- Bearer token auth (`PORTFOLIO_API_TOKEN`)
- 30–60 second response cache (default 45s)
- No credentials or tokens in logs

## Setup

### 1. Create virtual environment

```bash
cd portfolio-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
ROBINHOOD_USERNAME=your_robinhood_email
ROBINHOOD_PASSWORD=your_robinhood_password
ROBINHOOD_MFA_CODE=123456
PORTFOLIO_API_TOKEN=choose-a-long-random-secret
PORT=8000
PORTFOLIO_CACHE_SECONDS=45
```

**Security:** Never commit `.env`. Robinhood may require MFA — set `ROBINHOOD_MFA_CODE` when prompted, or use an app-specific workflow supported by `robin_stocks`.

### 3. Run locally

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Test with curl

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/portfolio/Agentic
```

Health check:

```bash
curl http://localhost:8000/health
```

`accountNumber` (e.g. `Agentic`) is a **label** used by the MCP. The service returns data for your logged-in Robinhood account.

## Connect Trading MCP

In the Node MCP server `.env`:

```env
PORTFOLIO_API_BASE_URL=http://localhost:8000/portfolio
PORTFOLIO_API_KEY=YOUR_TOKEN
```

`PORTFOLIO_API_KEY` must match `PORTFOLIO_API_TOKEN` on this service.

The MCP calls:

```
GET {PORTFOLIO_API_BASE_URL}/{accountNumber}
Authorization: Bearer {PORTFOLIO_API_KEY}
```

Example production:

```env
PORTFOLIO_API_BASE_URL=https://your-portfolio-api.onrender.com/portfolio
PORTFOLIO_API_KEY=YOUR_TOKEN
```

Then use MCP tools:

- `get_portfolio_trade_plan` with `accountNumber: "Agentic"`
- `get_intraday_decision_check` with `accountNumber: "Agentic"`

## Deploy

### Render

1. New **Web Service** → connect repo, set **Root Directory** to `portfolio-api`
2. Build: `pip install -r requirements.txt`
3. Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables from `.env.example`

### Heroku

```bash
cd portfolio-api
heroku create your-portfolio-api
heroku config:set ROBINHOOD_USERNAME=... ROBINHOOD_PASSWORD=... PORTFOLIO_API_TOKEN=...
git subtree push --prefix portfolio-api heroku main
```

Uses included `Procfile` and `runtime.txt`.

## Response shape

```json
{
  "accountNumber": "Agentic",
  "accountValue": 12345.67,
  "buyingPower": 2500.0,
  "cash": 500.0,
  "equityPositions": [
    {
      "symbol": "SOXL",
      "shares": 10,
      "averageCost": 175.5,
      "currentPrice": 220.51,
      "marketValue": 2205.1,
      "currentValue": 2205.1,
      "unrealizedGainLoss": 450.1,
      "unrealizedGainLossPercent": 25.64
    }
  ],
  "optionPositions": [],
  "updatedAt": "2026-06-26T12:00:00Z",
  "source": "robinhood",
  "warnings": []
}
```

## Error handling

| Status | Meaning |
|--------|---------|
| 401 | Missing/invalid bearer token or Robinhood login failure |
| 502 | Robinhood fetch/network error |
| 503 | Server missing `PORTFOLIO_API_TOKEN` |

## Disclaimer

Unofficial Robinhood integration for **read-only research**. Not affiliated with Robinhood. Use at your own risk. Never expose this service publicly without strong authentication.
