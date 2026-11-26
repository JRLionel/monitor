import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rss,
  Trash2,
  X,
} from 'lucide-react';
import {
  wechatApi,
  type WechatAccount,
  type WechatArticle,
  type WechatFeedPreview,
  type WechatSchedule,
} from '../services/api';
import { onWechatNew } from '../services/socket';
import ScheduleModal from './ScheduleModal';
import { cn } from '../lib/utils';
import { relativeTime } from '../utils/relativeTime';
import { formatScheduleLabel } from '../utils/schedule';

interface WechatSubscriptionsPanelProps {
  onToast?: (message: string, type: 'success' | 'error') => void;
}

const PAGE_SIZE = 20;

const inputClass =
  'w-full px-4 py-2.5 rounded-xl bg-[#f7f9fb] border border-[#dfe6ec] text-sm text-[#0b1726] placeholder-[#9aa8b5] focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all';

function accountStatus(account: WechatAccount): { label: string; dot: string } {
  if (!account.isActive) return { label: '已暂停', dot: 'bg-slate-400' };
  if (account.lastError) return { label: '抓取异常', dot: 'bg-red-500' };
  if (!account.lastCheckedAt) return { label: '待检查', dot: 'bg-amber-400' };
  return { label: '监听中', dot: 'bg-emerald-500' };
}

export default function WechatSubscriptionsPanel({ onToast }: WechatSubscriptionsPanelProps) {
  const toastRef = useRef(onToast);
  toastRef.current = onToast;
  const notify = useCallback((message: string, type: 'success' | 'error') => {
    toastRef.current?.(message, type);
  }, []);

  const [accounts, setAccounts] = useState<WechatAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [schedule, setSchedule] = useState<WechatSchedule | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const [articles, setArticles] = useState<WechatArticle[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: '', feedUrl: '' });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<WechatFeedPreview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      setAccounts(await wechatApi.getAccounts());
    } catch (error) {
      notify(error instanceof Error ? error.message : '获取订阅列表失败', 'error');
    } finally {
      setAccountsLoading(false);
    }
  }, [notify]);

  const loadArticles = useCallback(async () => {
    setArticlesLoading(true);
    try {
      const result = await wechatApi.getArticles({
        accountId: selectedId ?? undefined,
        unreadOnly,
        page,
        limit: PAGE_SIZE,
      });
      setArticles(result.data);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch (error) {
      notify(error instanceof Error ? error.message : '获取文章失败', 'error');
    } finally {
      setArticlesLoading(false);
    }
  }, [selectedId, unreadOnly, page, notify]);

  useEffect(() => {
    void loadAccounts();
    wechatApi
      .getSchedule()
      .then(setSchedule)
      .catch(() => {});
  }, [loadAccounts]);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  useEffect(() => {
    return onWechatNew(() => {
      void loadAccounts();
      void loadArticles();
    });
  }, [loadAccounts, loadArticles]);

  const totalUnread = useMemo(
    () => accounts.reduce((sum, account) => sum + (account.unreadCount ?? 0), 0),
    [accounts]
  );

  const latestArticleAt = useMemo(() => {
    let latest: string | null = null;
    for (const account of accounts) {
      if (!account.lastArticleAt) continue;
      if (!latest || new Date(account.lastArticleAt) > new Date(latest)) {
        latest = account.lastArticleAt;
      }
    }
    return latest;
  }, [accounts]);

  const selectedAccount = accounts.find(account => account.id === selectedId) ?? null;

  const refreshAll = async () => {
    await Promise.all([loadAccounts(), loadArticles()]);
  };

  const handleCheckAll = async () => {
    setCheckingAll(true);
    try {
      const result = await wechatApi.checkAll();
      notify(
        result.inserted > 0
          ? `检查完成，新增 ${result.inserted} 篇文章`
          : result.failed > 0
            ? `检查完成，${result.failed} 个订阅异常`
            : '检查完成，暂无新文章',
        result.failed > 0 && result.inserted === 0 ? 'error' : 'success'
      );
      await refreshAll();
    } catch (error) {
      notify(error instanceof Error ? error.message : '检查失败', 'error');
    } finally {
      setCheckingAll(false);
    }
  };

  const handleRefreshArticles = async () => {
    if (accounts.length === 0) return;
    setRefreshing(true);
    try {
      let inserted = 0;
      let error: string | undefined;

      if (selectedId) {
        const result = await wechatApi.checkAccount(selectedId);
        inserted = result.inserted;
        error = result.error;
      } else {
        const result = await wechatApi.checkAll();
        inserted = result.inserted;
        if (result.failed > 0) error = `${result.failed} 个订阅检查失败`;
      }

      notify(
        error
          ? `刷新失败：${error}`
          : inserted > 0
            ? `已同步，新增 ${inserted} 篇文章`
            : '已是最新，暂无新文章',
        error ? 'error' : 'success'
      );
      await refreshAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : '刷新失败', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCheckOne = async (account: WechatAccount) => {
    setActionId(account.id);
    try {
      const result = await wechatApi.checkAccount(account.id);
      notify(
        result.error
          ? `${account.name} 检查失败：${result.error}`
          : result.inserted > 0
            ? `${account.name} 新增 ${result.inserted} 篇文章`
            : `${account.name} 暂无新文章`,
        result.error ? 'error' : 'success'
      );
      await refreshAll();
    } catch (error) {
      notify(error instanceof Error ? error.message : '检查失败', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleToggle = async (account: WechatAccount) => {
    setActionId(account.id);
    try {
      await wechatApi.toggleAccount(account.id);
      notify(account.isActive ? '已暂停该订阅' : '已启用该订阅', 'success');
      await refreshAll();
    } catch (error) {
      notify(error instanceof Error ? error.message : '操作失败', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (account: WechatAccount) => {
    if (account.isBuiltin) return;
    if (!window.confirm(`确定删除订阅「${account.name}」及其全部文章吗？`)) return;
    setActionId(account.id);
    try {
      await wechatApi.removeAccount(account.id);
      if (selectedId === account.id) setSelectedId(null);
      notify('订阅已删除', 'success');
      setPage(1);
      await refreshAll();
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const result = await wechatApi.markRead(
        selectedId ? { accountId: selectedId } : { all: true }
      );
      notify(result.updated > 0 ? `已标记 ${result.updated} 篇文章为已读` : '没有未读文章', 'success');
      await refreshAll();
    } catch (error) {
      notify(error instanceof Error ? error.message : '标记已读失败', 'error');
    }
  };

  const handleOpenArticle = (article: WechatArticle) => {
    if (article.isRead) return;
    setArticles(prev =>
      prev.map(item => (item.id === article.id ? { ...item, isRead: true } : item))
    );
    setAccounts(prev =>
      prev.map(account =>
        account.id === article.accountId
          ? { ...account, unreadCount: Math.max(0, (account.unreadCount ?? 0) - 1) }
          : account
      )
    );
    wechatApi.markRead({ ids: [article.id] }).catch(() => {});
  };

  const openSchedule = async () => {
    setScheduleLoading(true);
    try {
      setSchedule(await wechatApi.getSchedule());
      setScheduleOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : '获取刷新设置失败', 'error');
    } finally {
      setScheduleLoading(false);
    }
  };

  const openModal = () => {
    setForm({ name: '', feedUrl: '' });
    setPreview(null);
    setFormError(null);
    setModalOpen(true);
  };

  const handleTestFeed = async () => {
    if (!form.feedUrl.trim()) {
      setFormError('请先填写订阅源地址');
      return;
    }
    setTesting(true);
    setFormError(null);
    setPreview(null);
    try {
      const result = await wechatApi.testFeed(form.feedUrl.trim());
      setPreview(result);
      if (!form.name.trim() && result.feedTitle) {
        setForm(prev => ({ ...prev, name: result.feedTitle }));
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '订阅源检测失败');
    } finally {
      setTesting(false);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('请填写公众号名称');
      return;
    }
    if (!form.feedUrl.trim()) {
      setFormError('请填写订阅源地址');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await wechatApi.createAccount({
        name: form.name.trim(),
        feedUrl: form.feedUrl.trim(),
      });
      setModalOpen(false);
      notify('订阅已添加，已建立当前文章基线', 'success');
      await refreshAll();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '添加订阅失败');
    } finally {
      setSaving(false);
    }
  };

  const selectAccount = (id: string | null) => {
    setSelectedId(id);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* 概览 */}
      <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-display flex items-center gap-2 text-[22px] font-semibold text-[#0b1726]">
            <Rss className="h-5 w-5 text-emerald-600" />
            公众号订阅
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            定时检查已订阅公众号的文章源，发现新文章会推送站内通知
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-right">
            <p className="text-xs text-slate-500">订阅账号</p>
            <p className="text-xl font-bold text-[#0b1726]">{accounts.length}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">未读文章</p>
            <p className="text-xl font-bold text-[#ff5a36]">{totalUnread}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">最近更新</p>
            <p className="text-xs font-medium text-[#33475b]">
              {latestArticleAt ? relativeTime(latestArticleAt) : '—'}
            </p>
          </div>
          <button
            onClick={openSchedule}
            disabled={scheduleLoading}
            className="flex items-center gap-2 rounded-xl border border-[#dfe6ec] bg-white px-4 py-2 text-sm font-medium text-[#42576b] transition-all hover:border-[#c9d5df] hover:text-[#0b1726] disabled:opacity-50"
            title="设置定时刷新规则"
          >
            <Clock className="h-4 w-4" />
            {formatScheduleLabel(schedule, '刷新设置')}
          </button>
          <button
            onClick={handleCheckAll}
            disabled={checkingAll || accounts.length === 0}
            className="flex items-center gap-2 rounded-xl border border-[#dfe6ec] bg-white px-4 py-2 text-sm font-medium text-[#42576b] transition-all hover:border-[#c9d5df] hover:text-[#0b1726] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', checkingAll && 'animate-spin')} />
            {checkingAll ? '检查中' : '全部检查'}
          </button>
          <button
            onClick={openModal}
            className="flex items-center gap-2 rounded-xl bg-[#0b1726] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#16283d]"
          >
            <Plus className="h-4 w-4" />
            添加订阅
          </button>
        </div>
      </div>

      {accountsLoading && accounts.length === 0 ? (
        <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="panel h-72 animate-pulse" />
          <div className="panel h-96 animate-pulse" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <Rss className="mx-auto mb-3 h-10 w-10 text-[#c9d5df]" />
          <p className="text-sm font-medium text-[#33475b]">还没有订阅任何公众号</p>
          <p className="mt-1 text-xs text-[#8a99a8]">
            添加公众号的 RSS / Atom 订阅地址，系统会定时检查最新文章
          </p>
          <button
            onClick={openModal}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0b1726] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#16283d]"
          >
            <Plus className="h-4 w-4" />
            添加第一个订阅
          </button>
        </div>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* 账号列表 */}
          <aside className="panel overflow-hidden">
            <header className="flex items-center justify-between border-b border-[#dfe6ec] px-4 py-3">
              <h3 className="text-sm font-semibold text-[#0b1726]">订阅账号</h3>
              <button
                onClick={() => selectAccount(null)}
                className={cn(
                  'rounded-lg border px-2 py-0.5 text-[10px] transition-colors',
                  selectedId === null
                    ? 'border-[#0b1726] bg-[#0b1726] text-white'
                    : 'border-[#dfe6ec] text-[#5f7183] hover:text-[#0b1726]'
                )}
              >
                全部
              </button>
            </header>
            <div>
              {accounts.map(account => {
                const status = accountStatus(account);
                const active = selectedId === account.id;
                return (
                  <div
                    key={account.id}
                    onClick={() => selectAccount(account.id)}
                    className={cn(
                      'group flex cursor-pointer items-center gap-3 border-b border-[#f0f4f7] px-3 py-2.5 transition-colors last:border-0',
                      active ? 'bg-[#f2f5f8]' : 'hover:bg-[#f7f9fb]'
                    )}
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#e3e9ef] bg-[#eef2f6] text-xs font-semibold text-[#5c6f82]">
                      {account.avatar ? (
                        <img src={account.avatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        account.name.slice(0, 1)
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[13px] font-medium text-[#0b1726]">
                          {account.name}
                        </p>
                        {account.isBuiltin && (
                          <span
                            className="shrink-0 rounded bg-[#eef2f6] px-1.5 py-0.5 text-[10px] font-medium text-[#5c6f82]"
                            title="内置默认订阅，不可删除"
                          >
                            默认
                          </span>
                        )}
                        {!!account.unreadCount && (
                          <span className="shrink-0 rounded-full bg-[#ff5a36] px-1.5 text-[10px] font-bold leading-4 text-white">
                            {account.unreadCount > 99 ? '99+' : account.unreadCount}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#8a99a8]">
                        <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
                        <span>{status.label}</span>
                        <span>·</span>
                        <span>
                          {account.lastArticleAt ? relativeTime(account.lastArticleAt) : '暂无文章'}
                        </span>
                      </div>
                      {account.lastError && (
                        <p
                          className="mt-1 line-clamp-1 text-[10px] text-red-600"
                          title={account.lastError}
                        >
                          {account.lastError}
                        </p>
                      )}
                    </div>

                    <div
                      className="flex shrink-0 items-center gap-0.5 text-[#a4b1bd]"
                      onClick={event => event.stopPropagation()}
                    >
                      <button
                        title="立即检查"
                        onClick={() => handleCheckOne(account)}
                        disabled={actionId === account.id}
                        className={cn(
                          'rounded-lg p-1 transition-colors hover:bg-[#eef2f6]',
                          account.isBuiltin
                            ? 'text-emerald-600 hover:text-emerald-700'
                            : 'hover:text-[#0b1726]'
                        )}
                      >
                        {actionId === account.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {!account.isBuiltin && (
                        <button
                          title={account.isActive ? '暂停订阅' : '启用订阅'}
                          onClick={() => handleToggle(account)}
                          disabled={actionId === account.id}
                          className="rounded-lg p-1 transition-colors hover:bg-[#eef2f6] hover:text-[#0b1726]"
                        >
                          {account.isActive ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      {!account.isBuiltin && (
                        <button
                          title="删除订阅"
                          onClick={() => handleDelete(account)}
                          disabled={actionId === account.id}
                          className="rounded-lg p-1 transition-colors hover:bg-red-500/10 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* 文章列表 */}
          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe6ec] bg-white/95 px-5 py-3.5 backdrop-blur">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="font-display truncate text-[18px] font-semibold leading-none text-[#0b1726]">
                  {selectedAccount ? selectedAccount.name : '全部文章'}
                </h3>
                <span className="shrink-0 rounded border border-[#e3e9ef] bg-[#f4f7fa] px-1.5 py-0.5 font-mono-tech text-[10px] tracking-wider text-[#5c6f82]">
                  {total} 篇
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setUnreadOnly(value => !value);
                    setPage(1);
                  }}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
                    unreadOnly
                      ? 'border-[#0b1726] bg-[#0b1726] text-white'
                      : 'border-[#dfe6ec] text-[#5f7183] hover:text-[#0b1726]'
                  )}
                >
                  仅未读
                </button>
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 rounded-lg border border-[#dfe6ec] px-2.5 py-1 text-[11px] text-[#5f7183] transition-colors hover:text-[#0b1726]"
                >
                  <CheckCheck className="h-3 w-3" />
                  全部已读
                </button>
                <button
                  onClick={handleRefreshArticles}
                  disabled={refreshing || articlesLoading || accounts.length === 0}
                  className="flex items-center gap-1 rounded-lg border border-[#dfe6ec] px-2.5 py-1 text-[11px] text-[#5f7183] transition-colors hover:text-[#0b1726] disabled:opacity-50"
                  title="从订阅源拉取最新文章"
                >
                  <RefreshCw
                    className={cn('h-3 w-3', (refreshing || articlesLoading) && 'animate-spin')}
                  />
                  {refreshing ? '刷新中' : '刷新文章'}
                </button>
              </div>
            </header>

            {articlesLoading && articles.length === 0 ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2].map(index => (
                  <div key={index} className="h-16 animate-pulse rounded-xl bg-[#f2f5f8]" />
                ))}
              </div>
            ) : articles.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <p className="text-sm text-[#6f8194]">
                  {unreadOnly ? '当前没有未读文章' : '还没有文章'}
                </p>
                <p className="mt-1 text-xs text-[#8a99a8]">
                  订阅建立后，系统只会在公众号发布新文章时推送
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#f0f4f7] md:max-h-[calc(100vh-260px)] md:overflow-y-auto">
                {articles.map((article, index) => (
                  <motion.a
                    key={article.id}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleOpenArticle(article)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index * 0.02, 0.2) }}
                    className="flex gap-3 px-5 py-4 transition-colors hover:bg-[#f7f9fb]"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm leading-snug',
                          article.isRead ? 'text-[#6f8194]' : 'font-medium text-[#0b1726]'
                        )}
                      >
                        {!article.isRead && (
                          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#ff5a36] align-middle" />
                        )}
                        {article.title}
                      </p>
                      {article.digest && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#8a99a8]">
                          {article.digest}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#8a99a8]">
                        <span className="rounded bg-[#eef2f6] px-1.5 py-0.5 text-[#5c6f82]">
                          {article.account?.name ?? '公众号'}
                        </span>
                        <span>
                          {relativeTime(article.publishedAt ?? article.createdAt)}
                        </span>
                        <ExternalLink className="h-3 w-3" />
                      </div>
                    </div>
                  </motion.a>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <footer className="flex items-center justify-between border-t border-[#dfe6ec] px-5 py-3 text-xs text-[#6f8194]">
                <span>共 {total} 篇</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(value => Math.max(1, value - 1))}
                    disabled={page <= 1 || articlesLoading}
                    className="rounded-lg border border-[#dfe6ec] p-1 transition-colors hover:text-[#0b1726] disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span>
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(value => Math.min(totalPages, value + 1))}
                    disabled={page >= totalPages || articlesLoading}
                    className="rounded-lg border border-[#dfe6ec] p-1 transition-colors hover:text-[#0b1726] disabled:opacity-40"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </footer>
            )}
          </section>
        </div>
      )}

      {/* 刷新设置弹窗 */}
      {scheduleOpen && schedule && (
        <ScheduleModal
          title="刷新设置"
          targetLabel="订阅源"
          actionLabel="刷新"
          schedule={schedule}
          onClose={() => setScheduleOpen(false)}
          onSave={async data => {
            const saved = await wechatApi.saveSchedule(data);
            setSchedule(saved);
            notify('刷新设置已保存', 'success');
          }}
          onError={message => notify(message, 'error')}
        />
      )}

      {/* 添加订阅弹窗 */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-lg space-y-4 rounded-2xl border border-[#dfe6ec] bg-white p-6"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#0b1726]">添加公众号订阅</h3>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-[#eef2f6] hover:text-[#0b1726]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#5f7183]">公众号名称</label>
              <input
                className={inputClass}
                placeholder="如：少数派"
                value={form.name}
                onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#5f7183]">
                订阅源地址（RSS / Atom）
              </label>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="https://example.com/wechat/feed.xml"
                  value={form.feedUrl}
                  onChange={event => {
                    setForm(prev => ({ ...prev, feedUrl: event.target.value }));
                    setPreview(null);
                  }}
                />
                <button
                  onClick={handleTestFeed}
                  disabled={testing}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#dfe6ec] px-3 text-xs font-medium text-[#42576b] transition-colors hover:text-[#0b1726] disabled:opacity-50"
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rss className="h-3.5 w-3.5" />
                  )}
                  检测
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[#8a99a8]">
                支持公众号转 RSS 服务生成的订阅地址，保存后会以当前最新文章为基线
              </p>
            </div>

            {preview && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <CheckCheck className="h-3.5 w-3.5" />
                  已识别 {preview.itemCount} 篇文章
                  {preview.feedTitle ? ` · ${preview.feedTitle}` : ''}
                </p>
                <ul className="mt-2 space-y-1">
                  {preview.items.slice(0, 3).map(item => (
                    <li key={item.url} className="truncate text-[11px] text-[#5c6f82]">
                      · {item.title}
                      {item.publishedAt ? ` · ${relativeTime(item.publishedAt)}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {formError && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-[#dfe6ec] px-4 py-2 text-sm text-[#5f7183] transition-colors hover:text-[#0b1726]"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#0b1726] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#16283d] disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                确认订阅
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
