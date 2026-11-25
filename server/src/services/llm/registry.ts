import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { CATALOG, DEFAULT_PROVIDER, PROVIDER_IDS } from './catalog.js';
import { createOpenAICompatibleProvider } from './openaiCompatible.js';
import type { ChatProvider, ProviderMeta } from './types.js';

/** 环境变量兜底，优先级低于界面里保存的配置 */
const ENV_API_KEYS: Record<string, string[]> = {
  deepseek: ['DEEPSEEK_API_KEY'],
  xiaomi: ['MIMO_API_KEY', 'XIAOMI_MIMO_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY'],
};

export interface ProviderStatus {
  id: string;
  name: string;
  docsUrl?: string;
  keyPlaceholder?: string;
  hasKey: boolean;
  apiKeyMasked: string;
  configured: boolean;
  selectedModel: string;
  models: ProviderMeta['models'];
}

let hasWarnedDbError = false;

export async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch (error) {
    // 数据库不可用时按“未配置”处理，业务会自动走 fallback 分析
    if (!hasWarnedDbError) {
      hasWarnedDbError = true;
      console.warn('读取 AI 配置失败，将使用环境变量或 fallback：', error);
    }
    return null;
  }
}

export async function putSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

async function resolveApiKey(providerId: string): Promise<string | null> {
  const saved = await getSetting(`ai.${providerId}.apiKey`);
  if (saved) return saved;

  for (const envKey of ENV_API_KEYS[providerId] ?? []) {
    const value = process.env[envKey];
    if (value) return value;
  }
  return null;
}

export async function getActiveProviderId(): Promise<string> {
  const saved = await getSetting('ai.provider');
  if (saved && CATALOG[saved]) return saved;
  return DEFAULT_PROVIDER;
}

async function getSelectedModel(providerId: string): Promise<string> {
  const meta = CATALOG[providerId];
  const saved = await getSetting(`ai.${providerId}.model`);
  if (saved && meta.models.some(m => m.id === saved)) return saved;
  return meta.models[0].id;
}

async function buildProvider(meta: ProviderMeta, apiKey: string): Promise<ChatProvider> {
  let sessionId: string | undefined;

  if (meta.sessionHeader) {
    sessionId = (await getSetting(`ai.${meta.id}.sessionId`)) ?? undefined;
    if (!sessionId) {
      sessionId = `ses_${randomUUID().replace(/-/g, '')}`;
      await putSetting(`ai.${meta.id}.sessionId`, sessionId);
    }
  }

  return createOpenAICompatibleProvider(meta, apiKey, sessionId);
}

/** 业务侧唯一入口：返回当前启用的 provider 与模型；未配置密钥时返回 null */
export async function getChatProvider(): Promise<{ provider: ChatProvider; model: string } | null> {
  const providerId = await getActiveProviderId();
  const meta = CATALOG[providerId];
  if (!meta) return null;

  const apiKey = await resolveApiKey(providerId);
  if (!apiKey) return null;

  const model = await getSelectedModel(providerId);
  const provider = await buildProvider(meta, apiKey);
  return { provider, model };
}

export async function getProviderStatuses(): Promise<{ active: string; providers: ProviderStatus[] }> {
  const active = await getActiveProviderId();

  const providers = await Promise.all(
    PROVIDER_IDS.map(async (id): Promise<ProviderStatus> => {
      const meta = CATALOG[id];
      const apiKey = await resolveApiKey(id);
      return {
        id,
        name: meta.name,
        docsUrl: meta.docsUrl,
        keyPlaceholder: meta.keyPlaceholder,
        hasKey: Boolean(apiKey),
        apiKeyMasked: apiKey ? maskKey(apiKey) : '',
        configured: Boolean(apiKey),
        selectedModel: await getSelectedModel(id),
        models: meta.models,
      };
    })
  );

  return { active, providers };
}

/** 保存配置；apiKey 为空时不覆盖已有密钥 */
export async function saveProviderConfig(input: {
  provider: string;
  model?: string;
  apiKey?: string;
}): Promise<void> {
  const meta = CATALOG[input.provider];
  if (!meta) throw new Error('未知的模型服务商');

  await putSetting('ai.provider', input.provider);

  if (input.model && meta.models.some(m => m.id === input.model)) {
    await putSetting(`ai.${input.provider}.model`, input.model);
  }

  if (input.apiKey && input.apiKey.trim()) {
    await putSetting(`ai.${input.provider}.apiKey`, input.apiKey.trim());
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs?: number;
  model?: string;
  sample?: string;
  error?: string;
}

/** 健康检测：发一条最小请求验证密钥、地址、模型是否可用 */
export async function testConnection(input: {
  provider: string;
  model?: string;
  apiKey?: string;
}): Promise<ConnectionTestResult> {
  const meta = CATALOG[input.provider];
  if (!meta) return { ok: false, error: '未知的模型服务商' };

  const apiKey = input.apiKey?.trim() || (await resolveApiKey(input.provider));
  if (!apiKey) return { ok: false, error: '尚未配置 API Key' };

  const model =
    input.model && meta.models.some(m => m.id === input.model)
      ? input.model
      : meta.models[0].id;

  try {
    const provider = await buildProvider(meta, apiKey);
    const startedAt = Date.now();
    const text = await provider.chat({
      model,
      messages: [{ role: 'user', content: '只回复 ok 两个字符，不要输出其他内容。' }],
      temperature: 0,
      maxTokens: 16,
    });

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      model,
      sample: text.trim().slice(0, 80),
    };
  } catch (error) {
    return {
      ok: false,
      model,
      error: error instanceof Error ? error.message : '连接失败',
    };
  }
}
