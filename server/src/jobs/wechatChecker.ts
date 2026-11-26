import type { Server } from 'socket.io';
import type { WechatAccount } from '@prisma/client';
import { prisma } from '../db.js';
import { fetchWechatArticles, newestPublishedAt } from '../services/wechat/service.js';
import type { WechatFeedItem } from '../services/wechat/types.js';
import { runSource } from '../services/sourceStatus.js';

const MAX_ARTICLES_PER_CHECK = 30;
const CHECK_TIMEOUT_MS = 20_000;
const BACKOFF_MINUTES = [30, 60, 120, 240];
const MAX_FAILURES = 5;
const ACCOUNT_INTERVAL_MS = 800;

export interface WechatCheckOutcome {
  accountId: string;
  inserted: number;
  baseline?: boolean;
  history?: number;
  error?: string;
}

/**
 * 把订阅源当前已有的文章作为历史记录写入（标记为已读，不推送通知）。
 * 用于建立基线时展示已发布文章列表，避免一订阅就是空白页。
 */
export async function importHistoryArticles(
  accountId: string,
  items: WechatFeedItem[]
): Promise<number> {
  let imported = 0;

  for (const item of items) {
    try {
      const existing = await prisma.wechatArticle.findUnique({
        where: { url: item.url },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.wechatArticle.create({
        data: {
          accountId,
          title: item.title,
          url: item.url,
          digest: item.digest || null,
          coverUrl: item.coverUrl,
          author: item.author,
          publishedAt: item.publishedAt,
          isRead: true,
        },
      });
      imported += 1;
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') {
        console.error('[公众号] 历史文章入库失败:', error);
      }
    }
  }

  return imported;
}

async function recordFailure(
  account: WechatAccount,
  message: string,
  now: Date
): Promise<WechatCheckOutcome> {
  const failCount = account.failCount + 1;
  const delayMinutes = BACKOFF_MINUTES[Math.min(failCount - 1, BACKOFF_MINUTES.length - 1)];
  const paused = failCount >= MAX_FAILURES;

  await prisma.wechatAccount.update({
    where: { id: account.id },
    data: {
      lastCheckedAt: now,
      failCount,
      lastError: paused ? `${message}（连续失败 ${failCount} 次，已自动暂停）` : message,
      nextCheckAt: new Date(now.getTime() + delayMinutes * 60_000),
      isActive: paused ? false : account.isActive,
    },
  });

  return { accountId: account.id, inserted: 0, error: message };
}

async function checkAccount(io: Server, account: WechatAccount): Promise<WechatCheckOutcome> {
  const { items, status } = await runSource(
    `wechat:${account.id}`,
    () => fetchWechatArticles(account.feedUrl, account.sourceType, MAX_ARTICLES_PER_CHECK),
    { label: account.name, timeoutMs: CHECK_TIMEOUT_MS }
  );

  const now = new Date();

  if (status.error) {
    return recordFailure(account, status.error, now);
  }

  const newest = newestPublishedAt(items);

  // 首次订阅：把当前已发布文章作为历史记录入库（已读、不通知），并建立基线
  if (!account.baselineDone) {
    const history = await importHistoryArticles(account.id, items);
    await prisma.wechatAccount.update({
      where: { id: account.id },
      data: {
        baselineDone: true,
        lastCheckedAt: now,
        lastArticleAt: newest,
        failCount: 0,
        lastError: null,
        nextCheckAt: null,
      },
    });
    return { accountId: account.id, inserted: 0, history, baseline: true };
  }

  // 兼容早期订阅：已建立基线但还没有任何文章记录时，补录基线时间之前的历史文章
  const storedCount = await prisma.wechatArticle.count({ where: { accountId: account.id } });
  if (storedCount === 0 && account.lastArticleAt) {
    const baselineTime = account.lastArticleAt.getTime();
    const historyItems = items.filter(
      item => !item.publishedAt || item.publishedAt.getTime() <= baselineTime
    );
    await importHistoryArticles(account.id, historyItems);
  }

  // 严格按发布时间判断，基线之后的文章才算新文章
  const cutoff = account.lastArticleAt?.getTime() ?? 0;
  const candidates = items
    .filter(item => item.publishedAt && item.publishedAt.getTime() > cutoff)
    .sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0));

  let inserted = 0;
  let newestSeen = account.lastArticleAt;

  for (const item of candidates) {
    try {
      const existing = await prisma.wechatArticle.findUnique({
        where: { url: item.url },
        select: { id: true, publishedAt: true },
      });
      if (existing) {
        // 历史数据可能缺少发布时间，后续抓取到同篇文章时补齐
        if (!existing.publishedAt && item.publishedAt) {
          await prisma.wechatArticle.update({
            where: { id: existing.id },
            data: { publishedAt: item.publishedAt },
          });
          if (item.publishedAt && (!newestSeen || item.publishedAt > newestSeen)) {
            newestSeen = item.publishedAt;
          }
        }
        continue;
      }

      const article = await prisma.wechatArticle.create({
        data: {
          accountId: account.id,
          title: item.title,
          url: item.url,
          digest: item.digest || null,
          coverUrl: item.coverUrl,
          author: item.author,
          publishedAt: item.publishedAt,
        },
      });

      inserted += 1;
      if (item.publishedAt && (!newestSeen || item.publishedAt > newestSeen)) {
        newestSeen = item.publishedAt;
      }

      await prisma.notification.create({
        data: {
          type: 'wechat',
          title: `公众号更新 · ${account.name}`,
          content: article.title,
        },
      });

      io.emit('wechat:new', {
        accountId: account.id,
        accountName: account.name,
        article,
      });
      io.emit('notification', {
        type: 'wechat',
        title: '公众号有新文章',
        content: `${account.name}：${article.title}`,
        accountId: account.id,
      });
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') {
        console.error(`[公众号] 文章入库失败 ${account.name}:`, error);
      }
    }
  }

  await prisma.wechatAccount.update({
    where: { id: account.id },
    data: {
      lastCheckedAt: now,
      lastArticleAt: newestSeen,
      failCount: 0,
      lastError: null,
      nextCheckAt: null,
    },
  });

  return { accountId: account.id, inserted };
}

export async function checkWechatAccount(
  io: Server,
  accountId: string
): Promise<WechatCheckOutcome> {
  const account = await prisma.wechatAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new Error('订阅不存在');
  }
  return checkAccount(io, account);
}

export async function runWechatCheck(
  io: Server
): Promise<{ checked: number; inserted: number; failed: number }> {
  const now = new Date();
  const accounts = await prisma.wechatAccount.findMany({
    where: {
      isActive: true,
      OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!accounts.length) {
    return { checked: 0, inserted: 0, failed: 0 };
  }

  let inserted = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      const outcome = await checkAccount(io, account);
      inserted += outcome.inserted;
      if (outcome.error) failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[公众号] 检查订阅失败 ${account.name}:`, error);
    }
    await new Promise(resolve => setTimeout(resolve, ACCOUNT_INTERVAL_MS));
  }

  console.log(`[公众号] 检查 ${accounts.length} 个订阅，新增 ${inserted} 篇文章`);
  return { checked: accounts.length, inserted, failed };
}
