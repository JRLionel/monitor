import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.js';
import { RateLimiter, httpGet } from './http.js';
import { deduplicateByUrl } from './dedupe.js';

const bingLimiter = new RateLimiter(5000);
const googleLimiter = new RateLimiter(10000);
const duckduckgoLimiter = new RateLimiter(3000);
const hackernewsLimiter = new RateLimiter(1000);

export async function searchBing(query: string): Promise<SearchResult[]> {
  try {
    const response = await httpGet<string>('https://www.bing.com/search', {
      params: { q: query, count: 20 },
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      responseType: 'text',
      limiter: bingLimiter,
      timeoutMs: 15_000,
      retries: 2,
      label: 'bing',
    });

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    $('li.b_algo').each((_, element) => {
      const titleElement = $(element).find('h2 a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href');
      const snippet = $(element).find('.b_caption p').text().trim();

      if (title && url && url.startsWith('http')) {
        results.push({ title, content: snippet, url, source: 'bing' });
      }
    });

    console.log(`Bing search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Bing search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

export async function searchGoogle(query: string): Promise<SearchResult[]> {
  try {
    const response = await httpGet<string>('https://www.google.com/search', {
      params: { q: query, num: 20, hl: 'en' },
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      responseType: 'text',
      limiter: googleLimiter,
      timeoutMs: 15_000,
      retries: 2,
      label: 'google',
    });

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    $('div.g').each((_, element) => {
      const titleElement = $(element).find('h3').first();
      const title = titleElement.text().trim();
      const linkElement = $(element).find('a').first();
      const url = linkElement.attr('href');
      const snippet = $(element).find('.VwiC3b').text().trim();

      if (title && url && url.startsWith('http')) {
        results.push({ title, content: snippet, url, source: 'google' });
      }
    });

    console.log(`Google search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Google search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// DuckDuckGo 搜索（使用 HTML 版本）
export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const response = await httpGet<string>('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      responseType: 'text',
      limiter: duckduckgoLimiter,
      timeoutMs: 15_000,
      retries: 2,
      label: 'duckduckgo',
    });

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    $('.result').each((_, element) => {
      const titleElement = $(element).find('.result__title a');
      const title = titleElement.text().trim();
      const rawUrl = titleElement.attr('href');
      const snippet = $(element).find('.result__snippet').text().trim();

      let url = rawUrl;
      if (rawUrl && rawUrl.includes('uddg=')) {
        try {
          const urlParams = new URLSearchParams(rawUrl.split('?')[1]);
          url = decodeURIComponent(urlParams.get('uddg') || rawUrl);
        } catch {
          url = rawUrl;
        }
      }

      if (title && url && url.startsWith('http')) {
        results.push({ title, content: snippet, url, source: 'duckduckgo' });
      }
    });

    console.log(`DuckDuckGo search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('DuckDuckGo search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// Hacker News API（Algolia，官方免费）
interface HNSearchResult {
  hits: Array<{
    objectID: string;
    title: string;
    url: string | null;
    story_text: string | null;
    author: string;
    points: number;
    num_comments: number;
    created_at: string;
  }>;
}

export async function searchHackerNews(query: string): Promise<SearchResult[]> {
  try {
    const oneDayAgo = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
    const response = await httpGet<HNSearchResult>('https://hn.algolia.com/api/v1/search', {
      params: {
        query,
        tags: 'story',
        hitsPerPage: 20,
        numericFilters: `created_at_i>${oneDayAgo}`,
      },
      limiter: hackernewsLimiter,
      timeoutMs: 15_000,
      retries: 2,
      label: 'hackernews',
    });

    const results: SearchResult[] = (response.data.hits || [])
      .filter(hit => hit.url || hit.story_text)
      .map(hit => ({
        title: hit.title,
        content: hit.story_text || hit.title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: 'hackernews' as const,
        sourceId: hit.objectID,
        publishedAt: new Date(hit.created_at),
        score: hit.points,
        commentCount: hit.num_comments,
        author: {
          name: hit.author,
          username: hit.author,
        },
      }));

    console.log(`Hacker News search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Hacker News search error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// 聚合搜索（国际搜索引擎，仅保留可用的）
export async function searchAll(query: string): Promise<SearchResult[]> {
  const results = await Promise.allSettled([searchBing(query), searchHackerNews(query)]);
  const allResults: SearchResult[] = [];
  const sourceNames = ['Bing', 'HackerNews'];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value);
    } else {
      console.warn(`${sourceNames[index]} search failed:`, result.reason);
    }
  });

  const uniqueResults = deduplicateByUrl(allResults);
  console.log(`Search aggregation for "${query}": ${allResults.length} total, ${uniqueResults.length} unique`);
  return uniqueResults;
}
