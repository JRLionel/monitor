import { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, X } from 'lucide-react';
import type { CheckSchedule, ScheduleMode } from '../services/api';
import { cn } from '../lib/utils';

interface ScheduleModalProps {
  /** 弹窗标题，如「刷新设置」「巡检设置」 */
  title: string;
  /** 定时执行的对象，用于说明文案，如「订阅源」「数据来源」 */
  targetLabel: string;
  /** 执行动作，用于间隔说明文案，如「刷新」「巡检」 */
  actionLabel: string;
  schedule: CheckSchedule;
  onClose: () => void;
  onSave: (data: {
    mode: ScheduleMode;
    intervalMinutes: number;
    dailyTime: string;
  }) => Promise<void>;
  onError: (message: string) => void;
}

const INTERVALS = [30, 60, 120, 240, 480];
const MINUTES = [0, 15, 30, 45];
const HOURS = Array.from({ length: 24 }, (_, index) => index);

const ITEM_HEIGHT = 40;
const WHEEL_HEIGHT = 200;

const pad = (value: number) => String(value).padStart(2, '0');

function formatInterval(minutes: number): string {
  return minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`;
}

function parseTime(value: string): { hour: number; minute: number } {
  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  return {
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute: MINUTES.includes(minute) ? minute : 0,
  };
}

interface WheelColumnProps {
  values: number[];
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  widthClass?: string;
}

/** 闹钟式滚轮选择列：上下滚动吸附，中间高亮当前值 */
function WheelColumn({
  values,
  value,
  onChange,
  format = pad,
  widthClass = 'w-24',
}: WheelColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = Math.max(0, values.indexOf(value));
  const [scrollTop, setScrollTop] = useState(index * ITEM_HEIGHT);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = index * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTo({ top: target });
    }
    setScrollTop(target);
  }, [index]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const nextIndex = Math.min(
      values.length - 1,
      Math.max(0, Math.round(el.scrollTop / ITEM_HEIGHT))
    );
    if (values[nextIndex] !== value) {
      onChange(values[nextIndex]);
    }
  };

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, 110);
  };

  const center = scrollTop / ITEM_HEIGHT;

  return (
    <div className={cn('relative select-none', widthClass)}>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-10 -translate-y-1/2 rounded-lg border border-[#dfe6ec] bg-[#0b1726]/[0.035]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-gradient-to-b from-white via-white/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-gradient-to-t from-white via-white/80 to-transparent" />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          height: WHEEL_HEIGHT,
          scrollSnapType: 'y mandatory',
          paddingTop: (WHEEL_HEIGHT - ITEM_HEIGHT) / 2,
          paddingBottom: (WHEEL_HEIGHT - ITEM_HEIGHT) / 2,
        }}
      >
        {values.map((item, itemIndex) => {
          const distance = Math.abs(itemIndex - center);
          const active = item === value;
          return (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              style={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: 'center',
                opacity: Math.max(0.18, 1 - distance * 0.34),
              }}
              className={cn(
                'flex w-full items-center justify-center text-sm tabular-nums transition-colors',
                active ? 'font-semibold text-[#0b1726]' : 'text-[#5f7183]'
              )}
            >
              {format(item)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ScheduleModal({
  title,
  targetLabel,
  actionLabel,
  schedule,
  onClose,
  onSave,
  onError,
}: ScheduleModalProps) {
  const initial = parseTime(schedule.dailyTime);
  const [mode, setMode] = useState<ScheduleMode>(schedule.mode);
  const [intervalMinutes, setIntervalMinutes] = useState(schedule.intervalMinutes);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [saving, setSaving] = useState(false);

  const timeText = `${pad(hour)}:${pad(minute)}`;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ mode, intervalMinutes, dailyTime: timeText });
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存设置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-5 rounded-2xl border border-[#dfe6ec] bg-white p-6"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#1d4ed8]" />
            <h3 className="text-base font-semibold text-[#0b1726]">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-[#eef2f6] hover:text-[#0b1726]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 模式切换 */}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f2f5f8] p-1">
          {(
            [
              { key: 'interval', label: '定时刷新' },
              { key: 'daily', label: '每天定时' },
            ] as const
          ).map(item => (
            <button
              key={item.key}
              onClick={() => setMode(item.key)}
              className={cn(
                'rounded-lg py-2 text-xs font-medium transition-all',
                mode === item.key
                  ? 'bg-white text-[#0b1726] shadow-[0_8px_20px_-16px_rgba(11,23,38,0.9)]'
                  : 'text-[#6f8194] hover:text-[#0b1726]'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === 'interval' ? (
          <div>
            <p className="tech-label mb-1 text-center">刷新间隔</p>
            <div className="flex justify-center">
              <WheelColumn
                values={INTERVALS}
                value={intervalMinutes}
                onChange={setIntervalMinutes}
                format={value => (value < 60 ? `${value} 分` : `${value / 60} 时`)}
                widthClass="w-28"
              />
            </div>
            <p className="mt-1 text-center text-[11px] text-[#8a99a8]">
              每 {formatInterval(intervalMinutes)}{actionLabel}一次
            </p>
          </div>
        ) : (
          <div>
            <p className="tech-label mb-1 text-center">同步时刻</p>
            <div className="flex items-center justify-center gap-1">
              <WheelColumn values={HOURS} value={hour} onChange={setHour} />
              <span className="pb-1 text-lg font-semibold text-[#0b1726]">:</span>
              <WheelColumn values={MINUTES} value={minute} onChange={setMinute} />
            </div>
            <p className="mt-1 text-center text-[11px] text-[#8a99a8]">
              每天 {timeText} 检查一次
            </p>
          </div>
        )}

        <p className="rounded-xl bg-[#f7f9fb] px-3 py-2 text-[11px] leading-relaxed text-[#6f8194]">
          {mode === 'interval'
            ? `系统运行期间，每 ${formatInterval(intervalMinutes)}${actionLabel}一次${targetLabel}。`
            : `系统运行期间，每天 ${timeText} ${actionLabel}一次${targetLabel}；若该时刻服务未运行，启动后会自动补执行。`}
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-[#dfe6ec] px-4 py-2 text-sm text-[#5f7183] transition-colors hover:text-[#0b1726]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-[#0b1726] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#16283d] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
