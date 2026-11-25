import { Router } from 'express';
import { prisma } from '../db.js';
import { sendTestEmail } from '../services/email.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskPassword(password: string): string {
  if (password.length <= 8) return '****';
  return `${password.slice(0, 4)}****${password.slice(-4)}`;
}

// ========== 发件账户 ==========

// 获取所有发件账户（密码掩码）
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await prisma.emailAccount.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json(accounts.map(({ password, ...rest }) => ({
      ...rest,
      password: password ? maskPassword(password) : ''
    })));
  } catch (error) {
    console.error('Error fetching email accounts:', error);
    res.status(500).json({ error: 'Failed to fetch email accounts' });
  }
});

// 创建发件账户
router.post('/accounts', async (req, res) => {
  try {
    const { name, host, port, secure, username, password, isActive } = req.body;

    if (!name || !host || !username || !password) {
      return res.status(400).json({ error: 'name, host, username, password 为必填项' });
    }

    const parsedPort = port !== undefined ? parseInt(port, 10) : 587;

    if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      return res.status(400).json({ error: '无效的端口号' });
    }

    const account = await prisma.$transaction(async (tx) => {
      // 单选激活：创建时若要求激活，先取消其他账户
      if (isActive) {
        await tx.emailAccount.updateMany({
          where: { isActive: true },
          data: { isActive: false }
        });
      }

      return tx.emailAccount.create({
        data: {
          name: String(name).trim(),
          host: String(host).trim(),
          port: parsedPort,
          secure: Boolean(secure),
          username: String(username).trim(),
          password: String(password),
          isActive: Boolean(isActive)
        }
      });
    });

    const { password: _, ...safe } = account;
    res.status(201).json({ ...safe, password: maskPassword(account.password) });
  } catch (error) {
    console.error('Error creating email account:', error);
    res.status(500).json({ error: 'Failed to create email account' });
  }
});

// 更新发件账户（password 不传或为空时保留原密码）
router.put('/accounts/:id', async (req, res) => {
  try {
    const { name, host, port, secure, username, password, isActive } = req.body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = String(name).trim();
    if (host !== undefined) data.host = String(host).trim();
    if (port !== undefined) {
      const parsedPort = parseInt(port, 10);
      if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        return res.status(400).json({ error: '无效的端口号' });
      }
      data.port = parsedPort;
    }
    if (secure !== undefined) data.secure = Boolean(secure);
    if (username !== undefined) data.username = String(username).trim();
    if (password) data.password = String(password);

    const account = await prisma.$transaction(async (tx) => {
      if (isActive !== undefined) {
        if (isActive) {
          await tx.emailAccount.updateMany({
            where: { isActive: true },
            data: { isActive: false }
          });
        }
        data.isActive = Boolean(isActive);
      }

      return tx.emailAccount.update({
        where: { id: req.params.id },
        data
      });
    });

    const { password: _, ...safe } = account;
    res.json({ ...safe, password: maskPassword(account.password) });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Email account not found' });
    }
    console.error('Error updating email account:', error);
    res.status(500).json({ error: 'Failed to update email account' });
  }
});

// 激活发件账户（单选）
router.patch('/accounts/:id/activate', async (req, res) => {
  try {
    const account = await prisma.$transaction(async (tx) => {
      await tx.emailAccount.updateMany({
        where: { isActive: true },
        data: { isActive: false }
      });

      return tx.emailAccount.update({
        where: { id: req.params.id },
        data: { isActive: true }
      });
    });

    const { password: _, ...safe } = account;
    res.json({ ...safe, password: maskPassword(account.password) });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Email account not found' });
    }
    console.error('Error activating email account:', error);
    res.status(500).json({ error: 'Failed to activate email account' });
  }
});

// 删除发件账户
router.delete('/accounts/:id', async (req, res) => {
  try {
    await prisma.emailAccount.delete({
      where: { id: req.params.id }
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Email account not found' });
    }
    console.error('Error deleting email account:', error);
    res.status(500).json({ error: 'Failed to delete email account' });
  }
});

// ========== 收件邮箱 ==========

// 获取所有收件邮箱
router.get('/recipients', async (req, res) => {
  try {
    const recipients = await prisma.emailRecipient.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json(recipients);
  } catch (error) {
    console.error('Error fetching email recipients:', error);
    res.status(500).json({ error: 'Failed to fetch email recipients' });
  }
});

// 创建收件邮箱
router.post('/recipients', async (req, res) => {
  try {
    const { address, name } = req.body;

    if (!address || !EMAIL_RE.test(String(address).trim())) {
      return res.status(400).json({ error: '请填写有效的邮箱地址' });
    }

    const recipient = await prisma.emailRecipient.create({
      data: {
        address: String(address).trim().toLowerCase(),
        name: name?.trim() || null
      }
    });

    res.status(201).json(recipient);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: '该收件邮箱已存在' });
    }
    console.error('Error creating email recipient:', error);
    res.status(500).json({ error: 'Failed to create email recipient' });
  }
});

// 更新收件邮箱
router.put('/recipients/:id', async (req, res) => {
  try {
    const { address, name, isEnabled } = req.body;

    const data: Record<string, unknown> = {};
    if (address !== undefined) {
      if (!EMAIL_RE.test(String(address).trim())) {
        return res.status(400).json({ error: '请填写有效的邮箱地址' });
      }
      data.address = String(address).trim().toLowerCase();
    }
    if (name !== undefined) data.name = name?.trim() || null;
    if (isEnabled !== undefined) data.isEnabled = Boolean(isEnabled);

    const recipient = await prisma.emailRecipient.update({
      where: { id: req.params.id },
      data
    });

    res.json(recipient);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Email recipient not found' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: '该收件邮箱已存在' });
    }
    console.error('Error updating email recipient:', error);
    res.status(500).json({ error: 'Failed to update email recipient' });
  }
});

// 切换收件邮箱启用状态
router.patch('/recipients/:id/toggle', async (req, res) => {
  try {
    const recipient = await prisma.emailRecipient.findUnique({
      where: { id: req.params.id }
    });

    if (!recipient) {
      return res.status(404).json({ error: 'Email recipient not found' });
    }

    const updated = await prisma.emailRecipient.update({
      where: { id: req.params.id },
      data: { isEnabled: !recipient.isEnabled }
    });

    res.json(updated);
  } catch (error) {
    console.error('Error toggling email recipient:', error);
    res.status(500).json({ error: 'Failed to toggle email recipient' });
  }
});

// 删除收件邮箱
router.delete('/recipients/:id', async (req, res) => {
  try {
    await prisma.emailRecipient.delete({
      where: { id: req.params.id }
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Email recipient not found' });
    }
    console.error('Error deleting email recipient:', error);
    res.status(500).json({ error: 'Failed to delete email recipient' });
  }
});

// ========== 测试邮件 ==========

// 用激活账户向所有启用收件人发送测试邮件
router.post('/test', async (req, res) => {
  try {
    const result = await sendTestEmail();
    res.json(result);
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ ok: false, error: 'Failed to send test email' });
  }
});

export default router;
