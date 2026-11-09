/**
 * 以它为底稿新建、本机对不上原来那张地图用的地图插件时,新建界面「地图插件」那一行下面、编辑地形面板顶上的那一块:
 *   没装     「原来的地图用了「环形山」第 1.0 版，这台没装」:「去作品墙装同一版」(作品墙上正是这一版才有)「从文件装…」
 *   被停用了 只说停用了,移出它才能重新长
 *   别的版本 「换成第 1.1 版重新长」(地图会变,不自动换)
 * 没装的先说;装好以后这一块自己收起
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { MapPluginCheck } from '../../plugin/pluginWorld';
import { Icon } from '../icons';
import { useMapNow } from '../world/mapNow';
import { openPluginPicked, openWallPlugin } from './entry';
import { pickAccept } from './pickAccept';
import { useWallRev, wallOnce, wallWorkOf } from './galleryWatch';
import { swapMaps } from './mapWorld';
import { versionLabel } from './pluginWords';
import './plugins.css';
import './mapOff.css';

export interface MapOffNoteProps {
  /** studio = 新建界面「星球」那一组下面;terrain = 编辑地形面板顶上 */
  where: 'studio' | 'terrain';
  phone: boolean;
  /** 插件界面开着(关着时不给装、不提「地图插件」那一行) */
  plugins: boolean;
  /** 换了版本:星球照新选的重新长 */
  onRegrow: () => void;
}

type Off = Exclude<MapPluginCheck, { status: 'ready' }>;

const nameOf = (c: Off) => `「${c.plugin.name ?? c.id}」${versionLabel(c.plugin.version)}`;

export function MapOffNote({ where, phone, plugins, onRegrow }: MapOffNoteProps) {
  const s = useMapNow();
  const fileRef = useRef<HTMLInputElement>(null);
  useWallRev();
  useEffect(() => void wallOnce(), []);
  if (!s || s.ready) return null;
  const off = s.checks.filter((c): c is Off => c.status !== 'ready');
  const miss = off.filter((c) => c.status === 'missing');
  const blocked = off.filter((c) => c.status === 'blocked');
  const other = off.filter((c): c is Extract<Off, { status: 'other' }> => c.status === 'other');
  const studio = where === 'studio';
  const it = (n: number) => (n > 1 ? '它们' : '它');
  const names = (cs: readonly Off[]) => cs.map(nameOf).join('、');
  let head: string;
  let text: string;
  let buttons: ReactNode = null;
  if (miss.length || !off.length) {
    const cs = miss.length ? miss : s.list.map((plugin): Off => ({ id: plugin.id, plugin, status: 'missing' }));
    const works = cs.map((c) => wallWorkOf(c.id, c.plugin.sum));
    const at = works.findIndex((w) => !!w);
    const go = at < 0 ? null : { work: works[at]!, sum: cs[at].plugin.sum };
    const get = go ? '装上同一版' : '向分享这个世界的人要插件文件，装上同一版';
    head = `原来的地图用了${names(cs)}，这台没装`;
    text = studio
      ? `换世界参数、改地形，都得用${it(cs.length)}把地图重新长一遍。${get}就能改${plugins ? `；或者在「地图插件」里移出${it(cs.length)}，照不带${it(cs.length)}的重新长（地图会变）` : ''}。`
      : `改地形要用${it(cs.length)}把地图重新长一遍，${get}才能改。`;
    if (plugins)
      buttons = (
        <>
          {go && (
            <button className="mo-btn pri" data-act="map-off-wall" onClick={() => openWallPlugin(go.work, go.sum)}>
              去作品墙装同一版
            </button>
          )}
          <button className="mo-btn" data-act="map-off-file" onClick={() => fileRef.current?.click()}>
            从文件装…
          </button>
        </>
      );
  } else if (blocked.length) {
    const n = blocked.length;
    head = `原来的地图用了${names(blocked)}，${it(n)}被网站停用了`;
    text = studio
      ? `换世界参数、改地形，都得用${it(n)}把地图重新长一遍，${it(n)}不再跑了。${plugins ? `在「地图插件」里移出${it(n)}，照不带${it(n)}的重新长（地图会变）。` : ''}`
      : `改地形要用${it(n)}把地图重新长一遍，${it(n)}不再跑了${plugins ? `；在「地图插件」里移出${it(n)}才能改（地图会变）` : ''}。`;
  } else {
    const one = other.length === 1 ? other[0] : null;
    const to = one ? versionLabel(one.installed.version) : '你装的版本';
    head = one ? `原来的地图用的是${nameOf(one)}，你装的是${versionLabel(one.installed.version)}` : `原来的地图用的是${names(other)}，你装的是别的版本`;
    text = `改地形得用同一版重新长。换成${to}也行，但整张地图会变（雨、河、森林沙漠、文明都会不一样）。`;
    if (plugins)
      buttons = (
        <button
          className="mo-btn pri"
          data-act="map-off-swap"
          onClick={() =>
            void swapMaps(
              s.id,
              other.map((c) => c.id),
            ).then((ok) => ok && onRegrow())
          }
        >
          换成{to}重新长
        </button>
      );
  }
  return (
    <div className={`mo-why${phone ? ' ph' : ''}`} data-testid="map-off" data-where={where}>
      <Icon name="warn" size={18} />
      <span>
        <b>{head}</b>
        {text}
        {buttons && <span className="mo-bs">{buttons}</span>}
        <input
          ref={fileRef}
          type="file"
          accept={pickAccept()}
          hidden
          data-testid="map-off-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) openPluginPicked(f);
          }}
        />
      </span>
    </div>
  );
}
