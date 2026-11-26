import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cron from 'node-cron';

import { prisma } from './db.js';
import keywordsRouter from './routes/keywords.js';
import hotspotsRouter from './routes/hotspots.js';
import settingsRouter from './routes/settings.js';
import aiRouter from './routes/ai.js';
import notificationsRouter from './routes/notifications.js';
import emailRouter from './routes/email.js';
import sourcesRouter from './routes/sources.js';
import hotBoardRouter from './routes/hotBoard.js';
import createWechatRouter from './routes/wechat.js';
import { seedBuiltinWechatSources } from './services/wechat/builtin.js';
import { runHotspotCheck } from './jobs/hotspotChecker.js';
import { runWechatCheck } from './jobs/wechatChecker.js';
import {
  getWechatSchedule,
  isWechatScheduleDue,
  markWechatScheduleRun,
} from './services/wechat/schedule.js';
import {
  getHotspotSchedule,
  isHotspotScheduleDue,
  markHotspotScheduleRun,
} from './services/hotspot/schedule.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/keywords', keywordsRouter);
app.use('/api/hotspots', hotspotsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/email', emailRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/hot-board', hotBoardRouter);
app.use('/api/wechat', createWechatRouter(io));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manual trigger for hotspot check
app.post('/api/check-hotspots', async (req, res) => {
  try {
    await runHotspotCheck(io);
    res.json({ message: 'Hotspot check completed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run hotspot check' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('subscribe', (keywords: string[]) => {
    keywords.forEach(kw => socket.join(`keyword:${kw}`));
    console.log(`Socket ${socket.id} subscribed to:`, keywords);
  });

  socket.on('unsubscribe', (keywords: string[]) => {
    keywords.forEach(kw => socket.leave(`keyword:${kw}`));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Scheduled job: 每分钟按「热点雷达 - 巡检设置」判断是否执行巡检
let hotspotTickRunning = false;
cron.schedule('* * * * *', async () => {
  if (hotspotTickRunning) return;
  hotspotTickRunning = true;
  try {
    const schedule = await getHotspotSchedule();
    const lastRunAt = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;
    const now = new Date();
    if (!isHotspotScheduleDue(schedule, lastRunAt, now)) return;

    console.log('🔄 Running scheduled hotspot check...');
    await runHotspotCheck(io);
    await markHotspotScheduleRun(now);
    console.log('✅ Scheduled hotspot check completed');
  } catch (error) {
    console.error('❌ Scheduled hotspot check failed:', error);
  } finally {
    hotspotTickRunning = false;
  }
});

// Scheduled job: 每分钟按「公众号订阅 - 刷新设置」判断是否执行刷新
let wechatTickRunning = false;
cron.schedule('* * * * *', async () => {
  if (wechatTickRunning) return;
  wechatTickRunning = true;
  try {
    const schedule = await getWechatSchedule();
    const lastRunAt = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;
    const now = new Date();
    if (!isWechatScheduleDue(schedule, lastRunAt, now)) return;

    console.log('📰 Running scheduled WeChat subscription check...');
    await runWechatCheck(io);
    await markWechatScheduleRun(now);
  } catch (error) {
    console.error('❌ Scheduled WeChat check failed:', error);
  } finally {
    wechatTickRunning = false;
  }
});

// Export for use in other modules
export { io };

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`
  🔥 热点监控服务启动成功!
  📡 Server running on http://localhost:${PORT}
  🔌 WebSocket ready
  ⏰ Hotspot check follows the radar patrol schedule
  `);

  // 内置默认订阅（配置写死、不可删除），启动时自动同步
  void seedBuiltinWechatSources(io);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
