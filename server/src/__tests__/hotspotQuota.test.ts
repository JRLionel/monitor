import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cacheClear } from '../services/cache.js';

/**
 * 巡检配额回归测试
 *
 * 背景：此前配额计数器只在“热点入库成功”后自增，被 AI 过滤掉的内容不计数，
 * 导致配额形同虚设——例如 30 条 Twitter 结果会触发 30 次 AI 调用（应为 15 次）。
 * 该测试锁定“按实际处理条数消耗配额”的行为。
 */

const analyzed: string[] = [];

let twitterItems: any[] = [];
let weiboItems: any[] = [];

function makeItems(source: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `${source}-${i}`,
    content: `${source}-content-${i}`,
    url: `https://example.com/${source}/${i}`,
    source
  }));
}

vi.mock('../db.js', () => ({
  prisma: {
    keyword: { findMany: async () => [{ id: 'k1', text: 'Claude' }] },
    hotspot: {
      findFirst: async () => null,
      // 本测试中所有内容都会被过滤，不应发生入库
      create: async () => {
        throw new Error('unexpected hotspot.create');
      }
    },
    notification: { create: async () => ({}) }
  }
}));

vi.mock('../services/twitter.js', () => ({
  searchTwitter: async () => twitterItems
}));

vi.mock('../services/search.js', () => ({
  searchHackerNews: async () => []
}));

vi.mock('../services/chinaSearch.js', () => ({
  searchBilibili: async () => [],
  detectAndFetchAccount: async () => ({ accounts: [], results: [] })
}));

vi.mock('../services/weibo.js', () => ({
  searchWeibo: async () => weiboItems
}));

vi.mock('../services/juejin.js', () => ({
  searchJuejin: async () => []
}));

vi.mock('../services/ai.js', () => ({
  expandKeyword: async (keyword: string) => [keyword],
  preMatchKeyword: () => ({ matched: true, matchedTerms: ['Claude'] }),
  analyzeContent: async (text: string) => {
    analyzed.push(text);
    // 低相关性 → 全部被过滤，不触发入库
    return {
      isReal: true,
      relevance: 10,
      relevanceReason: 'low',
      keywordMentioned: false,
      importance: 'low',
      summary: ''
    };
  }
}));

vi.mock('../services/email.js', () => ({ sendHotspotEmail: async () => true }));

const { runHotspotCheck } = await import('../jobs/hotspotChecker.js');

const fakeServer = { to: () => ({ emit: () => {} }), emit: () => {} } as any;

describe('巡检配额（回归）', () => {
  beforeEach(() => {
    analyzed.length = 0;
    twitterItems = [];
    weiboItems = [];
    cacheClear();
  });

  it('Twitter 结果超过配额时，AI 分析次数不超过 15', async () => {
    twitterItems = makeItems('twitter', 30);
    await runHotspotCheck(fakeServer);
    expect(analyzed).toHaveLength(15);
  }, 20000);

  it('其他来源共享 10 条配额', async () => {
    weiboItems = makeItems('weibo', 30);
    await runHotspotCheck(fakeServer);
    expect(analyzed).toHaveLength(10);
  }, 20000);
});
