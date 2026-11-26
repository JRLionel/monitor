import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';

const DESKTOP_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

const MOBILE_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 600;
const DEFAULT_MAX_DELAY_MS = 8_000;
const DEFAULT_HOST_INTERVAL_MS = 600;

export type HttpErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'risk_control'
  | 'forbidden'
  | 'not_found'
  | 'http_error'
  | 'network';

export interface HttpErrorInit {
  status?: number;
  url?: string;
  retryAfterMs?: number;
  body?: string;
}

export class HttpError extends Error {
  readonly kind: HttpErrorKind;
  readonly status?: number;
  readonly url: string;
  readonly retryAfterMs?: number;
  readonly body?: string;

  constructor(kind: HttpErrorKind, message: string, init: HttpErrorInit = {}) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.status = init.status;
    this.url = init.url ?? '';
    this.retryAfterMs = init.retryAfterMs;
    this.body = init.body;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class RateLimiter {
  private lastRequestTime = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.lastRequestTime + this.minIntervalMs - now);
    this.lastRequestTime = now + waitMs;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}

const hostLimiters = new Map<string, RateLimiter>();

function hostLimiter(url: string): RateLimiter {
  let host = 'default';
  try {
    host = new URL(url).host;
  } catch {
    // keep default
  }
  let limiter = hostLimiters.get(host);
  if (!limiter) {
    limiter = new RateLimiter(DEFAULT_HOST_INTERVAL_MS);
    hostLimiters.set(host, limiter);
  }
  return limiter;
}

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  set(name: string, value: string): void {
    if (name && value) {
      this.cookies.set(name, value);
    }
  }

  loadHeader(header: string | undefined): void {
    if (!header) return;
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      this.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
    }
  }

  loadSetCookie(header: string | string[] | undefined): void {
    if (!header) return;
    const lines = Array.isArray(header) ? header : [header];
    for (const line of lines) {
      const first = line.split(';')[0];
      const index = first.indexOf('=');
      if (index <= 0) continue;
      this.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  toHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  cookieJar?: CookieJar;
  limiter?: RateLimiter;
  responseType?: 'json' | 'text';
  label?: string;
}

function pickAgent(kind: 'desktop' | 'mobile'): string {
  const pool = kind === 'mobile' ? MOBILE_AGENTS : DESKTOP_AGENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function browserHeaders(
  kind: 'desktop' | 'mobile' = 'desktop',
  referer?: string,
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': pickAgent(kind),
    Accept: accept,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (referer) {
    headers.Referer = referer;
  }
  return headers;
}

function parseRetryAfter(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

function bodySnippet(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data.replace(/\s+/g, ' ').slice(0, 300);
  }
  if (data && typeof data === 'object') {
    try {
      return JSON.stringify(data).slice(0, 300);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function errorFromResponse(response: AxiosResponse, url: string): HttpError {
  const status = response.status;
  const body = bodySnippet(response.data);
  const retryAfterMs = parseRetryAfter(response.headers?.['retry-after']);

  if (status === 412) {
    return new HttpError('risk_control', `HTTP 412 触发平台风控: ${url}`, { status, url, body });
  }
  if (status === 429) {
    return new HttpError('rate_limited', `HTTP 429 请求过于频繁: ${url}`, { status, url, retryAfterMs, body });
  }
  if (status === 403) {
    return new HttpError('forbidden', `HTTP 403 拒绝访问（可能需要 Cookie 或更换出口 IP）: ${url}`, {
      status,
      url,
      body,
    });
  }
  if (status === 404) {
    return new HttpError('not_found', `HTTP 404 资源不存在: ${url}`, { status, url, body });
  }
  return new HttpError('http_error', `HTTP ${status}: ${url}`, { status, url, body });
}

function errorFromAxios(error: AxiosError, url: string): HttpError {
  if (error.response) {
    return errorFromResponse(error.response, url);
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new HttpError('timeout', `请求超时: ${url}`, { url });
  }
  return new HttpError('network', `网络请求失败: ${url} (${error.code || error.message})`, { url });
}

function shouldRetry(error: HttpError): boolean {
  if (error.kind === 'timeout' || error.kind === 'network' || error.kind === 'rate_limited') {
    return true;
  }
  return typeof error.status === 'number' && error.status >= 500;
}

function retryDelayMs(error: HttpError, attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, maxDelayMs);
  }
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return Math.min(exponential + jitter, maxDelayMs);
}

export async function httpRequest<T = any>(
  method: 'GET' | 'POST',
  url: string,
  options: RequestOptions = {}
): Promise<AxiosResponse<T>> {
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const limiter = options.limiter ?? hostLimiter(url);

  const headers: Record<string, string> = {
    ...browserHeaders('desktop'),
    ...options.headers,
  };
  if (options.cookieJar) {
    const cookie = options.cookieJar.toHeader();
    if (cookie && !headers.Cookie) {
      headers.Cookie = cookie;
    }
  }

  const config: AxiosRequestConfig = {
    method,
    url,
    params: options.params,
    data: options.data,
    headers,
    timeout: timeoutMs,
    maxRedirects: 5,
    responseType: options.responseType === 'text' ? 'text' : 'json',
    transformResponse: options.responseType === 'text' ? [(data: string) => data] : undefined,
    validateStatus: () => true,
  };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await limiter.wait();

    try {
      const response = await axios.request<T>(config);
      options.cookieJar?.loadSetCookie(
        response.headers?.['set-cookie'] as string | string[] | undefined
      );

      if (response.status >= 400) {
        throw errorFromResponse(response, url);
      }
      return response;
    } catch (error) {
      const httpError = isHttpError(error)
        ? error
        : error instanceof AxiosError || axios.isAxiosError(error)
          ? errorFromAxios(error as AxiosError, url)
          : new HttpError('network', `请求失败: ${url}`, { url });

      if (!shouldRetry(httpError) || attempt === retries) {
        throw httpError;
      }

      const delay = retryDelayMs(httpError, attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `[http] ${options.label || method} ${httpError.kind} 重试 ${attempt + 1}/${retries}，${delay}ms 后继续`
      );
      await sleep(delay);
    }
  }

  throw new HttpError('network', `请求失败: ${url}`, { url });
}

export function httpGet<T = any>(url: string, options: RequestOptions = {}): Promise<AxiosResponse<T>> {
  return httpRequest<T>('GET', url, options);
}

export function httpPost<T = any>(url: string, options: RequestOptions = {}): Promise<AxiosResponse<T>> {
  return httpRequest<T>('POST', url, options);
}

export function describeHttpError(error: unknown): string {
  if (isHttpError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
