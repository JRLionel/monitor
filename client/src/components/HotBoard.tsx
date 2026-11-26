import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ExternalLink,
  Flame,
  Globe2,
  Layers,
  Newspaper,
  RefreshCw,
} from 'lucide-react';
import {
  hotBoardApi,
  type HotBoard as HotBoardData,
  type HotBoardGroup,
  type HotBoardItem,
  type HotBoardSnapshot,
} from '../services/api';
import { cn } from '../lib/utils';
import { relativeTime } from '../utils/relativeTime';

type GroupKey = 'all' | HotBoardGroup;

const GROUP_META: { key: GroupKey; label: string; icon: typeof Flame }[] = [
  { key: 'all', label: '全部', icon: Layers },
  { key: 'cn', label: '国内热榜', icon: Flame },
  { key: 'news', label: '科技资讯', icon: Newspaper },
  { key: 'global', label: '全球视野', icon: Globe2 },
];

const RAIL_GROUPS: { key: HotBoardGroup; label: string }[] = [
  { key: 'cn', label: '国内热榜' },
  { key: 'news', label: '科技资讯' },
  { key: 'global', label: '全球视野' },
];

function formatHot(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '';
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return String(Math.round(value));
}

function BoardRow({ item, index }: { item: HotBoardItem; index: number }) {
  const meta = item.hotValue ? formatHot(item.hotValue) : item.label;
  const rank = item.rank || index + 1;

  const content = (
    <>
      <span
        className={cn(
          'w-6 shrink-0 text-right text-xs font-semibold tabular-nums',
          rank <= 3 ? 'text-red-600' : 'text-slate-600'
        )}
      >
        {rank}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-[#33475b] group-hover/item:text-[#0b1726] transition-colors line-clamp-2">
          {item.title}
        </span>
        {item.desc && (
          <span className="block text-[11px] text-slate-600 mt-0.5 line-clamp-1">{item.desc}</span>
        )}
      </span>
      {meta && (
        <span className="shrink-0 text-[10px] text-slate-600 tabular-nums mt-0.5">{meta}</span>
      )}
      {item.pinned && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 border border-red-500/20">
          置顶
        </span>
      )}
    </>
  );

  if (!item.url) {
    return <div className="flex items-start gap-2 px-5 py-2.5">{content}</div>;
  }

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group/item flex items-start gap-3 px-5 py-2.5 hover:bg-[#f7f9fb] transition-colors"
    >
      {content}
    </a>
  );
}

function BoardDetail({ board }: { board: HotBoardData }) {
  return (
    <motion.section
      key={board.label}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel overflow-hidden min-h-[360px]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[#dfe6ec] bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-display truncate text-[21px] font-semibold leading-none text-[#0b1726]">
            {board.label}
          </h3>
          <span className="shrink-0 rounded border border-[#e3e9ef] bg-[#f4f7fa] px-1.5 py-0.5 font-mono-tech text-[10px] tracking-wider text-[#5c6f82]">
            {board.code}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-[#8a99a8]">
          {board.items.length ? `${board.items.length} 条` : '未获取'}
        </span>
      </header>

      {board.items.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-[#6f8194]">这次暂时没有取到内容</p>
          {board.error && <p className="mt-1 line-clamp-2 text-[11px] text-[#8a99a8]">{board.error}</p>}
        </div>
      ) : (
        <div className="divide-y divide-[#f0f4f7] md:max-h-[calc(100vh-240px)] md:overflow-y-auto">
          {board.items.map((item, index) => (
            <BoardRow key={`${item.rank}-${item.title}`} item={item} index={index} />
          ))}
        </div>
      )}
    </motion.section>
  );
}

export default function HotBoardPanel() {
  const [snapshot, setSnapshot] = useState<HotBoardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupKey>('all');
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await hotBoardApi.get({ refresh, limit: 30 });
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '全网热榜获取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const boards = useMemo(() => Object.entries(snapshot?.boards ?? {}), [snapshot]);

  const groupCounts = useMemo(() => {
    const counts: Record<GroupKey, number> = { all: boards.length, cn: 0, news: 0, global: 0 };
    for (const [, board] of boards) {
      counts[board.group] += 1;
    }
    return counts;
  }, [boards]);

  const visibleBoards = useMemo(
    () => boards.filter(([, board]) => group === 'all' || board.group === group),
    [boards, group]
  );

  const railGroups = useMemo(
    () =>
      RAIL_GROUPS.map(meta => ({
        ...meta,
        boards: visibleBoards.filter(([, board]) => board.group === meta.key),
      })).filter(item => item.boards.length > 0),
    [visibleBoards]
  );

  const selectedEntry =
    visibleBoards.find(([id]) => id === activeBoardId) ?? visibleBoards[0];
  const selectedId = selectedEntry?.[0];
  const selectedBoard = selectedEntry?.[1];

  const totalItems = useMemo(
    () => boards.reduce((sum, [, board]) => sum + board.items.length, 0),
    [boards]
  );
  const liveSources = useMemo(
    () => boards.filter(([, board]) => board.items.length > 0).length,
    [boards]
  );

  const selectBoard = (id: string) => {
    setActiveBoardId(id);
  };

  return (
    <div className="space-y-6">
      {/* 概览 */}
      <div className="panel p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-[22px] font-semibold text-[#0b1726] flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-600" />
            全网热榜
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            聚合微博、百度、抖音、头条、B站、知乎、科技资讯与 Hacker News，同一事件跨平台合并
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs text-slate-500">有内容来源</p>
            <p className="text-xl font-bold text-[#0b1726]">
              {liveSources}
              <span className="text-sm text-slate-600"> / {boards.length}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">收录条目</p>
            <p className="text-xl font-bold text-orange-600">{totalItems.toLocaleString()}</p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-50 text-orange-600 text-sm font-medium border border-orange-500/20 transition-all"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </div>

      {snapshot && (
        <p className="text-[11px] text-slate-600 -mt-3">
          快照生成于 {relativeTime(snapshot.generatedAt)} · 榜单排名与热度以来源页面为准
        </p>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 同频热点 */}
      {snapshot && snapshot.topics.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#1d4ed8]" />
            <h3 className="text-sm font-semibold text-[#0b1726]">同频热点</h3>
            <span className="text-[11px] text-slate-600">在不同平台，遇见同一个话题</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {snapshot.topics.map((topic, index) => (
              <motion.article
                key={`${topic.title}-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
                className="px-3 py-2.5 rounded-xl bg-gradient-to-br from-blue-500/[0.05] to-transparent border border-blue-500/10"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-[#1d4ed8] border border-blue-500/20">
                    {topic.platformCount} 个平台
                  </span>
                  <span>热度分 {topic.score}</span>
                </div>
                {topic.url ? (
                  <a
                    href={topic.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[13px] font-medium leading-snug text-[#0b1726] hover:text-[#1d4ed8] transition-colors line-clamp-1"
                  >
                    {topic.title}
                  </a>
                ) : (
                  <p className="text-[13px] font-medium leading-snug text-[#0b1726] line-clamp-1">{topic.title}</p>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {topic.mentions.map(mention => (
                    <a
                      key={`${mention.platform}-${mention.title}`}
                      href={mention.url || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#eef2f6] hover:bg-[#e5ebf1] text-[#5c6f82] hover:text-[#0b1726] border border-[#e3e9ef] transition-colors"
                      title={mention.title}
                    >
                      {mention.label}
                      <span className="text-slate-600">#{mention.rank}</span>
                    </a>
                  ))}
                </div>
              </motion.article>
            ))}
          </div>
        </section>
      )}

      {/* 平台筛选 */}
      <div className="flex flex-wrap gap-2">
        {GROUP_META.map(({ key, label, icon: Icon }) => {
          const count = groupCounts[key];
          if (key !== 'all' && count === 0) return null;
          return (
            <button
              key={key}
              onClick={() => {
                setGroup(key);
                setActiveBoardId(null);
              }}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all',
                group === key
                  ? 'bg-[#e5ebf1] text-[#0b1726] border border-[#d7e0e8]'
                  : 'text-slate-500 hover:text-[#33475b] hover:bg-[#eef2f6] border border-transparent'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              <span className="text-slate-600">{count}</span>
            </button>
          );
        })}
      </div>

      {/* 信息来源 / 热榜 分栏 */}
      {loading && !snapshot ? (
        <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="panel h-80 animate-pulse" />
          <div className="panel h-[520px] animate-pulse" />
        </div>
      ) : selectedBoard ? (
        <div className="grid items-start gap-3 sm:grid-cols-[180px_minmax(0,1fr)] md:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="panel p-2 sm:sticky sm:top-4 sm:h-fit lg:top-24">
            <div className="flex gap-2 overflow-x-auto sm:flex-col sm:gap-0 sm:overflow-visible">
              {railGroups.map(section => (
                <div key={section.key} className="contents sm:block sm:space-y-0.5">
                  <p className="tech-label hidden px-3 pb-1 pt-3 sm:block">{section.label}</p>
                  {section.boards.map(([id, board]) => {
                    const active = selectedId === id;
                    return (
                      <button
                        key={id}
                        onClick={() => selectBoard(id)}
                        className={cn(
                          'flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all sm:w-full',
                          active
                            ? 'bg-[#0b1726] text-white'
                            : 'text-[#42576b] hover:bg-[#f1f5f9]'
                        )}
                      >
                        <span className="whitespace-nowrap text-[13px] font-medium">{board.label}</span>
                        <span
                          className={cn(
                            'ml-auto hidden font-mono-tech text-[10px] sm:inline',
                            active ? 'text-white/50' : 'text-[#a4b1bd]'
                          )}
                        >
                          {board.items.length || '—'}
                        </span>
                        {board.items.length === 0 && (
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              active ? 'bg-white/40' : 'bg-[#e0b4b4]'
                            )}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </aside>

          <BoardDetail board={selectedBoard} />
        </div>
      ) : null}

      {!loading && !error && snapshot && boards.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-10">暂无可用的热榜来源</p>
      )}

      <p className="text-xs text-slate-600 flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        点击条目会在新窗口打开来源页面
      </p>
    </div>
  );
}
