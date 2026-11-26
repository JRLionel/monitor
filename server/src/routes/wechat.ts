import { Router } from 'express';
import type { Server } from 'socket.io';
import type { WechatAccount } from '@prisma/client';
import { prisma } from '../db.js';
import {
  newestPublishedAt,
  normalizeFeedUrl,
  previewWechatFeed,
  resolveWechatAdapter,
} from '../services/wechat/service.js';
import { checkWechatAccount, importHistoryArticles, runWechatCheck } from '../jobs/wechatChecker.js';
import { getWechatSchedule, saveWechatSchedule } from '../services/wechat/schedule.js';
import { isBuiltinAccountId } from '../services/wechat/builtin.js';

interface AccountUpdateInput {
  name?: string;
  avatar?: string | null;
  description?: string | null;
  bizId?: string | null;
  isActive?: boolean;
  feedUrl?: string;
  baselineDone?: boolean;
  lastArticleAt?: Date | null;
  lastCheckedAt?: Date;
  failCount?: number;
  lastError?: string | null;
  nextCheckAt?: Date | null;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

async function attachCounts(accounts: WechatAccount[]) {
  if (!accounts.length) return [];

  const [unreadGroups, totalGroups] = await Promise.all([
    prisma.wechatArticle.groupBy({
      by: ['accountId'],
      where: { isRead: false },
      _count: { _all: true },
    }),
    prisma.wechatArticle.groupBy({
      by: ['accountId'],
      _count: { _all: true },
    }),
  ]);

  const unread = new Map(unreadGroups.map(group => [group.accountId, group._count._all]));
  const total = new Map(totalGroups.map(group => [group.accountId, group._count._all]));

  return accounts.map(account => ({
    ...account,
    isBuiltin: isBuiltinAccountId(account.id),
    unreadCount: unread.get(account.id) ?? 0,
    articleCount: total.get(account.id) ?? 0,
  }));
}

export default function createWechatRouter(io: Server): Router {
  const router = Router();

  // 刷新计划设置
  router.get('/settings', async (_req, res) => {
    try {
      res.json(await getWechatSchedule());
    } catch (error) {
      console.error('Error fetching wechat schedule:', error);
      res.status(500).json({ error: '获取刷新设置失败' });
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      const schedule = await saveWechatSchedule(req.body ?? {});
      res.json(schedule);
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  // 订阅列表（含未读数），内置默认订阅固定排在首位
  router.get('/accounts', async (_req, res) => {
    try {
      const accounts = await prisma.wechatAccount.findMany({ orderBy: { createdAt: 'asc' } });
      const ordered = [...accounts].sort(
        (a, b) =>
          Number(isBuiltinAccountId(b.id)) - Number(isBuiltinAccountId(a.id))
      );
      res.json(await attachCounts(ordered));
    } catch (error) {
      console.error('Error fetching wechat accounts:', error);
      res.status(500).json({ error: '获取订阅列表失败' });
    }
  });

  // 添加前预览订阅源
  router.post('/test-feed', async (req, res) => {
    try {
      const feedUrl = normalizeFeedUrl(req.body?.feedUrl ?? req.body?.url);
      const sourceType = req.body?.sourceType;
      resolveWechatAdapter(sourceType);

      const preview = await previewWechatFeed(feedUrl, sourceType, 10);
      if (!preview.feedTitle && preview.items.length === 0) {
        return res.status(400).json({ error: '该地址不是有效的 RSS / Atom 订阅源' });
      }

      res.json({
        feedTitle: preview.feedTitle,
        itemCount: preview.items.length,
        items: preview.items.slice(0, 5),
      });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  // 新增订阅（同时建立基线）
  router.post('/accounts', async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: '请填写公众号名称' });
      }

      const sourceType = typeof req.body?.sourceType === 'string' ? req.body.sourceType : 'rss';
      resolveWechatAdapter(sourceType);
      const feedUrl = normalizeFeedUrl(req.body?.feedUrl);

      const preview = await previewWechatFeed(feedUrl, sourceType, 20);
      if (!preview.feedTitle && preview.items.length === 0) {
        return res.status(400).json({ error: '该地址不是有效的 RSS / Atom 订阅源' });
      }

      const account = await prisma.wechatAccount.create({
        data: {
          name,
          feedUrl,
          sourceType,
          avatar: typeof req.body?.avatar === 'string' ? req.body.avatar.trim() || null : null,
          description:
            typeof req.body?.description === 'string' ? req.body.description.trim() || null : null,
          bizId: typeof req.body?.bizId === 'string' ? req.body.bizId.trim() || null : null,
          baselineDone: true,
          lastArticleAt: newestPublishedAt(preview.items),
          lastCheckedAt: new Date(),
        },
      });

      // 已发布文章作为已读历史入库，订阅后立即可查看文章列表
      await importHistoryArticles(account.id, preview.items);

      const [withCounts] = await attachCounts([account]);
      res.status(201).json(withCounts);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        return res.status(409).json({ error: '该订阅源已存在' });
      }
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  // 更新订阅
  router.put('/accounts/:id', async (req, res) => {
    try {
      const existing = await prisma.wechatAccount.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: '订阅不存在' });
      }

      const data: AccountUpdateInput = {};

      if (req.body?.name !== undefined) {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.status(400).json({ error: '公众号名称不能为空' });
        data.name = name;
      }
      if (req.body?.avatar !== undefined) {
        data.avatar = typeof req.body.avatar === 'string' ? req.body.avatar.trim() || null : null;
      }
      if (req.body?.description !== undefined) {
        data.description =
          typeof req.body.description === 'string' ? req.body.description.trim() || null : null;
      }
      if (req.body?.bizId !== undefined) {
        data.bizId = typeof req.body.bizId === 'string' ? req.body.bizId.trim() || null : null;
      }
      if (req.body?.isActive !== undefined) {
        data.isActive = Boolean(req.body.isActive);
      }

      if (req.body?.feedUrl !== undefined) {
        const feedUrl = normalizeFeedUrl(req.body.feedUrl);
        if (feedUrl !== existing.feedUrl) {
          const sourceType = existing.sourceType;
          const preview = await previewWechatFeed(feedUrl, sourceType, 20);
          if (!preview.feedTitle && preview.items.length === 0) {
            return res.status(400).json({ error: '该地址不是有效的 RSS / Atom 订阅源' });
          }
          data.feedUrl = feedUrl;
          data.baselineDone = true;
          data.lastArticleAt = newestPublishedAt(preview.items);
          data.lastCheckedAt = new Date();
          data.failCount = 0;
          data.lastError = null;
          data.nextCheckAt = null;
        }
      }

      const account = await prisma.wechatAccount.update({
        where: { id: existing.id },
        data,
      });

      const [withCounts] = await attachCounts([account]);
      res.json(withCounts);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        return res.status(409).json({ error: '该订阅源已存在' });
      }
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  // 启停订阅
  router.patch('/accounts/:id/toggle', async (req, res) => {
    try {
      const account = await prisma.wechatAccount.findUnique({ where: { id: req.params.id } });
      if (!account) {
        return res.status(404).json({ error: '订阅不存在' });
      }

      const updated = await prisma.wechatAccount.update({
        where: { id: account.id },
        data: {
          isActive: !account.isActive,
          failCount: 0,
          lastError: null,
          nextCheckAt: null,
        },
      });

      const [withCounts] = await attachCounts([updated]);
      res.json(withCounts);
    } catch (error) {
      console.error('Error toggling wechat account:', error);
      res.status(500).json({ error: '切换订阅状态失败' });
    }
  });

  // 删除订阅（内置默认订阅不可删除）
  router.delete('/accounts/:id', async (req, res) => {
    if (isBuiltinAccountId(req.params.id)) {
      return res.status(400).json({ error: '默认订阅不支持删除' });
    }
    try {
      await prisma.wechatAccount.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2025') {
        return res.status(404).json({ error: '订阅不存在' });
      }
      console.error('Error deleting wechat account:', error);
      res.status(500).json({ error: '删除订阅失败' });
    }
  });

  // 立即检查单个订阅
  router.post('/accounts/:id/check', async (req, res) => {
    try {
      const outcome = await checkWechatAccount(io, req.params.id);
      const account = await prisma.wechatAccount.findUnique({ where: { id: req.params.id } });
      const [withCounts] = account ? await attachCounts([account]) : [];
      res.json({ ...outcome, ...(withCounts ? { account: withCounts } : {}) });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  // 立即检查全部订阅
  router.post('/check-all', async (_req, res) => {
    try {
      const result = await runWechatCheck(io);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  // 文章列表
  router.get('/articles', async (req, res) => {
    try {
      const page = clampLimit(req.query.page, 1, 10_000);
      const limit = clampLimit(req.query.limit, 20, 50);
      const accountId =
        typeof req.query.accountId === 'string' && req.query.accountId
          ? req.query.accountId
          : undefined;
      const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 'true';

      const where = {
        ...(accountId ? { accountId } : {}),
        ...(unreadOnly ? { isRead: false } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.wechatArticle.findMany({
          where,
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          include: { account: { select: { id: true, name: true, avatar: true } } },
        }),
        prisma.wechatArticle.count({ where }),
      ]);

      res.json({
        data,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (error) {
      console.error('Error fetching wechat articles:', error);
      res.status(500).json({ error: '获取文章列表失败' });
    }
  });

  // 未读数
  router.get('/unread-count', async (_req, res) => {
    try {
      const [total, groups] = await Promise.all([
        prisma.wechatArticle.count({ where: { isRead: false } }),
        prisma.wechatArticle.groupBy({
          by: ['accountId'],
          where: { isRead: false },
          _count: { _all: true },
        }),
      ]);

      res.json({
        total,
        byAccount: groups.map(group => ({ accountId: group.accountId, count: group._count._all })),
      });
    } catch (error) {
      console.error('Error fetching wechat unread count:', error);
      res.status(500).json({ error: '获取未读数失败' });
    }
  });

  // 标记已读
  router.patch('/articles/read', async (req, res) => {
    try {
      const { ids, accountId, all } = req.body ?? {};
      let where: { id?: { in: string[] }; accountId?: string; isRead?: boolean };

      if (Array.isArray(ids) && ids.length) {
        where = { id: { in: ids.filter((id): id is string => typeof id === 'string') } };
      } else if (typeof accountId === 'string' && accountId) {
        where = { accountId };
      } else if (all === true) {
        where = { isRead: false };
      } else {
        return res.status(400).json({ error: '请指定要标记已读的文章' });
      }

      const result = await prisma.wechatArticle.updateMany({ where, data: { isRead: true } });
      res.json({ updated: result.count });
    } catch (error) {
      console.error('Error marking wechat articles read:', error);
      res.status(500).json({ error: '标记已读失败' });
    }
  });

  return router;
}
