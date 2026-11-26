import { Server } from 'socket.io';
import { prisma } from '../db.js';
import { searchTwitter } from '../services/twitter.js';
import { searchHackerNews } from '../services/search.js';
import { searchJuejin } from '../services/juejin.js';
import { searchGitHub, searchCSDN } from '../services/techSearch.js';
import { analyzeContent, expandKeyword, preMatchKeyword, summarizeScanDigest, type DigestItem } from '../services/ai.js';
import { sendScanDigestEmail } from '../services/email.js';
import { clusterByEvent, dedupeItems, linkCrossSources } from '../services/dedupe.js';
import { detectQueryType, sourcePriority, type QueryType } from '../services/queryType.js';
import { cacheKey } from '../services/cache.js';
import { runSource, sourceStatusRegistry } from '../services/sourceStatus.js';
import type { SearchResult } from '../types.js';

// 新鲜度过滤：丢弃超过指定小时数的内容
// Twitter 层面已通过 since: 限制了时间范围，这里只做兜底
const MAX_AGE_HOURS = 7 * 24; // 7天
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || 20 * 60 * 1000);
const SOURCE_TIMEOUTS: Record<string, number> = {
  twitter: 30_000,
  hackernews: 20_000,
  juejin: 20_000,
  github: 25_000,
  csdn: 25_000,
};

function filterByFreshness(results: SearchResult[]): SearchResult[] {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000);
  return results.filter(item => {
    // 没有发布时间的，暂时保留
    if (!item.publishedAt) return true;
    return item.publishedAt >= cutoff;
  });
}

// 按来源优先级排序：来源基础优先级 + 查询意图动态调整
function prioritizeResults(results: SearchResult[], queryType?: QueryType): SearchResult[] {
  return [...results].sort((a, b) => {
    return sourcePriority(a.source, queryType) - sourcePriority(b.source, queryType);
  });
}

export async function runHotspotCheck(io: Server): Promise<void> {
  console.log('🔍 Starting hotspot check...');

  // 获取所有激活的关键词
  const keywords = await prisma.keyword.findMany({
    where: { isActive: true }
  });

  if (keywords.length === 0) {
    console.log('No active keywords to monitor');
    return;
  }

  console.log(`Checking ${keywords.length} keywords...`);

  let newHotspotsCount = 0;
  // 本轮新增热点，扫描结束后统一汇总成一封邮件
  const digestItems: DigestItem[] = [];

  for (const keyword of keywords) {
    console.log(`\n📎 Checking keyword: "${keyword.text}"`);

    try {
      // 第一步：Query Expansion（查询扩展）
      console.log(`  🔍 Expanding keyword "${keyword.text}"...`);
      const expandedKeywords = await expandKeyword(keyword.text);
      console.log(`  📋 Expanded to ${expandedKeywords.length} variants: ${expandedKeywords.slice(0, 5).join(', ')}${expandedKeywords.length > 5 ? '...' : ''}`);

      const queryType = detectQueryType(keyword.text);
      console.log(`  🧠 Query type: ${queryType}`);

      // 第二步：从多个技术来源并行获取数据（社区讨论 + 开源项目 + 中文技术博客）
      const sourceDefs = [
        { id: 'twitter', fn: () => searchTwitter(keyword.text) },
        { id: 'hackernews', fn: () => searchHackerNews(keyword.text) },
        { id: 'juejin', fn: () => searchJuejin(keyword.text) },
        { id: 'github', fn: () => searchGitHub(keyword.text) },
        { id: 'csdn', fn: () => searchCSDN(keyword.text) },
      ] as const;

      const outcomes = await Promise.all(
        sourceDefs.map(def =>
          runSource(def.id, def.fn, {
            keyword: keyword.text,
            timeoutMs: SOURCE_TIMEOUTS[def.id],
            cacheKey: cacheKey(def.id, keyword.text),
            cacheTtlMs: SEARCH_CACHE_TTL_MS,
          })
        )
      );

      const allResults: SearchResult[] = [];

      for (const outcome of outcomes) {
        const { status } = outcome;
        if (outcome.items.length > 0) {
          allResults.push(...outcome.items);
          console.log(`  ${status.label}: ${outcome.items.length} results${status.cacheHit ? '（缓存）' : ''}`);
        } else {
          const reason = status.error ? ` - ${status.error}` : '';
          console.log(`  ${status.label}: ${status.state}${reason}`);
        }
      }

      io.emit('source:status', sourceStatusRegistry.snapshot());

      // 语义去重 → 跨源关联 → 新鲜度过滤 → 按意图调整来源优先级
      const uniqueResults = dedupeItems(allResults, keyword.text);
      linkCrossSources(uniqueResults, keyword.text);
      const freshResults = filterByFreshness(uniqueResults);
      const sortedResults = prioritizeResults(freshResults, queryType);
      const clusters = clusterByEvent(sortedResults, keyword.text);

      if (clusters.length > 0) {
        const summary = clusters
          .slice(0, 3)
          .map(cluster => `${cluster.sources.join('/')}(${cluster.size})`)
          .join('、');
        console.log(`  🧩 同频热点 ${clusters.length} 组: ${summary}`);
      }

      console.log(`  Total: ${allResults.length} raw → ${uniqueResults.length} unique → ${freshResults.length} fresh (within ${MAX_AGE_HOURS}h)`);

      // 处理结果配额：Twitter 保留独立配额（无 Key 时为空，不影响其他源）
      // 技术源数量较多，提高非 Twitter 来源的共享配额
      let twitterProcessed = 0;
      let otherProcessed = 0;
      const TWITTER_QUOTA = 15;
      const OTHER_QUOTA = 30;

      for (const item of sortedResults) {
        // 检查配额（按“实际处理条数”计，避免过滤后继续无限调用 AI）
        if (item.source === 'twitter' && twitterProcessed >= TWITTER_QUOTA) continue;
        if (item.source !== 'twitter' && otherProcessed >= OTHER_QUOTA) continue;
        try {
          // 检查是否已存在
          const existing = await prisma.hotspot.findFirst({
            where: {
              url: item.url,
              source: item.source
            }
          });

          if (existing) {
            continue;
          }

          // 进入处理流程即消耗配额（已入库的条目除外）
          if (item.source === 'twitter') twitterProcessed++;
          else otherProcessed++;

          // AI 分析（传入关键词和预匹配结果）
          const fullText = item.title + '\n' + item.content;
          const preMatch = preMatchKeyword(fullText, expandedKeywords);
          const analysis = await analyzeContent(fullText, keyword.text, preMatch);

          // 只保存真实且相关的热点
          if (!analysis.isReal) {
            console.log(`  ❌ Filtered fake/spam: ${item.title.slice(0, 30)}...`);
            continue;
          }

          // 相关性阈值：50 分以下过滤
          if (analysis.relevance < 50) {
            console.log(`  ⏭ Low relevance (${analysis.relevance}): ${item.title.slice(0, 30)}...`);
            continue;
          }

          // 额外规则：关键词未被提及且相关性不足 65 → 过滤
          if (!analysis.keywordMentioned && analysis.relevance < 65) {
            console.log(`  ⏭ Keyword not mentioned & relevance < 65 (${analysis.relevance}): ${item.title.slice(0, 30)}...`);
            continue;
          }

          // 保存热点
          const hotspot = await prisma.hotspot.create({
            data: {
              title: item.title,
              content: item.content,
              url: item.url,
              source: item.source,
              sourceId: item.sourceId || null,
              isReal: analysis.isReal,
              relevance: analysis.relevance,
              relevanceReason: analysis.relevanceReason || null,
              keywordMentioned: analysis.keywordMentioned ?? null,
              importance: analysis.importance,
              summary: analysis.summary,
              viewCount: item.viewCount || null,
              likeCount: item.likeCount || null,
              retweetCount: item.retweetCount || null,
              replyCount: item.replyCount || null,
              commentCount: item.commentCount || null,
              quoteCount: item.quoteCount || null,
              danmakuCount: item.danmakuCount || null,
              authorName: item.author?.name || null,
              authorUsername: item.author?.username || null,
              authorAvatar: item.author?.avatar || null,
              authorFollowers: item.author?.followers || null,
              authorVerified: item.author?.verified ?? null,
              publishedAt: item.publishedAt || null,
              keywordId: keyword.id
            },
            include: {
              keyword: true
            }
          });

          newHotspotsCount++;
          console.log(`  ✅ New hotspot [${item.source}]: ${hotspot.title.slice(0, 40)}... (${analysis.importance})`);

          // 创建通知
          await prisma.notification.create({
            data: {
              type: 'hotspot',
              title: `发现新热点: ${hotspot.title.slice(0, 50)}`,
              content: analysis.summary || hotspot.content.slice(0, 100),
              hotspotId: hotspot.id
            }
          });

          // WebSocket 通知
          io.to(`keyword:${keyword.text}`).emit('hotspot:new', hotspot);
          io.emit('notification', {
            type: 'hotspot',
            title: '发现新热点',
            content: hotspot.title,
            hotspotId: hotspot.id,
            importance: hotspot.importance
          });

          // 收集到本轮简报，扫描结束后统一发送
          digestItems.push({
            index: digestItems.length,
            keyword: keyword.text,
            source: hotspot.source,
            importance: hotspot.importance,
            relevance: hotspot.relevance,
            title: hotspot.title,
            summary: hotspot.summary,
            url: hotspot.url,
            publishedAt: hotspot.publishedAt
          });

        } catch (error) {
          console.error(`  Error processing result:`, error);
        }
      }

      // 避免过快请求
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`Error checking keyword "${keyword.text}":`, error);
    }
  }

  // 本轮扫描结束时统一生成 AI 简报并发送一封邮件
  if (digestItems.length > 0) {
    const scanTime = new Date();
    const keywordTexts = keywords.map(k => k.text);
    try {
      const digest = await summarizeScanDigest(digestItems, { keywords: keywordTexts, scanTime });
      const sent = await sendScanDigestEmail(digest, digestItems, { keywords: keywordTexts, scanTime });
      console.log(
        sent
          ? `📧 本轮简报已发送：${digestItems.length} 条热点，${digest.topics.length} 个主题（${digest.generatedBy === 'ai' ? 'AI 总结' : '模板兜底'}）`
          : '📧 本轮简报未发送：未配置发件账户/收件邮箱或发送失败'
      );
    } catch (error) {
      console.error('Failed to send scan digest email:', error);
    }
  }

  console.log(`\n✨ Hotspot check completed. Found ${newHotspotsCount} new hotspots.`);
}
