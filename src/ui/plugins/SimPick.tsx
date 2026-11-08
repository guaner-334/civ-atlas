/**
 * 新建世界里选推演插件的那一页:「文明」里点「推演插件」那一行进来,换掉左边(手机上是卡片里换页),左上「‹ 文明」回去;
 * 底下照旧是「开始推演」。样子照选规则那一页。
 *
 *   选上的     按出手的先后:≡ 拖着换先后、序号、⊖ 移出;有滑条的点开拨(样子和「拓荒」的一样,能打字),改过的写默认值、能恢复默认
 *              几个插件交到同一个影响口:下面一句说两边的数乘在一起(加的口写加在一起),只说明、不挡着
 *   装了没选的 ⊕ 加到最后;最多 4 个,满了灰着
 *   一个都没装 说推演插件是什么、去插件页装
 *   以它为底稿带过来、本机没装的 照旧列在选上的里、标「你没装」:装上或移出以前不能开始推演
 *
 * 选的记在 world/simNow.ts(推演带上它们的文件);建好以后不能换。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { listPlugins, type InstalledPlugin } from '../../plugin/pluginStore';
import type { SimParam } from '../../plugin/pluginSim';
import { Icon } from '../icons';
import { ParamField, rangeFill } from '../ParamField';
import type { SliderLike } from '../genesisSliders';
import { currentWorld } from '../saveStore';
import { useSimNow } from '../world/simNow';
import { PuzzleIcon, openPlugins, subscribePluginsOpen } from './entry';
import { PluginIcon, useIcons } from './pluginIcons';
import { versionLabel } from './pluginWords';
import { chooseSims, chosenSims, type SimChoice } from './worldPlugins';
import type { SimPluginCheck } from '../../plugin/pluginWorld';
import { paramDigits, paramStep, paramsBrief, sharedNotes, simBrief } from './simPickText';
import { useVerdicts, verdictOf } from './verdict';
import './plugins.css';

type Missing = Extract<SimPluginCheck, { status: 'missing' }>;

export interface SimPickProps {
  phone: boolean;
  onBack: () => void;
  /** 电脑:右上收起侧栏 */
  onCollapse?: () => void;
}

/** 一个世界最多几个推演插件(和推演引擎的 PLUGIN_LIMITS.plugins 一样) */
export const SIM_PICK_MAX = 4;
const MAX = SIM_PICK_MAX;

export const move = <T,>(l: readonly T[], from: number, to: number): T[] => {
  const out = [...l];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
};

export function SimPick({ phone, onBack, onCollapse }: SimPickProps) {
  const worldId = currentWorld()?.id;
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [picks, setPicks] = useState<SimChoice[]>(() => chosenSims(worldId));
  const picksRef = useRef(picks);
  picksRef.current = picks;
  /** 滑条展开着的那一个 */
  const [open, setOpen] = useState<string | null>(null);
  useVerdicts();
  const icons = useIcons(installed);
  const simNow = useSimNow();
  const carried = simNow && simNow.id === worldId ? simNow.checks.filter((c): c is Missing => c.status === 'missing') : [];
  // 别处改了选的(带过来的装上了、停用名单变了):照记着的换
  useEffect(() => {
    const next = chosenSims(worldId);
    if (JSON.stringify(next) !== JSON.stringify(picksRef.current)) setPicks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simNow]);

  useEffect(() => {
    let live = true;
    const load = () =>
      listPlugins().then(
        (l) => live && setInstalled(l.filter((p) => p.current.manifest.role === 'sim')),
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
  type Row = { c: SimChoice; p: InstalledPlugin; miss: null } | { c: SimChoice; p: null; miss: Missing };
  const rows = picks.flatMap((c): Row[] => {
    const p = usable.find((x) => x.id === c.id);
    if (p) return [{ c, p, miss: null }];
    const miss = carried.find((x) => x.id === c.id);
    return miss ? [{ c, p: null, miss }] : [];
  });
  const chosen = rows.flatMap(({ c, p }) => (p ? [{ c, p }] : []));
  const rest = usable.filter((p) => !picks.some((c) => c.id === p.id));
  const full = rows.length >= MAX;

  const commit = (next: SimChoice[]) => {
    setPicks(next);
    if (worldId) void chooseSims(worldId, next, installed ?? undefined);
  };
  // 插件删掉了、被停用了:选上的里去掉;更新了版本:换成现在那一版的文件
  useEffect(() => {
    if (installed) commit(rows.map((x) => x.c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  const listRef = useRef<HTMLDivElement>(null);
  const drag = (e: ReactPointerEvent<HTMLElement>, from: number) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let at = from;
    const onMove = (ev: PointerEvent) => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-sim-row]') ?? [])];
      // 拖到第几个:别的几行里中线在指针上面的有几行
      const to = rows.filter((r, k) => {
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

  const setParam = (id: string, k: string, v: number) => commit(picks.map((c) => (c.id === id ? { ...c, params: { ...c.params, [k]: v } } : c)));
  const resetParams = (id: string) => commit(picks.map((c) => (c.id === id ? { id } : c)));

  const top = (
    <>
      <div className="st-top">
        <button className="nw-back" data-act="sim-pick-back" onClick={onBack}>
          <Icon name="back" size={18} />
          文明
        </button>
        {onCollapse && (
          <button className="sb-collapse" data-act="side-collapse" aria-label="收起侧栏" data-tip="收起侧栏" onClick={onCollapse}>
            <Icon name="sidebar" size={19} />
          </button>
        )}
      </div>
      <div className="nw-title-row">
        <div className="nw-title">推演插件</div>
      </div>
      <div className="nw-intro sp-intro">
        {phone ? '推演时跟着出手的插件，最多 4 个，上面的先出手。建好以后不能换。' : '推演时跟着出手的插件，最多 4 个，上面的先出手。建好以后不能换；想换，就以它为底稿另建一个世界。'}
      </div>
    </>
  );
  if (installed && !usable.length && !rows.length)
    return (
      <div className="sp" data-testid="sim-pick">
        {top}
        <div className="sp-empty">
          <b>还没装推演插件</b>
          <span>推演插件会在推演里出手，改历史怎么走：比如有议会的国家开战要先过议会（厌战）、异教的州更难治（宗教生效）。在插件页里从作品墙或文件装，装好回到这里选。</span>
          <button className="sp-btn" data-act="sim-pick-plugins" onClick={openPlugins}>
            <PuzzleIcon size={16} />
            去插件页…
          </button>
        </div>
        <div className="nm-note sp-note">不选就照规则推，和以前一样。</div>
      </div>
    );

  const notes = sharedNotes(chosen.map(({ p }) => ({ name: p.current.manifest.name, influences: p.current.manifest.sim?.influences })));
  return (
    <div className="sp" data-testid="sim-pick">
      {top}
      {rows.length > 0 && (
        <>
          <div className="sp-sec">
            选上的<span>{full ? `${rows.length} / ${MAX}` : phone ? '按住 ≡ 拖动排先后' : '拖 ≡ 排先后'}</span>
          </div>
          <div className="sp-grp" ref={listRef}>
            {rows.map(({ c, p, miss }, i) => {
              if (!p) {
                const name = miss.plugin.name ?? miss.id;
                return (
                  <div key={miss.id} className="sp-item">
                    <div className="sp-row" data-sim-row={miss.id} data-sim-missing>
                      <button className="sp-grip" aria-label={`${name}：拖动排先后`} onPointerDown={(e) => drag(e, i)}>
                        <Glyph d="M5 8h14M5 12h14M5 16h14" />
                      </button>
                      <span className="sp-ord">{i + 1}</span>
                      <PluginIcon src={null} size="sm" />
                      <span className="sp-nm">
                        <b>
                          {name} <span className="plg-tag">{versionLabel(miss.plugin.version)}</span> <span className="plg-tag warn">你没装</span>
                        </b>
                        <small>装上同一个插件，或者移出它，才能开始推演</small>
                      </span>
                      <button className="sp-rm" data-act="sim-remove" aria-label={`移出${name}`} onClick={() => commit(picks.filter((x) => x.id !== miss.id))}>
                        <Glyph d="M8 12h8" ring />
                      </button>
                    </div>
                  </div>
                );
              }
              const m = p.current.manifest;
              const spec = m.sim?.params ?? {};
              const keys = Object.keys(spec);
              const isOpen = open === p.id && keys.length > 0;
              const brief = paramsBrief(spec, c.params);
              return (
                <div key={p.id} className="sp-item">
                  <div className="sp-row" data-sim-row={p.id}>
                    <button
                      className="sp-grip"
                      aria-label={`${m.name}：拖动排先后`}
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
                    <span className="sp-ord">{i + 1}</span>
                    <PluginIcon src={icons.get(p.current.sum)} size="sm" />
                    <span className="sp-nm">
                      <b>
                        {m.name} <span className="plg-tag">{versionLabel(m.version)}</span>
                      </b>
                      {!(phone && keys.length && !isOpen) && <small>{m.sim ? simBrief(m.sim) : ''}</small>}
                      {keys.length > 0 && !isOpen && (
                        <button className="sp-tog" data-act="sim-params-open" onClick={() => setOpen(p.id)}>
                          {brief}
                          <Icon name="chevron" size={14} />
                        </button>
                      )}
                    </span>
                    <button className="sp-rm" data-act="sim-remove" aria-label={`移出${m.name}`} onClick={() => commit(picks.filter((x) => x.id !== p.id))}>
                      <Glyph d="M8 12h8" ring />
                    </button>
                  </div>
                  {isOpen && (
                    <>
                      <div className="sp-slh">
                        {brief}
                        {brief.includes('改过') && (
                          <button className="sp-lnk" data-act="sim-params-reset" onClick={() => resetParams(p.id)}>
                            恢复默认
                          </button>
                        )}
                        <button className="sp-lnk" data-act="sim-params-close" onClick={() => setOpen(null)}>
                          收起
                        </button>
                      </div>
                      {keys.map((k) => (
                        <SimSlider key={k} k={k} p={spec[k]} value={c.params && k in c.params ? c.params[k] : spec[k].default} onCommit={(v) => setParam(p.id, k, v)} />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {notes.length > 0 && (
            <div className="sp-info" data-testid="sim-shared">
              <Icon name="info" size={16} />
              <span>
                {notes.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </div>
          )}
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
                    </b>
                    <small>{m.sim ? simBrief(m.sim) : ''}</small>
                  </span>
                  <button className="sp-add" data-act="sim-add" aria-label={`选上${m.name}`} disabled={full} onClick={() => commit([...picks, { id: p.id }])}>
                    <Icon name="plus" size={20} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      <button className="sp-more" data-act="sim-pick-plugins" onClick={openPlugins}>
        去插件页装别的推演插件…
      </button>
      {!phone && <div className="nm-note sp-note">选了插件的世界，别人打开照样能看；要接着推，得装着同一版插件。</div>}
    </div>
  );
}

/** ≡、⊖ 这几样图标里没有 */
export function Glyph({ d, ring }: { d: string; ring?: boolean }) {
  return (
    <svg className="icon" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true" focusable="false">
      {ring && <circle cx="12" cy="12" r="8.5" />}
      <path d={d} />
    </svg>
  );
}

/** 一个滑条:名字(改过的跟一句默认值)、能打字的数、下面一条;拖动时只改数,松手才算 */
export function SimSlider({ k, p, value, onCommit }: { k: string; p: SimParam; value: number; onCommit: (v: number) => void }) {
  const step = paramStep(p);
  const digits = paramDigits(step);
  const s: SliderLike = { key: k, name: p.label, min: p.min, max: p.max, step, fmt: (v) => v.toFixed(digits), hint: '', field: { digits } };
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const [err, setErr] = useState<string | null>(null);
  const changed = value !== p.default;
  return (
    <div className="param-slider sp-sl" data-param={k}>
      <span className="param-slider-row">
        <span>
          {p.label}
          {changed && <small className="sp-def">默认 {s.fmt(p.default)}</small>}
        </span>
        <ParamField s={s} value={v} onCommit={onCommit} onBad={setErr} />
      </span>
      {err && <span className="param-slider-err">{err}</span>}
      <input
        type="range"
        aria-label={p.label}
        min={p.min}
        max={p.max}
        step={step}
        value={v}
        style={rangeFill(s, v)}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== value && onCommit(v)}
        onKeyUp={() => v !== value && onCommit(v)}
      />
    </div>
  );
}
