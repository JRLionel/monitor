import { Router } from 'express';
import { getHotBoard } from '../services/hotBoard.js';

const router = Router();

// 全网热榜快照（默认缓存 5 分钟，refresh=1 强制刷新）
router.get('/', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
    const sources =
      typeof req.query.sources === 'string'
        ? req.query.sources.split(',').map(value => value.trim()).filter(Boolean)
        : undefined;

    const snapshot = await getHotBoard({ refresh, sources, limit });
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : '全网热榜获取失败',
    });
  }
});

export default router;
