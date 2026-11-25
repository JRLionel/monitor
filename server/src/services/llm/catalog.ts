import type { ProviderMeta } from './types.js';

/**
 * 模型服务目录。
 * 新增厂商只需要在这里加一项，业务代码和路由都不需要改。
 */
export const CATALOG: Record<string, ProviderMeta> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    path: '/chat/completions',
    authStyle: 'bearer',
    tokenParam: 'max_tokens',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-...（DeepSeek 控制台创建）',
    models: [
      {
        id: 'deepseek-flash',
        label: 'DeepSeek V4.1 Flash',
        description: '快速、低成本，适合批量内容判断',
        recommended: true,
        capabilities: ['文本'],
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: '推理能力更强，适合复杂语义判断',
        capabilities: ['文本', '推理'],
      },
    ],
  },

  xiaomi: {
    id: 'xiaomi',
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    path: '/chat/completions',
    authStyle: 'api-key',
    tokenParam: 'max_completion_tokens',
    docsUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    keyPlaceholder: 'sk-...（小米 MiMo 开放平台）',
    extraBody: { reasoning: { effort: 'none' } },
    models: [
      {
        id: 'mimo-v2.6-flash',
        label: 'MiMo V2.6 Flash',
        description: '快速响应，适合高频调用',
        recommended: true,
        capabilities: ['文本'],
      },
      {
        id: 'mimo-v2.6-pro',
        label: 'MiMo V2.6 Pro',
        description: '效果与成本均衡',
        capabilities: ['文本'],
      },
      {
        id: 'mimo-v2.6-pro-ultraspeed',
        label: 'MiMo V2.6 Pro UltraSpeed',
        description: '超高速版本，优先保证低延迟',
        capabilities: ['文本'],
      },
    ],
  },

  'opencode-go': {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/inference/go',
    path: '/openai/v1/chat/completions',
    authStyle: 'bearer',
    tokenParam: 'max_tokens',
    sessionHeader: true,
    docsUrl: 'https://opencode.ai/console',
    keyPlaceholder: 'oc_sk_...（OpenCode Console）',
    models: [
      {
        id: 'deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash',
        description: '通用快速模型，性价比高',
        recommended: true,
        capabilities: ['文本'],
      },
      {
        id: 'glm-5.3',
        label: 'GLM 5.3',
        description: '中文理解与结构化输出表现好',
        capabilities: ['文本'],
      },
      {
        id: 'kimi-k3',
        label: 'Kimi K3',
        description: '长文本理解能力强',
        capabilities: ['文本', '长文本'],
      },
    ],
  },
};

export const PROVIDER_IDS = Object.keys(CATALOG);
export const DEFAULT_PROVIDER = 'deepseek';
