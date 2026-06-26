import { logger } from "../utils/logger.js";

/** Browser-like UA — Yahoo blocks bare/default clients on options endpoints. */
export const YAHOO_OPTIONS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CRUMB_TTL_MS = 30 * 60 * 1000;
const CRUMB_URLS = [
  "https://query2.finance.yahoo.com/v1/test/getcrumb",
  "https://query1.finance.yahoo.com/v1/test/getcrumb",
] as const;
const COOKIE_BOOTSTRAP_URLS = [
  "https://fc.yahoo.com",
  "https://finance.yahoo.com",
] as const;

interface YahooAuth {
  cookieHeader: string;
  crumb: string;
  expiresAt: number;
}

let cachedAuth: YahooAuth | null = null;

function parseSetCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const raw of setCookies) {
    const pair = raw.split(";")[0]?.trim();
    if (!pair) {
      continue;
    }
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeaderFromJar(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function isValidCrumb(crumb: string): boolean {
  return (
    crumb.length > 0 &&
    crumb.length <= 32 &&
    !crumb.startsWith("{") &&
    !crumb.includes("Unauthorized")
  );
}

async function bootstrapCookies(jar: Map<string, string>): Promise<void> {
  for (const url of COOKIE_BOOTSTRAP_URLS) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": YAHOO_OPTIONS_USER_AGENT,
          Accept: "text/html,application/json,*/*",
          Cookie: cookieHeaderFromJar(jar),
        },
        redirect: "follow",
      });
      mergeCookies(jar, parseSetCookieHeaders(response.headers));
    } catch (error) {
      logger.debug("Yahoo cookie bootstrap failed", { url, error: String(error) });
    }
  }
}

async function fetchCrumb(jar: Map<string, string>): Promise<string | null> {
  const cookieHeader = cookieHeaderFromJar(jar);
  for (const url of CRUMB_URLS) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": YAHOO_OPTIONS_USER_AGENT,
          Accept: "text/plain,*/*",
          Cookie: cookieHeader,
        },
      });
      const crumb = (await response.text()).trim();
      if (response.ok && isValidCrumb(crumb)) {
        return crumb;
      }
      logger.debug("Yahoo crumb fetch rejected", {
        url,
        status: response.status,
        bodyPreview: crumb.slice(0, 80),
      });
    } catch (error) {
      logger.debug("Yahoo crumb fetch failed", { url, error: String(error) });
    }
  }
  return null;
}

async function refreshYahooAuth(): Promise<YahooAuth | null> {
  const jar = new Map<string, string>();
  await bootstrapCookies(jar);

  const crumb = await fetchCrumb(jar);
  const cookieHeader = cookieHeaderFromJar(jar);
  if (!crumb || !cookieHeader) {
    logger.warn("Yahoo auth bootstrap failed", {
      hasCrumb: Boolean(crumb),
      cookieCount: jar.size,
    });
    return null;
  }

  logger.debug("Yahoo auth refreshed", { crumbLength: crumb.length, cookieCount: jar.size });
  return {
    cookieHeader,
    crumb,
    expiresAt: Date.now() + CRUMB_TTL_MS,
  };
}

/** Cached Yahoo cookie + crumb pair for authenticated finance API calls. */
export async function getYahooAuth(): Promise<YahooAuth | null> {
  const now = Date.now();
  if (cachedAuth && cachedAuth.expiresAt > now) {
    return cachedAuth;
  }

  cachedAuth = await refreshYahooAuth();
  return cachedAuth;
}

export function clearYahooAuthCache(): void {
  cachedAuth = null;
}

export interface YahooAuthenticatedFetchInit {
  url: string;
  symbol: string;
}

export async function yahooAuthenticatedGet(
  url: string,
  symbol: string,
): Promise<Response | null> {
  let auth = await getYahooAuth();
  if (!auth) {
    return null;
  }

  const request = () =>
    fetch(url, {
      headers: {
        "User-Agent": YAHOO_OPTIONS_USER_AGENT,
        Accept: "application/json",
        Cookie: auth!.cookieHeader,
      },
    });

  let response = await request();
  if (response.status === 401) {
    clearYahooAuthCache();
    auth = await getYahooAuth();
    if (!auth) {
      return response;
    }
    response = await request();
  }

  if (!response.ok) {
    logger.warn("Yahoo authenticated request failed", {
      symbol,
      status: response.status,
      url,
    });
  }

  return response;
}
