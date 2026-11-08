/** 插件的图标:插件包里带的 icon.png;没带的给一个拼图。插件页、工具菜单、插件卡共用 */
import { useEffect, useState } from 'react';
import { parseZip } from '../../gen/zipStore';
import { PLUGIN_ICON, PLUGIN_MAX_BYTES, type OpenedPlugin } from '../../plugin/pluginFile';
import { pluginFileBytes, type InstalledPlugin } from '../../plugin/pluginStore';
import { createListeners } from '../createStore';
import { PuzzleIcon } from './entry';
import './plugins.css';

const iconUrls = new Map<string, string | null>();
const loaded = createListeners();

function iconUrl(data: Uint8Array | undefined): string | null {
  return data ? URL.createObjectURL(new Blob([data], { type: 'image/png' })) : null;
}

/** 装了的各插件的图标(按指纹),读出来以前没有 */
export function useIcons(list: readonly InstalledPlugin[] | null): Map<string, string | null> {
  const [, bump] = useState(0);
  useEffect(() => loaded.subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => {
    for (const p of list ?? []) {
      const sum = p.current.sum;
      if (iconUrls.has(sum)) continue;
      iconUrls.set(sum, null);
      void pluginFileBytes(sum)
        .then((bytes) => {
          const icon = bytes ? parseZip(bytes, PLUGIN_MAX_BYTES).find((e) => e.name === PLUGIN_ICON)?.data : undefined;
          iconUrls.set(sum, iconUrl(icon));
          loaded.emit();
        })
        .catch(() => {});
    }
  }, [list]);
  return iconUrls;
}

export function PluginIcon({ src, size, className }: { src: string | null | undefined; size: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const cls = `plg-pi ${size}${className ? ` ${className}` : ''}`;
  if (src) return <img className={cls} src={src} alt="" />;
  return (
    <span className={`${cls} none`}>
      <PuzzleIcon />
    </span>
  );
}

/** 刚打开的文件里的图标:窗口关了就放掉 */
export function useOpenedIcon(opened: OpenedPlugin): string | null {
  const [url] = useState(() => iconUrl(opened.files.get(PLUGIN_ICON)));
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}
