import { Router } from 'express';
import { prisma } from '../db.js';
import { sortHotspots } from '../utils/sortHotspots.js';
import { getHotspotSchedule, saveHotspotSchedule } from '../services/hotspot/schedule.js';

const router = Router();

// 获取所有热点
router.get('/', async (req, res) => {
  try {
    const { 
      page = '1', 
      limit = '20', 
      source, 
      importance,
      keywordId,
      isReal,
      timeRange,
      timeFrom,
      timeTo,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (source) where.source = source;
    if (importance) where.importance = importance;
    if (keywordId) where.keywordId = keywordId;
    if (isReal !== undefined && isReal !== '') {
      where.isReal = isReal === 'true';
    }

    // 时间范围筛选
    if (timeRange) {
      const now = new Date();
      let dateFrom: Date | null = null;
      switch (timeRange) {
        case '1h':
          dateFrom = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case 'today':
          dateFrom = new Date(now);
          dateFrom.setHours(0, 0, 0, 0);
          break;
        case '7d':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
      if (dateFrom) {
        where.createdAt = { gte: dateFrom };
      }
    } else if (timeFrom || timeTo) {
      where.createdAt = {};
      if (timeFrom) where.createdAt.gte = new Date(timeFrom as string);
      if (timeTo) where.createdAt.lte = new Date(timeTo as string);
    }

    // 排序处理
    let orderBy: any;
    const sort = sortBy as string;
    const order = (sortOrder as string) === 'asc' ? 'asc' : 'desc';

    // importance 和 hot 需要在内存中排序（Prisma 不支持自定义排序）
    const needsMemorySort = sort === 'importance' || sort === 'hot';

    switch (sort) {
      case 'publishedAt':
        orderBy = [{ publishedAt: order }, { createdAt: 'desc' }];
        break;
      case 'relevance':
        orderBy = { relevance: order };
        break;
      case 'importance':
      case 'hot':
        orderBy = { createdAt: 'desc' };
        break;
      default:
        orderBy = { createdAt: order };
        break;
    }

    const [rawHotspots, total] = await Promise.all([
      prisma.hotspot.findMany({
        where,
        orderBy,
        ...(needsMemorySort ? {} : { skip, take: limitNum }),
        include: {
          keyword: {
            select: { id: true, text: true, category: true }
          }
        }
      }),
      prisma.hotspot.count({ where })
    ]);

    let hotspots;
    if (needsMemorySort) {
      const sorted = sortHotspots(rawHotspots, sort, order as 'asc' | 'desc');
      hotspots = sorted.slice(skip, skip + limitNum);
    } else {
      hotspots = rawHotspots;
    }

    res.json({
      data: hotspots,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching hotspots:', error);
    res.status(500).json({ error: 'Failed to fetch hotspots' });
  }
});

// 获取热点统计
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalHotspots,
      todayHotspots,
      urgentHotspots,
      sourceStats
    ] = await Promise.all([
      prisma.hotspot.count(),
      prisma.hotspot.count({
        where: { createdAt: { gte: today } }
      }),
      prisma.hotspot.count({
        where: { importance: 'urgent' }
      }),
      prisma.hotspot.groupBy({
        by: ['source'],
        _count: { source: true }
      })
    ]);

    res.json({
      total: totalHotspots,
      today: todayHotspots,
      urgent: urgentHotspots,
      bySource: sourceStats.reduce((acc: Record<string, number>, item: { source: string; _count: { source: number } }) => {
        acc[item.source] = item._count.source;
        return acc;
      }, {} as Record<string, number>)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// 获取巡检计划设置
router.get('/schedule', async (_req, res) => {
  try {
    res.json(await getHotspotSchedule());
  } catch (error) {
    console.error('Error fetching hotspot schedule:', error);
    res.status(500).json({ error: '获取巡检设置失败' });
  }
});

// 保存巡检计划设置
router.put('/schedule', async (req, res) => {
  try {
    res.json(await saveHotspotSchedule(req.body ?? {}));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '保存巡检设置失败' });
  }
});

// 获取单个热点
router.get('/:id', async (req, res) => {
  try {
    const hotspot = await prisma.hotspot.findUnique({
      where: { id: req.params.id },
      include: {
        keyword: true
      }
    });

    if (!hotspot) {
      return res.status(404).json({ error: 'Hotspot not found' });
    }

    res.json(hotspot);
  } catch (error) {
    console.error('Error fetching hotspot:', error);
    res.status(500).json({ error: 'Failed to fetch hotspot' });
  }
});

// 手动搜索热点（与定时巡检共用同一套技术源）
router.post('/search', async (req, res) => {
  try {
    const { query, sources } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const { searchTwitter } = await import('../services/twitter.js');
    const { searchHackerNews } = await import('../services/search.js');
    const { searchJuejin } = await import('../services/juejin.js');
    const { searchGitHub, searchCSDN } = await import('../services/techSearch.js');
    const { analyzeContent } = await import('../services/ai.js');

    const allSources = [
      { id: 'hackernews', fn: () => searchHackerNews(query) },
      { id: 'juejin', fn: () => searchJuejin(query) },
      { id: 'github', fn: () => searchGitHub(query) },
      { id: 'csdn', fn: () => searchCSDN(query) },
      // Twitter 占位：未配置 API Key 时服务内部返回空，不影响其他源
      { id: 'twitter', fn: () => searchTwitter(query) },
    ];
    const selected = Array.isArray(sources) && sources.length > 0
      ? allSources.filter(def => sources.includes(def.id))
      : allSources;

    const outcomes = await Promise.allSettled(selected.map(def => def.fn()));
    const results: any[] = [];
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
        results.push(...outcome.value);
      }
    }

    // URL 去重，按发布时间倒序
    const seen = new Set<string>();
    const unique = results.filter(item => {
      const key = item.url || item.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) =>
      new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()
    );

    // AI 分析前 20 条
    const analyzedResults = await Promise.all(
      unique.slice(0, 20).map(async (item) => {
        try {
          const analysis = await analyzeContent(item.title + ' ' + (item.content ?? ''), query);
          return { ...item, analysis };
        } catch {
          return { ...item, analysis: null };
        }
      })
    );

    res.json({ results: analyzedResults });
  } catch (error) {
    console.error('Error searching hotspots:', error);
    res.status(500).json({ error: 'Failed to search hotspots' });
  }
});

// 批量删除热点
router.post('/batch-delete', async (req, res) => {
  const rawIds = req.body?.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return res.status(400).json({ error: 'ids is required' });
  }

  const ids = [...new Set(rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))];
  if (!ids.length) {
    return res.status(400).json({ error: 'ids is required' });
  }

  try {
    const result = await prisma.hotspot.deleteMany({
      where: { id: { in: ids } }
    });
    res.json({ deleted: result.count });
  } catch (error) {
    console.error('Error batch deleting hotspots:', error);
    res.status(500).json({ error: 'Failed to delete hotspots' });
  }
});

// 删除热点
router.delete('/:id', async (req, res) => {
  try {
    await prisma.hotspot.delete({
      where: { id: req.params.id }
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Hotspot not found' });
    }
    console.error('Error deleting hotspot:', error);
    res.status(500).json({ error: 'Failed to delete hotspot' });
  }
});

export default router;
