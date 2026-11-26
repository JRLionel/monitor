import { fetchRssFeed } from './rss.js';
import { fetchClaudeArticles } from './claude.js';
import type {
  WechatFeedItem,
  WechatFeedPreview,
  WechatSourceAdapter,
  WechatSourceType,
} from './types.js';

const ADAPTERS: Partial<Record<WechatSourceType, WechatSourceAdapter>> = {
  rss: { type: 'rss', fetch: fetchRssFeed },
  claude: { type: 'claude', fetch: fetchClaudeArticles },
};

export function resolveWechatAdapter(sourceType: string | null | undefined): WechatSourceAdapter {
  const key = (sourceType || 'rss').toLowerCase() as WechatSourceType;
  const adapter = ADAPTERS[key];
  if (!adapter) {
    throw new Error(`暂不支持的订阅来源类型：${sourceType}`);
  }
  return adapter;
}

export function normalizeFeedUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('请填写订阅源地址');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error('订阅源地址格式不正确');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('订阅源仅支持 http / https 地址');
  }
  return parsed.toString();
}

export async function previewWechatFeed(
  feedUrl: string,
  sourceType: string | null | undefined = 'rss',
  limit = 10
): Promise<WechatFeedPreview> {
  return resolveWechatAdapter(sourceType).fetch(feedUrl, limit);
}

export async function fetchWechatArticles(
  feedUrl: string,
  sourceType: string | null | undefined = 'rss',
  limit = 30
): Promise<WechatFeedItem[]> {
  const preview = await previewWechatFeed(feedUrl, sourceType, limit);
  return preview.items;
}

export function newestPublishedAt(items: WechatFeedItem[]): Date | null {
  let newest: Date | null = null;
  for (const item of items) {
    if (!item.publishedAt) continue;
    if (!newest || item.publishedAt.getTime() > newest.getTime()) {
      newest = item.publishedAt;
    }
  }
  return newest;
}
