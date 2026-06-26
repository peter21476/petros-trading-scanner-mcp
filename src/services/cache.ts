interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const CACHE_TTL = {
  MARKET_DATA_MS: 5 * 60 * 1000,
  DAILY_REPORT_MS: 15 * 60 * 1000,
} as const;

export async function getCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: {
    skipCacheWhen?: (value: T) => boolean;
  },
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    return existing.value as T;
  }

  const value = await fetcher();
  if (!options?.skipCacheWhen?.(value)) {
    store.set(key, { value, expiresAt: now + ttlMs, storedAt: now });
  }
  return value;
}

export interface CachedResult<T> {
  data: T;
  fromCache: boolean;
  cachedAt: string | null;
}

/** Fetch with TTL cache and metadata for research-tool envelopes. */
export async function getCachedWithMeta<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: {
    skipCacheWhen?: (value: T) => boolean;
  },
): Promise<CachedResult<T>> {
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    return {
      data: existing.value as T,
      fromCache: true,
      cachedAt: new Date(existing.storedAt).toISOString(),
    };
  }

  const data = await fetcher();
  if (!options?.skipCacheWhen?.(data)) {
    store.set(key, { value: data, expiresAt: now + ttlMs, storedAt: now });
  }
  return { data, fromCache: false, cachedAt: null };
}

export function clearCache(): void {
  store.clear();
}
