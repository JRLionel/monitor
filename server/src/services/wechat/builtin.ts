import type { Server } from 'socket.io';
import { prisma } from '../../db.js';
import { checkWechatAccount } from '../../jobs/wechatChecker.js';
import type { WechatSourceType } from './types.js';

export interface BuiltinWechatSource {
  id: string;
  name: string;
  feedUrl: string;
  sourceType: WechatSourceType;
  description: string;
}

/**
 * 内置默认订阅源：不来自数据库录入，始终存在且不可删除。
 * 服务启动时会自动同步到数据库，并按此配置修正名称、地址与来源类型。
 */
export const BUILTIN_WECHAT_SOURCES: BuiltinWechatSource[] = [
  {
    id: 'builtin-claude-articles',
    name: 'Claude 官方文章',
    feedUrl: 'https://claude.com/resources/articles',
    sourceType: 'claude',
    description: 'Anthropic 官网定期发布的 Claude 文章与公告',
  },
];

const BUILTIN_IDS = new Set(BUILTIN_WECHAT_SOURCES.map(source => source.id));

export function isBuiltinAccountId(id: string | null | undefined): boolean {
  return !!id && BUILTIN_IDS.has(id);
}

/**
 * 保证内置订阅在数据库中存在，并用配置覆盖可维护字段。
 * 首次创建时立即抓取一次，把已发布文章作为已读历史入库建立基线。
 */
export async function seedBuiltinWechatSources(io: Server): Promise<void> {
  for (const source of BUILTIN_WECHAT_SOURCES) {
    try {
      const existing = await prisma.wechatAccount.findUnique({ where: { id: source.id } });

      if (!existing) {
        await prisma.wechatAccount.create({
          data: {
            id: source.id,
            name: source.name,
            feedUrl: source.feedUrl,
            sourceType: source.sourceType,
            description: source.description,
          },
        });
        await checkWechatAccount(io, source.id);
        console.log(`[公众号] 已初始化内置订阅：${source.name}`);
        continue;
      }

      await prisma.wechatAccount.update({
        where: { id: source.id },
        data: {
          name: source.name,
          feedUrl: source.feedUrl,
          sourceType: source.sourceType,
          description: source.description,
          isActive: true,
          failCount: 0,
          lastError: null,
          nextCheckAt: null,
        },
      });

      // 基线未建立或历史文章缺少发布时间时，启动后立即同步一次以补全数据
      const missingDates = await prisma.wechatArticle.count({
        where: { accountId: source.id, publishedAt: null },
      });
      if (!existing.baselineDone || missingDates > 0) {
        await checkWechatAccount(io, source.id);
      }
    } catch (error) {
      console.error(`[公众号] 初始化内置订阅失败 ${source.name}:`, error);
    }
  }
}
