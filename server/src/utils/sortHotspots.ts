/**
 * 热点排序工具函数
 * 供后端路由和前端客户端排序共用
 *
 * 热度口径：分平台互动量加权 → log1p 压缩 → 映射到 0-100 → 乘以时间衰减。
 * 不同平台的点赞/转发/播放含义不同，因此权重分开计算，避免“点赞数直接相加”。
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

/** 重要程度数值映射，数值越小越重要 */
export const IMPORTANCE_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** log1p(约 3000) 附近的加权互动量视为满分参考值 */
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

/**
 * 分平台计算原始互动强度。
 * 返回 null 表示该条没有任何可用互动数据（如搜索引擎结果）。
 */
export function engagementRaw(item: SortableHotspot): number | null {
  const likes = item.likeCount;
  const retweets = item.retweetCount;
  const views = item.viewCount;
  const comments = item.commentCount ?? item.replyCount;
  const source = (item.source || '').toLowerCase();

  if (source === 'github') {
    // star(likes) 为主，fork(views) 与 issue(comments) 为辅
    if (allMissing([likes, views, comments])) return null;
    return (
      0.6 * log1pSafe(likes) +
      0.25 * log1pSafe(views) +
      0.15 * log1pSafe(comments)
    );
  }

  if (source === 'hackernews') {
    // 社区投票(score) 与评论数为主
    if (allMissing([item.score, comments, views])) return null;
    return (
      0.5 * log1pSafe(item.score) +
      0.4 * log1pSafe(comments) +
      0.1 * log1pSafe(views ? views / 1000 : 0)
    );
  }

  if (source === 'juejin' || source === 'csdn') {
    // 中文技术社区：阅读量为主，点赞与评论为辅
    if (allMissing([views, likes, comments])) return null;
    return (
      0.5 * log1pSafe(views) +
      0.3 * log1pSafe(likes) +
      0.2 * log1pSafe(comments)
    );
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

/**
 * 时间衰减：30 天窗口内从 1.0 平滑衰减到约 0.6。
 * 没有可靠发布时间的条目按 0.75 处理，避免被无限放大。
 */
export function recencyFactor(item: SortableHotspot): number {
  const timestamp = toTimestamp(item.publishedAt) || toTimestamp(item.createdAt);
  if (!timestamp) return 0.75;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  const normalized = Math.min(1, ageDays / RECENCY_WINDOW_DAYS);
  return 0.6 + 0.4 * Math.exp(-normalized * 7);
}

/**
 * 热度综合分（0-100），用于展示和 "hot" 排序。
 * 互动数据缺失时给一个较低的基准分，让纯搜索/资讯结果仍能按新鲜度排序。
 */
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

/**
 * 比较两个热点的重要程度
 * 返回负数 = a 更重要，正数 = b 更重要，0 = 相同
 */
export function compareImportance(a: SortableHotspot, b: SortableHotspot): number {
  return (IMPORTANCE_ORDER[a.importance] ?? 4) - (IMPORTANCE_ORDER[b.importance] ?? 4);
}

/**
 * 通用排序函数
 * @param items - 热点数组（会被复制，不修改原数组）
 * @param sortBy - 排序字段
 * @param sortOrder - 排序方向 'asc' | 'desc'
 * @returns 排序后的新数组
 */
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
