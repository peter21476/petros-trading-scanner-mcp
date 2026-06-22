const YAHOO_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

let yahooRateLimitedUntil = 0;

export function isYahooRateLimited(): boolean {
  return Date.now() < yahooRateLimitedUntil;
}

export function markYahooRateLimited(): void {
  yahooRateLimitedUntil = Date.now() + YAHOO_RATE_LIMIT_COOLDOWN_MS;
}

export function getYahooRateLimitedUntil(): number | null {
  return yahooRateLimitedUntil > Date.now() ? yahooRateLimitedUntil : null;
}

export function getRateLimitedSources(): Array<{
  source: string;
  until: string;
}> {
  const until = getYahooRateLimitedUntil();
  if (!until) {
    return [];
  }
  return [{ source: "Yahoo Finance", until: new Date(until).toISOString() }];
}

export function clearYahooRateLimitForTests(): void {
  yahooRateLimitedUntil = 0;
}
