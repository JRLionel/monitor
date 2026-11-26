import type { AIAnalysis } from '../types.js';
import { getChatProvider } from './llm/registry.js';

// ========== Query Expansion（查询扩展） ==========

/**
 * 使用 AI 将关键词扩展为多个变体，用于文本预过滤。
 * 返回扩展后的关键词列表（含原始关键词）。
 * 结果会被缓存，同一关键词不会重复调用 AI。
 */
const expansionCache = new Map<string, string[]>();

export async function expandKeyword(keyword: string): Promise<string[]> {
  // 缓存命中
  if (expansionCache.has(keyword)) {
    return expansionCache.get(keyword)!;
  }

  // 不管 AI 是否可用，先提取基础核心词
  const coreTerms = extractCoreTerms(keyword);

  const active = await getChatProvider();

  if (!active) {
    const result = [keyword, ...coreTerms];
    expansionCache.set(keyword, result);
    return result;
  }

  try {
    const rawContent = await active.provider.chat({
      model: active.model,
      messages: [
        {
          role: 'system',
          content: `你是一个搜索查询扩展专家。给定一个监控关键词，生成该关键词的变体和相关检索词，用于文本匹配。

规则：
1. 包含原始关键词的各种写法（大小写、空格、连字符变体）
2. 包含关键词的核心组成词（拆分后的各个有意义的词）
3. 包含常见别称、缩写、中英文对照
4. 不要加入泛化词（比如关键词是"Claude Sonnet 4.6"，不要加"AI模型"这种泛化词）
5. 总数控制在 5-15 个

输出 JSON 数组，只输出 JSON，不要有其他内容。
示例输入："Claude Sonnet 4.6"
示例输出：["Claude Sonnet 4.6", "Claude Sonnet", "Sonnet 4.6", "claude-sonnet-4.6", "Claude 4.6", "Anthropic Sonnet"]`
        },
        {
          role: 'user',
          content: keyword
        }
      ],
      temperature: 0.2,
      maxTokens: 300
    });

    const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed: string[] = JSON.parse(jsonMatch[0]);
      // 确保原始关键词和核心词都在列表中
      const expanded = [...new Set([keyword, ...coreTerms, ...parsed.map(s => s.trim()).filter(Boolean)])];
      expansionCache.set(keyword, expanded);
      console.log(`  🔍 Query expansion for "${keyword}": ${expanded.length} variants`);
      return expanded;
    }
  } catch (error) {
    console.error('Query expansion failed:', error);
  }

  // Fallback：使用基础核心词
  const fallback = [keyword, ...coreTerms];
  expansionCache.set(keyword, fallback);
  return fallback;
}

/**
 * 从关键词中提取核心词（纯文本方式，不依赖 AI）
 */
function extractCoreTerms(keyword: string): string[] {
  const terms: string[] = [];
  // 按空格、连字符、下划线分割
  const parts = keyword.split(/[\s\-_\/\\·]+/).filter(p => p.length >= 2);
  if (parts.length > 1) {
    terms.push(...parts);
    // 两两组合
    for (let i = 0; i < parts.length - 1; i++) {
      terms.push(parts[i] + ' ' + parts[i + 1]);
    }
  }
  // 去重，排除原始关键词本身
  return [...new Set(terms)].filter(t => t.toLowerCase() !== keyword.toLowerCase());
}

// ========== 关键词预匹配 ==========

/**
 * 检查文本中是否包含任一扩展关键词（不区分大小写）。
 * 返回是否匹配以及匹配到的词。
 */
export function preMatchKeyword(text: string, expandedKeywords: string[]): { matched: boolean; matchedTerms: string[] } {
  const lowerText = text.toLowerCase();
  const matchedTerms: string[] = [];
  for (const kw of expandedKeywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matchedTerms.push(kw);
    }
  }
  return { matched: matchedTerms.length > 0, matchedTerms };
}

// ========== AI 内容分析（关键词感知） ==========

function buildAnalysisPrompt(keyword: string, preMatchResult: { matched: boolean; matchedTerms: string[] }): string {
  const matchHint = preMatchResult.matched 
    ? `\n注意：文本预匹配发现内容中包含以下关键词变体：${preMatchResult.matchedTerms.join('、')}` 
    : `\n注意：文本预匹配发现内容中未直接提及关键词"${keyword}"的任何变体，请特别严格审核相关性。`;

  return `你是一个热点内容精准匹配专家。你的任务是判断一段内容是否与指定的监控关键词【${keyword}】直接相关。

${matchHint}

分析要点：
1. 判断是否为真实有价值的信息（排除标题党、假新闻、营销软文）
2. 判断内容是否【直接】涉及关键词"${keyword}"。注意：
   - 仅仅属于同一领域但未提及关键词的内容，相关性应低于 40 分
   - 内容必须直接讨论、提及或与"${keyword}"有实质关联才能获得 60 分以上
   - 只是间接沾边（如同类产品、同领域但不同主题）应给 30-50 分
3. 判断内容中是否直接提及了"${keyword}"或其等价表述（keywordMentioned）
4. 评估热点的重要程度（对关注"${keyword}"的人来说有多重要）
5. 用一句话说明此内容与"${keyword}"的关系（不是介绍内容本身，而是说"此内容与关键词的关联是什么"）
6. 用一句话解释你的相关性打分理由

请以 JSON 格式输出：
{
  "isReal": true/false,
  "relevance": 0-100,
  "relevanceReason": "相关性打分理由...",
  "keywordMentioned": true/false,
  "importance": "low/medium/high/urgent",
  "summary": "此内容与【${keyword}】的关联：..."
}

只输出 JSON，不要有其他内容。`;
}

function clampRelevance(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function normalizeImportance(value: unknown): AIAnalysis['importance'] {
  return ['low', 'medium', 'high', 'urgent'].includes(String(value))
    ? String(value) as AIAnalysis['importance']
    : 'low';
}

/**
 * 解析模型返回的分析结果。
 * 兼容 markdown 代码块，以及被 max_tokens 截断（缺少闭合大括号）的 JSON。
 * 无法解析时返回 null，由调用方走 fallback。
 */
function parseAnalysisResponse(raw: string): AIAnalysis | null {
  const text = raw.trim();
  if (!text) return null;

  // 去掉 ```json ``` 包裹
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;

  const start = source.indexOf('{');
  if (start === -1) return null;
  const end = source.lastIndexOf('}');

  // 情况一：完整 JSON
  if (end > start) {
    try {
      const parsed = JSON.parse(source.slice(start, end + 1));
      return {
        isReal: Boolean(parsed.isReal),
        relevance: clampRelevance(parsed.relevance),
        relevanceReason: String(parsed.relevanceReason ?? '').slice(0, 200),
        keywordMentioned: Boolean(parsed.keywordMentioned),
        importance: normalizeImportance(parsed.importance),
        summary: String(parsed.summary ?? '').slice(0, 150)
      };
    } catch {
      // 继续尝试截断兜底
    }
  }

  // 情况二：输出被截断，按字段兜底提取
  const relevanceMatch = source.match(/"relevance"\s*:\s*(-?\d+(?:\.\d+)?)/);
  if (!relevanceMatch) return null;

  const readString = (field: string): string => {
    const match = source.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"?`));
    return match
      ? match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
      : '';
  };
  const readBool = (field: string, fallback: boolean): boolean => {
    const match = source.match(new RegExp(`"${field}"\\s*:\\s*(true|false)`));
    return match ? match[1] === 'true' : fallback;
  };
  const importanceMatch = source.match(/"importance"\s*:\s*"?(low|medium|high|urgent)"?/);

  return {
    isReal: readBool('isReal', true),
    relevance: clampRelevance(relevanceMatch[1]),
    relevanceReason: readString('relevanceReason').slice(0, 200),
    keywordMentioned: readBool('keywordMentioned', false),
    importance: normalizeImportance(importanceMatch?.[1]),
    summary: readString('summary').slice(0, 150)
  };
}

export async function analyzeContent(content: string, keyword: string, preMatchResult?: { matched: boolean; matchedTerms: string[] }): Promise<AIAnalysis> {
  // 默认预匹配结果
  const matchResult = preMatchResult ?? { matched: false, matchedTerms: [] };

  const active = await getChatProvider();

  if (!active) {
    console.warn('未配置 AI 模型服务商，使用 fallback 分析');
    return {
      isReal: true,
      relevance: matchResult.matched ? 50 : 20,
      relevanceReason: '未配置 AI 服务，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: content.slice(0, 50) + '...'
    };
  }

  try {
    const prompt = buildAnalysisPrompt(keyword, matchResult);

    const responseContent = await active.provider.chat({
      model: active.model,
      messages: [
        {
          role: 'system',
          content: prompt
        },
        {
          role: 'user',
          content: content.slice(0, 2000) // 限制内容长度
        }
      ],
      temperature: 0.2, // 降低温度，提高判断一致性
      // 推理模型的 reasoning_tokens 与正文共用该预算，500 容易被截断导致 JSON 不完整
      maxTokens: 1200
    });

    const analysis = parseAnalysisResponse(responseContent);
    if (analysis) {
      return analysis;
    }

    console.warn(`AI 响应无法解析，使用 fallback。响应片段：${responseContent.slice(0, 200)}`);
  } catch (error) {
    console.error('AI analysis failed:', error instanceof Error ? error.message : error);
  }

  // Fallback
  return {
    isReal: true,
    relevance: matchResult.matched ? 30 : 10,
    relevanceReason: 'AI 分析失败，使用默认分数',
    keywordMentioned: matchResult.matched,
    importance: 'low',
    summary: content.slice(0, 50) + '...'
  };
}

// ========== 扫描汇总简报（每轮扫描只发一封邮件） ==========

export interface DigestItem {
  index: number;
  keyword: string;
  source: string;
  importance: string;
  relevance: number;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date | null;
}

export interface DigestTopic {
  headline: string;
  level: AIAnalysis['importance'];
  analysis: string;
  itemIndexes: number[];
}

export interface ScanDigest {
  subject: string;
  overview: string;
  topics: DigestTopic[];
  watchlist: string;
  generatedBy: 'ai' | 'fallback';
}

const IMPORTANCE_WEIGHT: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const MAX_DIGEST_ITEMS = 60;
const MAX_DIGEST_TOPICS = 5;

const DIGEST_SYSTEM_PROMPT = `你是「热点雷达」的简报编辑。系统每隔一段时间扫描一批监控关键词，刚从多个来源（Twitter/X、Hacker News、掘金、GitHub、CSDN 等）采集到一批新热点。你的任务是把这批零散条目整理成一封可以直接发给订阅者的中文简报。

写作要求：
1. 只基于给定条目，不臆测、不补充外部信息，不编造数字、时间、人物、引语。
2. 先合并讲同一件事的条目（跨来源重复报道），以"事件/主题"为单位组织，而不是逐条罗列。
3. 重要性排序：urgent > high > medium > low；同级别下，优先多来源共同报道、相关性评分更高的条目。
4. 主题数量 1-5 个。条目少时不要硬凑：只有 1 条就只写 1 个主题。
5. 语言简洁、客观、信息密度高；避免"震惊""炸裂""必看"等情绪化或营销化用词。
6. 每个主题必须给出所属条目的 index（见输入条目前的 [i] 编号），用于回链原文，严禁虚构输入中不存在的 index。
7. 全部使用简体中文；产品名、公司名、人名等专有名词保留原文写法。

只输出 JSON，不要 markdown 代码块围栏，不要任何解释性文字。

输出格式：
{
  "subject": "一句话概括本轮最重要的事，不超过 24 字",
  "overview": "本轮整体情况，2-3 句：热点集中在哪些方向、有无突发事件、跟监控关键词的关系",
  "topics": [
    {
      "headline": "主题标题，不超过 20 字，尽量动宾结构，如「Anthropic 发布 Claude Opus 4.5」",
      "level": "urgent | high | medium | low",
      "analysis": "2-3 句：发生了什么、为什么值得关注、对关注这些关键词的人意味着什么（不超过 120 字）",
      "itemIndexes": [0, 3, 5]
    }
  ],
  "watchlist": "可选，一句话提示值得后续跟踪的线索；没有则给空字符串"
}`;

function truncateText(text: string | null | undefined, max: number): string {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function buildDigestInput(items: DigestItem[], keywords: string[], scanTime: Date): string {
  const lines = items.slice(0, MAX_DIGEST_ITEMS).map(item => {
    const time = item.publishedAt
      ? item.publishedAt.toISOString().slice(0, 16).replace('T', ' ')
      : '未知';
    return `[${item.index}] ${item.keyword} | ${item.source} | ${item.importance} | ${item.relevance} | ${truncateText(item.title, 80)} | ${truncateText(item.summary, 100)} | ${time}`;
  });

  return `扫描时间：${scanTime.toLocaleString('zh-CN')}
监控关键词：${keywords.join('、')}
本轮新增热点：${items.length} 条

条目列表（每行一条，格式：[index] 关键词 | 来源 | 重要度 | 相关性 | 标题 | 摘要 | 发布时间）：
${lines.join('\n')}`;
}

/**
 * 解析模型返回的简报 JSON。
 * topics 中的 itemIndexes 会按输入条目做合法性过滤，防止前端回链到不存在的条目。
 */
function parseDigestResponse(raw: string, items: DigestItem[]): ScanDigest | null {
  const text = raw.trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }

  const validIndexes = new Set(items.map(item => item.index));

  const topics = (Array.isArray(parsed.topics) ? parsed.topics : [])
    .map(topic => {
      const raw = (topic ?? {}) as Record<string, unknown>;
      const itemIndexes = (Array.isArray(raw.itemIndexes) ? raw.itemIndexes : [])
        .map(Number)
        .filter(index => validIndexes.has(index));
      return {
        headline: truncateText(String(raw.headline ?? ''), 40),
        level: normalizeImportance(raw.level),
        analysis: truncateText(String(raw.analysis ?? ''), 300),
        itemIndexes: [...new Set(itemIndexes)]
      };
    })
    .filter(topic => topic.headline && topic.analysis)
    .slice(0, MAX_DIGEST_TOPICS);

  const overview = truncateText(String(parsed.overview ?? ''), 400);
  if (!overview && topics.length === 0) return null;

  return {
    subject: truncateText(String(parsed.subject ?? ''), 40) || `本轮新增 ${items.length} 条热点`,
    overview,
    topics,
    watchlist: truncateText(String(parsed.watchlist ?? ''), 120),
    generatedBy: 'ai'
  };
}

/** AI 不可用或解析失败时的兜底简报：按重要度排序，每条热点单独成段 */
function buildFallbackDigest(items: DigestItem[], meta: { keywords: string[]; scanTime: Date }): ScanDigest {
  const sorted = [...items].sort((a, b) => {
    const weightDiff = (IMPORTANCE_WEIGHT[a.importance] ?? 3) - (IMPORTANCE_WEIGHT[b.importance] ?? 3);
    return weightDiff !== 0 ? weightDiff : b.relevance - a.relevance;
  });

  const keywords = [...new Set(items.map(item => item.keyword))];
  const sources = [...new Set(items.map(item => item.source))];

  return {
    subject: `本轮新增 ${items.length} 条热点`,
    overview: `本轮扫描共发现 ${items.length} 条新热点，覆盖 ${keywords.length} 个关键词、${sources.length} 个来源。热点集中在：${keywords.slice(0, 3).join('、')}${keywords.length > 3 ? ' 等' : ''}。扫描时间 ${meta.scanTime.toLocaleString('zh-CN')}。`,
    topics: sorted.slice(0, MAX_DIGEST_TOPICS).map(item => ({
      headline: truncateText(item.title, 40),
      level: normalizeImportance(item.importance),
      analysis: truncateText(item.summary ?? item.title, 300),
      itemIndexes: [item.index]
    })),
    watchlist: '',
    generatedBy: 'fallback'
  };
}

/**
 * 将一轮扫描新增的热点汇总成一封简报（只做一次 AI 调用）。
 * 未配置模型或调用失败时自动退回模板化摘要，保证邮件仍可发送。
 */
export async function summarizeScanDigest(
  items: DigestItem[],
  meta: { keywords: string[]; scanTime: Date }
): Promise<ScanDigest> {
  const fallback = buildFallbackDigest(items, meta);

  const active = await getChatProvider();
  if (!active) {
    return fallback;
  }

  try {
    const rawContent = await active.provider.chat({
      model: active.model,
      messages: [
        { role: 'system', content: DIGEST_SYSTEM_PROMPT },
        { role: 'user', content: buildDigestInput(items, meta.keywords, meta.scanTime) }
      ],
      temperature: 0.3,
      maxTokens: 1500
    });

    const digest = parseDigestResponse(rawContent, items);
    if (digest) {
      return digest;
    }
    console.warn(`简报响应无法解析，使用 fallback。响应片段：${rawContent.slice(0, 200)}`);
  } catch (error) {
    console.error('Scan digest summary failed:', error instanceof Error ? error.message : error);
  }

  return fallback;
}

export async function batchAnalyze(contents: string[], keyword: string, expandedKeywords?: string[]): Promise<AIAnalysis[]> {
  // 并行分析，但限制并发数
  const batchSize = 3;
  const results: AIAnalysis[] = [];

  for (let i = 0; i < contents.length; i += batchSize) {
    const batch = contents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(content => {
        const preMatch = expandedKeywords 
          ? preMatchKeyword(content, expandedKeywords) 
          : undefined;
        return analyzeContent(content, keyword, preMatch);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
