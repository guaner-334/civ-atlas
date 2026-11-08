/** 「更多」菜单里的「插件」、地图上的「工具」按钮和它们的外壳;插件页(PluginWindow.tsx)、工具(tools/)点开才下载 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createStore } from '../createStore';
import { MenuItem } from '../PopMenu';
import { showToast } from '../toastStore';
import { toolCard, toolRunning, toolsMenu, type ToolsProps } from './toolsState';

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

/** 插件页开着 */
export const usePluginsOpen = (): boolean => open.use();

/** 插件页开、关时调 f;返回取消的函数 */
export const subscribePluginsOpen = (f: (on: boolean) => void): (() => void) => open.subscribe(() => f(open.get()));

export function closePlugins(): void {
  open.set(false);
}

export function PluginsMenuItem() {
  const [n, setN] = useState({ on: 0, newer: 0 });
  useEffect(() => {
    let live = true;
    Promise.all([import('../../plugin/pluginStore'), import('./verdict'), import('./galleryWatch')])
      .then(async ([store, { verdictOf }, { newVersionOf }]) => {
        const ok = (await store.listPlugins()).filter((p) => !verdictOf(p.current.sum, p.id).blocked);
        return { on: ok.length, newer: ok.filter((p) => newVersionOf(p)).length };
      })
      .then(
        (count) => live && setN(count),
        () => {},
      );
    return () => {
      live = false;
    };
  }, []);
  return (
    <MenuItem icon={<PuzzleIcon size={16} />} act="plugins" note={n.on ? `装了 ${n.on} 个${n.newer ? `，${n.newer} 个有新版` : ''}` : undefined} onClick={openPlugins}>
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
  // 装着的插件联网时和作品墙对一对:有新版、被网站停用了
  useEffect(() => {
    import('./galleryWatch').then(
      (m) => m.watchPlugins(),
      () => {},
    );
  }, []);
  if (!shown) return null;
  return (
    <Suspense fallback={null}>
      <PluginWindow phone={phone} onClose={closePlugins} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// 工具

const loadTools = () => import('./tools/ToolsLayer');

function toolsFailed() {
  toolsMenu.set(false);
  showToast({ id: 'plugins-load', kind: 'error', text: '没能打开工具', more: ['网络断了，或者网站刚更新过，重新加载试试'], action: { label: '重新加载', act: 'plugins-reload', onClick: () => location.reload() } });
}

/** 地图右下(手机右上竖排)的「工具」:点开列出插件带来的工具;菜单开着、插件开着时是按下去的样子 */
export function ToolsButton({ phone, disabled }: { phone?: boolean; disabled?: boolean }) {
  const open = toolsMenu.use();
  const running = toolRunning.use();
  const on = open || running;
  const click = () => {
    if (toolsMenu.get()) return toolsMenu.set(false);
    loadTools().then(() => toolsMenu.set(true), toolsFailed);
  };
  if (phone)
    return (
      <button className={`pb-btn plg-tools${on ? ' on' : ''}`} data-act="tools" aria-pressed={on} aria-expanded={open} disabled={disabled} onClick={click} aria-label="工具" title="插件带来的工具">
        <PuzzleIcon size={21} />
      </button>
    );
  return (
    <button className={`glass mc-btn mc-globe mc-tools${on ? ' on' : ''}`} data-act="tools" aria-pressed={on} aria-expanded={open} onClick={click} title="插件带来的工具">
      <PuzzleIcon size={18} />
      <span>工具</span>
    </button>
  );
}

function ToolsMissing(_: ToolsProps) {
  useEffect(toolsFailed, []);
  return null;
}

const ToolsLayer = lazy(() => loadTools().catch(() => ({ default: ToolsMissing as unknown as typeof import('./tools/ToolsLayer').default })));

/** 工具菜单、插件卡、点选:第一次点开「工具」以后才挂上 */
export function ToolsHost(p: ToolsProps) {
  const used = useRef(false);
  const menu = toolsMenu.use();
  const card = toolCard.use();
  const shown = menu || card;
  if (shown) used.current = true;
  if (!used.current) return null;
  return (
    <Suspense fallback={null}>
      <ToolsLayer {...p} />
    </Suspense>
  );
}
