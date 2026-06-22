import { logger } from "../utils/logger.js";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_TIMEOUT_MS = 15_000;

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export async function fetchText(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json,*/*",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw new FetchError(
        `HTTP ${response.status} for ${url}`,
        response.status,
        url,
      );
    }

    return await response.text();
  } catch (error) {
    if (error instanceof FetchError) {
      throw error;
    }
    logger.warn("Fetch failed", { url, error: String(error) });
    throw new FetchError(
      error instanceof Error ? error.message : "Unknown fetch error",
      undefined,
      url,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const text = await fetchText(url, init, timeoutMs);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FetchError(`Invalid JSON response from ${url}`, undefined, url);
  }
}

export async function safeFetchText(url: string): Promise<string | null> {
  try {
    return await fetchText(url);
  } catch (error) {
    logger.warn("safeFetchText failed", { url, error: String(error) });
    return null;
  }
}

export async function safeFetchJson<T>(url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url);
  } catch (error) {
    logger.warn("safeFetchJson failed", { url, error: String(error) });
    return null;
  }
}
