import { Router } from 'express';
import { sourceStatusRegistry } from '../services/sourceStatus.js';

const router = Router();

// 各采集源最近一次运行状态
router.get('/status', (_req, res) => {
  res.json(sourceStatusRegistry.snapshot());
});

export default router;
