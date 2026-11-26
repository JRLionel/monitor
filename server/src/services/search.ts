import type { SearchResult } from '../types.js';
import { RateLimiter, httpGet } from './http.js';

const hackernewsLimiter = new RateLimiter(1000);

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
