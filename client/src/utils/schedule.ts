import type { CheckSchedule } from '../services/api';

/** 把定时设置格式化成按钮上展示的简短文案 */
export function formatScheduleLabel(
  schedule: CheckSchedule | null,
  fallback: string
): string {
  if (!schedule) return fallback;
  if (schedule.mode === 'daily') return `每天 ${schedule.dailyTime}`;
  return schedule.intervalMinutes < 60
    ? `每 ${schedule.intervalMinutes} 分钟`
    : `每 ${schedule.intervalMinutes / 60} 小时`;
}
