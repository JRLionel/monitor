import type { SearchResult } from '../types.js';
import { browserHeaders, CookieJar, HttpError, httpGet, httpPost } from './http.js';
import { tokenOverlapRelevance } from '../utils/text.js';

const MOBILE_SEARCH_URL = 'https://m.weibo.cn/api/container/getIndex';
const HOT_SEARCH_URL = 'https://weibo.com/ajax/side/hotSearch';
const VISITOR_URL = 'https://passport.weibo.com/visitor/genvisitor2';

class WeiboLoginRequired extends Error {
  constructor(message = '微博搜索需要登录态') {
    super(message);
    this.name = 'WeiboLoginRequired';
  }
}

let visitorJarPromise: Promise<CookieJar> | null = null;

function loadCookieHeader(jar: CookieJar, header: string): void {
  jar.loadHeader(header);
}

function createVisitorJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  const envCookie = process.env.WEIBO_COOKIE;
  if (envCookie) {
    loadCookieHeader(jar, envCookie);
    return Promise.resolve(jar);
  }

  return (async () => {
    try {
      const body = new URLSearchParams({
        cb: 'visitor_gray_callback',
        tid: '',
        from: 'weibo',
      }).toString();

      const response = await httpPost<string>(VISITOR_URL, {
        data: body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://passport.weibo.com/visitor/visitor',
        },
        responseType: 'text',
        timeoutMs: 8000,
        retries: 1,
        cookieJar: jar,
        label: 'weibo-visitor',
      });

      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      for (const name of ['sub', 'subp']) {
        const match = text.match(new RegExp(`"${name}":"([^"]+)"`));
        if (match?.[1]) {
          jar.set(name.toUpperCase(), match[1]);
        }
      }
    } catch (error) {
      console.warn(`[微博] 访客 Cookie 获取失败: ${error instanceof Error ? error.message : error}`);
    }
    return jar;
  })();
}

function getVisitorJar(): Promise<CookieJar> {
  if (!visitorJarPromise) {
    visitorJarPromise = createVisitorJar();
  }
  return visitorJarPromise;
}

function stripHtml(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWeiboDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const now = new Date();
  const value = raw.trim();

  if (value === '刚刚') return now;

  let match = value.match(/(\d+)\s*分钟前/);
  if (match) return new Date(now.getTime() - Number(match[1]) * 60_000);

  match = value.match(/(\d+)\s*小时前/);
  if (match) return new Date(now.getTime() - Number(match[1]) * 3_600_000);

  match = value.match(/今天\s*(\d{1,2}):(\d{2})/);
  if (match) {
    const date = new Date(now);
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return date;
  }

  match = value.match(/昨天\s*(\d{1,2}):(\d{2})/);
  if (match) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return date;
  }

  match = value.match(/(\d{1,2})月(\d{1,2})日/);
  if (match) {
    const date = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]));
    if (date.getTime() > now.getTime() + 86_400_000) {
      date.setFullYear(date.getFullYear() - 1);
    }
    return date;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return undefined;
}

interface WeiboMblog {
  id?: string | number;
  bid?: string;
  text?: string;
  created_at?: string;
  reposts_count?: number;
  comments_count?: number;
  attitudes_count?: number;
  user?: {
    id?: string | number;
    screen_name?: string;
    profile_image_url?: string;
    followers_count?: number;
    verified?: boolean;
  };
}

function parseMblog(mblog: WeiboMblog): SearchResult | null {
  const id = mblog.id != null ? String(mblog.id) : mblog.bid;
  if (!id) return null;

  const text = stripHtml(mblog.text);
  if (!text) return null;

  const publishedAt = parseWeiboDate(mblog.created_at);

  return {
    title: text.slice(0, 80),
    content: text,
    url: `https://m.weibo.cn/detail/${id}`,
    source: 'weibo',
    sourceId: id,
    publishedAt,
    likeCount: mblog.attitudes_count,
    retweetCount: mblog.reposts_count,
    commentCount: mblog.comments_count,
    author: mblog.user
      ? {
          name: mblog.user.screen_name || '微博用户',
          username: mblog.user.id != null ? String(mblog.user.id) : undefined,
          avatar: mblog.user.profile_image_url,
          followers: mblog.user.followers_count,
          verified: mblog.user.verified,
        }
      : undefined,
  };
}

function parseMobileCards(data: any): SearchResult[] {
  const cards = data?.data?.cards;
  if (!Array.isArray(cards)) return [];

  const results: SearchResult[] = [];
  for (const card of cards) {
    if (!card || typeof card !== 'object') continue;
    if (card.card_type === 9 && card.mblog) {
      const parsed = parseMblog(card.mblog);
      if (parsed) results.push(parsed);
    }
    const groups = card.card_group;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        if (group?.mblog) {
          const parsed = parseMblog(group.mblog);
          if (parsed) results.push(parsed);
        }
      }
    }
  }
  return results;
}

async function searchViaMobile(keyword: string, pages: number): Promise<SearchResult[]> {
  const jar = await getVisitorJar();
  const collected: SearchResult[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= pages; page += 1) {
    const params: Record<string, string | number> = {
      containerid: `100103type=1&q=${keyword}`,
      page_type: 'searchall',
    };
    if (page > 1) params.page = page;

    const response = await httpGet<any>(MOBILE_SEARCH_URL, {
      params,
      headers: {
        ...browserHeaders('mobile', 'https://m.weibo.cn/', 'application/json'),
        'X-Requested-With': 'XMLHttpRequest',
      },
      cookieJar: jar,
      timeoutMs: 15_000,
      retries: 1,
      label: 'weibo-search',
    });

    const data = response.data;
    if (data?.ok === -100 || String(data?.url || '').includes('passport.weibo.com')) {
      throw new WeiboLoginRequired('微博关键词搜索被要求登录（可配置 WEIBO_COOKIE）');
    }

    const pageItems = parseMobileCards(data);
    if (!pageItems.length) break;

    for (const item of pageItems) {
      const key = item.sourceId || item.url;
      if (seen.has(key)) continue;
      const relevance = tokenOverlapRelevance(keyword, `${item.title} ${item.content}`);
      if (relevance < 0.2) continue;
      seen.add(key);
      collected.push(item);
    }

    if (collected.length >= 50) break;
  }

  return collected;
}

interface WeiboHotEntry {
  word?: string;
  note?: string;
  word_scheme?: string;
  num?: number;
  realpos?: number;
  rank?: number;
  label_name?: string;
  is_ad?: number;
}

async function fetchHotEntries(limit = 50): Promise<WeiboHotEntry[]> {
  const response = await httpGet<any>(HOT_SEARCH_URL, {
    headers: browserHeaders('desktop', 'https://weibo.com/', 'application/json'),
    timeoutMs: 10_000,
    retries: 1,
    label: 'weibo-hot',
  });

  const entries = response.data?.data?.realtime;
  return Array.isArray(entries) ? entries.filter((entry: WeiboHotEntry) => !entry.is_ad).slice(0, limit) : [];
}

async function searchHotRelated(keyword: string): Promise<SearchResult[]> {
  const entries = await fetchHotEntries(50);
  const results: SearchResult[] = [];
  const now = new Date();

  entries.forEach((entry, index) => {
    const word = entry.word || entry.note;
    if (!word) return;

    const relevance = tokenOverlapRelevance(keyword, word);
    if (relevance < 0.35) return;

    const rank = entry.realpos || entry.rank || index + 1;
    const hotValue = entry.num;
    const label = entry.label_name ? `「${entry.label_name}」` : '';
    const query = entry.word_scheme || `#${word}#`;

    results.push({
      title: `🔥 微博热搜: ${word}`,
      content: `微博热搜第 ${rank} 位${label}，热度 ${hotValue?.toLocaleString() || '未知'}`,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`,
      source: 'weibo',
      sourceId: `hot:${word}`,
      publishedAt: now,
      viewCount: hotValue,
    });
  });

  return results;
}

/**
 * 微博关键词搜索：移动端搜索 → 热搜兜底。
 * 搜索被登录墙拦截时，仍会尽量返回热搜中的相关话题。
 */
export async function searchWeibo(query: string): Promise<SearchResult[]> {
  let mobileError: unknown = null;
  let items: SearchResult[] = [];

  try {
    items = await searchViaMobile(query, 2);
  } catch (error) {
    mobileError = error;
    console.warn(`[微博] 关键词搜索失败: ${error instanceof Error ? error.message : error}`);
  }

  if (!items.length) {
    try {
      items = await searchHotRelated(query);
    } catch (error) {
      console.warn(`[微博] 热搜兜底失败: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (!items.length && mobileError instanceof WeiboLoginRequired) {
    throw new HttpError(
      'forbidden',
      '微博关键词搜索需要登录 Cookie：请在 .env 中配置 WEIBO_COOKIE（可从浏览器复制）',
      { status: 403, url: MOBILE_SEARCH_URL }
    );
  }

  if (!items.length && mobileError instanceof HttpError) {
    throw mobileError;
  }

  return items;
}
