import * as cheerio from 'cheerio';
import { browserHeaders, httpGet } from '../http.js';
import type { WechatFeedItem, WechatFeedPreview } from './types.js';

const PAGE_TIMEOUT_MS = 20_000;
const DEFAULT_DIGEST_LENGTH = 220;
const ARTICLE_PATH = /^\/resources\/articles\/[^/?#]+/;

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const DATE_PATTERN =
  /(?:^|[^A-Za-z])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/i;

function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function parseCardDate(text: string): Date | null {
  const match = cleanText(text).match(DATE_PATTERN);
  if (!match) return null;

  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (month === undefined || !Number.isFinite(day)) return null;

  const date = new Date(year, month, day, 12, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 解析 Claude 官网文章列表页（HTML）。
 * 页面里每篇文章是一个指向 /resources/articles/<slug> 的卡片链接，
 * 卡片内包含标题、发布日期与摘要，按页面出现顺序去重后按时间倒序返回。
 */
export function parseClaudeArticles(
  body: string,
  limit = 20,
  baseUrl = 'https://claude.com/resources/articles'
): WechatFeedPreview {
  if (!body?.trim()) return { feedTitle: '', items: [] };

  const $ = cheerio.load(body);
  const feedTitle = cleanText($('h1').first().text()) || 'Claude Articles';
  const origin = new URL(baseUrl).origin;
  const items = new Map<string, WechatFeedItem>();

  $('a[href]').each((_, node) => {
    const el = $(node);
    const href = el.attr('href') ?? '';

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (url.origin !== origin) return;
    if (!ARTICLE_PATH.test(url.pathname)) return;

    const normalized = `${url.origin}${url.pathname}`;
    const title = cleanText(el.find('h3').first().text()) || cleanText(el.attr('aria-label'));
    if (!title) return;

    const excerpt = cleanText(el.find('p').first().text());

    // 日期位于卡片头部的元信息节点中，取叶子节点精确匹配，避免与类型标签粘连
    let publishedAt: Date | null = null;
    el.find('*').each((__, child) => {
      if (publishedAt) return;
      const leaf = $(child);
      if (leaf.children().length > 0) return;
      const text = cleanText(leaf.text());
      if (text && text.length <= 24) {
        publishedAt = parseCardDate(text);
      }
    });

    // 页面同一篇文章可能出现在顶部精选轮播与下方列表，合并补充缺失字段
    const existing = items.get(normalized);
    if (existing) {
      if (!existing.digest && excerpt) existing.digest = excerpt;
      if (!existing.publishedAt && publishedAt) existing.publishedAt = publishedAt;
      return;
    }

    const coverSrc = el.find('img').first().attr('src') ?? '';
    items.set(normalized, {
      title,
      url: normalized,
      digest: excerpt.slice(0, DEFAULT_DIGEST_LENGTH),
      coverUrl: coverSrc ? absoluteUrl(coverSrc, normalized) : null,
      author: 'Anthropic',
      publishedAt,
    });
  });

  const list = [...items.values()].sort((a, b) => {
    const timeA = a.publishedAt?.getTime() ?? 0;
    const timeB = b.publishedAt?.getTime() ?? 0;
    return timeB - timeA;
  });

  return { feedTitle, items: list.slice(0, limit) };
}

export async function fetchClaudeArticles(
  feedUrl: string,
  limit = 20
): Promise<WechatFeedPreview> {
  const response = await httpGet<string>(feedUrl, {
    headers: browserHeaders('desktop', feedUrl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'),
    responseType: 'text',
    timeoutMs: PAGE_TIMEOUT_MS,
    retries: 1,
    label: 'wechat-claude',
  });

  return parseClaudeArticles(String(response.data ?? ''), limit, feedUrl);
}
