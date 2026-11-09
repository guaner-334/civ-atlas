/**
 * 新建世界里选地图插件的那一页:「地图」那一步点「地图插件」那一行进来,换掉左边(手机上是卡片里换页),左上「‹ 地图」回去。
 * 样子照选推演插件那一页(SimPick.tsx);选了、换了先后、拨了滑条(松手才算),星球照新选的马上重新长(onChange)。
 *
 *   选上的     按出手的先后(同一步里上面的先出手):≡ 拖着换先后、序号、⊖ 移出;名字下面写在哪一步出手;有滑条的点开拨
 *   装了没选的 ⊕ 加到最后;最多 4 个,满了灰着
 *   一个都没装 说地图插件是什么、去插件页装
 *   以它为底稿带过来、本机对不上的 照旧列在选上的里、标「你没装」「你装的是第 N 版」:装上同一版或移出以前,地图不重新长
 *
 * 选的记在 world/mapNow.ts(长地图带上它们的文件);建好以后不能换。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { listPlugins, type InstalledPlugin } from '../../plugin/pluginStore';
import type { MapPluginCheck } from '../../plugin/pluginWorld';
import { Icon } from '../icons';
import { currentWorld } from '../saveStore';
import { getStage } from '../stageStore';
import { useMapNow } from '../world/mapNow';
import { PuzzleIcon, openPlugins, subscribePluginsOpen } from './entry';
import { MAP_PICK_MAX, mapBrief } from './mapText';
import { chooseMaps, chosenMaps, type MapChoice } from './mapWorld';
import { PluginIcon, useIcons } from './pluginIcons';
import { installHowText, versionLabel } from './pluginWords';
import { serverBase } from '../../account/server';
import { paramsBrief } from './simPickText';
import { Glyph, SimSlider, move } from './SimPick';
import { useVerdicts, verdictOf } from './verdict';
import './plugins.css';

type Off = Exclude<MapPluginCheck, { status: 'ready' }>;

export interface MapPickProps {
  phone: boolean;
  onBack: () => void;
  /** 选的变了(已记进 world/mapNow.ts):星球照它重新长 */
  onChange: () => void;
  /** 电脑:右上收起侧栏 */
  onCollapse?: () => void;
  /** 新建中的世界(长不出地图时 currentWorld() 是空的,照这个认) */
  worldId?: string;
}

const MAX = MAP_PICK_MAX;

/** 带过来的这一个本机怎么对不上 */
function offTag(c: Off): string {
  if (c.status === 'other') return `你装的是${versionLabel(c.installed.version)}`;
  if (c.status === 'blocked') return '网站停用了';
  return '你没装';
}

export function MapPick({ phone, onBack, onChange, onCollapse, worldId: given }: MapPickProps) {
  // 选了以后星球在重新长、长不出来,那会儿 currentWorld() 是空的:记着进来时的世界
  const idRef = useRef(currentWorld()?.id ?? given);
  idRef.current = currentWorld()?.id ?? idRef.current;
  const worldId = idRef.current;
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [picks, setPicks] = useState<MapChoice[]>(() => chosenMaps(worldId));
  const picksRef = useRef(picks);
  picksRef.current = picks;
  /** 滑条展开着的那一个 */
  const [open, setOpen] = useState<string | null>(null);
  useVerdicts();
  const icons = useIcons(installed);
  const mapNow = useMapNow();
  const carried = mapNow && mapNow.id === worldId && !mapNow.ready ? mapNow.checks.filter((c): c is Off => c.status !== 'ready') : [];
  // 别处改了选的(带过来的装上了、停用名单变了):照记着的换
  useEffect(() => {
    const next = chosenMaps(worldId);
    if (JSON.stringify(next) !== JSON.stringify(picksRef.current)) setPicks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapNow]);

  useEffect(() => {
    let live = true;
    const load = () =>
      listPlugins().then(
        (l) => live && setInstalled(l.filter((p) => p.current.manifest.role === 'map')),
        () => live && setInstalled([]),
      );
    void load();
    // 从这里去插件页装了、删了,回来重新列
    const off = subscribePluginsOpen((on) => !on && void load());
    return () => {
      live = false;
      off();
    };
  }, []);

  const usable = (installed ?? []).filter((p) => !verdictOf(p.current.sum, p.id).blocked);
  type Row = { c: MapChoice; p: InstalledPlugin; off: null } | { c: MapChoice; p: null; off: Off };
  const rows = picks.flatMap((c): Row[] => {
    const off = carried.find((x) => x.id === c.id);
    if (off) return [{ c, p: null, off }];
    const p = usable.find((x) => x.id === c.id);
    return p ? [{ c, p, off: null }] : [];
  });
  const rest = usable.filter((p) => !picks.some((c) => c.id === p.id));
  const full = rows.length >= MAX;

  const commit = (next: MapChoice[]) => {
    setPicks(next);
    // 读插件文件的这一会儿点了「‹ 地图」也照样记下、重新长;离开了新建界面、换了世界的不记
    if (worldId) void chooseMaps(worldId, next, installed ?? undefined, () => getStage().stage === 'draft' && (currentWorld()?.id ?? worldId) === worldId).then((ok) => ok && onChange());
  };
  // 插件删掉了、被停用了:选上的里去掉(换了版本的不自动换,地图不悄悄变)
  useEffect(() => {
    if (installed && rows.length !== picks.length) commit(rows.map((x) => x.c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  const listRef = useRef<HTMLDivElement>(null);
  const drag = (e: ReactPointerEvent<HTMLElement>, from: number) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let at = from;
    const onMove = (ev: PointerEvent) => {
      const els = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-map-row]') ?? [])];
      // 拖到第几个:别的几行里中线在指针上面的有几行
      const to = els.filter((r, k) => {
        const b = r.getBoundingClientRect();
        return k !== at && ev.clientY > b.top + b.height / 2;
      }).length;
      if (to !== at) {
        setPicks((l) => move(l, at, to));
        at = to;
      }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (at !== from) commit(picksRef.current);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };
  const nudge = (i: number, d: number) => {
    const j = i + d;
    if (j >= 0 && j < picks.length) commit(move(picks, i, j));
  };
  const grip = (name: string, i: number) => (
    <button
      className="sp-grip"
      aria-label={`${name}：拖动排先后`}
      onPointerDown={(e) => drag(e, i)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          nudge(i, e.key === 'ArrowUp' ? -1 : 1);
        }
      }}
    >
      <Glyph d="M5 8h14M5 12h14M5 16h14" />
    </button>
  );

  const setParam = (id: string, k: string, v: number) => commit(picks.map((c) => (c.id === id ? { ...c, params: { ...c.params, [k]: v } } : c)));
  const resetParams = (id: string) => commit(picks.map((c) => (c.id === id ? { id } : c)));

  const top = (
    <>
      <div className="st-top">
        <button className="nw-back" data-act="map-pick-back" onClick={onBack}>
          <Icon name="back" size={18} />
          地图
        </button>
        {onCollapse && (
          <button className="sb-collapse" data-act="side-collapse" aria-label="收起侧栏" data-tip="收起侧栏" onClick={onCollapse}>
            <Icon name="sidebar" size={19} />
          </button>
        )}
      </div>
      <div className="nw-title-row">
        <div className="nw-title">地图插件</div>
      </div>
      <div className="nw-intro sp-intro">长地图时跟着出手的插件，最多 4 个。先改海拔、再改气候、最后出图层；同一步里上面的先出手。建好以后不能换。</div>
    </>
  );
  if (installed && !usable.length && !rows.length)
    return (
      <div className="sp" data-testid="map-pick">
        {top}
        <div className="sp-empty">
          <b>还没装地图插件</b>
          <span>地图插件在长地图时出手，改海拔、改气候，或者给地图加一张图层：比如砸出陨石坑（环形山）、照柯本气候分类（柯本气候）。{installHowText(!!serverBase())}</span>
          <button className="sp-btn" data-act="map-pick-plugins" onClick={openPlugins}>
            <PuzzleIcon size={16} />
            去插件页…
          </button>
        </div>
        <div className="nm-note sp-note">不选就照官方的长法长地图，和以前一样。</div>
      </div>
    );

  return (
    <div className="sp" data-testid="map-pick">
      {top}
      {rows.length > 0 && (
        <>
          <div className="sp-sec">
            选上的<span>{full ? `${rows.length} / ${MAX}` : phone ? '按住 ≡ 拖动排先后' : '拖 ≡ 排先后'}</span>
          </div>
          <div className="sp-grp" ref={listRef}>
            {rows.map(({ c, p, off }, i) => {
              if (!p) {
                const name = off.plugin.name ?? off.id;
                return (
                  <div key={off.id} className="sp-item">
                    <div className="sp-row" data-map-row={off.id} data-map-off={off.status}>
                      {grip(name, i)}
                      <span className="sp-ord">{i + 1}</span>
                      <PluginIcon src={null} size="sm" />
                      <span className="sp-nm">
                        <b>
                          {name} <span className="plg-tag">{versionLabel(off.plugin.version)}</span> <span className="plg-tag warn">{offTag(off)}</span>
                        </b>
                        <small>{off.status === 'blocked' ? '移出它，地图照剩下的插件重新长' : '装上同一版，或者移出它，地图才能重新长'}</small>
                      </span>
                      <button className="sp-rm" data-act="map-remove" aria-label={`移出${name}`} onClick={() => commit(picks.filter((x) => x.id !== off.id))}>
                        <Glyph d="M8 12h8" ring />
                      </button>
                    </div>
                  </div>
                );
              }
              const m = p.current.manifest;
              const spec = m.map?.params ?? {};
              const keys = Object.keys(spec);
              const isOpen = open === p.id && keys.length > 0;
              const brief = paramsBrief(spec, c.params);
              const v = verdictOf(p.current.sum, p.id);
              return (
                <div key={p.id} className="sp-item">
                  <div className="sp-row" data-map-row={p.id}>
                    {grip(m.name, i)}
                    <span className="sp-ord">{i + 1}</span>
                    <PluginIcon src={icons.get(p.current.sum)} size="sm" />
                    <span className="sp-nm">
                      <b>
                        {m.name} <span className="plg-tag">{versionLabel(m.version)}</span>
                        {!v.reviewed && (
                          <>
                            {' '}
                            <span className="plg-tag warn">没审核</span>
                          </>
                        )}
                      </b>
                      <small>{m.map ? mapBrief(m.map) : ''}</small>
                      {keys.length > 0 && !isOpen && (
                        <button className="sp-tog" data-act="map-params-open" onClick={() => setOpen(p.id)}>
                          {brief}
                          <Icon name="chevron" size={14} />
                        </button>
                      )}
                    </span>
                    <button className="sp-rm" data-act="map-remove" aria-label={`移出${m.name}`} onClick={() => commit(picks.filter((x) => x.id !== p.id))}>
                      <Glyph d="M8 12h8" ring />
                    </button>
                  </div>
                  {isOpen && (
                    <>
                      <div className="sp-slh">
                        {brief}
                        {brief.includes('改过') && (
                          <button className="sp-lnk" data-act="map-params-reset" onClick={() => resetParams(p.id)}>
                            恢复默认
                          </button>
                        )}
                        <button className="sp-lnk" data-act="map-params-close" onClick={() => setOpen(null)}>
                          收起
                        </button>
                      </div>
                      {keys.map((k) => (
                        <SimSlider key={k} k={k} p={spec[k]} value={c.params && k in c.params ? c.params[k] : spec[k].default} onCommit={(x) => setParam(p.id, k, x)} />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {rest.length > 0 && (
        <>
          <div className="sp-sec">
            {rows.length ? '装了没选的' : '装了的'}
            {full && <span>最多 {MAX} 个，先移出一个</span>}
          </div>
          <div className="sp-grp">
            {rest.map((p) => {
              const m = p.current.manifest;
              return (
                <div key={p.id} className={`sp-row${full ? ' dis' : ''}`}>
                  <PluginIcon src={icons.get(p.current.sum)} size="sm" />
                  <span className="sp-nm">
                    <b>
                      {m.name} <span className="plg-tag">{versionLabel(m.version)}</span>
                      {!verdictOf(p.current.sum, p.id).reviewed && (
                        <>
                          {' '}
                          <span className="plg-tag warn">没审核</span>
                        </>
                      )}
                    </b>
                    <small>{m.map ? mapBrief(m.map) : ''}</small>
                  </span>
                  <button className="sp-add" data-act="map-add" aria-label={`选上${m.name}`} disabled={full} onClick={() => commit([...picks, { id: p.id }])}>
                    <Icon name="plus" size={20} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      <button className="sp-more" data-act="map-pick-plugins" onClick={openPlugins}>
        去插件页装别的地图插件…
      </button>
      {!phone && <div className="nm-note sp-note">用了地图插件的世界，别人打开照样能看、接着推；要改地形，得装着同一版插件。</div>}
    </div>
  );
}
