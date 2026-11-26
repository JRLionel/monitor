import nodemailer from 'nodemailer';
import { prisma } from '../db.js';
import type { DigestItem, ScanDigest } from './ai.js';

// transporter 缓存：以账户 id + updatedAt 为键，配置变更后自动重建
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedTransporter: any = null;
let cachedKey = '';

/**
 * 从数据库读取当前激活的发件账户，创建 nodemailer transporter。
 * 无激活账户时返回 null（邮件通知未配置）。
 */
async function getTransporter(): Promise<{ transporter: any; account: { username: string } } | null> {
  const account = await prisma.emailAccount.findFirst({
    where: { isActive: true }
  });

  if (!account) {
    console.warn('No active email account configured, notifications disabled');
    return null;
  }

  const cacheKey = `${account.id}:${account.updatedAt.toISOString()}`;

  if (!cachedTransporter || cachedKey !== cacheKey) {
    cachedTransporter = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: {
        user: account.username,
        pass: account.password
      }
    });
    cachedKey = cacheKey;
  }

  return { transporter: cachedTransporter, account };
}

/**
 * 获取所有启用的收件邮箱地址。
 */
async function getEnabledRecipients(): Promise<string[]> {
  const recipients = await prisma.emailRecipient.findMany({
    where: { isEnabled: true },
    orderBy: { createdAt: 'asc' }
  });

  return recipients.map(r => r.address);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LEVEL_META: Record<string, { emoji: string; label: string; color: string }> = {
  urgent: { emoji: '🚨', label: '紧急', color: '#ff4757' },
  high: { emoji: '🔥', label: '高', color: '#ff6b35' },
  medium: { emoji: '⚡', label: '中', color: '#ffa502' },
  low: { emoji: '📌', label: '低', color: '#2ed573' }
};

const LEVEL_ORDER = ['urgent', 'high', 'medium', 'low'];

/**
 * 发送一轮扫描的汇总简报（每轮扫描仅一封）。
 * digest 由 AI 生成或兜底模板产生，items 用于回填原文链接。
 */
export async function sendScanDigestEmail(
  digest: ScanDigest,
  items: DigestItem[],
  meta: { keywords: string[]; scanTime: Date }
): Promise<boolean> {
  const mailer = await getTransporter();

  if (!mailer) {
    return false;
  }

  const to = await getEnabledRecipients();

  if (to.length === 0) {
    console.warn('No enabled email recipients, notifications disabled');
    return false;
  }

  const itemByIndex = new Map(items.map(item => [item.index, item]));

  // 主题按重要度排序，保证邮件从上往下读重要性递减
  const topics = [...digest.topics].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)
  );

  const topLevel = topics[0]?.level ?? 'medium';
  const topEmoji = LEVEL_META[topLevel]?.emoji ?? '📌';

  const topicsHtml = topics.map(topic => {
    const level = LEVEL_META[topic.level] ?? LEVEL_META.medium;
    const links = topic.itemIndexes
      .map(index => itemByIndex.get(index))
      .filter((item): item is DigestItem => Boolean(item))
      .map(item => `
        <li style="margin: 6px 0;">
          <span style="color: #94a3b8; font-size: 12px;">[${escapeHtml(item.source)}]</span>
          <a href="${escapeHtml(item.url)}" style="color: #667eea; text-decoration: none;">${escapeHtml(item.title)}</a>
        </li>
      `)
      .join('');

    return `
      <div style="margin: 0 0 20px; padding: 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <p style="margin: 0 0 8px;">
          <span style="display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; color: #fff; background: ${level.color};">
            ${level.emoji} ${level.label}
          </span>
        </p>
        <h3 style="margin: 0 0 8px; font-size: 16px; color: #0f172a;">${escapeHtml(topic.headline)}</h3>
        <p style="margin: 0 0 10px; font-size: 14px; line-height: 1.7; color: #334155;">${escapeHtml(topic.analysis)}</p>
        ${links ? `<ul style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6;">${links}</ul>` : ''}
      </div>
    `;
  }).join('');

  const keywordsText = meta.keywords.slice(0, 12).map(escapeHtml).join('、');

  try {
    await mailer.transporter.sendMail({
      from: mailer.account.username,
      to: to.join(', '),
      subject: `${topEmoji} 热点雷达简报：${digest.subject}（本轮 ${items.length} 条）`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
            a { color: #667eea; }
          </style>
        </head>
        <body style="margin: 0; background: #f1f5f9;">
          <div style="max-width: 640px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <p style="margin: 0 0 6px; font-size: 12px; letter-spacing: 1px; opacity: 0.85;">HOTSPOT RADAR · 本轮简报</p>
              <h1 style="margin: 0; font-size: 20px; line-height: 1.5;">${escapeHtml(digest.subject)}</h1>
              <p style="margin: 10px 0 0; font-size: 13px; opacity: 0.9;">
                新增 ${items.length} 条 · ${meta.scanTime.toLocaleString('zh-CN')}
              </p>
            </div>
            <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.8; color: #334155;">${escapeHtml(digest.overview)}</p>
              ${topicsHtml}
              ${digest.watchlist ? `
                <div style="padding: 12px 16px; background: #eef2ff; border-left: 3px solid #667eea; border-radius: 4px; font-size: 13px; color: #3730a3;">
                  <strong>后续关注：</strong>${escapeHtml(digest.watchlist)}
                </div>
              ` : ''}
              <p style="margin: 24px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                监控关键词：${keywordsText || '无'}${meta.keywords.length > 12 ? ' 等' : ''}<br>
                本邮件由热点雷达自动汇总，每轮扫描最多发送一封。
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log(`Scan digest email sent: ${items.length} hotspots, ${topics.length} topics, source=${digest.generatedBy}`);
    return true;
  } catch (error) {
    console.error('Failed to send scan digest email:', error);
    return false;
  }
}

export async function sendTestEmail(): Promise<{ ok: boolean; sent?: number; error?: string }> {
  const mailer = await getTransporter();

  if (!mailer) {
    return { ok: false, error: '尚未配置激活的发件账户' };
  }

  const to = await getEnabledRecipients();

  if (to.length === 0) {
    return { ok: false, error: '没有启用的收件邮箱' };
  }

  try {
    await mailer.transporter.sendMail({
      from: mailer.account.username,
      to: to.join(', '),
      subject: '📮 热点监控测试邮件',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #333;">
          <h2>📮 这是一封测试邮件</h2>
          <p>收到此邮件说明邮箱通知配置正确。</p>
          <p style="color: #999; font-size: 12px;">发送时间：${new Date().toLocaleString('zh-CN')}</p>
        </body>
        </html>
      `
    });

    return { ok: true, sent: to.length };
  } catch (error: any) {
    console.error('Failed to send test email:', error);
    return { ok: false, error: error?.message || '发送失败' };
  }
}
