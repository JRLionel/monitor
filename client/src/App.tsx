import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Flame, Search, Bell, Trash2, 
  ExternalLink, RefreshCw, X, Check, AlertTriangle,
  Zap, TrendingUp, Twitter, Globe, Eye, Activity, Clock, Target,
  ChevronLeft, ChevronRight,
  MessageCircle, Repeat2, Quote, User, Shield, ShieldAlert,
  ChevronDown, ChevronUp, ChevronsUpDown, ThermometerSun, FileText,
  Settings as SettingsIcon, Database, Mail, Rss
} from 'lucide-react';
import { 
  keywordsApi, hotspotsApi, notificationsApi, sourcesApi, triggerHotspotCheck,
  type Keyword, type Hotspot, type Stats, type Notification,
  type CheckSchedule, type SourceStatusSnapshot
} from './services/api';
import { onNewHotspot, onNotification, onSourceStatus, subscribeToKeywords } from './services/socket';
import { cn } from './lib/utils';
import FilterSortBar, { defaultFilterState, type FilterState } from './components/FilterSortBar';
import SettingsPanel from './components/SettingsPanel';
import EmailConfigPanel from './components/EmailConfigPanel';
import HotBoardPanel from './components/HotBoard';
import WechatSubscriptionsPanel from './components/WechatSubscriptions';
import KeywordsModal from './components/KeywordsModal';
import SourcesModal from './components/SourcesModal';
import ScheduleModal from './components/ScheduleModal';
import { formatScheduleLabel } from './utils/schedule';
import { sortHotspots, calcHotScore, hotScoreToDisplay } from './utils/sortHotspots';
import { relativeTime, formatDateTime } from './utils/relativeTime';
// TextGenerateEffect available for future use

function getHeatLevel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: '爆', color: 'text-red-600' };
  if (score >= 60) return { label: '热', color: 'text-orange-600' };
  if (score >= 40) return { label: '温', color: 'text-amber-700' };
  if (score >= 20) return { label: '凉', color: 'text-[#1d4ed8]' };
  return { label: '冷', color: 'text-[#6f8194]' };
}

const SEARCH_HISTORY_KEY = 'hotpulse:search-history';
const MAX_SEARCH_HISTORY = 12;

const NAV_ITEMS = [
  { key: 'dashboard', label: '热点雷达', en: 'RADAR', icon: Activity },
  { key: 'hotboard', label: '全网热榜', en: 'BOARDS', icon: Flame },
  { key: 'wechat', label: '公众号订阅', en: 'WECHAT', icon: Rss },
  { key: 'search', label: '搜索', en: 'SEARCH', icon: Search },
  { key: 'settings', label: '模型服务', en: 'MODELS', icon: SettingsIcon },
  { key: 'email', label: '邮件通知', en: 'MAIL', icon: Mail },
] as const;

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_SEARCH_HISTORY);
  } catch {
    return [];
  }
}

function App() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatusSnapshot | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showPatrolSchedule, setShowPatrolSchedule] = useState(false);
  const [patrolSchedule, setPatrolSchedule] = useState<CheckSchedule | null>(null);
  const [patrolLoading, setPatrolLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'hotboard' | 'wechat' | 'search' | 'settings' | 'email'>('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [dashboardFilters, setDashboardFilters] = useState<FilterState>({ ...defaultFilterState });
  const [searchFilters, setSearchFilters] = useState<FilterState>({ ...defaultFilterState });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchResults, setSearchResults] = useState<Hotspot[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => loadSearchHistory());
  const [selectedHotspotIds, setSelectedHotspotIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  // 展开/折叠状态
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedContents, setExpandedContents] = useState<Set<string>>(new Set());
  const [allReasonsExpanded, setAllReasonsExpanded] = useState(false);
  // 请求序号：只应用最新一次请求的结果，避免旧页码/旧筛选的响应覆盖新数据
  const loadSeqRef = useRef(0);

  // 加载数据
  const loadData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setIsLoading(true);
    try {
      const filterParams: Record<string, string | number> = {
        limit: 20,
        page: currentPage,
      };
      // Apply dashboard filters
      if (dashboardFilters.source) filterParams.source = dashboardFilters.source;
      if (dashboardFilters.importance) filterParams.importance = dashboardFilters.importance;
      if (dashboardFilters.keywordId) filterParams.keywordId = dashboardFilters.keywordId;
      if (dashboardFilters.timeRange) filterParams.timeRange = dashboardFilters.timeRange;
      if (dashboardFilters.isReal) filterParams.isReal = dashboardFilters.isReal;
      if (dashboardFilters.sortBy) filterParams.sortBy = dashboardFilters.sortBy;
      if (dashboardFilters.sortOrder) filterParams.sortOrder = dashboardFilters.sortOrder;

      const [keywordsData, hotspotsData, statsData, notifData] = await Promise.all([
        keywordsApi.getAll(),
        hotspotsApi.getAll(filterParams as any),
        hotspotsApi.getStats(),
        notificationsApi.getAll({ limit: 20 })
      ]);

      // 若已有更新的请求发出，丢弃本次（过期）结果
      if (seq !== loadSeqRef.current) return;

      setKeywords(keywordsData);
      setHotspots(hotspotsData.data);
      setTotalPages(hotspotsData.pagination.totalPages);
      setStats(statsData);
      setNotifications(notifData.data);
      setUnreadCount(notifData.unreadCount);

      // 订阅关键词
      const activeKeywords = keywordsData.filter(k => k.isActive).map(k => k.text);
      if (activeKeywords.length > 0) {
        subscribeToKeywords(activeKeywords);
      }
    } catch (error) {
      if (seq === loadSeqRef.current) {
        console.error('Failed to load data:', error);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [dashboardFilters, currentPage]);

  // 筛选条件变化时重置页码（与筛选同批更新，避免用旧页码多发一次请求）
  const handleDashboardFilterChange = (next: FilterState) => {
    setDashboardFilters(next);
    setCurrentPage(1);
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 离开搜索页时清空本次结果，只保留搜索记录
  useEffect(() => {
    if (activeTab !== 'search') {
      setSearchResults(prev => (prev.length ? [] : prev));
    }
  }, [activeTab]);

  // 翻页或筛选变化时清空热点选择
  useEffect(() => {
    setSelectedHotspotIds(new Set());
  }, [currentPage, dashboardFilters]);

  // WebSocket 事件
  useEffect(() => {
    const unsubHotspot = onNewHotspot((hotspot) => {
      setHotspots(prev => [hotspot as Hotspot, ...prev.slice(0, 19)]);
      showToast('发现新热点: ' + hotspot.title.slice(0, 30), 'success');
      loadData();
    });

    const unsubNotif = onNotification(() => {
      setUnreadCount(prev => prev + 1);
    });

    const unsubSourceStatus = onSourceStatus(setSourceStatus);

    sourcesApi.getStatus().then(setSourceStatus).catch(() => {});

    return () => {
      unsubHotspot();
      unsubNotif();
      unsubSourceStatus();
    };
  }, [loadData]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 添加关键词
  const handleAddKeyword = async (text: string) => {
    if (!text.trim()) return;

    try {
      const keyword = await keywordsApi.create({ text: text.trim() });
      setKeywords(prev => [keyword, ...prev]);
      showToast('关键词添加成功', 'success');
      subscribeToKeywords([keyword.text]);
    } catch (error: any) {
      showToast(error.message || '添加失败', 'error');
    }
  };

  // 删除关键词
  const handleDeleteKeyword = async (id: string) => {
    try {
      await keywordsApi.delete(id);
      setKeywords(prev => prev.filter(k => k.id !== id));
      showToast('关键词已删除', 'success');
    } catch (error) {
      showToast('删除失败', 'error');
    }
  };

  // 切换关键词状态
  const handleToggleKeyword = async (id: string) => {
    try {
      const updated = await keywordsApi.toggle(id);
      setKeywords(prev => prev.map(k => k.id === id ? updated : k));
    } catch (error) {
      showToast('操作失败', 'error');
    }
  };

  // 加载巡检设置
  useEffect(() => {
    hotspotsApi.getSchedule().then(setPatrolSchedule).catch(() => {});
  }, []);

  const openPatrolSchedule = async () => {
    setPatrolLoading(true);
    try {
      setPatrolSchedule(await hotspotsApi.getSchedule());
      setShowPatrolSchedule(true);
    } catch {
      showToast('获取巡检设置失败', 'error');
    } finally {
      setPatrolLoading(false);
    }
  };

  // 热点多选
  const toggleHotspotSelection = (id: string) => {
    setSelectedHotspotIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllHotspots = () => {
    setSelectedHotspotIds(prev =>
      prev.size === hotspots.length ? new Set() : new Set(hotspots.map(hotspot => hotspot.id))
    );
  };

  const refreshDashboardAfterDelete = (remainingOnPage: number) => {
    if (remainingOnPage === 0 && currentPage > 1) {
      setCurrentPage(page => Math.max(1, page - 1));
    } else {
      loadData();
    }
  };

  // 删除单条热点
  const handleDeleteHotspot = async (id: string) => {
    if (!window.confirm('确定删除这条热点吗？')) return;

    try {
      await hotspotsApi.delete(id);
      const remaining = hotspots.filter(hotspot => hotspot.id !== id);
      setHotspots(remaining);
      setSelectedHotspotIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast('热点已删除', 'success');
      refreshDashboardAfterDelete(remaining.length);
    } catch (error) {
      showToast('删除失败', 'error');
    }
  };

  // 批量删除热点
  const handleBatchDeleteHotspots = async () => {
    const ids = [...selectedHotspotIds];
    if (!ids.length) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 条热点吗？`)) return;

    setIsBatchDeleting(true);
    try {
      await hotspotsApi.deleteMany(ids);
      const idSet = new Set(ids);
      const remaining = hotspots.filter(hotspot => !idSet.has(hotspot.id));
      setHotspots(remaining);
      setSelectedHotspotIds(new Set());
      showToast(`已删除 ${ids.length} 条热点`, 'success');
      refreshDashboardAfterDelete(remaining.length);
    } catch (error) {
      showToast('批量删除失败', 'error');
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // 手动搜索：结果仅保留在当前搜索页，不写入热点雷达
  const runSearch = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    setSearchQuery(query);
    setIsLoading(true);
    try {
      const result = await hotspotsApi.search(query);
      const mapped: Hotspot[] = result.results.map((item, index) => ({
        id: `search-${index}-${item.url}`,
        title: item.title,
        content: item.content ?? '',
        url: item.url,
        source: item.source,
        sourceId: item.sourceId ?? null,
        isReal: item.analysis?.isReal ?? true,
        relevance: item.analysis?.relevance ?? 0,
        relevanceReason: item.analysis?.relevanceReason ?? null,
        keywordMentioned: item.analysis?.keywordMentioned ?? null,
        importance: item.analysis?.importance ?? 'medium',
        summary: item.analysis?.summary ?? null,
        viewCount: item.viewCount ?? null,
        likeCount: item.likeCount ?? null,
        retweetCount: item.retweetCount ?? null,
        replyCount: item.replyCount ?? null,
        commentCount: item.commentCount ?? null,
        quoteCount: item.quoteCount ?? null,
        danmakuCount: item.danmakuCount ?? null,
        authorName: item.author?.name ?? null,
        authorUsername: item.author?.username ?? null,
        authorAvatar: item.author?.avatar ?? null,
        authorFollowers: item.author?.followers ?? null,
        authorVerified: item.author?.verified ?? null,
        publishedAt: item.publishedAt ?? null,
        createdAt: new Date().toISOString(),
        keyword: null,
      }));

      setSearchResults(mapped);
      setSearchHistory(prev => {
        const next = [query, ...prev.filter(value => value !== query)].slice(0, MAX_SEARCH_HISTORY);
        try {
          localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
        } catch {
          // 本地存储不可用时仅保留内存中的搜索记录
        }
        return next;
      });
      showToast(`找到 ${mapped.length} 条结果`, 'success');
    } catch (error) {
      showToast('搜索失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(searchQuery);
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    try {
      localStorage.removeItem(SEARCH_HISTORY_KEY);
    } catch {
      // ignore
    }
  };

  // 手动触发检查
  const handleManualCheck = async () => {
    setIsChecking(true);
    try {
      await triggerHotspotCheck();
      showToast('热点检查已触发', 'success');
      setTimeout(loadData, 5000);
    } catch (error) {
      showToast('触发失败', 'error');
    } finally {
      setIsChecking(false);
    }
  };

  // 标记通知为已读
  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // 展开/折叠相关性理由
  const toggleReason = (id: string) => {
    setExpandedReasons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 展开/折叠原始内容
  const toggleContent = (id: string) => {
    setExpandedContents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 一键展开/折叠所有相关性理由
  const toggleAllReasons = (list: Hotspot[]) => {
    if (allReasonsExpanded) {
      setExpandedReasons(new Set());
    } else {
      setExpandedReasons(new Set(list.filter(h => h.relevanceReason).map(h => h.id)));
    }
    setAllReasonsExpanded(!allReasonsExpanded);
  };

  // Client-side filtering/sorting for search results
  const filteredSearchResults = useMemo(() => {
    let results = [...searchResults];

    // Apply filters
    if (searchFilters.source) {
      results = results.filter(h => h.source === searchFilters.source);
    }
    if (searchFilters.importance) {
      results = results.filter(h => h.importance === searchFilters.importance);
    }
    if (searchFilters.isReal === 'true') {
      results = results.filter(h => h.isReal);
    } else if (searchFilters.isReal === 'false') {
      results = results.filter(h => !h.isReal);
    }
    if (searchFilters.keywordId) {
      results = results.filter(h => h.keyword?.id === searchFilters.keywordId);
    }
    if (searchFilters.timeRange) {
      const now = new Date();
      let dateFrom: Date | null = null;
      switch (searchFilters.timeRange) {
        case '1h': dateFrom = new Date(now.getTime() - 60 * 60 * 1000); break;
        case 'today': dateFrom = new Date(now); dateFrom.setHours(0, 0, 0, 0); break;
        case '7d': dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case '30d': dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      }
      if (dateFrom) {
        results = results.filter(h => new Date(h.createdAt) >= dateFrom!);
      }
    }

    // Apply sorting using shared utility
    results = sortHotspots(results, searchFilters.sortBy || 'createdAt', (searchFilters.sortOrder || 'desc') as 'asc' | 'desc');

    return results;
  }, [searchResults, searchFilters]);

  const getImportanceIcon = (importance: string) => {
    switch (importance) {
      case 'urgent': return <AlertTriangle className="w-4 h-4" />;
      case 'high': return <Flame className="w-4 h-4" />;
      case 'medium': return <Zap className="w-4 h-4" />;
      default: return <TrendingUp className="w-4 h-4" />;
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'twitter': return <Twitter className="w-4 h-4" />;
      case 'bilibili': return <Eye className="w-4 h-4" />;
      case 'weibo': return <Activity className="w-4 h-4" />;
      case 'juejin': return <FileText className="w-4 h-4" />;
      case 'hackernews': return <Zap className="w-4 h-4" />;
      default: return <Globe className="w-4 h-4" />;
    }
  };

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      twitter: 'Twitter',
      bilibili: 'Bilibili',
      weibo: '微博热搜',
      juejin: '稀土掘金',
      hackernews: 'HackerNews'
    };
    return labels[source] || source;
  };

  const renderHeaderActions = () => (
    <div className="flex items-center gap-2.5">
      <motion.button
        onClick={handleManualCheck}
        disabled={isChecking}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          'flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all',
          isChecking
            ? 'bg-[#e9efff] text-[#1d4ed8] cursor-wait'
            : 'bg-[#0b1726] text-white shadow-[0_16px_32px_-20px_rgba(11,23,38,0.9)] hover:bg-[#16283c]'
        )}
      >
        <RefreshCw className={cn('h-4 w-4', isChecking && 'animate-spin')} />
        {isChecking ? '扫描中' : '立即扫描'}
      </motion.button>

      <div className="relative">
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative rounded-xl border border-[#dfe6ec] bg-white p-2.5 text-[#5f7183] transition-all hover:border-[#c9d5df] hover:text-[#0b1726]"
          aria-label="通知"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#ff5a36] text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        <AnimatePresence>
          {showNotifications && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              className="absolute right-0 top-14 z-50 w-80 overflow-hidden rounded-2xl border border-[#dfe6ec] bg-white shadow-[0_32px_80px_-40px_rgba(11,23,38,0.45)]"
            >
              <div className="flex items-center justify-between border-b border-[#edf1f5] p-4">
                <h3 className="text-sm font-semibold text-[#0b1726]">通知</h3>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs text-[#1d4ed8] hover:text-blue-700">
                    全部已读
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#8a99a8]">暂无通知</p>
                ) : (
                  <div className="divide-y divide-[#edf1f5]">
                    {notifications.slice(0, 5).map(n => (
                      <div key={n.id} className={cn('p-4 transition-colors', n.isRead ? 'opacity-50' : 'hover:bg-[#f7f9fb]')}>
                        <p className="text-sm font-medium text-[#0b1726]">{n.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-[#6f8194]">{n.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  const patrolLabel = formatScheduleLabel(patrolSchedule, '每 30 分钟');

  return (
    <div className="relative min-h-screen">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -right-40 -top-48 h-[620px] w-[620px] rounded-full bg-blue-500/[0.055] blur-[140px]" />
        <div className="absolute -bottom-56 left-[16%] h-[520px] w-[520px] rounded-full bg-teal-500/[0.045] blur-[140px]" />
        <div className="absolute inset-y-0 right-[22%] w-px bg-gradient-to-b from-transparent via-[#0b1726]/[0.045] to-transparent" />
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-6 left-1/2 z-50 px-5 py-3 rounded-full backdrop-blur-xl flex items-center gap-3 shadow-[0_24px_60px_-28px_rgba(11,23,38,0.45)] border bg-white/95",
              toast.type === 'success' 
                ? 'border-emerald-500/30 text-emerald-700' 
                : 'border-red-400/30 text-red-600'
            )}
          >
            {toast.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {showKeywords && (
        <KeywordsModal
          keywords={keywords}
          onClose={() => setShowKeywords(false)}
          onAdd={handleAddKeyword}
          onDelete={handleDeleteKeyword}
          onToggle={handleToggleKeyword}
        />
      )}

      {showSources && (
        <SourcesModal
          stats={stats}
          sourceStatus={sourceStatus}
          onClose={() => setShowSources(false)}
        />
      )}

      {showPatrolSchedule && patrolSchedule && (
        <ScheduleModal
          title="巡检设置"
          targetLabel="数据来源"
          actionLabel="巡检"
          schedule={patrolSchedule}
          onClose={() => setShowPatrolSchedule(false)}
          onSave={async data => {
            const saved = await hotspotsApi.saveSchedule(data);
            setPatrolSchedule(saved);
            showToast('巡检设置已保存', 'success');
          }}
          onError={message => showToast(message, 'error')}
        />
      )}

      {/* Sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col border-r border-[#dfe6ec] bg-white/75 backdrop-blur-2xl lg:flex">
        <div className="flex items-center gap-3 px-6 pb-7 pt-7">
          <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-[#0b1726] text-white shadow-[0_16px_30px_-20px_rgba(11,23,38,0.9)]">
            <Flame className="h-5 w-5" />
            <span className="signal-dot absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-500 text-emerald-500" />
          </div>
          <div>
            <p className="font-display text-[21px] font-semibold leading-none tracking-tight text-[#0b1726]">HotPulse</p>
            <p className="tech-label mt-1.5">Signal Lab</p>
          </div>
        </div>

        <nav className="flex-1 px-3">
          <p className="tech-label px-3 pb-2">Console / 控制台</p>
          <div className="space-y-1">
            {NAV_ITEMS.map(({ key, label, en, icon: Icon }, index) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all',
                  activeTab === key
                    ? 'bg-[#0b1726] text-white shadow-[0_16px_30px_-22px_rgba(11,23,38,0.9)]'
                    : 'text-[#42576b] hover:bg-white hover:text-[#0b1726]'
                )}
              >
                <span className={cn('font-mono-tech text-[10px] tracking-widest', activeTab === key ? 'text-white/45' : 'text-[#a4b1bd]')}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Icon className="h-4 w-4" />
                <span className="text-[13px] font-medium">{label}</span>
                <span className={cn('ml-auto font-mono-tech text-[9px] tracking-[0.14em]', activeTab === key ? 'text-white/35' : 'text-[#b6c2cd]')}>
                  {en}
                </span>
              </button>
            ))}
          </div>
        </nav>

        <div className="border-t border-[#dfe6ec] px-6 py-5">
          <div className="flex items-center gap-2">
            <span className="signal-dot h-1.5 w-1.5 rounded-full bg-emerald-500 text-emerald-500" />
            <span className="tech-label">System Online</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#8a99a8]">
            自动巡检 · Socket 实时推送
          </p>
        </div>
      </aside>

      <div className="relative z-10 lg:pl-[236px]">
        {/* Desktop top bar */}
        <header className="sticky top-0 z-20 hidden border-b border-[#dfe6ec] bg-[#f2f5f8]/80 backdrop-blur-xl lg:block">
          <div className="flex items-center justify-between px-10 py-3.5">
            <div className="flex items-center gap-4">
              <span className="tech-label">Live Intelligence</span>
              <span className="h-3 w-px bg-[#c9d5df]" />
              <span className="flex items-center gap-1.5 text-[11px] text-[#5f7183]">
                <span className="signal-dot h-1.5 w-1.5 rounded-full bg-emerald-500 text-emerald-500" />
                实时巡检运行中
              </span>
            </div>
            {renderHeaderActions()}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] px-4 pb-16 pt-5 sm:px-6 lg:px-10 lg:pt-8">
          {/* Mobile brand + actions */}
          <div className="mb-5 flex items-center justify-between gap-4 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="relative grid h-10 w-10 place-items-center rounded-2xl bg-[#0b1726] text-white">
                <Flame className="h-5 w-5" />
                <span className="signal-dot absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-500 text-emerald-500" />
              </div>
              <div>
                <p className="font-display text-[20px] font-semibold leading-none tracking-tight text-[#0b1726]">HotPulse</p>
                <p className="tech-label mt-1">Signal Lab</p>
              </div>
            </div>
            {renderHeaderActions()}
          </div>

          {/* Mobile nav */}
          <div className="mb-6 flex flex-wrap gap-2 lg:hidden">
            {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-all',
                  activeTab === key
                    ? 'border-[#0b1726] bg-[#0b1726] text-white'
                    : 'border-[#dfe6ec] bg-white/70 text-[#5f7183] backdrop-blur'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

        {/* 全网热榜 Tab */}
        {activeTab === 'hotboard' && (
          <HotBoardPanel />
        )}

        {/* 公众号订阅 Tab */}
        {activeTab === 'wechat' && (
          <WechatSubscriptionsPanel onToast={showToast} />
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {/* Page heading */}
            <div>
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <div>
                  <p className="tech-label">Radar / 热点雷达</p>
                  <h1 className="font-display mt-2 text-[32px] leading-none tracking-tight text-[#0b1726] sm:text-[38px]">
                    实时情报总览
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <motion.button
                    onClick={openPatrolSchedule}
                    disabled={patrolLoading}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    title="设置热点巡检时间"
                    className="flex items-center gap-2 rounded-xl border border-[#dfe6ec] bg-white px-4 py-2.5 text-[13px] font-medium text-[#0b1726] shadow-[0_16px_32px_-26px_rgba(11,23,38,0.45)] transition-all hover:border-[#c9d5df] disabled:opacity-50"
                  >
                    <Clock className="h-4 w-4 text-[#1d4ed8]" />
                    {formatScheduleLabel(patrolSchedule, '巡检设置')}
                  </motion.button>
                  <motion.button
                    onClick={() => setShowSources(true)}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-2 rounded-xl border border-[#dfe6ec] bg-white px-4 py-2.5 text-[13px] font-medium text-[#0b1726] shadow-[0_16px_32px_-26px_rgba(11,23,38,0.45)] transition-all hover:border-[#c9d5df]"
                  >
                    <Database className="h-4 w-4 text-[#1d4ed8]" />
                    数据来源
                  </motion.button>
                  <motion.button
                    onClick={() => setShowKeywords(true)}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-2 rounded-xl border border-[#dfe6ec] bg-white px-4 py-2.5 text-[13px] font-medium text-[#0b1726] shadow-[0_16px_32px_-26px_rgba(11,23,38,0.45)] transition-all hover:border-[#c9d5df]"
                  >
                    <Target className="h-4 w-4 text-[#1d4ed8]" />
                    监控词
                    <span className="rounded-full bg-[#eef2f6] px-2 py-0.5 text-[11px] tabular-nums text-[#5c6f82]">
                      {keywords.filter(k => k.isActive).length}/{keywords.length}
                    </span>
                  </motion.button>
                </div>
              </div>
              <p className="mt-3 max-w-xl text-xs leading-relaxed text-[#8a99a8]">
                所有来源{patrolLabel}巡检一次，经 AI 去重、相关性评分与跨源聚类后进入下方信息流。
              </p>
            </div>

            {/* Instrument strip */}
            {stats && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-px bg-[#e9eef3] sm:grid-cols-4">
                  <div className="relative bg-white px-5 py-5">
                    <p className="tech-label flex items-center gap-1.5 whitespace-nowrap">
                      <Activity className="h-3 w-3" />
                      Total / 总热点
                    </p>
                    <p className="font-display mt-2 text-[32px] leading-none tracking-tight text-[#0b1726]">
                      {stats.total}
                    </p>
                    <span className="absolute right-4 top-4 h-1.5 w-1.5 rounded-full bg-[#1d4ed8]" />
                  </div>

                  <div className="relative bg-white px-5 py-5">
                    <p className="tech-label flex items-center gap-1.5 whitespace-nowrap">
                      <Clock className="h-3 w-3" />
                      Today / 今日新增
                    </p>
                    <p className="font-display mt-2 text-[32px] leading-none tracking-tight text-[#1d4ed8]">
                      {stats.today}
                    </p>
                  </div>

                  <div className="relative bg-white px-5 py-5">
                    <p className="tech-label flex items-center gap-1.5 whitespace-nowrap">
                      <AlertTriangle className="h-3 w-3" />
                      Urgent / 紧急
                    </p>
                    <p className="font-display mt-2 text-[32px] leading-none tracking-tight text-[#ff5a36]">
                      {stats.urgent}
                    </p>
                    <span className="absolute right-4 top-4 h-1.5 w-1.5 rounded-full bg-[#ff5a36]" />
                  </div>

                  <div className="relative bg-white px-5 py-5">
                    <p className="tech-label flex items-center gap-1.5 whitespace-nowrap">
                      <Target className="h-3 w-3" />
                      Watch / 监控词
                    </p>
                    <p className="font-display mt-2 text-[32px] leading-none tracking-tight text-[#0f9f8f]">
                      {keywords.filter(k => k.isActive).length}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Hotspots Feed */}
            <div>
              <div className="mb-4 flex items-end justify-between gap-4 border-b border-[#dfe6ec] pb-3">
                <div>
                  <p className="tech-label">Stream / 信息流</p>
                  <h2 className="font-display mt-1.5 text-[24px] leading-none tracking-tight text-[#0b1726]">
                    实时热点流
                  </h2>
                </div>
                <span className="text-[11px] text-[#8a99a8]">{patrolLabel}自动更新</span>
              </div>

              {/* Filter & Sort Bar */}
              <div className="mb-5">
                <FilterSortBar
                  filters={dashboardFilters}
                  onChange={handleDashboardFilterChange}
                  keywords={keywords}
                />
              </div>
              
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : hotspots.length === 0 ? (
                <div className="text-center py-16 rounded-2xl border border-dashed border-[#d7e0e8]">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#eef2f6] flex items-center justify-center">
                    <Search className="w-8 h-8 text-slate-600" />
                  </div>
                  <p className="text-[#6f8194]">尚未发现热点</p>
                  <p className="text-sm text-slate-600 mt-1">添加监控关键词开始追踪</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 批量操作栏 */}
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-[#dfe6ec] bg-white/70 backdrop-blur">
                    <label className="flex items-center gap-2 text-xs text-[#5c6f82] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={hotspots.length > 0 && selectedHotspotIds.size === hotspots.length}
                        onChange={toggleSelectAllHotspots}
                        className="w-4 h-4 rounded border-[#cfdae3] bg-[#f6f8fa] accent-[#1d4ed8] cursor-pointer"
                      />
                      全选当前页
                      {selectedHotspotIds.size > 0 && (
                        <span className="text-[#1d4ed8]">已选 {selectedHotspotIds.size} 条</span>
                      )}
                    </label>
                    <button
                      onClick={handleBatchDeleteHotspots}
                      disabled={selectedHotspotIds.size === 0 || isBatchDeleting}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {isBatchDeleting
                        ? '删除中...'
                        : `批量删除${selectedHotspotIds.size ? `（${selectedHotspotIds.size}）` : ''}`}
                    </button>
                  </div>

                  {/* 一键展开/折叠所有理由 */}
                  {hotspots.some(h => h.relevanceReason) && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => toggleAllReasons(hotspots)}
                        className="flex items-center gap-1.5 text-xs text-[#6f8194] hover:text-[#1d4ed8] transition-colors px-3 py-1.5 rounded-lg hover:bg-[#eef2f6]"
                      >
                        <ChevronsUpDown className="w-3.5 h-3.5" />
                        {allReasonsExpanded ? '折叠所有理由' : '展开所有理由'}
                      </button>
                    </div>
                  )}

                  {hotspots.map((hotspot, index) => {
                    const heatScore = hotScoreToDisplay(calcHotScore(hotspot));
                    const heat = getHeatLevel(heatScore);
                    return (
                    <motion.div
                      key={hotspot.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="group relative overflow-hidden panel panel-hover p-5"
                    >
                      <span
                        className={cn(
                          'absolute left-0 top-6 h-8 w-[3px] rounded-r-full',
                          hotspot.importance === 'urgent' && 'bg-[#ff5a36]',
                          hotspot.importance === 'high' && 'bg-orange-500',
                          hotspot.importance === 'medium' && 'bg-[#d9a406]',
                          hotspot.importance === 'low' && 'bg-[#0f9f8f]'
                        )}
                      />
                      <div className="flex items-start justify-between gap-4">
                        <input
                          type="checkbox"
                          checked={selectedHotspotIds.has(hotspot.id)}
                          onChange={() => toggleHotspotSelection(hotspot.id)}
                          className="mt-1 w-4 h-4 shrink-0 rounded border-[#cfdae3] bg-[#f6f8fa] accent-[#1d4ed8] cursor-pointer"
                          aria-label={`选择热点：${hotspot.title}`}
                        />
                        <div className="flex-1 min-w-0">
                          {/* Row 1: Meta badges */}
                          <div className="flex flex-wrap items-center gap-2 mb-3">
                            <span className={cn(
                              "px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider flex items-center",
                              hotspot.importance === 'urgent' && "bg-red-50 text-red-600 border border-red-200",
                              hotspot.importance === 'high' && "bg-orange-50 text-orange-600 border border-orange-200",
                              hotspot.importance === 'medium' && "bg-amber-50 text-amber-700 border border-amber-200",
                              hotspot.importance === 'low' && "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            )}>
                              {getImportanceIcon(hotspot.importance)}
                              <span className="ml-1">{hotspot.importance}</span>
                            </span>
                            <span className="flex items-center gap-1 text-xs text-slate-600">
                              {getSourceIcon(hotspot.source)}
                              {getSourceLabel(hotspot.source)}
                            </span>
                            {hotspot.keyword && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-[#1d4ed8] border border-blue-500/20">
                                {hotspot.keyword.text}
                              </span>
                            )}
                            {/* 真实性标记 */}
                            {!hotspot.isReal && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-600 border border-red-500/20">
                                <ShieldAlert className="w-3 h-3" />
                                可疑
                              </span>
                            )}
                            {hotspot.isReal && hotspot.relevance >= 80 && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                                <Shield className="w-3 h-3" />
                                可信
                              </span>
                            )}
                            {hotspot.keywordMentioned === true && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-700 border border-purple-500/20">
                                <Target className="w-3 h-3" />
                                直接提及
                              </span>
                            )}
                            {hotspot.keywordMentioned === false && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-700 border border-yellow-500/20">
                                <Target className="w-3 h-3" />
                                间接相关
                              </span>
                            )}
                            {/* 热度综合指标 */}
                            <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-[#eef2f6] border border-[#d7e0e8] font-medium", heat.color)}>
                              <ThermometerSun className="w-3 h-3" />
                              {heat.label} {heatScore}
                            </span>
                          </div>
                          
                          {/* Title */}
                          <h3 className="font-display text-[19px] font-semibold leading-snug text-[#0b1726] mb-2 line-clamp-2 group-hover:text-[#1d4ed8] transition-colors">
                            {hotspot.title}
                          </h3>
                          
                          {/* AI Summary - 标注 */}
                          {hotspot.summary && (
                            <div className="mb-3">
                              <span className="text-[10px] text-[#1d4ed8]/70 font-medium mr-1.5">AI 摘要</span>
                              <span className="text-sm text-[#6f8194]">{hotspot.summary}</span>
                            </div>
                          )}

                          {/* 作者信息 */}
                          {hotspot.authorName && (
                            <div className="flex items-center gap-2 mb-3">
                              {hotspot.authorAvatar ? (
                                <img src={hotspot.authorAvatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                              ) : (
                                <User className="w-4 h-4 text-slate-600" />
                              )}
                              <span className="text-xs text-[#5c6f82]">
                                {hotspot.authorName}
                                {hotspot.authorUsername && <span className="text-slate-600 ml-1">@{hotspot.authorUsername}</span>}
                              </span>
                              {hotspot.authorVerified && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-[#1d4ed8]">✓ 认证</span>
                              )}
                              {hotspot.authorFollowers != null && hotspot.authorFollowers > 0 && (
                                <span className="text-[10px] text-slate-600">{hotspot.authorFollowers.toLocaleString()} 粉丝</span>
                              )}
                            </div>
                          )}
                          
                          {/* 互动数据 */}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mb-2">
                            <span className="flex items-center gap-1">
                              <Target className="w-3.5 h-3.5" />
                              相关性 {hotspot.relevance}%
                            </span>
                            {hotspot.likeCount != null && hotspot.likeCount > 0 && (
                              <span className="flex items-center gap-1" title="点赞">
                                <Zap className="w-3.5 h-3.5" />
                                {hotspot.likeCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.retweetCount != null && hotspot.retweetCount > 0 && (
                              <span className="flex items-center gap-1" title="转发">
                                <Repeat2 className="w-3.5 h-3.5" />
                                {hotspot.retweetCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.replyCount != null && hotspot.replyCount > 0 && (
                              <span className="flex items-center gap-1" title="回复">
                                <MessageCircle className="w-3.5 h-3.5" />
                                {hotspot.replyCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.commentCount != null && hotspot.commentCount > 0 && (
                              <span className="flex items-center gap-1" title="评论">
                                <MessageCircle className="w-3.5 h-3.5" />
                                {hotspot.commentCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.quoteCount != null && hotspot.quoteCount > 0 && (
                              <span className="flex items-center gap-1" title="引用">
                                <Quote className="w-3.5 h-3.5" />
                                {hotspot.quoteCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.viewCount != null && hotspot.viewCount > 0 && (
                              <span className="flex items-center gap-1" title="浏览量">
                                <Eye className="w-3.5 h-3.5" />
                                {hotspot.viewCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.danmakuCount != null && hotspot.danmakuCount > 0 && (
                              <span className="flex items-center gap-1" title="弹幕">
                                💬 {hotspot.danmakuCount.toLocaleString()}
                              </span>
                            )}
                          </div>

                          {/* 时间信息 */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                            {hotspot.publishedAt && (
                              <span className="flex items-center gap-1" title={`发布于 ${formatDateTime(hotspot.publishedAt)}`}>
                                <Clock className="w-3 h-3" />
                                发布 {relativeTime(hotspot.publishedAt)}
                              </span>
                            )}
                            <span className="flex items-center gap-1" title={`抓取于 ${formatDateTime(hotspot.createdAt)}`}>
                              <Activity className="w-3 h-3" />
                              抓取 {relativeTime(hotspot.createdAt)}
                            </span>
                          </div>

                          {/* AI 相关性理由 - 可折叠 */}
                          {hotspot.relevanceReason && (
                            <div className="mt-2">
                              <button
                                onClick={() => toggleReason(hotspot.id)}
                                className="flex items-center gap-1 text-[11px] text-[#1d4ed8]/70 hover:text-[#1d4ed8] transition-colors"
                              >
                                {expandedReasons.has(hotspot.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                AI 分析理由
                              </button>
                              <AnimatePresence>
                                {expandedReasons.has(hotspot.id) && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <p className="text-xs text-[#6f8194] mt-1 pl-4 border-l-2 border-blue-500/20">
                                      {hotspot.relevanceReason}
                                    </p>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}

                          {/* 原始内容 - 可折叠 */}
                          {hotspot.content && hotspot.content !== hotspot.summary && (
                            <div className="mt-2">
                              <button
                                onClick={() => toggleContent(hotspot.id)}
                                className="flex items-center gap-1 text-[11px] text-[#6f8194] hover:text-[#33475b] transition-colors"
                              >
                                {expandedContents.has(hotspot.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                <FileText className="w-3 h-3" />
                                原始内容
                              </button>
                              <AnimatePresence>
                                {expandedContents.has(hotspot.id) && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <p className="text-xs text-[#6f8194] mt-1 pl-4 border-l-2 border-[#d7e0e8] whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                      {hotspot.content}
                                    </p>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}
                        </div>
                        
                        {/* Actions */}
                        <div className="flex flex-col items-center gap-2 shrink-0">
                          <a
                            href={hotspot.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-2.5 rounded-xl bg-[#eef2f6] hover:bg-blue-500/20 text-[#6f8194] hover:text-[#1d4ed8] transition-all"
                            title="查看原文"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => handleDeleteHotspot(hotspot.id)}
                            className="p-2.5 rounded-xl bg-[#eef2f6] hover:bg-red-500/20 text-[#6f8194] hover:text-red-600 transition-all"
                            title="删除这条热点"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && !isLoading && (
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="p-2 rounded-xl bg-[#eef2f6] border border-[#d7e0e8] text-[#5c6f82] hover:text-[#0b1726] hover:border-[#c9d5df] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let page: number;
                      if (totalPages <= 7) {
                        page = i + 1;
                      } else if (currentPage <= 4) {
                        page = i + 1;
                      } else if (currentPage >= totalPages - 3) {
                        page = totalPages - 6 + i;
                      } else {
                        page = currentPage - 3 + i;
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={cn(
                            "w-8 h-8 rounded-lg text-xs font-medium transition-all",
                            currentPage === page
                              ? "bg-[#0b1726] text-white border border-[#0b1726]"
                              : "text-[#6f8194] hover:text-[#0b1726] hover:bg-[#eef2f6]"
                          )}
                        >
                          {page}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="p-2 rounded-xl bg-[#eef2f6] border border-[#d7e0e8] text-[#5c6f82] hover:text-[#0b1726] hover:border-[#c9d5df] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-600 ml-2">
                    共 {stats?.total || 0} 条
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            <div>
              <p className="tech-label">Search / 全网搜索</p>
              <h1 className="font-display mt-2 text-[30px] leading-none tracking-tight text-[#0b1726]">搜索情报</h1>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSearch} className="panel p-5">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索热点内容..."
                    className="w-full pl-12 pr-4 py-3 rounded-xl bg-[#eef2f6] border border-[#d7e0e8] text-[#0b1726] placeholder-[#9aa8b5] focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
                <motion.button 
                  type="submit" 
                  disabled={isLoading}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium flex items-center gap-2 shadow-lg shadow-blue-500/25 disabled:opacity-50"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  搜索
                </motion.button>
              </div>
            </form>

            {searchResults.length === 0 ? (
              /* 搜索记录：仅保留关键词，不保留上次搜索结果 */
              <div className="p-5 rounded-2xl bg-white border border-[#e3e9ef]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-[#0b1726] flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#6f8194]" />
                    搜索记录
                  </h3>
                  {searchHistory.length > 0 && (
                    <button
                      onClick={clearSearchHistory}
                      className="text-xs text-[#6f8194] hover:text-red-600 transition-colors"
                    >
                      清空记录
                    </button>
                  )}
                </div>
                {searchHistory.length === 0 ? (
                  <p className="text-sm text-slate-600 text-center py-8">
                    暂无搜索记录，输入关键词开始搜索
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {searchHistory.map(term => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => runSearch(term)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#eef2f6] hover:bg-blue-500/10 text-sm text-[#5c6f82] hover:text-[#1d4ed8] border border-[#e3e9ef] hover:border-blue-500/20 transition-all"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        {term}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-slate-600 mt-4">
                  搜索记录仅保存在本地；搜索结果只在当前页面展示，不会写入热点雷达。
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 px-1">
                  <div>
                    <h3 className="text-sm font-medium text-[#0b1726]">搜索结果</h3>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      「{searchQuery}」· {searchResults.length} 条 · 仅本次查看，不写入热点库
                    </p>
                  </div>
                  <button
                    onClick={() => setSearchResults([])}
                    className="text-xs text-[#6f8194] hover:text-[#33475b] transition-colors"
                  >
                    返回搜索记录
                  </button>
                </div>

                {/* Search Filter & Sort Bar */}
                <FilterSortBar
                  filters={searchFilters}
                  onChange={setSearchFilters}
                  keywords={keywords}
                />

                {/* Search Results */}
                <div className="space-y-3">
              {filteredSearchResults.length === 0 && searchResults.length > 0 && (
                <div className="text-center py-12 rounded-2xl border border-dashed border-[#d7e0e8]">
                  <p className="text-[#6f8194]">当前筛选条件下无结果</p>
                  <p className="text-sm text-slate-600 mt-1">尝试调整筛选条件</p>
                </div>
              )}
              {filteredSearchResults.map((hotspot, i) => {
                const heatScore = hotScoreToDisplay(calcHotScore(hotspot));
                const heat = getHeatLevel(heatScore);
                return (
                <motion.div 
                  key={hotspot.id} 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group p-5 rounded-2xl bg-white hover:bg-[#f6f8fa] border border-[#e3e9ef] transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase flex items-center",
                          hotspot.importance === 'urgent' && "bg-red-500/15 text-red-600 border border-red-500/20",
                          hotspot.importance === 'high' && "bg-orange-500/15 text-orange-600 border border-orange-500/20",
                          hotspot.importance === 'medium' && "bg-amber-500/15 text-amber-700 border border-amber-500/20",
                          hotspot.importance === 'low' && "bg-emerald-500/15 text-emerald-700 border border-emerald-500/20"
                        )}>
                          {getImportanceIcon(hotspot.importance)}
                          <span className="ml-1">{hotspot.importance}</span>
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-600">
                          {getSourceIcon(hotspot.source)}
                          {getSourceLabel(hotspot.source)}
                        </span>
                        {!hotspot.isReal && (
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-600 border border-red-500/20">
                            <ShieldAlert className="w-3 h-3" />
                            可疑
                          </span>
                        )}
                        <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-[#eef2f6] border border-[#d7e0e8] font-medium", heat.color)}>
                          <ThermometerSun className="w-3 h-3" />
                          {heat.label} {heatScore}
                        </span>
                      </div>
                      <h3 className="font-medium text-[#0b1726] mb-2 group-hover:text-[#1d4ed8] transition-colors">{hotspot.title}</h3>
                      {hotspot.summary && (
                        <div className="mb-2">
                          <span className="text-[10px] text-[#1d4ed8]/60 font-medium mr-1.5">AI 摘要</span>
                          <span className="text-sm text-[#6f8194]">{hotspot.summary}</span>
                        </div>
                      )}
                      {hotspot.authorName && (
                        <div className="flex items-center gap-2 mb-2">
                          <User className="w-4 h-4 text-slate-600" />
                          <span className="text-xs text-[#5c6f82]">{hotspot.authorName}</span>
                          {hotspot.authorVerified && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-[#1d4ed8]">✓ 认证</span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                        <span className="flex items-center gap-1">
                          <Target className="w-3.5 h-3.5" />
                          相关性 {hotspot.relevance}%
                        </span>
                        {hotspot.likeCount != null && hotspot.likeCount > 0 && (
                          <span className="flex items-center gap-1" title="点赞">
                            <Zap className="w-3.5 h-3.5" />
                            {hotspot.likeCount.toLocaleString()}
                          </span>
                        )}
                        {hotspot.viewCount != null && hotspot.viewCount > 0 && (
                          <span className="flex items-center gap-1" title="浏览量">
                            <Eye className="w-3.5 h-3.5" />
                            {hotspot.viewCount.toLocaleString()}
                          </span>
                        )}
                      </div>
                      {hotspot.publishedAt && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-600 mt-1" title={formatDateTime(hotspot.publishedAt)}>
                          <Clock className="w-3 h-3" />
                          发布 {relativeTime(hotspot.publishedAt)}
                        </div>
                      )}
                    </div>
                    <a
                      href={hotspot.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 px-4 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-[#1d4ed8] text-sm font-medium transition-all"
                    >
                      查看
                    </a>
                  </div>
                </motion.div>
                );
              })}
                </div>
              </>
            )}
          </div>
        )}

        {/* 模型服务 Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div>
              <p className="tech-label">Models / 模型服务</p>
              <h1 className="font-display mt-2 text-[30px] leading-none tracking-tight text-[#0b1726]">AI 能力配置</h1>
            </div>
            <SettingsPanel onToast={showToast} />
          </div>
        )}

        {/* 邮件通知 Tab */}
        {activeTab === 'email' && (
          <div className="space-y-6">
            <div>
              <p className="tech-label">Mail / 邮件通知</p>
              <h1 className="font-display mt-2 text-[30px] leading-none tracking-tight text-[#0b1726]">通知通道</h1>
            </div>
            <EmailConfigPanel onToast={showToast} />
          </div>
        )}
      </main>
      </div>
    </div>
  );
}

export default App;
