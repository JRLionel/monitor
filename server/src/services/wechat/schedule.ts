import { createScheduleStore, type Schedule, type ScheduleMode } from '../scheduleStore.js';

export type WechatScheduleMode = ScheduleMode;
export type WechatSchedule = Schedule;

const store = createScheduleStore({
  keyPrefix: 'wechat_schedule',
  messages: {
    mode: '刷新模式不正确',
    interval: '刷新间隔仅支持 30 分钟 / 1 小时 / 2 小时 / 4 小时 / 8 小时',
    time: '同步时刻格式应为 HH:MM，分钟仅支持 00 / 15 / 30 / 45',
  },
});

export const getWechatSchedule = store.getSchedule;
export const saveWechatSchedule = store.saveSchedule;
export const isWechatScheduleDue = store.isDue;
export const markWechatScheduleRun = store.markRun;
