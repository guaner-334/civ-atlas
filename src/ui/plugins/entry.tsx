/** 「更多」菜单里的「插件」和插件页的外壳;插件页本身(PluginWindow.tsx)点开才下载 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { createStore } from '../createStore';
import { MenuItem } from '../PopMenu';
import { showToast } from '../toastStore';

const open = createStore(false);

/** 插件的图标:一块拼图(不放进 icons.tsx:那份跟首页一起下载) */
export function PuzzleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M19.4 7.9c0 .3.1.6.3.8l1.6 1.6c.9.9.9 2.5 0 3.4l-1.6 1.6c-.2.2-.5.3-.8.3-.5-.1-.8-.5-1-.9a2.5 2.5 0 1 0-3.2 3.2c.4.2.9.5.9 1 .1.3 0 .6-.3.8l-1.6 1.6c-.9.9-2.5.9-3.4 0l-1.6-1.6c-.2-.2-.5-.3-.9-.3-.5.1-.8.5-1 1a2.5 2.5 0 1 1-3.2-3.2c.5-.2.9-.5 1-1 0-.3-.1-.6-.3-.9l-1.6-1.6a2.4 2.4 0 0 1 0-3.4l1.5-1.5c.3-.3.6-.4.9-.3.5.1.9.5 1.1 1a2.5 2.5 0 1 0 3.2-3.2c-.5-.2-.9-.6-1-1.1 0-.3.1-.7.3-.9l1.5-1.5c.9-.9 2.5-.9 3.4 0l1.6 1.6c.2.2.6.3.9.3.5-.1.8-.5 1-1a2.5 2.5 0 1 1 3.2 3.2c-.5.2-.9.5-1 1Z" />
    </svg>
  );
}

export function openPlugins(): void {
  open.set(true);
}

export function closePlugins(): void {
  open.set(false);
}

export function PluginsMenuItem() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([import('../../plugin/pluginStore'), import('./verdict')])
      .then(async ([store, { verdictOf }]) => (await store.listPlugins()).filter((p) => !verdictOf(p.current.sum).blocked).length)
      .then(
        (count) => live && setN(count),
        () => {},
      );
    return () => {
      live = false;
    };
  }, []);
  return (
    <MenuItem icon={<PuzzleIcon size={16} />} act="plugins" note={n ? `装了 ${n} 个` : undefined} onClick={openPlugins}>
      插件
    </MenuItem>
  );
}

function WindowMissing() {
  useEffect(() => {
    closePlugins();
    showToast({ id: 'plugins-load', kind: 'error', text: '没能打开插件页', more: ['网络断了，或者网站刚更新过，重新加载试试'], action: { label: '重新加载', act: 'plugins-reload', onClick: () => location.reload() } });
  }, []);
  return null;
}

const PluginWindow = lazy(() => import('./PluginWindow').catch(() => ({ default: WindowMissing as unknown as typeof import('./PluginWindow').default })));

export function PluginsHost({ phone }: { phone: boolean }) {
  const shown = open.use();
  if (!shown) return null;
  return (
    <Suspense fallback={null}>
      <PluginWindow phone={phone} onClose={closePlugins} />
    </Suspense>
  );
}
