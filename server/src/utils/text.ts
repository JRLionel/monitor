const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_RE = /[a-z0-9]+/g;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'how', 'is', 'in', 'of', 'on',
  'and', 'with', 'from', 'by', 'at', 'this', 'that', 'it', 'my',
  'your', 'i', 'me', 'we', 'you', 'what', 'are', 'do', 'can',
  'its', 'be', 'or', 'not', 'no', 'so', 'if', 'but', 'about',
  'all', 'just', 'get', 'has', 'have', 'was', 'will', 'show', 'hn',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '上', '也', '到',
  '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她', '很', '么',
  '那', '这个', '那个', '什么', '怎么', '为什么', '以及', '或者', '但是', '因为', '所以',
  '如果', '可以', '这样', '那样', '他们', '我们', '你们', '它', '吗', '呢', '吧', '啊',
  '哦', '嗯', '与', '及', '等', '被', '把', '让', '给', '向', '还', '再', '又', '从',
  '对', '为', '以', '之', '其', '中', '最',
]);

const LOW_SIGNAL_QUERY_TOKENS = new Set([
  'advice', 'animation', 'animations', 'best', 'chance', 'chances',
  'code', 'compare', 'comparison', 'differences', 'explain', 'guide',
  'guides', 'how', 'latest', 'news', 'odds', 'opinion', 'opinions',
  'prediction', 'predictions', 'probability', 'probabilities', 'prompt',
  'prompting', 'prompts', 'rate', 'review', 'reviews', 'thoughts',
  'tip', 'tips', 'tutorial', 'tutorials', 'update', 'updates', 'use',
  'using', 'versus', 'vs', 'worth',
  '建议', '推荐', '教程', '评测', '对比', '最新', '消息', '更新', '分享', '经验',
]);

const SYNONYMS: Record<string, string[]> = {
  hip: ['rap', 'hiphop'],
  hop: ['rap', 'hiphop'],
  rap: ['hip', 'hop', 'hiphop'],
  hiphop: ['rap', 'hip', 'hop'],
  js: ['javascript'],
  javascript: ['js'],
  ts: ['typescript'],
  typescript: ['ts'],
  ai: ['artificial', 'intelligence', '人工智能', '机器学习', '深度学习'],
  artificial: ['ai', 'intelligence'],
  intelligence: ['ai', 'artificial'],
  ml: ['machine', 'learning'],
  machine: ['ml', 'learning'],
  learning: ['ml', 'machine'],
  react: ['reactjs'],
  reactjs: ['react'],
  svelte: ['sveltejs'],
  sveltejs: ['svelte'],
  vue: ['vuejs'],
  vuejs: ['vue'],
  人工智能: ['ai', '机器学习', '深度学习'],
  机器学习: ['ai', '人工智能', '深度学习'],
  深度学习: ['ai', '人工智能', '机器学习'],
};

let wordSegmenter: { segment(input: string): Iterable<{ segment: string }> } | null = null;
try {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: object) => any }).Segmenter;
  if (Segmenter) {
    wordSegmenter = new Segmenter('zh', { granularity: 'word' });
  }
} catch {
  wordSegmenter = null;
}

export function hasCJK(text: string): boolean {
  return Boolean(text) && CJK_RE.test(text);
}

function cjkTokens(run: string): string[] {
  if (wordSegmenter) {
    const tokens: string[] = [];
    for (const part of wordSegmenter.segment(run)) {
      const word = part.segment.trim();
      if (word) tokens.push(word);
    }
    if (tokens.length) return tokens;
  }
  if (run.length <= 1) return run ? [run] : [];
  const bigrams: string[] = [];
  for (let i = 0; i < run.length - 1; i += 1) {
    bigrams.push(run.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * 中英文混合分词。中文优先用 Intl.Segmenter（Node 18+ 内置），
 * 不可用时退化为字符二元组，避免引入 jieba 依赖。
 */
export function segment(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  if (!hasCJK(lower)) {
    return lower.match(LATIN_RE) ?? [];
  }

  const tokens: string[] = [];
  let position = 0;
  for (const match of lower.matchAll(CJK_RUN_RE)) {
    const start = match.index ?? 0;
    if (start > position) {
      tokens.push(...(lower.slice(position, start).match(LATIN_RE) ?? []));
    }
    tokens.push(...cjkTokens(match[0]));
    position = start + match[0].length;
  }
  if (position < lower.length) {
    tokens.push(...(lower.slice(position).match(LATIN_RE) ?? []));
  }
  return tokens;
}

function keepToken(token: string): boolean {
  if (!token || STOPWORDS.has(token)) return false;
  if (hasCJK(token)) return true;
  return token.length > 1;
}

function expandSynonyms(tokens: Set<string>): Set<string> {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of SYNONYMS[token] ?? []) {
      expanded.add(synonym);
    }
  }
  return expanded;
}

export function tokenize(text: string): Set<string> {
  const tokens = new Set(segment(text).filter(keepToken));
  return expandSynonyms(tokens);
}

function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 查询中心的相关性打分，0~1。
 * 公式与 last30days 保持一致：覆盖度 + 有效词覆盖 + 精确度 + 短语加成。
 */
export function tokenOverlapRelevance(query: string, text: string, hashtags?: string[]): number {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return 0.5;

  let combined = text;
  if (hashtags?.length) {
    combined = `${text} ${hashtags.join(' ')}`;
  }
  const textTokens = tokenize(combined);

  if (hashtags?.length) {
    for (const tag of hashtags) {
      const lowerTag = tag.toLowerCase();
      for (const queryToken of queryTokens) {
        if (lowerTag.includes(queryToken) && queryToken !== lowerTag) {
          textTokens.add(queryToken);
        }
      }
    }
  }

  const overlapTokens = [...queryTokens].filter(token => textTokens.has(token));
  const overlap = overlapTokens.length;
  if (overlap === 0) return 0;

  let informative = new Set([...queryTokens].filter(token => !LOW_SIGNAL_QUERY_TOKENS.has(token)));
  if (informative.size === 0) informative = queryTokens;

  const coverage = overlap / queryTokens.size;
  const informativeOverlap =
    [...informative].filter(token => textTokens.has(token)).length / informative.size;
  const precisionDenominator = Math.min(textTokens.size, queryTokens.size + 4) || 1;
  const precision = overlap / precisionDenominator;

  let phraseBonus = 0;
  const normalizedQuery = normalizePhrase(query);
  const normalizedText = normalizePhrase(combined);
  if (normalizedQuery && normalizedText.includes(normalizedQuery)) {
    phraseBonus = normalizedQuery.split(' ').length > 1 ? 0.12 : 0.16;
  } else if (hasCJK(query)) {
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    const compactText = normalizedText.replace(/\s+/g, '');
    if (compactQuery && compactText.includes(compactQuery)) {
      phraseBonus = 0.16;
    }
  }

  const base =
    0.55 * Math.pow(coverage, 1.35) +
    0.25 * informativeOverlap +
    0.20 * precision;

  if (informative.size && ![...informative].some(token => textTokens.has(token))) {
    return Math.round(Math.min(0.24, base) * 100) / 100;
  }

  return Math.round(Math.min(1, base + phraseBonus) * 100) / 100;
}

export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getNgrams(text: string, n = 3): Set<string> {
  const normalized = normalizeForCompare(text);
  if (normalized.length < n) {
    return new Set(normalized ? [normalized] : []);
  }
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - n; i += 1) {
    grams.add(normalized.slice(i, i + n));
  }
  return grams;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

/**
 * 去掉查询词本身。每个结果天然都包含关键词，
 * 它不能证明两条内容在讲同一件事。
 */
export function stripQueryTerms(text: string, query?: string): string {
  if (!query || !text) return text;
  const lowered = text.toLowerCase();
  const phrases = [...new Set([query.toLowerCase(), query.toLowerCase().replace(/\s+/g, '')])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let result = lowered;
  for (const phrase of phrases) {
    result = result.split(phrase).join(' ');
  }
  const queryTokens = new Set(segment(query.toLowerCase()));
  return segment(result)
    .filter(token => !queryTokens.has(token))
    .join(' ');
}

export function hybridSimilarity(a: string, b: string): number {
  return Math.max(jaccardSimilarity(getNgrams(a), getNgrams(b)), tokenJaccard(a, b));
}

function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(segment(a.toLowerCase()).filter(token => !STOPWORDS.has(token) && (hasCJK(token) || token.length > 1)));
  const tokensB = new Set(segment(b.toLowerCase()).filter(token => !STOPWORDS.has(token) && (hasCJK(token) || token.length > 1)));
  return jaccardSimilarity(tokensA, tokensB);
}

export function eventSimilarity(a: string, b: string, query?: string): number {
  const left = query ? stripQueryTerms(a, query) : a;
  const right = query ? stripQueryTerms(b, query) : b;
  if (query) {
    const leftSize = segment(left).length;
    const rightSize = segment(right).length;
    if (leftSize < 2 || rightSize < 2) return 0;
  }
  return hybridSimilarity(left, right);
}
