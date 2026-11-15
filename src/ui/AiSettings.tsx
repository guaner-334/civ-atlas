/**
 * AI 设置窗口(阶段 5):选用哪家 AI、填密钥、选模型、测试连接;"调用记录"页签看每一次调用(AiCallLog.tsx)。
 * 最上面是「使用 AI 功能」总开关(默认开):关掉以后这一页只剩这一行,界面上的 AI 入口都不显示(client.ts 的 useAiOn)。
 *
 *   openAiSettings(tab?)  打开它(成书窗口的"AI 设置"、提示条的"去设置"、别的面板要打开 AI 设置时都用这个)
 *   AiSettingsHost        窗口本身,App 里一直挂着(所以不管从哪儿打开都在)
 *
 *   我们的 AI(积分):登录网站账号后按次扣积分(登录窗和「我的世界」那个是同一个,AccountDialogs.tsx);
 *                   服务器还没上线时显示"还在内测,暂未开放"(src/ai/providers/official.ts)
 *   DeepSeek / 阿里云百炼:用户自己的 API 密钥,只存在这个浏览器里,请求直接从浏览器发给那一家
 *   测试用假 AI:开发时、或网址带 ai=mock 时才出现(不联网)
 *
 * 各功能在"还没设置 AI"时调 openAiSettings() 打开这里(client.ts 的 setAiSettingsOpener)。
 * 窗口内容在 AiSettingsDialog.tsx,点开才下载。
 */
import { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import { setAiSettingsOpener } from '../ai/client';
import './ai.css';

export type AiSettingsTab = 'settings' | 'log';

const AiSettingsDialog = lazy(() =>
  import('./AiSettingsDialog').catch(() => ({ default: (() => null) as unknown as typeof import('./AiSettingsDialog').default })),
);

// ---------------------------------------------------------------------------
// 开关

let dialog: { open: boolean; tab: AiSettingsTab } = { open: false, tab: 'settings' };
const subs = new Set<() => void>();
const setDialog = (d: typeof dialog) => {
  dialog = d;
  subs.forEach((f) => f());
};
function useDialog() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => dialog,
    () => dialog,
  );
}

/** 打开 AI 设置(tab = 'log' 直接看调用记录) */
export function openAiSettings(tab: AiSettingsTab = 'settings'): void {
  setDialog({ open: true, tab });
}
export function closeAiSettings(): void {
  if (dialog.open) setDialog({ ...dialog, open: false });
}

/** AI 设置窗口:App 里挂一次;各功能经 ai/client 的 openAiSettings()(没设置 AI 时)也打开这里 */
export function AiSettingsHost() {
  const d = useDialog();
  useEffect(() => {
    setAiSettingsOpener(() => openAiSettings('settings'));
    return () => setAiSettingsOpener(null);
  }, []);
  if (!d.open) return null;
  return (
    <Suspense fallback={null}>
      <AiSettingsDialog tab={d.tab} onTab={(tab) => setDialog({ open: true, tab })} onClose={closeAiSettings} />
    </Suspense>
  );
}
