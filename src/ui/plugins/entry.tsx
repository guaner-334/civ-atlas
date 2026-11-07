/** 「更多」菜单里的「插件」和插件页的外壳;插件页本身(PluginWindow.tsx)点开才下载 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { createStore } from '../createStore';
import { Icon } from '../icons';
import { MenuItem } from '../PopMenu';
import { showToast } from '../toastStore';

const open = createStore(false);

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
    Promise.all([import('./shelf'), import('./verdict')])
      .then(async ([shelf, { verdictOf }]) => (await shelf.listPlugins()).filter((p) => !verdictOf(p.current.sum).blocked).length)
      .then(
        (count) => live && setN(count),
        () => {},
      );
    return () => {
      live = false;
    };
  }, []);
  return (
    <MenuItem icon={<Icon name="puzzle" size={16} />} act="plugins" note={n ? `装了 ${n} 个` : undefined} onClick={openPlugins}>
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
