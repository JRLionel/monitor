import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Database,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Twitter,
  X,
  Zap,
} from 'lucide-react';
import type { SourceStatusEntry, SourceStatusSnapshot, Stats } from '../services/api';
import { cn } from '../lib/utils';
import { relativeTime } from '../utils/relativeTime';

/** 当前巡检实际启用的数据来源 */
const DATA_SOURCES: {
  key: string;
  name: string;
  category: string;
  description: string;
  method: string;
  url: string;
  accent: string;
  requiresKey?: boolean;
}[] = [
  {
    key: 'twitter',
    name: 'Twitter / X',
    category: '社交平台',
    description: '通过 twitterapi.io 高级搜索抓取推文，按点赞 / 转发 / 浏览 / 粉丝门槛做本地质量过滤。',
    method: '接入方式：第三方 API（需 Key）',
    url: 'https://x.com',
    accent: 'bg-sky-500/10 border-sky-500/20 text-sky-700',
    requiresKey: true,
  },
  {
    key: 'weibo',
    name: '微博',
    category: '社交平台',
    description: '移动端关键词搜索优先，未登录时自动降级热搜匹配与相关话题兜底。',
    method: '接入方式：移动端搜索（可选 Cookie）+ 热搜 API',
    url: 'https://s.weibo.com/top/summary',
    accent: 'bg-orange-500/10 border-orange-500/20 text-orange-600',
  },
  {
    key: 'bilibili',
    name: 'Bilibili',
    category: '视频平台',
    description: '调用公开 Web API 搜索视频，并自动识别同名 UP 主、抓取其最新投稿。',
    method: '接入方式：公开 Web API',
    url: 'https://www.bilibili.com',
    accent: 'bg-pink-500/10 border-pink-500/20 text-pink-700',
  },
  {
    key: 'juejin',
    name: '稀土掘金',
    category: '技术社区',
    description: '调用掘金搜索接口按最新排序检索技术文章，带入阅读、点赞与评论数据。',
    method: '接入方式：公开 API',
    url: 'https://juejin.cn',
    accent: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-700',
  },
  {
    key: 'hackernews',
    name: 'Hacker News',
    category: '技术社区',
    description: '通过 Algolia 官方 API 检索近 24 小时的技术社区 story。',
    method: '接入方式：官方 API',
    url: 'https://news.ycombinator.com',
    accent: 'bg-amber-500/10 border-amber-500/20 text-amber-700',
  },
];

const SOURCE_STATUS_BADGE: Record<string, { label: string; className: string; dot: string }> = {
  ok: { label: '正常', className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20', dot: 'bg-emerald-400' },
  empty: { label: '无结果', className: 'bg-slate-500/10 text-[#5c6f82] border-slate-500/20', dot: 'bg-slate-400' },
  timeout: { label: '超时', className: 'bg-amber-500/10 text-amber-700 border-amber-500/20', dot: 'bg-amber-400' },
  error: { label: '异常', className: 'bg-red-500/10 text-red-600 border-red-500/20', dot: 'bg-red-400' },
  skipped: { label: '已跳过', className: 'bg-slate-500/10 text-[#5c6f82] border-slate-500/20', dot: 'bg-slate-500' },
};

function getStatusBadge(status?: SourceStatusEntry) {
  if (!status) {
    return { label: '未运行', className: 'bg-[#eef2f6] text-[#5c6f82] border-[#d7e0e8]', dot: 'bg-slate-600' };
  }
  return SOURCE_STATUS_BADGE[status.state] ?? SOURCE_STATUS_BADGE.empty;
}

function getSourceIcon(source: string) {
  switch (source) {
    case 'twitter': return <Twitter className="h-4 w-4" />;
    case 'bilibili': return <Eye className="h-4 w-4" />;
    case 'weibo': return <Activity className="h-4 w-4" />;
    case 'juejin': return <FileText className="h-4 w-4" />;
    case 'hackernews': return <Zap className="h-4 w-4" />;
    default: return <Globe className="h-4 w-4" />;
  }
}

interface SourcesModalProps {
  stats: Stats | null;
  sourceStatus: SourceStatusSnapshot | null;
  onClose: () => void;
}

export default function SourcesModal({ stats, sourceStatus, onClose }: SourcesModalProps) {
  const totalCollected = DATA_SOURCES.reduce(
    (sum, source) => sum + (stats?.bySource?.[source.key] ?? 0),
    0
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#dfe6ec] bg-white"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#edf1f5] px-6 py-5">
          <div>
            <p className="tech-label">Sources / 数据来源</p>
            <h3 className="font-display mt-1.5 text-[22px] leading-none tracking-tight text-[#0b1726]">
              采集矩阵
            </h3>
            <p className="mt-2 text-xs text-[#8a99a8]">
              每次巡检并行抓取 {DATA_SOURCES.length} 个来源 · 累计采集{' '}
              <span className="text-[#1d4ed8]">{totalCollected.toLocaleString()}</span> 条
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-[#eef2f6] hover:text-[#0b1726]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 py-5">
          {DATA_SOURCES.map((source, index) => {
            const count = stats?.bySource?.[source.key] ?? 0;
            const status = sourceStatus?.sources.find(item => item.source === source.key);
            const badge = getStatusBadge(status);
            return (
              <motion.div
                key={source.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="group rounded-2xl border border-[#e3e9ef] bg-white p-4 transition-all hover:border-[#d7e0e8] hover:bg-[#f6f8fa]"
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                      source.accent
                    )}
                  >
                    {getSourceIcon(source.key)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-medium text-[#0b1726]">{source.name}</h4>
                      <span className="rounded-md border border-[#d7e0e8] bg-[#eef2f6] px-2 py-0.5 text-[10px] text-[#5c6f82]">
                        {source.category}
                      </span>
                      <span
                        className={cn(
                          'flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px]',
                          badge.className
                        )}
                        title={
                          status?.error ||
                          (status ? `最近运行：${status.keyword || '全部关键词'}` : '尚未执行巡检')
                        }
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', badge.dot)} />
                        {badge.label}
                        {status && status.count > 0 ? ` · ${status.count} 条` : ''}
                        {status?.cacheHit ? ' · 缓存' : ''}
                      </span>
                      {source.requiresKey && (
                        <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700">
                          需 API Key
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#6f8194]">
                      {source.description}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">{source.method}</p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-base font-semibold text-[#0b1726]">
                      {count.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-slate-600">已采集</p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      {status ? relativeTime(status.lastRunAt) : '尚未运行'}
                    </p>
                  </div>

                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`打开 ${source.name}`}
                    className="shrink-0 rounded-xl bg-[#eef2f6] p-2 text-[#6f8194] transition-all hover:bg-blue-500/20 hover:text-[#1d4ed8]"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="border-t border-[#edf1f5] px-6 py-4">
          <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-[#8a99a8]">
            <Database className="h-3 w-3" />
            单源失败不影响其他来源，巡检时间可在「巡检设置」中调整。
          </p>
        </div>
      </motion.div>
    </div>
  );
}
