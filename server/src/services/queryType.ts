export type QueryType =
  | 'product'
  | 'concept'
  | 'opinion'
  | 'how_to'
  | 'comparison'
  | 'breaking_news'
  | 'prediction';

const COMPARISON_PATTERNS =
  /(?:\b(vs\.?|versus|compared to|comparison|better than|difference between|switch from)\b|对比|比较|好还是|区别|选择)/i;
const HOWTO_PATTERNS =
  /(?:\b(how to|tutorial|step by step|setup|install|configure|deploy|migrate|implement|build a|create a|prompting|prompts?|best practices|tips|examples|animation|animations|video workflow|render pipeline)\b|怎么|如何|教程|步骤|安装|配置|部署|搭建)/i;
const PRODUCT_PATTERNS =
  /(?:\b(price|pricing|cost|buy|purchase|deal|discount|subscription|plan|tier|free tier|alternative|prompt|prompts|prompting|template|templates)\b|价格|购买|优惠|折扣|订阅|免费|替代|推荐)/i;
const OPINION_PATTERNS =
  /(?:\b(worth it|thoughts on|opinion|review|experience with|recommend|should i|pros and cons|good or bad)\b|值得|怎么样|好不好|推荐|评测|体验)/i;
const PREDICTION_PATTERNS =
  /(?:\b(predict|forecast|odds|chance|probability|election|outcome|bet on|market for)\b|预测|趋势|前景|展望|走势)/i;
const CONCEPT_PATTERNS =
  /(?:\b(what is|what are|explain|definition|how does|how do|overview|introduction|guide to|primer)\b|什么是|解释|概述|介绍|入门|指南)/i;
const BREAKING_PATTERNS =
  /(?:\b(latest|breaking|just announced|launched|released|new|update|news|happened|today|this week)\b|最新|最近|刚刚|发布|上线|更新|消息|今天|本周)/i;

/**
 * 纯规则识别查询意图，不调 AI。
 * 优先级：comparison > how_to > product > opinion > prediction > concept > breaking_news
 */
export function detectQueryType(topic: string): QueryType {
  if (COMPARISON_PATTERNS.test(topic)) return 'comparison';
  if (HOWTO_PATTERNS.test(topic)) return 'how_to';
  if (PRODUCT_PATTERNS.test(topic)) return 'product';
  if (OPINION_PATTERNS.test(topic)) return 'opinion';
  if (PREDICTION_PATTERNS.test(topic)) return 'prediction';
  if (CONCEPT_PATTERNS.test(topic)) return 'concept';
  if (BREAKING_PATTERNS.test(topic)) return 'breaking_news';
  return 'breaking_news';
}

/**
 * 当前项目可用数据源在不同查询意图下的优先级（数字越小越靠前）。
 * 与 last30days 的 tier 思路一致，但不直接丢弃数据源，避免降低召回。
 */
export const SOURCE_PRIORITY_BY_QUERY_TYPE: Record<QueryType, Record<string, number>> = {
  breaking_news: { twitter: 0, weibo: 1, bing: 2, sogou: 3, hackernews: 4, bilibili: 5 },
  product: { weibo: 0, bilibili: 1, twitter: 2, sogou: 3, bing: 4, hackernews: 5 },
  opinion: { weibo: 0, twitter: 1, bilibili: 2, sogou: 3, bing: 4, hackernews: 5 },
  how_to: { bilibili: 0, sogou: 1, bing: 2, twitter: 3, weibo: 4, hackernews: 5 },
  comparison: { bilibili: 0, sogou: 1, twitter: 2, weibo: 3, bing: 4, hackernews: 5 },
  concept: { sogou: 0, bing: 1, twitter: 2, weibo: 3, bilibili: 4, hackernews: 5 },
  prediction: { weibo: 0, sogou: 1, twitter: 2, bing: 3, bilibili: 4, hackernews: 5 },
};

const FALLBACK_PRIORITY: Record<string, number> = {
  twitter: 1,
  weibo: 2,
  bilibili: 3,
  hackernews: 4,
  sogou: 5,
  bing: 6,
  google: 7,
  duckduckgo: 8,
};

export function sourcePriority(source: string, queryType?: QueryType): number {
  if (queryType) {
    const priority = SOURCE_PRIORITY_BY_QUERY_TYPE[queryType]?.[source];
    if (priority !== undefined) return priority;
  }
  return FALLBACK_PRIORITY[source] ?? 99;
}
