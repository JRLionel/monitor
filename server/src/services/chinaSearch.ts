import crypto from 'crypto';
import type { SearchResult } from '../types.js';
import { browserHeaders, HttpError, RateLimiter, httpGet } from './http.js';

const bilibiliLimiter = new RateLimiter(2000);

// ============================================================
// Bilibili 搜索（公开 API，无需 API Key）
// ============================================================

interface BilibiliSearchResponse {
  code: number;
  message?: string;
  data?: {
    result?: BilibiliVideoResult[];
  };
}

interface BilibiliVideoResult {
  aid: number;
  bvid: string;
  title: string;
  description: string;
  author: string;
  mid: number;
  pic: string;
  play: number;
  favorites: number;
  review: number;
  danmaku: number;
  like: number;
  pubdate: number;
  tag: string;
}

interface BilibiliUserSearchResponse {
  code: number;
  message?: string;
  data?: {
    result?: BilibiliUserResult[];
  };
}

interface BilibiliUserResult {
  mid: number;
  uname: string;
  usign: string;
  fans: number;
  videos: number;
  upic: string;
  official_verify: {
    type: number;
    desc: string;
  };
}

interface BilibiliSpaceResponse {
  code: number;
  message?: string;
  data?: {
    list?: {
      vlist?: BilibiliSpaceVideo[];
    };
  };
}

interface BilibiliSpaceVideo {
  aid: number;
  bvid: string;
  title: string;
  description: string;
  author: string;
  mid: number;
  pic: string;
  play: number;
  favorites: number;
  review: number;
  comment: number;
  danmaku: number;
  created: number;
}

function bilibiliHeaders(referer: string, withBuvid = false): Record<string, string> {
  const headers: Record<string, string> = {
    ...browserHeaders('desktop', referer, 'application/json'),
  };
  if (withBuvid) {
    headers.Cookie = `buvid3=${crypto.randomUUID()}infoc`;
  }
  return headers;
}

function assertBilibiliCode(code: number, message: string | undefined, url: string): void {
  if (code === 0) return;
  if (code === -412) {
    throw new HttpError('risk_control', `B站触发风控（code -412）: ${url}`, { url });
  }
  throw new HttpError('http_error', `B站接口返回错误 ${code}: ${message || ''} ${url}`, { url });
}

// 搜索 Bilibili 视频
export async function searchBilibili(query: string): Promise<SearchResult[]> {
  const url = 'https://api.bilibili.com/x/web-interface/search/type';
  try {
    const response = await httpGet<BilibiliSearchResponse>(url, {
      params: {
        keyword: query,
        search_type: 'video',
        order: 'pubdate',
        page: 1,
        pagesize: 20,
      },
      headers: bilibiliHeaders('https://search.bilibili.com/', true),
      limiter: bilibiliLimiter,
      timeoutMs: 15_000,
      retries: 2,
      label: 'bilibili',
    });

    assertBilibiliCode(response.data.code, response.data.message, url);

    const videos = response.data.data?.result;
    if (!videos) {
      console.log(`Bilibili search: no results (code: ${response.data.code})`);
      return [];
    }

    const results: SearchResult[] = videos.map(video => ({
      title: video.title.replace(/<\/?em[^>]*>/g, ''),
      content: video.description || video.title.replace(/<\/?em[^>]*>/g, ''),
      url: `https://www.bilibili.com/video/${video.bvid}`,
      source: 'bilibili' as const,
      sourceId: video.bvid,
      publishedAt: new Date(video.pubdate * 1000),
      viewCount: video.play,
      likeCount: video.like,
      commentCount: video.review,
      danmakuCount: video.danmaku,
      author: {
        name: video.author,
        username: String(video.mid),
      },
    }));

    console.log(`Bilibili search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Bilibili search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// 搜索 Bilibili 用户（用于账号检测）
export async function searchBilibiliUser(keyword: string): Promise<BilibiliUserResult | null> {
  const url = 'https://api.bilibili.com/x/web-interface/search/type';
  try {
    const response = await httpGet<BilibiliUserSearchResponse>(url, {
      params: {
        keyword,
        search_type: 'bili_user',
        page: 1,
        pagesize: 5,
      },
      headers: bilibiliHeaders('https://search.bilibili.com/'),
      limiter: bilibiliLimiter,
      timeoutMs: 15_000,
      retries: 1,
      label: 'bilibili-user',
    });

    assertBilibiliCode(response.data.code, response.data.message, url);

    const users = response.data.data?.result;
    if (!users?.length) return null;

    const exactMatch = users.find(
      user => user.uname === keyword || user.uname.toLowerCase() === keyword.toLowerCase()
    );
    if (exactMatch) return exactMatch;

    const topResult = users[0];
    if (topResult.fans > 1000 && topResult.uname.includes(keyword)) {
      return topResult;
    }

    return null;
  } catch (error) {
    console.error('Bilibili user search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// 获取 B 站用户最新视频
export async function getBilibiliUserVideos(mid: number): Promise<SearchResult[]> {
  const url = 'https://api.bilibili.com/x/space/arc/search';
  try {
    const response = await httpGet<BilibiliSpaceResponse>(url, {
      params: { mid, pn: 1, ps: 10, order: 'pubdate' },
      headers: bilibiliHeaders(`https://space.bilibili.com/${mid}`),
      limiter: bilibiliLimiter,
      timeoutMs: 15_000,
      retries: 1,
      label: 'bilibili-space',
    });

    assertBilibiliCode(response.data.code, response.data.message, url);

    const videos = response.data.data?.list?.vlist;
    if (!videos) return [];

    const results: SearchResult[] = videos.map(video => ({
      title: video.title,
      content: video.description || video.title,
      url: `https://www.bilibili.com/video/${video.bvid}`,
      source: 'bilibili' as const,
      sourceId: video.bvid,
      publishedAt: new Date(video.created * 1000),
      viewCount: video.play,
      commentCount: video.comment || video.review,
      danmakuCount: video.danmaku,
      author: {
        name: video.author,
        username: String(video.mid),
      },
    }));

    console.log(`Bilibili user ${mid} videos: found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Bilibili user videos error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// ============================================================
// 账号检测与信息获取
// ============================================================
export interface AccountInfo {
  platform: 'bilibili' | 'weibo';
  name: string;
  id: string;
  followers: number;
  verified: boolean;
  description: string;
  avatar?: string;
}

// 检测关键词是否为某平台账号，并获取该账号最新内容
export async function detectAndFetchAccount(keyword: string): Promise<{
  accounts: AccountInfo[];
  results: SearchResult[];
}> {
  const accounts: AccountInfo[] = [];
  const results: SearchResult[] = [];

  try {
    const biliUser = await searchBilibiliUser(keyword);
    if (biliUser) {
      accounts.push({
        platform: 'bilibili',
        name: biliUser.uname,
        id: String(biliUser.mid),
        followers: biliUser.fans,
        verified: biliUser.official_verify?.type >= 0,
        description: biliUser.usign,
        avatar: biliUser.upic,
      });

      console.log(`🎯 Detected Bilibili account: ${biliUser.uname} (${biliUser.fans} fans)`);

      const userVideos = await getBilibiliUserVideos(biliUser.mid);
      results.push(...userVideos);
    }
  } catch (error) {
    console.error('Bilibili account detection error:', error instanceof Error ? error.message : error);
  }

  return { accounts, results };
}
