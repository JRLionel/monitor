import { describeHttpError, isHttpError } from './http.js';
import { cacheGet, cacheSet } from './cache.js';

export type SourceState = 'ok' | 'empty' | 'error' | 'timeout' | 'skipped';

export interface SourceStatusEntry {
  source: string;
  label: string;
  state: SourceState;
  count: number;
  elapsedMs: number;
  error?: string;
  cacheHit?: boolean;
  keyword?: string;
  lastRunAt: string;
}

export const SOURCE_LABELS: Record<string, string> = {
  twitter: 'Twitter',
  hackernews: 'Hacker News',
  juejin: '掘金',
  github: 'GitHub',
  csdn: 'CSDN',
};

export class SourceTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceTimeoutError';
  }
}

class SourceStatusRegistry {
  private readonly entries = new Map<string, SourceStatusEntry>();
  private lastRunAt: string | null = null;

  record(entry: SourceStatusEntry): void {
    this.entries.set(entry.source, entry);
    this.lastRunAt = entry.lastRunAt;
  }

  snapshot(): { lastRunAt: string | null; sources: SourceStatusEntry[] } {
    return {
      lastRunAt: this.lastRunAt,
      sources: [...this.entries.values()].sort((a, b) => a.source.localeCompare(b.source)),
    };
  }

  clear(): void {
    this.entries.clear();
    this.lastRunAt = null;
  }
}

export const sourceStatusRegistry = new SourceStatusRegistry();

export interface RunSourceOptions {
  keyword?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  cacheKey?: string;
  label?: string;
}

const DEFAULT_SOURCE_TIMEOUT_MS = 30_000;

function errorMessage(error: unknown): string {
  if (isHttpError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return describeHttpError(error);
}

export async function runSource<T>(
  source: string,
  fn: () => Promise<T[]>,
  options: RunSourceOptions = {}
): Promise<{ items: T[]; status: SourceStatusEntry }> {
  const label = options.label ?? SOURCE_LABELS[source] ?? source;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? 0;
  const startedAt = Date.now();
  const lastRunAt = new Date().toISOString();

  if (options.cacheKey && cacheTtlMs > 0) {
    const cached = cacheGet<T>(options.cacheKey);
    if (cached) {
      const status: SourceStatusEntry = {
        source,
        label,
        state: cached.length ? 'ok' : 'empty',
        count: cached.length,
        elapsedMs: 0,
        cacheHit: true,
        keyword: options.keyword,
        lastRunAt,
      };
      sourceStatusRegistry.record(status);
      return { items: cached, status };
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SourceTimeoutError(`${label} 搜索超时（${timeoutMs}ms）`)),
        timeoutMs
      );
    });

    const items = (await Promise.race([fn(), timeoutPromise])) ?? [];
    if (options.cacheKey && cacheTtlMs > 0 && items.length) {
      cacheSet(options.cacheKey, items, cacheTtlMs);
    }

    const status: SourceStatusEntry = {
      source,
      label,
      state: items.length ? 'ok' : 'empty',
      count: items.length,
      elapsedMs: Date.now() - startedAt,
      keyword: options.keyword,
      lastRunAt,
    };
    sourceStatusRegistry.record(status);
    return { items, status };
  } catch (error) {
    const stale = options.cacheKey ? cacheGet<T>(options.cacheKey, true) : null;
    if (stale?.length) {
      const status: SourceStatusEntry = {
        source,
        label,
        state: 'ok',
        count: stale.length,
        elapsedMs: Date.now() - startedAt,
        error: `${errorMessage(error)}（已使用过期缓存）`,
        cacheHit: true,
        keyword: options.keyword,
        lastRunAt,
      };
      sourceStatusRegistry.record(status);
      return { items: stale, status };
    }

    const status: SourceStatusEntry = {
      source,
      label,
      state: error instanceof SourceTimeoutError ? 'timeout' : 'error',
      count: 0,
      elapsedMs: Date.now() - startedAt,
      error: errorMessage(error),
      keyword: options.keyword,
      lastRunAt,
    };
    sourceStatusRegistry.record(status);
    return { items: [], status };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
