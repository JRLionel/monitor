export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/** 各厂商差异全部收敛在适配器内部，业务层只依赖这个接口 */
export interface ChatProvider {
  id: string;
  chat(req: ChatRequest): Promise<string>;
}

export type AuthStyle = 'bearer' | 'api-key';

export interface ModelMeta {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
  capabilities: string[];
}

export interface ProviderMeta {
  id: string;
  name: string;
  baseUrl: string;
  path: string;
  authStyle: AuthStyle;
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  models: ModelMeta[];
  /** 额外请求体，例如关闭思考模式 */
  extraBody?: Record<string, unknown>;
  /** OpenCode Go 要求每次请求带会话 ID */
  sessionHeader?: boolean;
  docsUrl?: string;
  keyPlaceholder?: string;
}
