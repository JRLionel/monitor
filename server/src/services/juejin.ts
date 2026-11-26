import type { SearchResult } from '../types.js';
import { RateLimiter, browserHeaders, httpPost } from './http.js';

const juejinLimiter = new RateLimiter(3000);

interface JuejinSearchEntry {
  result_type?: number;
  result_model?: {
    article_id?: string;
    article_info?: {
      article_id: string;
      title: string;
      brief_content?: string;
      ctime?: string;
      view_count?: number;
      digg_count?: number;
      comment_count?: number;
    };
    author_user_info?: {
      user_name?: string;
    };
  };
}

interface JuejinSearchResponse {
  err_no: number;
  err_msg: string;
  data?: JuejinSearchEntry[];
}

// 掘金搜索（按最新排序，公开接口无需 Key）
export async function searchJuejin(query: string): Promise<SearchResult[]> {
  try {
    const response = await httpPost<JuejinSearchResponse>('https://api.juejin.cn/search_api/v1/search', {
      data: {
        key_word: query,
        id_type: 0,
        cursor: '0',
        limit: 20,
        search_type: 0,
        sort_type: 1,
        version: 1,
      },
      headers: {
        ...browserHeaders('desktop', 'https://juejin.cn/', 'application/json'),
        'Content-Type': 'application/json',
      },
      limiter: juejinLimiter,
      timeoutMs: 15_000,
      retries: 2,
      label: 'juejin',
    });

    if (response.data.err_no !== 0) {
      throw new Error(`掘金接口返回错误 ${response.data.err_no}: ${response.data.err_msg || ''}`);
    }

    const results: SearchResult[] = [];
    for (const entry of response.data.data ?? []) {
      const info = entry.result_model?.article_info;
      const articleId = info?.article_id || entry.result_model?.article_id;
      if (!info?.title || !articleId) continue;

      results.push({
        title: info.title,
        content: info.brief_content || info.title,
        url: `https://juejin.cn/post/${articleId}`,
        source: 'juejin',
        sourceId: articleId,
        publishedAt: info.ctime ? new Date(Number(info.ctime) * 1000) : undefined,
        viewCount: info.view_count,
        likeCount: info.digg_count,
        commentCount: info.comment_count,
        author: {
          name: entry.result_model?.author_user_info?.user_name || '掘金用户',
        },
      });
    }

    console.log(`Juejin search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Juejin search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}
