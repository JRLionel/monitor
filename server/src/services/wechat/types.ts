export type WechatSourceType = 'rss' | 'sogou' | 'api' | 'claude';

export interface WechatFeedItem {
  title: string;
  url: string;
  digest: string;
  coverUrl: string | null;
  author: string | null;
  publishedAt: Date | null;
}

export interface WechatFeedPreview {
  feedTitle: string;
  items: WechatFeedItem[];
}

export interface WechatSourceAdapter {
  type: WechatSourceType;
  fetch: (feedUrl: string, limit: number) => Promise<WechatFeedPreview>;
}
