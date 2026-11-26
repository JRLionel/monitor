import type { SearchResult } from '../types.js';
import { RateLimiter, browserHeaders, httpGet } from './http.js';

// 各源独立限速，避免触发 429
const githubLimiter = new RateLimiter(2000);
const csdnLimiter = new RateLimiter(3000);

// ============================================================
// GitHub 仓库搜索（官方 API，无需 Key）
//   以 stars 作为热度信号，按最近更新排序，聚焦新项目
// ============================================================

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  created_at: string;
  language: string | null;
  topics?: string[];
  owner: { login: string; avatar_url: string };
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubRepo[];
}

export async function searchGitHub(query: string): Promise<SearchResult[]> {
  const url = 'https://api.github.com/search/repositories';
  try {
    const response = await httpGet<GitHubSearchResponse>(url, {
      params: {
        q: query,
        sort: 'stars',
        order: 'desc',
        per_page: 15,
      },
      headers: {
        ...browserHeaders('desktop'),
        Accept: 'application/vnd.github+json',
      },
      limiter: githubLimiter,
      timeoutMs: 20_000,
      retries: 2,
      label: 'github',
    });

    const results: SearchResult[] = (response.data.items || []).map(repo => ({
      title: `${repo.full_name}${repo.language ? ` · ${repo.language}` : ''}`,
      content: repo.description || repo.full_name,
      url: repo.html_url,
      source: 'github' as const,
      sourceId: String(repo.id),
      publishedAt: new Date(repo.pushed_at),
      likeCount: repo.stargazers_count,
      commentCount: repo.open_issues_count,
      viewCount: repo.forks_count,
      author: {
        name: repo.owner.login,
        username: repo.owner.login,
        avatar: repo.owner.avatar_url,
      },
    }));

    console.log(`GitHub search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('GitHub search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// ============================================================
// CSDN 博客搜索（so.csdn.net 公开搜索接口，无需 Key）
//   tm=7 限定最近 7 天，避免相关度排序返回大量陈旧文章
// ============================================================

interface CsdnArticle {
  articleid?: string | number;
  id?: string | number;
  title?: string;
  description?: string;
  digest?: string;
  url?: string;
  create_time?: string | number;
  view?: string | number;
  viewcount?: string | number;
  digg?: string | number;
  diggcount?: string | number;
  comment?: string | number;
  commentcount?: string | number;
  nickname?: string;
  username?: string;
  avatar?: string;
}

interface CsdnSearchResponse {
  total?: number;
  result_vos?: CsdnArticle[];
}

// 搜索接口标题/摘要带 <em> 高亮标签，需清理并还原 HTML 实体
function stripCsdnMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function searchCSDN(query: string): Promise<SearchResult[]> {
  const url = 'https://so.csdn.net/api/v3/search';
  try {
    const response = await httpGet<CsdnSearchResponse>(url, {
      params: {
        q: query,
        t: 'blog',
        p: 1,
        s: 0,
        tm: 7, // 仅最近 7 天，保证热点新鲜度
        lv: -1,
        ft: 0,
      },
      headers: browserHeaders('desktop', 'https://so.csdn.net/'),
      limiter: csdnLimiter,
      timeoutMs: 20_000,
      retries: 2,
      label: 'csdn',
    });

    const articles = Array.isArray(response.data?.result_vos) ? response.data.result_vos : [];
    const results: SearchResult[] = [];

    for (const article of articles) {
      const rawTitle = article.title ? stripCsdnMarkup(article.title) : '';
      if (!rawTitle || !article.url) continue;

      const createdAt = toNumber(article.create_time);
      results.push({
        title: rawTitle,
        content: stripCsdnMarkup(article.description || article.digest || rawTitle),
        // 去掉搜索注入的跟踪参数，避免同一篇文章重复入库
        url: article.url.split('?')[0],
        source: 'csdn' as const,
        sourceId: String(article.articleid || article.id || ''),
        publishedAt: createdAt ? new Date(createdAt) : undefined,
        viewCount: toNumber(article.view ?? article.viewcount),
        likeCount: toNumber(article.digg ?? article.diggcount),
        commentCount: toNumber(article.comment ?? article.commentcount),
        author: article.nickname
          ? {
              name: article.nickname,
              username: article.username || article.nickname,
              avatar: article.avatar,
            }
          : undefined,
      });
    }

    results.sort(
      (a, b) =>
        new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()
    );

    console.log(`CSDN search for "${query}": found ${results.length} results (last 7 days)`);
    return results;
  } catch (error) {
    console.error('CSDN search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}
