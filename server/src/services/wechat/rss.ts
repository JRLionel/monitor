import * as cheerio from 'cheerio';
import { browserHeaders, httpGet } from '../http.js';
import type { WechatFeedItem, WechatFeedPreview } from './types.js';

const FEED_TIMEOUT_MS = 20_000;
const DEFAULT_DIGEST_LENGTH = 220;

function localTagName(name: string): string {
  return name.split(':').pop()?.toLowerCase() ?? name.toLowerCase();
}

function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeedDate(text: string | undefined): Date | null {
  const value = String(text ?? '').trim();
  if (!value) return null;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = value.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (match) {
    return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`);
  }
  return null;
}

function absoluteUrl(link: string, base: string): string {
  const value = link.trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function extractImage(raw: string, baseUrl: string): string | null {
  const match = raw.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? absoluteUrl(match[1], baseUrl) : null;
}

/**
 * 解析公众号 RSS / Atom 源。优先取 description / summary 作为摘要，
 * 封面依次尝试 enclosure、media:content、media:thumbnail 与正文首图。
 */
export function parseWechatFeed(
  body: string,
  limit = 20,
  baseUrl = 'https://mp.weixin.qq.com/'
): WechatFeedPreview {
  if (!body?.trim()) return { feedTitle: '', items: [] };

  const $ = cheerio.load(body, { xmlMode: true });
  const feedTitle = cleanText(
    $('channel > title').first().text() || $('feed > title').first().text()
  );

  const nodes = [...$('item').toArray(), ...$('entry').toArray()];
  const items: WechatFeedItem[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const el = $(node);
    let title = '';
    let link = '';
    let rawBody = '';
    let dateText = '';
    let author = '';
    let coverUrl = '';

    for (const child of el.children().toArray()) {
      const name = localTagName((child as { name?: string }).name ?? '');
      const element = $(child);

      if (name === 'title' && !title) {
        title = cleanText(element.text());
      } else if (name === 'link' && !link) {
        link = cleanText(element.text()) || element.attr('href') || '';
      } else if (name === 'description' || name === 'summary' || name === 'encoded') {
        if (!rawBody) rawBody = element.text();
      } else if (name === 'content') {
        // media:content 带 url 属性时是封面，Atom 的 content 则是正文
        if (!coverUrl && element.attr('url')) {
          coverUrl = element.attr('url') ?? '';
        } else if (!rawBody) {
          rawBody = element.text();
        }
      } else if (['pubdate', 'published', 'updated', 'date'].includes(name) && !dateText) {
        dateText = element.text();
      } else if ((name === 'author' || name === 'creator') && !author) {
        author = cleanText(element.text());
      } else if ((name === 'enclosure' || name === 'thumbnail') && !coverUrl) {
        const type = element.attr('type') ?? '';
        if (!type || type.startsWith('image')) {
          coverUrl = element.attr('url') ?? '';
        }
      }
    }

    const url = absoluteUrl(link, baseUrl);
    if (!title || !url || seen.has(url)) continue;

    seen.add(url);
    items.push({
      title,
      url,
      digest: cleanText(rawBody).slice(0, DEFAULT_DIGEST_LENGTH),
      coverUrl: coverUrl ? absoluteUrl(coverUrl, url) : extractImage(rawBody, url),
      author: author || null,
      publishedAt: parseFeedDate(dateText),
    });
  }

  items.sort((a, b) => {
    const timeA = a.publishedAt?.getTime() ?? 0;
    const timeB = b.publishedAt?.getTime() ?? 0;
    return timeB - timeA;
  });

  return { feedTitle, items: items.slice(0, limit) };
}

export async function fetchRssFeed(feedUrl: string, limit = 20): Promise<WechatFeedPreview> {
  const response = await httpGet<string>(feedUrl, {
    headers: browserHeaders(
      'desktop',
      feedUrl,
      'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8'
    ),
    responseType: 'text',
    timeoutMs: FEED_TIMEOUT_MS,
    retries: 1,
    label: 'wechat-rss',
  });

  return parseWechatFeed(String(response.data ?? ''), limit, feedUrl);
}
