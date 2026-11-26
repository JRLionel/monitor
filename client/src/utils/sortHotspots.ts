/**
 * 热点排序工具函数（前端版本，与 server/src/utils/sortHotspots.ts 逻辑一致）
 */

export interface SortableHotspot {
  source?: string | null;
  likeCount: number | null;
  retweetCount: number | null;
  viewCount: number | null;
  commentCount?: number | null;
  replyCount?: number | null;
  danmakuCount?: number | null;
  quoteCount?: number | null;
  score?: number | null;
  importance: string;
  relevance: number;
  publishedAt: Date | string | null;
  createdAt: Date | string;
}

export const IMPORTANCE_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const HEAT_REFERENCE = 8;
const UNKNOWN_ENGAGEMENT_BASE = 15;
const RECENCY_WINDOW_DAYS = 30;

function log1pSafe(value: number | null | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.log1p(numeric);
}

function allMissing(values: Array<number | null | undefined>): boolean {
  return values.every(value => value === null || value === undefined || !Number.isFinite(Number(value)));
}

export function engagementRaw(item: SortableHotspot): number | null {
  const likes = item.likeCount;
  const retweets = item.retweetCount;
  const views = item.viewCount;
  const comments = item.commentCount ?? item.replyCount;
  const source = (item.source || '').toLowerCase();

  if (source === 'github') {
    if (allMissing([likes, views, comments])) return null;
    return 0.6 * log1pSafe(likes) + 0.25 * log1pSafe(views) + 0.15 * log1pSafe(comments);
  }

  if (source === 'hackernews') {
    if (allMissing([item.score, comments, views])) return null;
    return 0.5 * log1pSafe(item.score) + 0.4 * log1pSafe(comments) + 0.1 * log1pSafe(views ? views / 1000 : 0);
  }

  if (source === 'juejin' || source === 'csdn') {
    if (allMissing([views, likes, comments])) return null;
    return 0.5 * log1pSafe(views) + 0.3 * log1pSafe(likes) + 0.2 * log1pSafe(comments);
  }

  if (source === 'twitter') {
    if (allMissing([likes, retweets, comments, views])) return null;
    return (
      0.35 * log1pSafe(likes) +
      0.3 * log1pSafe(retweets) +
      0.2 * log1pSafe(comments) +
      0.15 * log1pSafe(views ? views / 1000 : 0)
    );
  }

  if (allMissing([likes, retweets, comments, views])) return null;
  return (
    0.35 * log1pSafe(likes) +
    0.3 * log1pSafe(retweets) +
    0.25 * log1pSafe(comments) +
    0.1 * log1pSafe(views ? views / 1000 : 0)
  );
}

function toTimestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = typeof value === 'string' ? new Date(value).getTime() : value.getTime();
  return Number.isFinite(time) ? time : 0;
}

export function recencyFactor(item: SortableHotspot): number {
  const timestamp = toTimestamp(item.publishedAt) || toTimestamp(item.createdAt);
  if (!timestamp) return 0.75;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  const normalized = Math.min(1, ageDays / RECENCY_WINDOW_DAYS);
  return 0.6 + 0.4 * Math.exp(-normalized * 7);
}

export function calcHotScore(item: SortableHotspot): number {
  const raw = engagementRaw(item);
  const base = raw === null ? UNKNOWN_ENGAGEMENT_BASE : (raw / HEAT_REFERENCE) * 100;
  const heat = Math.max(0, Math.min(100, base));
  return Math.round(heat * recencyFactor(item) * 10) / 10;
}

/**
 * 将热度综合分映射为 0-100 的展示分。
 * calcHotScore 已是 0-100，这里只做边界保护。
 */
export function hotScoreToDisplay(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(100, Math.round(score));
}

export function compareImportance(a: SortableHotspot, b: SortableHotspot): number {
  return (IMPORTANCE_ORDER[a.importance] ?? 4) - (IMPORTANCE_ORDER[b.importance] ?? 4);
}

export function sortHotspots<T extends SortableHotspot>(
  items: T[],
  sortBy: string,
  sortOrder: 'asc' | 'desc' = 'desc'
): T[] {
  const sorted = [...items];
  const desc = sortOrder === 'desc';

  sorted.sort((a, b) => {
    let result: number;

    switch (sortBy) {
      case 'publishedAt': {
        const ta = toTimestamp(a.publishedAt);
        const tb = toTimestamp(b.publishedAt);
        result = ta - tb;
        if (result === 0) {
          result = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
        }
        break;
      }

      case 'importance': {
        result = compareImportance(a, b);
        if (result === 0) {
          result = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
          return desc ? -result : result;
        }
        return desc ? result : -result;
      }

      case 'relevance':
        result = a.relevance - b.relevance;
        break;

      case 'hot':
        result = calcHotScore(a) - calcHotScore(b);
        if (result === 0) {
          result = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
        }
        break;

      default: // createdAt
        result = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
        break;
    }

    return desc ? -result : result;
  });

  return sorted;
}
