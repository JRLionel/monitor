import { createScheduleStore, type Schedule, type ScheduleMode } from '../scheduleStore.js';

export type HotspotScheduleMode = ScheduleMode;
export type HotspotSchedule = Schedule;

const store = createScheduleStore({
  keyPrefix: 'hotspot_schedule',
  messages: {
    mode: '巡检模式不正确',
    interval: '巡检间隔仅支持 30 分钟 / 1 小时 / 2 小时 / 4 小时 / 8 小时',
    time: '巡检时刻格式应为 HH:MM，分钟仅支持 00 / 15 / 30 / 45',
  },
});

export const getHotspotSchedule = store.getSchedule;
export const saveHotspotSchedule = store.saveSchedule;
export const isHotspotScheduleDue = store.isDue;
export const markHotspotScheduleRun = store.markRun;
