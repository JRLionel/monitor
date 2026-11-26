import type { SearchResult } from '../types.js';
import { engagementRaw, type SortableHotspot } from '../utils/sortHotspots.js';
import { hybridSimilarity, stripQueryTerms } from '../utils/text.js';

export interface EventCluster {
  items: SearchResult[];
  sources: string[];
  size: number;
}

export function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/^http:\/\//, 'https://')
    .replace(/^https:\/\/www\./, 'https://');
}

export function deduplicateByUrl(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = normalizeUrl(item.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareText(item: SearchResult): string {
  return `${item.title} ${item.content}`.slice(0, 200);
}

function itemQuality(item: SearchResult): number {
  return engagementRaw(item as unknown as SortableHotspot) ?? 0;
}

function numericTokens(text: string): Set<string> {
  return new Set(text.match(/\d+/g) ?? []);
}

/**
 * 双方都带数字但没有任何交集（如 iPhone 17 / iPhone 18）时，
 * 即使文本高度相似也应视为不同事件。
 */
function hasConflictingNumbers(a: string, b: string): boolean {
  const left = numericTokens(a);
  const right = numericTokens(b);
  if (!left.size || !right.size) return false;
  for (const value of left) {
    if (right.has(value)) return false;
  }
  return true;
}

/**
 * URL 精确去重 + 标题/正文近重复合并。
 * 近重复保留互动量更高的一条；互动量相同则保留先出现的（通常优先级更高）。
 */
export function dedupeItems(
  items: SearchResult[],
  query?: string,
  threshold = 0.7
): SearchResult[] {
  const unique = deduplicateByUrl(items);
  if (unique.length <= 1) return unique;

  const texts = unique.map(item => stripQueryTerms(compareText(item), query));
  const removed = new Set<number>();

  for (let i = 0; i < unique.length; i += 1) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < unique.length; j += 1) {
      if (removed.has(j)) continue;
      if (hasConflictingNumbers(texts[i], texts[j])) continue;
      if (hybridSimilarity(texts[i], texts[j]) < threshold) continue;

      const loser = itemQuality(unique[i]) >= itemQuality(unique[j]) ? j : i;
      removed.add(loser);
      if (loser === i) break;
    }
  }

  return unique.filter((_, index) => !removed.has(index));
}

/**
 * 给跨平台相似内容互相打上 crossRefs 标记，供后续聚合展示使用。
 */
export function linkCrossSources(
  items: SearchResult[],
  query?: string,
  threshold = 0.4
): void {
  if (items.length <= 1) return;

  const texts = items.map(item =>
    stripQueryTerms(`${item.title} ${item.content}`.slice(0, 100), query)
  );

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (items[i].source === items[j].source) continue;
      if (hasConflictingNumbers(texts[i], texts[j])) continue;
      if (hybridSimilarity(texts[i], texts[j]) < threshold) continue;

      const leftRef = `${items[j].source}:${items[j].url}`;
      const rightRef = `${items[i].source}:${items[i].url}`;
      items[i].crossRefs = items[i].crossRefs ?? [];
      items[j].crossRefs = items[j].crossRefs ?? [];
      if (!items[i].crossRefs!.includes(leftRef)) items[i].crossRefs!.push(leftRef);
      if (!items[j].crossRefs!.includes(rightRef)) items[j].crossRefs!.push(rightRef);
    }
  }
}

/**
 * 跨平台事件聚类：同一事件出现在越多平台，信号越强。
 * 返回只包含 >= 2 个不同平台、且至少 2 条内容的簇。
 */
export function clusterByEvent(
  items: SearchResult[],
  query?: string,
  threshold = 0.4
): EventCluster[] {
  if (items.length <= 1) return [];

  const texts = items.map(item =>
    stripQueryTerms(`${item.title} ${item.content}`.slice(0, 100), query)
  );
  const parent = items.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (items[i].source === items[j].source) continue;
      if (hasConflictingNumbers(texts[i], texts[j])) continue;
      if (hybridSimilarity(texts[i], texts[j]) < threshold) continue;
      union(i, j);
    }
  }

  const groups = new Map<number, SearchResult[]>();
  items.forEach((item, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  });

  return [...groups.values()]
    .map(group => ({
      items: group,
      sources: [...new Set(group.map(item => item.source))],
      size: group.length,
    }))
    .filter(cluster => cluster.sources.length >= 2 && cluster.size >= 2)
    .sort((a, b) => b.sources.length - a.sources.length || b.size - a.size);
}
