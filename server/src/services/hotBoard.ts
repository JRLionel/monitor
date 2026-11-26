import * as cheerio from 'cheerio';
import { browserHeaders, httpGet } from './http.js';
import { runSource } from './sourceStatus.js';

export type HotBoardKind = 'board' | 'feed';
export type HotBoardGroup = 'cn' | 'news' | 'global';

export interface HotBoardItem {
  rank: number;
  title: string;
  url: string;
  hotValue?: number | null;
  label?: string;
  desc?: string;
  pinned?: boolean;
}

export interface HotBoard {
  label: string;
  code: string;
  kind: HotBoardKind;
  group: HotBoardGroup;
  items: HotBoardItem[];
  error: string | null;
}

export interface HotTopicMention {
  platform: string;
  label: string;
  rank: number;
  title: string;
  url: string;
  hotValue?: number | null;
}

export interface HotTopic {
  title: string;
  url: string;
  platformCount: number;
  score: number;
  mentions: HotTopicMention[];
}

export interface HotBoardSnapshot {
  generatedAt: string;
  boards: Record<string, HotBoard>;
  topics: HotTopic[];
}

interface HotBoardDef {
  id: string;
  label: string;
  code: string;
  group: HotBoardGroup;
  kind: HotBoardKind;
  fetch: (limit: number) => Promise<HotBoardItem[]>;
}

// ---------------------------------------------------------------------------
// 榜单适配器
// ---------------------------------------------------------------------------

const WEIBO_HOT_URL = 'https://weibo.com/ajax/side/hotSearch';
const BAIDU_HOT_HTML = 'https://top.baidu.com/board?tab=realtime';
const BAIDU_HOT_API = 'https://top.baidu.com/api/board?platform=wise&tab=realtime';
const DOUYIN_HOT_URL =
  'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1';
const TOUTIAO_HOT_URL = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';
const BILIBILI_HOT_URL = 'https://s.search.bilibili.com/main/hotword';
const ZHIHU_HOT_URLS = [
  'https://api.zhihu.com/topstory/hot-lists/total?limit=50',
  'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50',
];
const HN_FRONT_PAGE_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30';

const BAIDU_HOT_TAGS: Record<string, string> = { '1': '新', '3': '热' };

function toInt(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWeiboHot(limit: number): Promise<HotBoardItem[]> {
  const response = await httpGet<any>(WEIBO_HOT_URL, {
    headers: browserHeaders('desktop', 'https://weibo.com/', 'application/json'),
    timeoutMs: 12_000,
    retries: 1,
    label: 'hot-weibo',
  });

  const entries = response.data?.data?.realtime;
  if (!Array.isArray(entries)) return [];

  const items: HotBoardItem[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || entry.is_ad) continue;
    const word = entry.word || entry.note;
    if (!word) continue;
    const query = entry.word_scheme || `#${word}#`;
    items.push({
      rank: toInt(entry.realpos) || (toInt(entry.rank) ?? index) + 1,
      title: word,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`,
      hotValue: toInt(entry.num) ?? null,
      label: entry.label_name || '',
    });
    if (items.length >= limit) break;
  }
  return items;
}

function collectBaiduEntries(cards: any[]): any[] {
  const entries: any[] = [];
  for (const card of cards) {
    const content = card?.content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (!entry || typeof entry !== 'object') continue;
      // 移动端接口会在每个卡片外再包一层 content
      if (Array.isArray(entry.content)) {
        entries.push(...entry.content);
      } else {
        entries.push(entry);
      }
    }
  }
  return entries;
}

export function parseBaiduEntries(entries: any[], limit: number): HotBoardItem[] {
  const items: HotBoardItem[] = [];
  for (const entry of entries) {
    const word = entry?.word || entry?.query || '';
    if (!word) continue;
    const label = entry.isTop
      ? '置顶'
      : BAIDU_HOT_TAGS[String(entry.hotTag)] || entry.newHotName || '';
    items.push({
      rank: items.length + 1,
      title: word,
      url:
        entry.rawUrl ||
        entry.url ||
        `https://www.baidu.com/s?wd=${encodeURIComponent(word)}`,
      hotValue: toInt(entry.hotScore) ?? null,
      label,
      desc: cleanText(entry.desc).slice(0, 200),
      pinned: Boolean(entry.isTop),
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchBaiduHot(limit: number): Promise<HotBoardItem[]> {
  let entries: any[] = [];

  try {
    const response = await httpGet<string>(BAIDU_HOT_HTML, {
      headers: browserHeaders('desktop', 'https://top.baidu.com/'),
      responseType: 'text',
      timeoutMs: 12_000,
      retries: 1,
      label: 'hot-baidu',
    });
    const match = String(response.data ?? '').match(/<!--s-data:([\s\S]*?)-->/);
    if (match) {
      const data = JSON.parse(match[1]);
      entries = collectBaiduEntries(data?.data?.cards ?? []);
    }
  } catch (error) {
    console.warn(`[热榜] 百度 PC 页解析失败: ${error instanceof Error ? error.message : error}`);
  }

  if (!entries.length) {
    const response = await httpGet<any>(BAIDU_HOT_API, {
      headers: browserHeaders('mobile', 'https://top.baidu.com/', 'application/json'),
      timeoutMs: 10_000,
      retries: 1,
      label: 'hot-baidu',
    });
    entries = collectBaiduEntries(response.data?.data?.cards ?? []);
  }

  return parseBaiduEntries(entries, limit);
}

async function fetchDouyinHot(limit: number): Promise<HotBoardItem[]> {
  const response = await httpGet<any>(DOUYIN_HOT_URL, {
    headers: browserHeaders('desktop', 'https://www.douyin.com/', 'application/json'),
    timeoutMs: 12_000,
    retries: 1,
    label: 'hot-douyin',
  });

  const entries = response.data?.data?.word_list;
  if (!Array.isArray(entries)) return [];

  const items: HotBoardItem[] = [];
  for (const [index, entry] of entries.entries()) {
    const word = entry?.word || '';
    if (!word) continue;
    const sentenceId = entry.sentence_id;
    items.push({
      rank: toInt(entry.position) || index + 1,
      title: word,
      url: sentenceId
        ? `https://www.douyin.com/hot/${sentenceId}`
        : `https://www.douyin.com/search/${encodeURIComponent(word)}`,
      hotValue: toInt(entry.hot_value) ?? null,
      label: '',
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchToutiaoHot(limit: number): Promise<HotBoardItem[]> {
  const response = await httpGet<any>(TOUTIAO_HOT_URL, {
    headers: browserHeaders('desktop', 'https://www.toutiao.com/', 'application/json'),
    timeoutMs: 12_000,
    retries: 1,
    label: 'hot-toutiao',
  });

  const entries = response.data?.data;
  if (!Array.isArray(entries)) return [];

  const items: HotBoardItem[] = [];
  for (const [index, entry] of entries.entries()) {
    const title = entry?.Title || '';
    if (!title) continue;
    let url = entry.Url || '';
    if (url.includes('toutiao.com/trending/')) {
      url = url.split('?', 1)[0];
    }
    items.push({
      rank: index + 1,
      title,
      url,
      hotValue: toInt(entry.HotValue) ?? null,
      label: entry.Label || '',
      desc: cleanText(entry.Abstract),
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchBilibiliHot(limit: number): Promise<HotBoardItem[]> {
  const response = await httpGet<any>(`${BILIBILI_HOT_URL}?limit=${Math.max(10, limit)}`, {
    headers: browserHeaders('desktop', 'https://www.bilibili.com/', 'application/json'),
    timeoutMs: 12_000,
    retries: 1,
    label: 'hot-bilibili',
  });

  const entries = response.data?.list;
  if (!Array.isArray(entries)) return [];

  const items: HotBoardItem[] = [];
  for (const [index, entry] of entries.entries()) {
    const word = entry?.keyword || '';
    const title = entry?.show_name || word;
    if (!title) continue;
    items.push({
      rank: toInt(entry.pos) || index + 1,
      title,
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(word || title)}`,
      hotValue: toInt(entry.heat_score) ?? toInt(entry.score) ?? null,
      label: entry.word_type === 7 ? '直播' : '',
    });
    if (items.length >= limit) break;
  }
  return items;
}

export function parseZhihuHeat(detail: string | undefined): number | null {
  const match = String(detail ?? '').match(/([\d.]+)\s*(万|亿)?\s*热度/);
  if (!match) return null;
  let value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === '万') value *= 10_000;
  if (match[2] === '亿') value *= 100_000_000;
  return Math.round(value);
}

export function parseZhihuEntries(payload: any, limit: number): HotBoardItem[] {
  const entries = payload?.data;
  if (!Array.isArray(entries)) return [];

  const items: HotBoardItem[] = [];
  for (const [index, entry] of entries.entries()) {
    const target = entry?.target ?? {};
    const title = target.title || '';
    if (!title) continue;
    const questionId = target.id;
    items.push({
      rank: index + 1,
      title,
      url: questionId ? `https://www.zhihu.com/question/${questionId}` : '',
      hotValue: parseZhihuHeat(entry?.detail_text),
      label: '',
      desc: cleanText(target.excerpt).slice(0, 200),
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchZhihuHot(limit: number): Promise<HotBoardItem[]> {
  let lastError: unknown = null;
  let succeeded = false;

  for (const url of ZHIHU_HOT_URLS) {
    try {
      const response = await httpGet<any>(url, {
        headers: browserHeaders('desktop', 'https://www.zhihu.com/hot', 'application/json'),
        timeoutMs: 10_000,
        retries: 1,
        label: 'hot-zhihu',
      });
      succeeded = true;
      const items = parseZhihuEntries(response.data, limit);
      if (items.length) return items;
    } catch (error) {
      lastError = error;
    }
  }

  if (!succeeded && lastError) throw lastError;
  return [];
}

async function fetchHackerNewsFront(limit: number): Promise<HotBoardItem[]> {
  const response = await httpGet<any>(HN_FRONT_PAGE_URL, {
    timeoutMs: 12_000,
    retries: 1,
    label: 'hot-hackernews',
  });

  const hits = response.data?.hits;
  if (!Array.isArray(hits)) return [];

  const items: HotBoardItem[] = [];
  for (const hit of hits) {
    if (!hit?.objectID || !hit?.title) continue;
    items.push({
      rank: items.length + 1,
      title: hit.title,
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      hotValue: toInt(hit.points) ?? null,
      label: hit.num_comments ? `${hit.num_comments} 评论` : '',
    });
    if (items.length >= limit) break;
  }

  return items.sort((a, b) => (b.hotValue ?? 0) - (a.hotValue ?? 0)).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

// ---------------------------------------------------------------------------
// RSS / Atom
// ---------------------------------------------------------------------------

function localTagName(name: string): string {
  return name.split(':').pop()?.toLowerCase() ?? name.toLowerCase();
}

export function parseFeedDate(text: string | undefined): Date | null {
  const value = String(text ?? '').trim();
  if (!value) return null;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = value.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (match) {
    return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`);
  }
  return null;
}

function formatFeedTime(date: Date | null): string {
  if (!date) return '';
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

export function parseFeed(body: string, limit = 20): HotBoardItem[] {
  if (!body?.trim()) return [];

  const $ = cheerio.load(body, { xmlMode: true });
  const nodes = [...$('item').toArray(), ...$('entry').toArray()];
  const rows: { title: string; url: string; date: Date | null; index: number }[] = [];

  nodes.forEach((node, index) => {
    const el = $(node);
    let title = '';
    let link = '';
    let dateText = '';

    for (const child of el.children().toArray()) {
      const name = localTagName((child as any).name ?? '');
      if (name === 'title' && !title) {
        title = cleanText($(child).text());
      } else if (name === 'link' && !link) {
        link = cleanText($(child).text()) || ($(child).attr('href') ?? '');
      } else if (['pubdate', 'published', 'updated', 'date'].includes(name) && !dateText) {
        dateText = $(child).text();
      }
    }

    if (title && link) {
      rows.push({ title, url: link.trim(), date: parseFeedDate(dateText), index });
    }
  });

  rows.sort((a, b) => {
    const timeA = a.date?.getTime() ?? 0;
    const timeB = b.date?.getTime() ?? 0;
    if (timeA !== timeB) return timeB - timeA;
    return a.index - b.index;
  });

  return rows.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    title: row.title,
    url: row.url,
    hotValue: null,
    label: formatFeedTime(row.date),
  }));
}

async function fetchFeed(url: string, limit: number, label: string): Promise<HotBoardItem[]> {
  const response = await httpGet<string>(url, {
    headers: browserHeaders(
      'desktop',
      url,
      'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8'
    ),
    responseType: 'text',
    timeoutMs: 15_000,
    retries: 1,
    label,
  });
  return parseFeed(String(response.data ?? ''), limit);
}

// ---------------------------------------------------------------------------
// 来源配置
// ---------------------------------------------------------------------------

export const HOT_BOARD_DEFS: HotBoardDef[] = [
  { id: 'weibo', label: '微博热搜', code: 'WEIBO', group: 'cn', kind: 'board', fetch: fetchWeiboHot },
  { id: 'baidu', label: '百度热搜', code: 'BAIDU', group: 'cn', kind: 'board', fetch: fetchBaiduHot },
  { id: 'douyin', label: '抖音热榜', code: 'DOUYIN', group: 'cn', kind: 'board', fetch: fetchDouyinHot },
  { id: 'toutiao', label: '头条热榜', code: 'TOUTIAO', group: 'cn', kind: 'board', fetch: fetchToutiaoHot },
  { id: 'bilibili', label: 'B站热搜', code: 'BILI', group: 'cn', kind: 'board', fetch: fetchBilibiliHot },
  { id: 'zhihu', label: '知乎热榜', code: 'ZHIHU', group: 'cn', kind: 'board', fetch: fetchZhihuHot },
  {
    id: 'hackernews',
    label: 'Hacker News',
    code: 'HN',
    group: 'global',
    kind: 'board',
    fetch: fetchHackerNewsFront,
  },
  {
    id: 'ithome',
    label: 'IT之家',
    code: 'RSS',
    group: 'news',
    kind: 'feed',
    fetch: limit => fetchFeed('https://www.ithome.com/rss/', limit, 'hot-ithome'),
  },
  {
    id: 'huxiu',
    label: '虎嗅',
    code: 'RSS',
    group: 'news',
    kind: 'feed',
    fetch: limit => fetchFeed('https://rss.huxiu.com/', limit, 'hot-huxiu'),
  },
  {
    id: 'sspai',
    label: '少数派',
    code: 'RSS',
    group: 'news',
    kind: 'feed',
    fetch: limit => fetchFeed('https://sspai.com/feed', limit, 'hot-sspai'),
  },
  {
    id: 'ifanr',
    label: '爱范儿',
    code: 'RSS',
    group: 'news',
    kind: 'feed',
    fetch: limit => fetchFeed('https://www.ifanr.com/feed', limit, 'hot-ifanr'),
  },
  {
    id: 'solidot',
    label: 'Solidot',
    code: 'RSS',
    group: 'news',
    kind: 'feed',
    fetch: limit => fetchFeed('https://www.solidot.org/index.rss', limit, 'hot-solidot'),
  },
];

const DEF_BY_ID = new Map(HOT_BOARD_DEFS.map(def => [def.id, def]));
export const DEFAULT_HOT_SOURCES = HOT_BOARD_DEFS.map(def => def.id);

// ---------------------------------------------------------------------------
// 跨平台同频热点
// ---------------------------------------------------------------------------

const PUNCT_RE = /[\s#＃"'“”‘’《》<>【】\[\]()（）,，.。!！?？:：;；、·…—_/|-]+/g;
const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
const FUNCTION_CHARS = new Set(
  '如何评价怎么看为什么哪些是否这那我们他们你一个已经还就可以没有不因为所以如果但能会有的了在和与及吗呢吧啊'.split('')
);

export function normalizeTitle(title: string): string {
  return String(title ?? '').toLowerCase().replace(PUNCT_RE, '');
}

function shingles(text: string): Set<string> {
  if (text.length < 2) return new Set(text ? [text] : []);
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

export function titlesMatch(a: string, b: string): boolean {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  const sa = shingles(left);
  const sb = shingles(right);
  if (!sa.size || !sb.size) return false;
  let intersection = 0;
  for (const value of sa) {
    if (sb.has(value)) intersection += 1;
  }
  const dice = (2 * intersection) / (sa.size + sb.size);
  return dice >= 0.6;
}

/**
 * 提取榜单标题中的显著词：中文二元组（跳过纯虚词组合）+ 英文/数字 token。
 */
export function salientTerms(title: string): Set<string> {
  const text = String(title ?? '').toLowerCase();
  const terms = new Set<string>();

  for (const match of text.matchAll(CJK_RUN_RE)) {
    const run = match[0];
    for (let i = 0; i < run.length - 1; i += 1) {
      const pair = run.slice(i, i + 2);
      if (FUNCTION_CHARS.has(pair[0]) && FUNCTION_CHARS.has(pair[1])) continue;
      terms.add(pair);
    }
  }

  for (const token of text.match(/[a-z0-9]+/g) ?? []) {
    if (token.length >= 2) terms.add(token);
  }
  return terms;
}

function idfTable(termSets: Set<string>[]): Map<string, number> {
  const total = Math.max(1, termSets.length);
  const freq = new Map<string, number>();
  for (const terms of termSets) {
    for (const term of terms) {
      freq.set(term, (freq.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, count] of freq) {
    idf.set(term, Math.log(total / count));
  }
  return idf;
}

export function salientSimilarity(a: Set<string>, b: Set<string>, idf: Map<string, number>): number {
  let sharedWeight = 0;
  let sharedCount = 0;
  for (const term of a) {
    if (b.has(term)) {
      sharedWeight += idf.get(term) ?? 0;
      sharedCount += 1;
    }
  }
  if (sharedCount < 2) return 0;

  let weightA = 0;
  for (const term of a) weightA += idf.get(term) ?? 0;
  let weightB = 0;
  for (const term of b) weightB += idf.get(term) ?? 0;

  const denominator = Math.min(weightA, weightB);
  return denominator > 0 ? sharedWeight / denominator : 0;
}

const SALIENT_MATCH_THRESHOLD = 0.45;

interface MergeEntry {
  platform: string;
  item: HotBoardItem;
  size: number;
}

/**
 * 只在不同榜单之间合并同一事件；RSS / HN 不参与话题聚类。
 */
export function mergeTopics(boards: Record<string, HotBoard>): HotTopic[] {
  const entries: MergeEntry[] = [];

  for (const [platform, board] of Object.entries(boards)) {
    if (board.kind !== 'board' || platform === 'hackernews') continue;
    const items = board.items ?? [];
    for (const item of items) {
      if (item.pinned) continue;
      entries.push({ platform, item, size: items.length });
    }
  }
  if (entries.length < 2) return [];

  const termSets = entries.map(entry => salientTerms(entry.item.title));
  const idf = idfTable(termSets);
  const parent = entries.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[i].platform === entries[j].platform) continue;
      if (
        titlesMatch(entries[i].item.title, entries[j].item.title) ||
        salientSimilarity(termSets[i], termSets[j], idf) >= SALIENT_MATCH_THRESHOLD
      ) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < entries.length; index += 1) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(index);
    groups.set(root, group);
  }

  const topics: HotTopic[] = [];
  for (const members of groups.values()) {
    const platforms = new Set(members.map(index => entries[index].platform));
    if (platforms.size < 2) continue;

    let score = 0;
    let bestIndex = members[0];
    let bestPosition = -1;
    const mentions: HotTopicMention[] = [];

    for (const index of members) {
      const { platform, item, size } = entries[index];
      const position = 1 - (Math.max(1, item.rank) - 1) / Math.max(1, size);
      score += position;
      mentions.push({
        platform,
        label: boards[platform]?.label ?? platform,
        rank: item.rank,
        title: item.title,
        url: item.url,
        hotValue: item.hotValue ?? null,
      });
      if (position > bestPosition) {
        bestPosition = position;
        bestIndex = index;
      }
    }

    mentions.sort((a, b) => a.rank - b.rank);
    const best = entries[bestIndex];
    topics.push({
      title: best.item.title,
      url: best.item.url,
      platformCount: platforms.size,
      score: Math.round((score + 0.75 * (platforms.size - 1)) * 100) / 100,
      mentions,
    });
  }

  return topics.sort((a, b) => b.platformCount - a.platformCount || b.score - a.score);
}

// ---------------------------------------------------------------------------
// 快照与缓存
// ---------------------------------------------------------------------------

export interface GetHotBoardOptions {
  refresh?: boolean;
  sources?: string[];
  limit?: number;
}

const CACHE_TTL_MS = Number(process.env.HOT_BOARD_CACHE_TTL_MS || 5 * 60 * 1000);
const EMPTY_CACHE_TTL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const snapshotCache = new Map<string, { snapshot: HotBoardSnapshot; expiresAt: number }>();
const inflight = new Map<string, Promise<HotBoardSnapshot>>();

function resolveSources(raw?: string[]): string[] {
  const requested = raw?.map(id => id.trim().toLowerCase()).filter(Boolean);
  if (!requested?.length) return DEFAULT_HOT_SOURCES;
  const known = requested.filter(id => DEF_BY_ID.has(id));
  return known.length ? [...new Set(known)] : DEFAULT_HOT_SOURCES;
}

function clampLimit(limit?: number): number {
  const value = Number.isFinite(limit) ? Number(limit) : 20;
  return Math.min(Math.max(value, 5), 50);
}

export async function fetchHotBoards(
  sourceIds: string[],
  limit: number
): Promise<Record<string, HotBoard>> {
  const boards: Record<string, HotBoard> = {};

  await Promise.all(
    sourceIds.map(async id => {
      const def = DEF_BY_ID.get(id);
      if (!def) return;

      const { items, status } = await runSource(`hot:${def.id}`, () => def.fetch(limit), {
        label: def.label,
        timeoutMs: FETCH_TIMEOUT_MS,
      });

      boards[def.id] = {
        label: def.label,
        code: def.code,
        kind: def.kind,
        group: def.group,
        items,
        error: items.length ? null : status.error ?? (status.state === 'timeout' ? '请求超时' : '未返回条目'),
      };
    })
  );

  // 保持固定展示顺序
  const ordered: Record<string, HotBoard> = {};
  for (const def of HOT_BOARD_DEFS) {
    if (boards[def.id]) ordered[def.id] = boards[def.id];
  }
  return ordered;
}

async function buildSnapshot(sources: string[], limit: number): Promise<HotBoardSnapshot> {
  const boards = await fetchHotBoards(sources, limit);
  return {
    generatedAt: new Date().toISOString(),
    boards,
    topics: mergeTopics(boards),
  };
}

export function getHotBoard(options: GetHotBoardOptions = {}): Promise<HotBoardSnapshot> {
  const sources = resolveSources(options.sources);
  const limit = clampLimit(options.limit);
  const key = `${sources.join(',')}|${limit}`;
  const now = Date.now();

  if (!options.refresh) {
    const hit = snapshotCache.get(key);
    if (hit && hit.expiresAt > now) {
      return Promise.resolve(hit.snapshot);
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = buildSnapshot(sources, limit)
    .then(snapshot => {
      const hasItems = Object.values(snapshot.boards).some(board => board.items.length > 0);
      snapshotCache.set(key, {
        snapshot,
        expiresAt: Date.now() + (hasItems ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS),
      });
      return snapshot;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
