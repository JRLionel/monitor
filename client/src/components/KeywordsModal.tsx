import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Target, Trash2, X } from 'lucide-react';
import type { Keyword } from '../services/api';
import { cn } from '../lib/utils';

interface KeywordsModalProps {
  keywords: Keyword[];
  onClose: () => void;
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

export default function KeywordsModal({
  keywords,
  onClose,
  onAdd,
  onDelete,
  onToggle,
}: KeywordsModalProps) {
  const [text, setText] = useState('');
  const activeCount = keywords.filter(keyword => keyword.isActive).length;

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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#dfe6ec] bg-white"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#edf1f5] px-6 py-5">
          <div>
            <p className="tech-label">Watchlist / 监控词</p>
            <h3 className="font-display mt-1.5 text-[22px] leading-none tracking-tight text-[#0b1726]">
              监控关键词
            </h3>
            <p className="mt-2 text-xs text-[#8a99a8]">
              共 {keywords.length} 个 · {activeCount} 个生效
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <form onSubmit={handleSubmit} className="flex gap-2.5">
            <input
              type="text"
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="输入要监控的关键词，如：GPT-5、AI编程、Cursor..."
              className="w-full flex-1 rounded-xl border border-[#d7e0e8] bg-[#eef2f6] px-4 py-2.5 text-sm text-[#0b1726] placeholder-[#9aa8b5] transition-all focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <motion.button
              type="submit"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/25"
            >
              <Plus className="h-4 w-4" />
              添加
            </motion.button>
          </form>

          <div className="grid gap-2.5 md:grid-cols-2">
            <AnimatePresence>
              {keywords.map((keyword, index) => (
                <motion.div
                  key={keyword.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.02 }}
                  className={cn(
                    'group flex items-center justify-between rounded-xl border p-3 transition-all',
                    keyword.isActive
                      ? 'border-[#c7d7fe] bg-white hover:border-[#a9c2fb]'
                      : 'border-[#e3e9ef] bg-[#fafbfc] opacity-60'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => onToggle(keyword.id)}
                      className={cn(
                        'relative h-5 w-9 rounded-full transition-all',
                        keyword.isActive ? 'bg-[#1d4ed8]' : 'bg-[#c9d5df]'
                      )}
                      aria-label={keyword.isActive ? '停用' : '启用'}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                          keyword.isActive ? 'left-[18px]' : 'left-0.5'
                        )}
                      />
                    </button>
                    <span
                      className={cn(
                        'text-sm font-medium',
                        keyword.isActive ? 'text-[#0b1726]' : 'text-[#6f8194]'
                      )}
                    >
                      {keyword.text}
                    </span>
                    {keyword._count && keyword._count.hotspots > 0 && (
                      <span className="text-[11px] text-[#8a99a8]">
                        {keyword._count.hotspots} 条
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => onDelete(keyword.id)}
                    className="rounded-lg p-1.5 text-slate-500 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
                    aria-label="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {keywords.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[#d7e0e8] py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#eef2f6]">
                <Target className="h-7 w-7 text-slate-600" />
              </div>
              <p className="text-sm text-[#6f8194]">还没有监控关键词</p>
              <p className="mt-1 text-xs text-[#8a99a8]">添加你想追踪的技术热点词</p>
            </div>
          )}
        </div>

        <div className="border-t border-[#edf1f5] px-6 py-4">
          <p className="text-[11px] leading-relaxed text-[#8a99a8]">
            生效的关键词会参与 30 分钟自动巡检，并实时推送匹配到的新热点。
          </p>
        </div>
      </motion.div>
    </div>
  );
}
