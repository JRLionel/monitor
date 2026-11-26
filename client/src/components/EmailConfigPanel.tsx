import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  emailApi,
  type EmailAccount,
  type EmailRecipient,
} from '../services/api';
import { cn } from '../lib/utils';

interface EmailConfigPanelProps {
  onToast?: (message: string, type: 'success' | 'error') => void;
}

// ========== 发件账户表单 ==========
interface AccountForm {
  name: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
}

const EMPTY_ACCOUNT_FORM: AccountForm = {
  name: '',
  host: '',
  port: '587',
  secure: false,
  username: '',
  password: '',
};

const inputClass =
  'w-full px-4 py-2.5 rounded-xl bg-[#f7f9fb] border border-[#dfe6ec] text-sm text-[#0b1726] placeholder-[#9aa8b5] focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all';

const labelClass = 'text-sm text-[#33475b] mb-1.5 block';

export default function EmailConfigPanel({ onToast }: EmailConfigPanelProps) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 发件账户弹窗
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(EMPTY_ACCOUNT_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);

  // 收件邮箱弹窗
  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState<EmailRecipient | null>(null);
  const [recipientForm, setRecipientForm] = useState({ address: '', name: '' });
  const [isSavingRecipient, setIsSavingRecipient] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<
    { type: 'account' | 'recipient'; id: string; label: string } | null
  >(null);

  // 测试邮件
  const [isTesting, setIsTesting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [accountsData, recipientsData] = await Promise.all([
        emailApi.accounts.getAll(),
        emailApi.recipients.getAll(),
      ]);
      setAccounts(accountsData);
      setRecipients(recipientsData);
    } catch (error: any) {
      onToast?.(error.message || '加载邮箱配置失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ===== 发件账户 =====

  const openCreateAccount = () => {
    setEditingAccount(null);
    setAccountForm(EMPTY_ACCOUNT_FORM);
    setShowAccountModal(true);
  };

  const openEditAccount = (account: EmailAccount) => {
    setEditingAccount(account);
    setAccountForm({
      name: account.name,
      host: account.host,
      port: String(account.port),
      secure: account.secure,
      username: account.username,
      password: '',
    });
    setShowAccountModal(true);
  };

  const handleSaveAccount = async () => {
    const { name, host, username, password } = accountForm;
    if (!name.trim() || !host.trim() || !username.trim()) {
      onToast?.('备注名、SMTP 服务器、用户名为必填项', 'error');
      return;
    }
    if (!editingAccount && !password) {
      onToast?.('请填写 SMTP 密码/授权码', 'error');
      return;
    }

    setIsSavingAccount(true);
    try {
      if (editingAccount) {
        await emailApi.accounts.update(editingAccount.id, {
          name: name.trim(),
          host: host.trim(),
          port: parseInt(accountForm.port, 10) || 587,
          secure: accountForm.secure,
          username: username.trim(),
          ...(password ? { password } : {}),
        });
        onToast?.('发件账户已更新', 'success');
      } else {
        await emailApi.accounts.create({
          name: name.trim(),
          host: host.trim(),
          port: parseInt(accountForm.port, 10) || 587,
          secure: accountForm.secure,
          username: username.trim(),
          password,
        });
        onToast?.('发件账户已添加', 'success');
      }
      setShowAccountModal(false);
      await loadData();
    } catch (error: any) {
      onToast?.(error.message || '保存发件账户失败', 'error');
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleActivateAccount = async (account: EmailAccount) => {
    if (account.isActive) return;
    try {
      await emailApi.accounts.activate(account.id);
      onToast?.(`已切换发件账户：${account.name}`, 'success');
      await loadData();
    } catch (error: any) {
      onToast?.(error.message || '切换发件账户失败', 'error');
    }
  };

  // ===== 收件邮箱 =====

  const openCreateRecipient = () => {
    setEditingRecipient(null);
    setRecipientForm({ address: '', name: '' });
    setShowRecipientModal(true);
  };

  const openEditRecipient = (recipient: EmailRecipient) => {
    setEditingRecipient(recipient);
    setRecipientForm({ address: recipient.address, name: recipient.name || '' });
    setShowRecipientModal(true);
  };

  const handleSaveRecipient = async () => {
    if (!recipientForm.address.trim()) {
      onToast?.('请填写收件邮箱地址', 'error');
      return;
    }

    setIsSavingRecipient(true);
    try {
      if (editingRecipient) {
        await emailApi.recipients.update(editingRecipient.id, {
          address: recipientForm.address.trim(),
          name: recipientForm.name.trim() || undefined,
        });
        onToast?.('收件邮箱已更新', 'success');
      } else {
        await emailApi.recipients.create({
          address: recipientForm.address.trim(),
          name: recipientForm.name.trim() || undefined,
        });
        onToast?.('收件邮箱已添加', 'success');
      }
      setShowRecipientModal(false);
      await loadData();
    } catch (error: any) {
      onToast?.(error.message || '保存收件邮箱失败', 'error');
    } finally {
      setIsSavingRecipient(false);
    }
  };

  const handleToggleRecipient = async (recipient: EmailRecipient) => {
    try {
      await emailApi.recipients.toggle(recipient.id);
      await loadData();
    } catch (error: any) {
      onToast?.(error.message || '切换收件邮箱状态失败', 'error');
    }
  };

  // ===== 删除 / 测试 =====

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'account') {
        await emailApi.accounts.remove(deleteTarget.id);
        onToast?.('发件账户已删除', 'success');
      } else {
        await emailApi.recipients.remove(deleteTarget.id);
        onToast?.('收件邮箱已删除', 'success');
      }
      setDeleteTarget(null);
      await loadData();
    } catch (error: any) {
      onToast?.(error.message || '删除失败', 'error');
      setDeleteTarget(null);
    }
  };

  const handleSendTest = async () => {
    setIsTesting(true);
    try {
      const result = await emailApi.sendTest();
      if (result.ok) {
        onToast?.(`测试邮件已发送至 ${result.sent} 个收件邮箱`, 'success');
      } else {
        onToast?.(result.error || '发送失败', 'error');
      }
    } catch (error: any) {
      onToast?.(error.message || '发送失败', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[#dfe6ec] bg-white min-h-[560px] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-slate-600 animate-spin" />
      </div>
    );
  }

  const hasActiveAccount = accounts.some(a => a.isActive);
  const enabledRecipientCount = recipients.filter(r => r.isEnabled).length;

  return (
    <div className="space-y-8">
      {/* ===== 发件账户区 ===== */}
      <section className="rounded-2xl border border-[#dfe6ec] bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#0b1726]">发件账户</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                支持添加多个 SMTP 账户，点击卡片切换当前使用的发件账户
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSendTest}
              disabled={isTesting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#dfe6ec] text-xs text-[#33475b] hover:text-[#0b1726] hover:border-[#c9d5df] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              发送测试邮件
            </button>
            <button
              onClick={openCreateAccount}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-blue-500/15 text-[#1d4ed8] border border-blue-500/25 hover:bg-blue-500/25 transition-all"
            >
              <Plus className="w-4 h-4" />
              新增账户
            </button>
          </div>
        </div>

        <div className="h-px bg-[#f7f9fb] my-5" />

        {!hasActiveAccount && accounts.length > 0 && (
          <p className="mb-3 text-xs text-amber-700/80">
            尚未激活任何发件账户，点击下方卡片激活后才会发送邮件
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map(account => (
            <button
              key={account.id}
              onClick={() => handleActivateAccount(account)}
              className={cn(
                'group relative text-left p-4 rounded-xl border transition-all',
                account.isActive
                  ? 'bg-[#eef3f8] border-blue-500/30'
                  : 'bg-white border-[#edf1f5] hover:border-[#d3dde6]'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn('text-sm font-medium truncate', account.isActive ? 'text-[#0b1726]' : 'text-[#33475b]')}>
                      {account.name}
                    </p>
                    {account.isActive && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-blue-500/20 text-[#1d4ed8] text-[10px] font-medium">
                        使用中
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    {account.host}:{account.port} · {account.username}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    密码 {account.password || '未设置'}
                    {account.secure && ' · SSL'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      openEditAccount(account);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        openEditAccount(account);
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-[#1d4ed8] hover:bg-blue-500/10 transition-all"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setDeleteTarget({ type: 'account', id: account.id, label: account.name });
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        setDeleteTarget({ type: 'account', id: account.id, label: account.name });
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </button>
          ))}

          {accounts.length === 0 && (
            <div className="md:col-span-2 text-center py-12 rounded-xl border border-dashed border-[#dfe6ec]">
              <Mail className="w-8 h-8 mx-auto mb-3 text-slate-600" />
              <p className="text-slate-500 text-sm">还没有发件账户</p>
              <p className="text-xs text-slate-600 mt-1">添加一个 SMTP 账户用于发送通知邮件</p>
            </div>
          )}
        </div>
      </section>

      {/* ===== 收件邮箱区 ===== */}
      <section className="rounded-2xl border border-[#dfe6ec] bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-400 flex items-center justify-center">
              <Send className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#0b1726]">收件邮箱</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                已启用 {enabledRecipientCount} 个，通知邮件将发送给所有已启用的收件邮箱
              </p>
            </div>
          </div>
          <button
            onClick={openCreateRecipient}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-violet-500/15 text-violet-400 border border-violet-500/25 hover:bg-violet-500/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            添加收件邮箱
          </button>
        </div>

        <div className="h-px bg-[#f7f9fb] my-5" />

        <div className="space-y-2">
          {recipients.map(recipient => (
            <div
              key={recipient.id}
              className={cn(
                'group flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-all',
                recipient.isEnabled
                  ? 'bg-[#f7f9fb] border-[#dfe6ec]'
                  : 'bg-white border-[#edf1f5] opacity-60'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* 启用开关 */}
                <button
                  onClick={() => handleToggleRecipient(recipient)}
                  className={cn(
                    'w-11 h-6 rounded-full transition-all relative shrink-0',
                    recipient.isEnabled ? 'bg-blue-500' : 'bg-slate-700'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all',
                      recipient.isEnabled ? 'left-6' : 'left-1'
                    )}
                  />
                </button>
                <div className="min-w-0">
                  <p className="text-sm text-[#0b1726] truncate">{recipient.address}</p>
                  {recipient.name && (
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{recipient.name}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEditRecipient(recipient)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-[#1d4ed8] hover:bg-blue-500/10 transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setDeleteTarget({ type: 'recipient', id: recipient.id, label: recipient.address })}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {recipients.length === 0 && (
            <div className="text-center py-12 rounded-xl border border-dashed border-[#dfe6ec]">
              <Send className="w-8 h-8 mx-auto mb-3 text-slate-600" />
              <p className="text-slate-500 text-sm">还没有收件邮箱</p>
              <p className="text-xs text-slate-600 mt-1">添加接收热点通知的邮箱地址</p>
            </div>
          )}
        </div>
      </section>

      {/* ===== 账户新增/编辑弹窗 ===== */}
      {showAccountModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowAccountModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#dfe6ec] bg-white p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#0b1726]">
                {editingAccount ? '编辑发件账户' : '新增发件账户'}
              </h3>
              <button
                onClick={() => setShowAccountModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1726] hover:bg-[#eef2f6] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className={labelClass}>备注名</label>
              <input
                className={inputClass}
                placeholder="如：QQ邮箱-工作"
                value={accountForm.name}
                onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={labelClass}>SMTP 服务器</label>
                <input
                  className={inputClass}
                  placeholder="smtp.qq.com"
                  value={accountForm.host}
                  onChange={e => setAccountForm(f => ({ ...f, host: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>端口</label>
                <input
                  className={inputClass}
                  placeholder="587"
                  value={accountForm.port}
                  onChange={e => setAccountForm(f => ({ ...f, port: e.target.value }))}
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={accountForm.secure}
                onChange={e => setAccountForm(f => ({ ...f, secure: e.target.checked }))}
                className="w-4 h-4 accent-blue-500"
              />
              <span className="text-sm text-[#33475b]">SSL/TLS 加密连接（465 端口一般需要勾选）</span>
            </label>

            <div>
              <label className={labelClass}>SMTP 用户名</label>
              <input
                className={inputClass}
                placeholder="发件邮箱账号"
                value={accountForm.username}
                onChange={e => setAccountForm(f => ({ ...f, username: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelClass}>密码 / 授权码</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={cn(inputClass, 'pr-11')}
                  placeholder={
                    editingAccount
                      ? `已保存（${editingAccount.password}），留空表示不修改`
                      : 'SMTP 密码或邮箱授权码'
                  }
                  value={accountForm.password}
                  onChange={e => setAccountForm(f => ({ ...f, password: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#33475b] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAccountModal(false)}
                className="px-4 py-2 rounded-xl text-sm text-[#5c6f82] hover:text-[#0b1726] border border-[#dfe6ec] hover:border-[#c9d5df] transition-all"
              >
                取消
              </button>
              <button
                onClick={handleSaveAccount}
                disabled={isSavingAccount}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-blue-500/15 text-[#1d4ed8] border border-blue-500/25 hover:bg-blue-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSavingAccount && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isSavingAccount ? '保存中' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 收件邮箱新增/编辑弹窗 ===== */}
      {showRecipientModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowRecipientModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#dfe6ec] bg-white p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#0b1726]">
                {editingRecipient ? '编辑收件邮箱' : '添加收件邮箱'}
              </h3>
              <button
                onClick={() => setShowRecipientModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1726] hover:bg-[#eef2f6] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className={labelClass}>邮箱地址</label>
              <input
                className={inputClass}
                placeholder="notify@example.com"
                value={recipientForm.address}
                onChange={e => setRecipientForm(f => ({ ...f, address: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelClass}>备注（可选）</label>
              <input
                className={inputClass}
                placeholder="如：我的工作邮箱"
                value={recipientForm.name}
                onChange={e => setRecipientForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowRecipientModal(false)}
                className="px-4 py-2 rounded-xl text-sm text-[#5c6f82] hover:text-[#0b1726] border border-[#dfe6ec] hover:border-[#c9d5df] transition-all"
              >
                取消
              </button>
              <button
                onClick={handleSaveRecipient}
                disabled={isSavingRecipient}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-violet-500/15 text-violet-400 border border-violet-500/25 hover:bg-violet-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSavingRecipient && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isSavingRecipient ? '保存中' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 删除确认弹窗 ===== */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#dfe6ec] bg-white p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[#0b1726]">
                  删除{deleteTarget.type === 'account' ? '发件账户' : '收件邮箱'}
                </h3>
                <p className="text-sm text-[#5c6f82] mt-1 break-all">
                  确定删除「{deleteTarget.label}」吗？此操作不可撤销。
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-sm text-[#5c6f82] hover:text-[#0b1726] border border-[#dfe6ec] hover:border-[#c9d5df] transition-all"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-red-500/15 text-red-600 border border-red-500/25 hover:bg-red-500/25 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
