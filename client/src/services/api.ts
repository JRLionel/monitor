const API_BASE = '/api';

export interface Keyword {
  id: string;
  text: string;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { hotspots: number };
}

export interface Hotspot {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  sourceId: string | null;
  isReal: boolean;
  relevance: number;
  relevanceReason: string | null;
  keywordMentioned: boolean | null;
  importance: 'low' | 'medium' | 'high' | 'urgent';
  summary: string | null;
  viewCount: number | null;
  likeCount: number | null;
  retweetCount: number | null;
  replyCount: number | null;
  commentCount: number | null;
  quoteCount: number | null;
  danmakuCount: number | null;
  authorName: string | null;
  authorUsername: string | null;
  authorAvatar: string | null;
  authorFollowers: number | null;
  authorVerified: boolean | null;
  publishedAt: string | null;
  createdAt: string;
  keyword: { id: string; text: string; category: string | null } | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  hotspotId: string | null;
  createdAt: string;
}

export interface Stats {
  total: number;
  today: number;
  urgent: number;
  bySource: Record<string, number>;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Keywords API
export const keywordsApi = {
  getAll: () => request<Keyword[]>('/keywords'),
  
  getById: (id: string) => request<Keyword>(`/keywords/${id}`),
  
  create: (data: { text: string; category?: string }) => 
    request<Keyword>('/keywords', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  
  update: (id: string, data: Partial<Keyword>) => 
    request<Keyword>(`/keywords/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  
  delete: (id: string) => 
    request<void>(`/keywords/${id}`, { method: 'DELETE' }),
  
  toggle: (id: string) => 
    request<Keyword>(`/keywords/${id}/toggle`, { method: 'PATCH' })
};

// Hotspots API
export type ScheduleMode = 'interval' | 'daily';

/** 定时设置：公众号刷新与热点巡检共用同一结构 */
export interface CheckSchedule {
  mode: ScheduleMode;
  intervalMinutes: number;
  dailyTime: string;
  lastRunAt: string | null;
}

export interface SearchResultItem {
  title: string;
  content: string;
  url: string;
  source: string;
  sourceId?: string;
  publishedAt?: string;
  viewCount?: number;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  commentCount?: number;
  quoteCount?: number;
  danmakuCount?: number;
  author?: {
    name: string;
    username?: string;
    avatar?: string;
    followers?: number;
    verified?: boolean;
  };
  analysis: {
    isReal: boolean;
    relevance: number;
    relevanceReason: string;
    keywordMentioned: boolean;
    importance: 'low' | 'medium' | 'high' | 'urgent';
    summary: string;
  } | null;
}

export const hotspotsApi = {
  getAll: (params?: { 
    page?: number; 
    limit?: number; 
    source?: string; 
    importance?: string; 
    keywordId?: string;
    isReal?: string;
    timeRange?: string;
    timeFrom?: string;
    timeTo?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') searchParams.append(key, String(value));
      });
    }
    return request<{ data: Hotspot[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
      `/hotspots?${searchParams}`
    );
  },
  
  getStats: () => request<Stats>('/hotspots/stats'),
  
  getById: (id: string) => request<Hotspot>(`/hotspots/${id}`),
  
  search: (query: string, sources?: string[]) => 
    request<{ results: SearchResultItem[] }>('/hotspots/search', {
      method: 'POST',
      body: JSON.stringify({ query, sources })
    }),
  
  delete: (id: string) => 
    request<void>(`/hotspots/${id}`, { method: 'DELETE' }),

  deleteMany: (ids: string[]) =>
    request<{ deleted: number }>('/hotspots/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids })
    }),

  getSchedule: () => request<CheckSchedule>('/hotspots/schedule'),

  saveSchedule: (data: {
    mode: ScheduleMode;
    intervalMinutes: number;
    dailyTime: string;
  }) =>
    request<CheckSchedule>('/hotspots/schedule', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// Notifications API
export const notificationsApi = {
  getAll: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.append(key, String(value));
      });
    }
    return request<{ data: Notification[]; unreadCount: number; pagination: any }>(
      `/notifications?${searchParams}`
    );
  },
  
  markAsRead: (id: string) => 
    request<Notification>(`/notifications/${id}/read`, { method: 'PATCH' }),
  
  markAllAsRead: () => 
    request<void>('/notifications/read-all', { method: 'PATCH' }),
  
  delete: (id: string) => 
    request<void>(`/notifications/${id}`, { method: 'DELETE' }),
  
  clear: () => 
    request<void>('/notifications', { method: 'DELETE' })
};

// Settings API
export const settingsApi = {
  getAll: () => request<Record<string, string>>('/settings'),
  
  update: (settings: Record<string, string>) => 
    request<void>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    })
};

// AI 模型服务 API
export interface AIModelMeta {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
  capabilities: string[];
}

export interface AIProviderStatus {
  id: string;
  name: string;
  docsUrl?: string;
  keyPlaceholder?: string;
  hasKey: boolean;
  apiKeyMasked: string;
  configured: boolean;
  selectedModel: string;
  models: AIModelMeta[];
}

export interface AIProvidersResponse {
  active: string;
  providers: AIProviderStatus[];
}

export interface AIConnectionResult {
  ok: boolean;
  latencyMs?: number;
  model?: string;
  sample?: string;
  error?: string;
}

export const aiApi = {
  getProviders: () => request<AIProvidersResponse>('/ai/providers'),

  saveConfig: (data: { provider: string; model?: string; apiKey?: string }) =>
    request<AIProvidersResponse>('/ai/config', {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  test: (data: { provider: string; model?: string; apiKey?: string }) =>
    request<AIConnectionResult>('/ai/test', {
      method: 'POST',
      body: JSON.stringify(data)
    })
};

// Manual trigger
export const triggerHotspotCheck = () => 
  request<{ message: string }>('/check-hotspots', { method: 'POST' });

// ========== 采集源状态 ==========

export type SourceState = 'ok' | 'empty' | 'error' | 'timeout' | 'skipped';

export interface SourceStatusEntry {
  source: string;
  label: string;
  state: SourceState;
  count: number;
  elapsedMs: number;
  error?: string;
  cacheHit?: boolean;
  keyword?: string;
  lastRunAt: string;
}

export interface SourceStatusSnapshot {
  lastRunAt: string | null;
  sources: SourceStatusEntry[];
}

export const sourcesApi = {
  getStatus: () => request<SourceStatusSnapshot>('/sources/status'),
};

// ========== 全网热榜 ==========

export type HotBoardKind = 'board' | 'feed';
export type HotBoardGroup = 'cn' | 'news' | 'global';

export interface HotBoardItem {
  rank: number;
  title: string;
  url: string;
  hotValue?: number | null;
  label?: string;
  desc?: string;
  pinned?: boolean;
}

export interface HotBoard {
  label: string;
  code: string;
  kind: HotBoardKind;
  group: HotBoardGroup;
  items: HotBoardItem[];
  error: string | null;
}

export interface HotTopicMention {
  platform: string;
  label: string;
  rank: number;
  title: string;
  url: string;
  hotValue?: number | null;
}

export interface HotTopic {
  title: string;
  url: string;
  platformCount: number;
  score: number;
  mentions: HotTopicMention[];
}

export interface HotBoardSnapshot {
  generatedAt: string;
  boards: Record<string, HotBoard>;
  topics: HotTopic[];
}

export const hotBoardApi = {
  get: (params?: { refresh?: boolean; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.refresh) searchParams.append('refresh', '1');
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const query = searchParams.toString();
    return request<HotBoardSnapshot>(`/hot-board${query ? `?${query}` : ''}`);
  },
};

// ========== 公众号订阅 ==========

export interface WechatAccount {
  id: string;
  name: string;
  bizId: string | null;
  avatar: string | null;
  description: string | null;
  sourceType: string;
  feedUrl: string;
  isActive: boolean;
  baselineDone: boolean;
  lastCheckedAt: string | null;
  lastArticleAt: string | null;
  failCount: number;
  lastError: string | null;
  nextCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
  unreadCount?: number;
  articleCount?: number;
  isBuiltin?: boolean;
}

export interface WechatArticle {
  id: string;
  accountId: string;
  title: string;
  url: string;
  digest: string | null;
  coverUrl: string | null;
  author: string | null;
  publishedAt: string | null;
  isRead: boolean;
  createdAt: string;
  account?: { id: string; name: string; avatar: string | null };
}

export interface WechatFeedPreviewItem {
  title: string;
  url: string;
  digest: string;
  coverUrl: string | null;
  author: string | null;
  publishedAt: string | null;
}

export interface WechatFeedPreview {
  feedTitle: string;
  itemCount: number;
  items: WechatFeedPreviewItem[];
}

export interface WechatCheckResult {
  accountId: string;
  inserted: number;
  baseline?: boolean;
  error?: string;
  account?: WechatAccount;
}

export type WechatScheduleMode = ScheduleMode;

export type WechatSchedule = CheckSchedule;

export const wechatApi = {
  getAccounts: () => request<WechatAccount[]>('/wechat/accounts'),

  testFeed: (feedUrl: string) =>
    request<WechatFeedPreview>('/wechat/test-feed', {
      method: 'POST',
      body: JSON.stringify({ feedUrl }),
    }),

  createAccount: (data: { name: string; feedUrl: string; description?: string }) =>
    request<WechatAccount>('/wechat/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAccount: (id: string, data: Partial<Pick<WechatAccount, 'name' | 'feedUrl' | 'isActive'>>) =>
    request<WechatAccount>(`/wechat/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  toggleAccount: (id: string) =>
    request<WechatAccount>(`/wechat/accounts/${id}/toggle`, { method: 'PATCH' }),

  removeAccount: (id: string) =>
    request<void>(`/wechat/accounts/${id}`, { method: 'DELETE' }),

  checkAccount: (id: string) =>
    request<WechatCheckResult>(`/wechat/accounts/${id}/check`, { method: 'POST' }),

  checkAll: () =>
    request<{ checked: number; inserted: number; failed: number }>('/wechat/check-all', {
      method: 'POST',
    }),

  getArticles: (params?: {
    accountId?: string;
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.accountId) searchParams.append('accountId', params.accountId);
    if (params?.page) searchParams.append('page', String(params.page));
    if (params?.limit) searchParams.append('limit', String(params.limit));
    if (params?.unreadOnly) searchParams.append('unreadOnly', '1');
    const query = searchParams.toString();
    return request<{
      data: WechatArticle[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/wechat/articles${query ? `?${query}` : ''}`);
  },

  getUnreadCount: () =>
    request<{ total: number; byAccount: { accountId: string; count: number }[] }>(
      '/wechat/unread-count'
    ),

  markRead: (data: { ids?: string[]; accountId?: string; all?: boolean }) =>
    request<{ updated: number }>('/wechat/articles/read', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getSchedule: () => request<WechatSchedule>('/wechat/settings'),

  saveSchedule: (data: {
    mode: WechatScheduleMode;
    intervalMinutes: number;
    dailyTime: string;
  }) =>
    request<WechatSchedule>('/wechat/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// ========== 邮件通知配置 ==========

// 发件 SMTP 账户（password 为掩码值）
export interface EmailAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// 收件邮箱
export interface EmailRecipient {
  id: string;
  name: string | null;
  address: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailAccountInput {
  name: string;
  host: string;
  port?: number;
  secure?: boolean;
  username: string;
  password?: string; // 编辑时留空表示保留原密码
  isActive?: boolean;
}

export interface EmailRecipientInput {
  address: string;
  name?: string;
  isEnabled?: boolean;
}

export interface EmailTestResult {
  ok: boolean;
  sent?: number;
  error?: string;
}

export const emailApi = {
  accounts: {
    getAll: () => request<EmailAccount[]>('/email/accounts'),

    create: (data: EmailAccountInput) =>
      request<EmailAccount>('/email/accounts', {
        method: 'POST',
        body: JSON.stringify(data)
      }),

    update: (id: string, data: Partial<EmailAccountInput>) =>
      request<EmailAccount>(`/email/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      }),

    activate: (id: string) =>
      request<EmailAccount>(`/email/accounts/${id}/activate`, { method: 'PATCH' }),

    remove: (id: string) =>
      request<void>(`/email/accounts/${id}`, { method: 'DELETE' }),
  },

  recipients: {
    getAll: () => request<EmailRecipient[]>('/email/recipients'),

    create: (data: EmailRecipientInput) =>
      request<EmailRecipient>('/email/recipients', {
        method: 'POST',
        body: JSON.stringify(data)
      }),

    update: (id: string, data: Partial<EmailRecipientInput>) =>
      request<EmailRecipient>(`/email/recipients/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      }),

    toggle: (id: string) =>
      request<EmailRecipient>(`/email/recipients/${id}/toggle`, { method: 'PATCH' }),

    remove: (id: string) =>
      request<void>(`/email/recipients/${id}`, { method: 'DELETE' }),
  },

  sendTest: () =>
    request<EmailTestResult>('/email/test', { method: 'POST' }),
};
