import { Router } from 'express';
import {
  getProviderStatuses,
  saveProviderConfig,
  testConnection,
} from '../services/llm/registry.js';

const router = Router();

// 模型服务列表（含配置状态，密钥已脱敏）
router.get('/providers', async (req, res) => {
  try {
    res.json(await getProviderStatuses());
  } catch (error) {
    console.error('Error fetching AI providers:', error);
    res.status(500).json({ error: 'Failed to fetch AI providers' });
  }
});

// 保存当前厂商 / 模型 / 密钥
router.put('/config', async (req, res) => {
  try {
    const { provider, model, apiKey } = req.body ?? {};

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    if (apiKey !== undefined && typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'apiKey must be a string' });
    }

    await saveProviderConfig({ provider, model, apiKey });
    res.json(await getProviderStatuses());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save config';
    res.status(400).json({ error: message });
  }
});

// 健康检测：验证密钥 / 地址 / 模型是否可用
router.post('/test', async (req, res) => {
  try {
    const { provider, model, apiKey } = req.body ?? {};

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }

    const result = await testConnection({ provider, model, apiKey });
    res.json(result);
  } catch (error) {
    console.error('Error testing AI provider:', error);
    res.status(500).json({ ok: false, error: '连接测试失败' });
  }
});

export default router;
