import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Wifi,
  X,
} from 'lucide-react';
import {
  aiApi,
  type AIModelMeta,
  type AIProviderStatus,
  type AIProvidersResponse,
} from '../services/api';
import { cn } from '../lib/utils';

const PROVIDER_ACCENT: Record<string, string> = {
  deepseek: 'from-blue-500 to-cyan-400',
  xiaomi: 'from-orange-500 to-amber-400',
  'opencode-go': 'from-violet-500 to-fuchsia-400',
};

type TestState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  message?: string;
};

interface SettingsPanelProps {
  onToast?: (message: string, type: 'success' | 'error') => void;
}

export default function SettingsPanel({ onToast }: SettingsPanelProps) {
  const [data, setData] = useState<AIProvidersResponse | null>(null);
  const [activeId, setActiveId] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  const provider = useMemo(
    () => data?.providers.find(p => p.id === activeId) ?? null,
    [data, activeId]
  );

  const applyData = (next: AIProvidersResponse) => {
    setData(next);
    setActiveId(prev => (next.providers.some(p => p.id === prev) ? prev : next.active));
  };

  useEffect(() => {
    aiApi
      .getProviders()
      .then(applyData)
      .catch(error => onToast?.(error.message || '加载模型服务失败', 'error'));
  }, [onToast]);

  // 切换厂商：立即保存选择，并切换到该厂商的首个模型
  const handleSelectProvider = async (next: AIProviderStatus) => {
    setActiveId(next.id);
    setKeyInput('');
    setShowKey(false);
    try {
      const updated = await aiApi.saveConfig({
        provider: next.id,
        model: next.selectedModel,
      });
      applyData(updated);
    } catch (error: any) {
      onToast?.(error.message || '切换模型服务失败', 'error');
    }
  };

  const handleSaveKey = async () => {
    if (!provider || !keyInput.trim()) return;
    setIsSavingKey(true);
    try {
      const updated = await aiApi.saveConfig({
        provider: provider.id,
        apiKey: keyInput.trim(),
      });
      applyData(updated);
      setKeyInput('');
      onToast?.('API 密钥已保存', 'success');
    } catch (error: any) {
      onToast?.(error.message || '保存失败', 'error');
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleSelectModel = async (model: AIModelMeta) => {
    if (!provider) return;
    try {
      const updated = await aiApi.saveConfig({ provider: provider.id, model: model.id });
      applyData(updated);
    } catch (error: any) {
      onToast?.(error.message || '切换模型失败', 'error');
    }
  };

  const handleTest = async (model: AIModelMeta) => {
    if (!provider) return;
    setTestStates(prev => ({ ...prev, [model.id]: { status: 'loading' } }));
    try {
      const result = await aiApi.test({
        provider: provider.id,
        model: model.id,
        // 优先使用输入框中尚未保存的密钥
        apiKey: keyInput.trim() || undefined,
      });
      setTestStates(prev => ({
        ...prev,
        [model.id]: result.ok
          ? { status: 'ok', message: `${result.latencyMs}ms` }
          : { status: 'error', message: result.error || '连接失败' },
      }));
    } catch (error: any) {
      setTestStates(prev => ({
        ...prev,
        [model.id]: { status: 'error', message: error.message || '连接失败' },
      }));
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      applyData(await aiApi.getProviders());
      onToast?.('模型列表已刷新', 'success');
    } catch (error: any) {
      onToast?.(error.message || '刷新失败', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!data || !provider) {
    return (
      <div className="rounded-2xl border border-[#dfe6ec] bg-white min-h-[560px] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-slate-600 animate-spin" />
      </div>
    );
  }

  const accent = PROVIDER_ACCENT[provider.id] ?? 'from-slate-500 to-slate-400';

  return (
    <div className="rounded-2xl border border-[#dfe6ec] bg-white overflow-hidden flex flex-col md:flex-row min-h-[560px]">
      {/* 左侧服务商列表 */}
      <aside className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-[#edf1f5] p-3 space-y-1">
        {data.providers.map(p => {
          const selected = p.id === provider.id;
          return (
            <button
              key={p.id}
              onClick={() => handleSelectProvider(p)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all border',
                selected
                  ? 'bg-[#eef3f8] border-[#dfe6ec]'
                  : 'border-transparent hover:bg-[#f5f8fb]'
              )}
            >
              <div
                className={cn(
                  'w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shrink-0',
                  PROVIDER_ACCENT[p.id] ?? 'from-slate-500 to-slate-400'
                )}
              >
                {p.name.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm truncate', selected ? 'text-[#0b1726]' : 'text-[#33475b]')}>
                  {p.name}
                </p>
                <p className="text-[11px] flex items-center gap-1.5 mt-0.5 text-slate-500">
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      p.configured ? 'bg-emerald-400' : 'bg-slate-600'
                    )}
                  />
                  {p.configured ? '已配置' : '待完善配置'}
                </p>
              </div>
              {selected && <ChevronRight className="w-4 h-4 text-[#5c6f82] shrink-0" />}
            </button>
          );
        })}
      </aside>

      {/* 右侧配置区 */}
      <section className="flex-1 min-w-0 p-6 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-sm font-bold text-white',
                accent
              )}
            >
              {provider.name.slice(0, 2)}
            </div>
            <h2 className="text-xl font-semibold text-[#0b1726]">{provider.name}</h2>
          </div>
          {provider.docsUrl && (
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#dfe6ec] text-xs text-[#33475b] hover:text-[#0b1726] hover:border-[#c9d5df] transition-all"
            >
              获取密钥
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <div className="h-px bg-[#f7f9fb] my-6" />

        {/* API 密钥 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-[#33475b]">API 密钥</label>
            {provider.hasKey && (
              <span className="text-[11px] text-slate-600">已保存 {provider.apiKeyMasked}</span>
            )}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                placeholder={
                  provider.hasKey
                    ? '已保存，输入新密钥可覆盖'
                    : provider.keyPlaceholder ?? '填入该厂商的 API Key'
                }
                className="w-full pl-4 pr-11 py-2.5 rounded-xl bg-[#f7f9fb] border border-[#dfe6ec] text-sm text-[#0b1726] placeholder-[#9aa8b5] focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#33475b] transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={handleSaveKey}
              disabled={!keyInput.trim() || isSavingKey}
              className="px-4 rounded-xl text-sm font-medium bg-blue-500/15 text-[#1d4ed8] border border-blue-500/25 hover:bg-blue-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSavingKey ? '保存中' : '保存'}
            </button>
          </div>
        </div>

        {/* 可用模型 */}
        <div className="flex items-center justify-between mt-8 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-[#0b1726]">可用模型</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#f7f9fb] text-[#5c6f82]">
              {provider.models.length} 个模型
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#dfe6ec] text-xs text-[#5c6f82] hover:text-[#0b1726] hover:border-[#c9d5df] transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
            获取模型列表
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {provider.models.map(model => {
            const selected = provider.selectedModel === model.id;
            const test = testStates[model.id] ?? { status: 'idle' as const };

            return (
              <div
                key={model.id}
                onClick={() => handleSelectModel(model)}
                className={cn(
                  'p-4 rounded-xl border bg-white flex flex-col gap-2 cursor-pointer transition-all',
                  selected
                    ? 'border-blue-500/40 bg-blue-500/[0.06]'
                    : 'border-[#dfe6ec] hover:border-[#c9d5df]'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-[#0b1726] truncate">{model.label}</span>
                    {model.recommended && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 border border-amber-500/20">
                        推荐
                      </span>
                    )}
                    {selected && (
                      <span className="shrink-0 flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 border border-emerald-500/20">
                        <Check className="w-2.5 h-2.5" />
                        使用中
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {model.capabilities.map(capability => (
                      <span
                        key={capability}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[#f7f9fb] text-[#5c6f82] border border-[#dfe6ec]"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">{model.description}</p>

                <div className="mt-auto pt-2">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleTest(model);
                    }}
                    disabled={test.status === 'loading'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#dfe6ec] text-xs text-[#33475b] hover:text-[#0b1726] hover:border-[#c9d5df] transition-all disabled:opacity-50"
                  >
                    {test.status === 'loading' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5" />
                    )}
                    检测连接
                  </button>

                  {test.status === 'ok' && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-emerald-700">
                      <Check className="w-3 h-3" />
                      连接正常 · {test.message}
                    </span>
                  )}
                  {test.status === 'error' && (
                    <span
                      className="ml-2 inline-flex items-center gap-1 text-[11px] text-red-600 max-w-[60%] truncate align-middle"
                      title={test.message}
                    >
                      <X className="w-3 h-3 shrink-0" />
                      {test.message}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
