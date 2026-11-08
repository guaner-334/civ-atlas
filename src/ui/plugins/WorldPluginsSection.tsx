/** 世界设定页的「用到的插件」一组:这个世界存了哪个插件的图层、数据,本机装没装;没用插件的世界不放 */
import { useEffect, useMemo, useState } from 'react';
import { useSavesVersion } from '../saveStore';
import { pluginLayers } from './layerState';
import { PluginIcon, useIcons } from './pluginIcons';
import { versionLabel } from './pluginText';
import { kbText } from './askState';
import { usedPlugins, type UsedPlugin } from './worldPlugins';
import './worldData.css';

/** 一行下面的小字 */
function linesOf(u: UsedPlugin, titles: string[]): string[] {
  const out: string[] = [];
  const here = u.here === 'none' ? '，没装也照常能看' : '';
  if (u.layers.length) {
    const named = titles.length ? titles.map((t) => `「${t}」`).join('') : '';
    out.push(`存了${u.layers.length > 1 ? ` ${u.layers.length} 个` : '一个'}图层${named}${here}（图层面板「插件图层」里）`);
  }
  if (u.data) {
    const kb = kbText(u.data.bytes);
    out.push(u.here === 'none' ? `存了它自己的数据（${kb} KB），装了它才用得上；数据原样留着，网站不打开、不改动。` : `存了它自己的数据（${kb} KB）。`);
    out.push('因为这个，这个世界不能公开分享（见「存档」）');
  }
  if (!out.length) out.push('世界里记着用过它');
  return out;
}

export default function WorldPluginsSection({ worldId }: { worldId: string }) {
  const v = useSavesVersion();
  const saved = pluginLayers.use(() => pluginLayers.get().saved);
  const [list, setList] = useState<UsedPlugin[] | null>(null);
  useEffect(() => {
    let live = true;
    void usedPlugins(worldId).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [worldId, v, saved]);
  const installed = useMemo(() => (list ?? []).flatMap((u) => (u.installed ? [u.installed] : [])), [list]);
  const icons = useIcons(installed);
  if (!list?.length) return null;
  return (
    <section className="ov-sec plg-wp" data-testid="world-plugins">
      <h3>
        用到的插件<small>看世界不需要插件</small>
      </h3>
      <div className="ov-kv">
        {list.map((u) => {
          const titles = u.layers.map((l) => saved.get(`${u.id}/${l}`)?.data.title).filter((t): t is string => !!t);
          return (
            <div key={u.id} className="plg-wp-row" data-plugin={u.id}>
              <PluginIcon src={u.installed ? icons.get(u.installed.current.sum) : null} size="sm" />
              <span>
                <b>
                  {u.name}
                  {u.plugin && <span className="plg-tag">{versionLabel(u.plugin.version)}</span>}
                  {u.here === 'none' ? <span className="plg-tag">你没装</span> : u.here === 'other' ? <span className="plg-tag">你装的是别的版本</span> : null}
                </b>
                {linesOf(u, titles).map((t) => (
                  <small key={t}>{t}</small>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <p>世界里只记插件的名字、第几版和文件指纹，不带插件的代码。装了同一个插件、版本不一样也能用；它认不了旧数据时会自己说要新版。</p>
    </section>
  );
}
