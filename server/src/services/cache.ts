interface CacheEntry<T> {
  items: T[];
  expiresAt: number;
  storedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function cacheKey(source: string, keyword: string): string {
  return `${source}:${keyword.trim().toLowerCase()}`;
}

export function cacheGet<T>(key: string, allowExpired = false): T[] | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (!allowExpired && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.items;
}

export function cacheSet<T>(key: string, items: T[], ttlMs: number): void {
  if (!items.length || ttlMs <= 0) return;
  const now = Date.now();
  store.set(key, { items, expiresAt: now + ttlMs, storedAt: now });
}

export function cacheClear(): void {
  store.clear();
}

export function cacheSize(): number {
  return store.size;
}
