import type { ChatProvider, ChatRequest, ProviderMeta } from './types.js';

const TIMEOUT_MS = 30_000;

function buildErrorMessage(status: number, raw: string): string {
  try {
    const data = JSON.parse(raw);
    const message = data?.error?.message ?? data?.message;
    if (typeof message === 'string' && message) return `HTTP ${status}: ${message}`;
  } catch {
    // 非 JSON 响应，忽略
  }
  return `HTTP ${status}: ${raw.slice(0, 200)}`;
}

/**
 * OpenAI Chat Completions 兼容适配器。
 * DeepSeek / 小米 MiMo / OpenCode Go 都复用这一个实现，
 * 差异通过 ProviderMeta（鉴权头、token 参数名、额外请求体、会话头）传入。
 */
export function createOpenAICompatibleProvider(
  meta: ProviderMeta,
  apiKey: string,
  sessionId?: string
): ChatProvider {
  return {
    id: meta.id,

    async chat(req: ChatRequest): Promise<string> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (meta.authStyle === 'api-key') {
        headers['api-key'] = apiKey;
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      if (meta.sessionHeader && sessionId) {
        headers['x-opencode-session'] = sessionId;
      }

      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        [meta.tokenParam]: req.maxTokens ?? 500,
        ...meta.extraBody,
      };

      const response = await fetch(`${meta.baseUrl}${meta.path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const raw = await response.text();

      if (!response.ok) {
        throw new Error(buildErrorMessage(response.status, raw));
      }

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error('响应不是合法 JSON');
      }

      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('响应格式异常：未找到 choices[0].message.content');
      }

      return content;
    },
  };
}
