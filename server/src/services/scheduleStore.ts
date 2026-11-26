import { prisma } from '../db.js';

export type ScheduleMode = 'interval' | 'daily';

export interface Schedule {
  mode: ScheduleMode;
  intervalMinutes: number;
  dailyTime: string;
  lastRunAt: string | null;
}

export const ALLOWED_INTERVALS = [30, 60, 120, 240, 480];
const ALLOWED_MINUTES = [0, 15, 30, 45];

const TIME_RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;

interface ScheduleStoreOptions {
  /** 设置项 key 前缀，如 wechat_schedule / hotspot_schedule */
  keyPrefix: string;
  /** 校验失败时的错误提示 */
  messages: {
    mode: string;
    interval: string;
    time: string;
  };
  defaultIntervalMinutes?: number;
  defaultDailyTime?: string;
}

export interface ScheduleInput {
  mode?: unknown;
  intervalMinutes?: unknown;
  dailyTime?: unknown;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/**
 * 按 key 前缀创建一套「定时刷新」设置读写逻辑，公众号订阅与热点巡检共用。
 */
export function createScheduleStore({
  keyPrefix,
  messages,
  defaultIntervalMinutes = 30,
  defaultDailyTime = '09:00',
}: ScheduleStoreOptions) {
  const MODE_KEY = `${keyPrefix}_mode`;
  const INTERVAL_KEY = `${keyPrefix}_interval`;
  const TIME_KEY = `${keyPrefix}_time`;
  const LAST_RUN_KEY = `${keyPrefix}_last_run`;

  async function getSchedule(): Promise<Schedule> {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [MODE_KEY, INTERVAL_KEY, TIME_KEY, LAST_RUN_KEY] } },
    });
    const values = new Map(rows.map(row => [row.key, row.value]));

    const mode: ScheduleMode = values.get(MODE_KEY) === 'daily' ? 'daily' : 'interval';
    const rawInterval = Number(values.get(INTERVAL_KEY));
    const intervalMinutes = ALLOWED_INTERVALS.includes(rawInterval)
      ? rawInterval
      : defaultIntervalMinutes;
    const rawTime = values.get(TIME_KEY) ?? '';
    const dailyTime = TIME_RE.test(rawTime) ? rawTime : defaultDailyTime;

    return {
      mode,
      intervalMinutes,
      dailyTime,
      lastRunAt: values.get(LAST_RUN_KEY) ?? null,
    };
  }

  async function saveSchedule(input: ScheduleInput): Promise<Schedule> {
    const mode =
      input.mode === 'daily' ? 'daily' : input.mode === 'interval' ? 'interval' : null;
    if (!mode) {
      throw new Error(messages.mode);
    }

    const intervalMinutes = Number(input.intervalMinutes);
    if (!ALLOWED_INTERVALS.includes(intervalMinutes)) {
      throw new Error(messages.interval);
    }

    const dailyTime = typeof input.dailyTime === 'string' ? input.dailyTime : '';
    const match = dailyTime.match(TIME_RE);
    if (!match || !ALLOWED_MINUTES.includes(Number(match[2]))) {
      throw new Error(messages.time);
    }

    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: MODE_KEY },
        update: { value: mode },
        create: { key: MODE_KEY, value: mode },
      }),
      prisma.setting.upsert({
        where: { key: INTERVAL_KEY },
        update: { value: String(intervalMinutes) },
        create: { key: INTERVAL_KEY, value: String(intervalMinutes) },
      }),
      prisma.setting.upsert({
        where: { key: TIME_KEY },
        update: { value: dailyTime },
        create: { key: TIME_KEY, value: dailyTime },
      }),
    ]);

    return getSchedule();
  }

  /**
   * 判断当前时刻是否应该执行一次刷新。
   * - 定时刷新：距上次执行已满设定的间隔
   * - 每天定时：到达当天设定时刻后只执行一次（系统重启后仍按系统时间补执行）
   */
  function isDue(schedule: Schedule, lastRunAt: Date | null, now: Date): boolean {
    if (schedule.mode === 'daily') {
      const [hour, minute] = schedule.dailyTime.split(':').map(Number);
      const target = new Date(now);
      target.setHours(hour, minute, 0, 0);
      if (now.getTime() < target.getTime()) return false;
      return !lastRunAt || lastRunAt.getTime() < target.getTime();
    }

    if (!lastRunAt) return true;
    return now.getTime() - lastRunAt.getTime() >= schedule.intervalMinutes * 60_000;
  }

  async function markRun(at: Date): Promise<void> {
    await setSetting(LAST_RUN_KEY, at.toISOString());
  }

  return { getSchedule, saveSchedule, isDue, markRun };
}
