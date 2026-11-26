import { describe, it, expect } from 'vitest';
import {
  mergeTopics,
  normalizeTitle,
  parseBaiduEntries,
  parseFeed,
  parseZhihuHeat,
  titlesMatch,
  type HotBoard,
  type HotBoardItem,
} from '../services/hotBoard.js';

function item(partial: Partial<HotBoardItem> & Pick<HotBoardItem, 'title'>): HotBoardItem {
  return {
    rank: 1,
    url: `https://example.com/${encodeURIComponent(partial.title)}`,
    ...partial,
  };
}

function board(
  id: string,
  items: HotBoardItem[],
  overrides: Partial<HotBoard> = {}
): HotBoard {
  return {
    label: id,
    code: id.toUpperCase(),
    kind: 'board',
    group: 'cn',
    items,
    error: null,
    ...overrides,
  };
}

describe('titlesMatch', () => {
  it('忽略空格、标点与大小写', () => {
    expect(titlesMatch('OpenAI 发布 GPT-5！', 'openai发布gpt5')).toBe(true);
  });

  it('包含关系在足够长时视为同一事件', () => {
    expect(titlesMatch('U23国足获亚运铜牌', '拿下点球大战，U23国足获亚运铜牌')).toBe(true);
  });

  it('不同事件不匹配', () => {
    expect(titlesMatch('iPhone 17 发布', '今天天气很好')).toBe(false);
  });
});

describe('mergeTopics', () => {
  it('同一事件跨平台合并成一个同频热点', () => {
    const topics = mergeTopics({
      weibo: board('weibo', [
        item({ title: '中国男足获亚运铜牌', rank: 3 }),
        item({ title: '某明星官宣新剧', rank: 5 }),
      ]),
      baidu: board('baidu', [
        item({ title: '拿下点球大战！U23国足获亚运铜牌', rank: 2 }),
        item({ title: 'iPhone 17 新配色曝光', rank: 8 }),
      ]),
      douyin: board('douyin', [item({ title: 'U23国足获亚运铜牌', rank: 1 })]),
      zhihu: board('zhihu', [item({ title: '今天晚饭吃什么比较好', rank: 4 })]),
    });

    expect(topics).toHaveLength(1);
    const [topic] = topics;
    expect(topic.platformCount).toBe(3);
    expect(topic.mentions.map(mention => mention.platform).sort()).toEqual([
      'baidu',
      'douyin',
      'weibo',
    ]);
    expect(topic.title).toBe('U23国足获亚运铜牌');
  });

  it('只有一个平台的相似内容不算同频热点', () => {
    const topics = mergeTopics({
      weibo: board('weibo', [
        item({ title: 'OpenAI 发布 GPT-5 模型', rank: 1 }),
        item({ title: 'OpenAI 正式发布 GPT-5 模型', rank: 2 }),
      ]),
    });
    expect(topics).toHaveLength(0);
  });

  it('置顶条目与 RSS 源不参与聚类', () => {
    const topics = mergeTopics({
      weibo: board('weibo', [item({ title: '中国男足获亚运铜牌', rank: 1 })]),
      baidu: board('baidu', [
        item({ title: '中国男足获亚运铜牌', rank: 1, pinned: true }),
      ]),
      ithome: board('ithome', [item({ title: '中国男足获亚运铜牌', rank: 1 })], {
        kind: 'feed',
        group: 'news',
      }),
    });
    expect(topics).toHaveLength(0);
  });
});

describe('parseFeed', () => {
  it('解析 RSS 并按发布时间倒序', () => {
    const body = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item>
          <title>较旧 &amp; 标题</title>
          <link>https://a.com/old</link>
          <pubDate>Wed, 25 Nov 2025 09:00:00 +0800</pubDate>
        </item>
        <item>
          <title><![CDATA[最新标题]]></title>
          <link>https://a.com/new</link>
          <pubDate>Thu, 26 Nov 2025 10:30:00 +0800</pubDate>
        </item>
      </channel></rss>`;

    const items = parseFeed(body);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('最新标题');
    expect(items[0].url).toBe('https://a.com/new');
    expect(items[0].rank).toBe(1);
    expect(items[0].label).toBe('11-26 10:30');
    expect(items[1].title).toBe('较旧 & 标题');
  });

  it('解析 Atom 的 link href', () => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom 条目</title>
        <link href="https://b.com/1" />
        <updated>2025-11-26T08:00:00Z</updated>
      </entry>
    </feed>`;

    const items = parseFeed(body);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://b.com/1');
    expect(items[0].label).toBe('11-26 16:00');
  });

  it('空内容返回空数组', () => {
    expect(parseFeed('')).toHaveLength(0);
    expect(parseFeed('<rss></rss>')).toHaveLength(0);
  });
});

describe('榜单字段解析', () => {
  it('知乎热度文本换算为数字', () => {
    expect(parseZhihuHeat('1234 万热度')).toBe(12_340_000);
    expect(parseZhihuHeat('1.2亿热度')).toBe(120_000_000);
    expect(parseZhihuHeat('没有热度')).toBeNull();
  });

  it('百度热搜条目带标签、置顶与热度', () => {
    const items = parseBaiduEntries(
      [
        { word: '置顶新闻', rawUrl: 'https://a.com/1', isTop: true, hotScore: '999' },
        { query: '普通热搜', url: 'https://a.com/2', hotTag: 3, hotScore: 1200 },
      ],
      10
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ rank: 1, title: '置顶新闻', label: '置顶', pinned: true });
    expect(items[1]).toMatchObject({ rank: 2, title: '普通热搜', label: '热', hotValue: 1200 });
  });
});

describe('normalizeTitle', () => {
  it('去掉空白与标点', () => {
    expect(normalizeTitle('#你好，世界！ #测试')).toBe('你好世界测试');
  });
});
