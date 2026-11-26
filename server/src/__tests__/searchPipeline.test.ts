import { describe, it, expect } from 'vitest';
import type { SearchResult } from '../types.js';
import { clusterByEvent, dedupeItems } from '../services/dedupe.js';
import { detectQueryType } from '../services/queryType.js';
import { tokenOverlapRelevance } from '../utils/text.js';

function item(partial: Partial<SearchResult> & Pick<SearchResult, 'title' | 'url' | 'source'>): SearchResult {
  return {
    content: partial.title,
    ...partial,
  };
}

describe('tokenOverlapRelevance', () => {
  it('中文关键词能匹配到中文内容', () => {
    expect(tokenOverlapRelevance('人工智能', '人工智能最新进展与产业观察')).toBeGreaterThan(0.5);
  });

  it('完全无关的内容得分为 0', () => {
    expect(tokenOverlapRelevance('人工智能', '今天天气很好，适合出门散步')).toBe(0);
  });

  it('英文大小写与短语匹配', () => {
    expect(tokenOverlapRelevance('Claude Code', 'claude code 新增了 hooks 能力')).toBeGreaterThan(0.5);
  });
});

describe('dedupeItems', () => {
  it('相同 URL 只保留一条', () => {
    const items = [
      item({ title: 'A', url: 'https://example.com/a', source: 'hackernews' }),
      item({ title: 'A', url: 'https://example.com/a/', source: 'weibo' }),
    ];
    expect(dedupeItems(items)).toHaveLength(1);
  });

  it('近重复标题会合并', () => {
    const items = [
      item({ title: 'OpenAI 发布 GPT-5 模型', url: 'https://a.com/1', source: 'weibo' }),
      item({ title: 'OpenAI 正式发布 GPT-5 模型', url: 'https://b.com/2', source: 'hackernews' }),
    ];
    expect(dedupeItems(items)).toHaveLength(1);
  });

  it('数字不同视为不同事件', () => {
    const items = [
      item({ title: 'OpenAI 发布 GPT-5 模型', url: 'https://a.com/1', source: 'weibo' }),
      item({ title: 'OpenAI 发布 GPT-6 模型', url: 'https://b.com/2', source: 'hackernews' }),
    ];
    expect(dedupeItems(items)).toHaveLength(2);
  });
});

describe('clusterByEvent', () => {
  it('同一事件跨平台出现时聚成一簇', () => {
    const items = [
      item({ title: 'OpenAI 发布 GPT-5 模型', url: 'https://weibo.com/1', source: 'weibo' }),
      item({ title: 'OpenAI 正式发布 GPT-5 模型', url: 'https://x.com/2', source: 'twitter' }),
      item({ title: 'OpenAI 发布 GPT-5 模型，性能大幅提升', url: 'https://b.com/3', source: 'hackernews' }),
      item({ title: '今天天气很好', url: 'https://c.com/4', source: 'bilibili' }),
    ];
    const clusters = clusterByEvent(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sources.sort()).toEqual(['hackernews', 'twitter', 'weibo']);
  });
});

describe('detectQueryType', () => {
  it('识别比较类查询', () => {
    expect(detectQueryType('Claude 和 GPT 对比')).toBe('comparison');
  });

  it('识别教程类查询', () => {
    expect(detectQueryType('如何部署 vLLM')).toBe('how_to');
  });

  it('识别产品类查询', () => {
    expect(detectQueryType('iPhone 17 价格')).toBe('product');
  });

  it('默认归为突发新闻', () => {
    expect(detectQueryType('Claude')).toBe('breaking_news');
  });
});
