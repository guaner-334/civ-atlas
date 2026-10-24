/**
 * 从大纲点一条到地图上看(概览「大纲」页、侧栏「大纲」一组点一行,见 OutlineSide.tsx 的 goToPlot):
 *
 *   卡片顶上一条    「‹ 大纲」回大纲页;"第 5 条　1700 年前后"、批改的章;上一条 / 下一条(照着点过去)
 *   地图上的小牌子  那件事在哪:圆号(颜色按章)+ 一句话 + 章,立在城 / 州治所 / 国都上,每帧跟着地图走;时间轴拖远了先收起
 *   时间轴上的记号  每条一颗小菱形(颜色按章;没推过 = 灰),正看着的那条换成写着号的圆;悬停出小卡(第几条、时间、章、作者写的那句、结果),
 *                   点一下 = 点那一条
 *
 * 换选了别的、取消选中:不看了(卡片顶条、小牌子收起,时间轴上的号变回菱形)。
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import type { Intervention, PlotStatus } from '../gen/edits';
import { eraText } from '../gen/era';
import { useEdits, useEra } from './editsStore';
import { useCivTime, useSelection } from './civView';
import { openOverview } from './overviewStore';
import { focusHolds, setOutlineFocus, useOutlineUi } from './outlineStore';
import { PlotStatusTag, goToPlot, useOutlineCtx } from './OutlineSide';
import { plotCell, plotHeadline, plotText, plotWindow, resultText, timeCell, type OutlineCtx } from './outlineInfo';
import { interventionText } from './Interventions';
import { Icon } from './icons';
import type { WorldToClient } from './EventPins';
import './outline.css';

/** 时间轴离那件事落定的那年超过这么多年,地图上的小牌子先收起 */
const PIN_YEARS = 20;

const reviewOf = (o: OutlineCtx, id: number) => o.review?.find((r) => r.id === id);
const ivBase = (civ: Civ) => (v: Intervention, i: number) => interventionText(civ, v, i);

/** 一条落在哪一年:推过了 = 落定的那年,没推过 = 情节的年份(跟着前一条的按估的) */
const plotAt = (o: OutlineCtx, id: number) => {
  const p = o.plots.find((x) => x.id === id)!;
  const r = reviewOf(o, id);
  return r && r.status !== 'failed' ? r.year : plotWindow(o, p).at;
};

/** 卡片顶上一条:从大纲点过来的才有 */
export function PlotStrip({ civ }: { civ: Civ }) {
  const { focus } = useOutlineUi();
  const { sel } = useSelection();
  const o = useOutlineCtx(civ);
  const era = useEra();
  if (!o || !focusHolds(focus, sel)) return null;
  const i = o.plots.findIndex((x) => x.id === focus.plot);
  if (i < 0) return null;
  const p = o.plots[i];
  const r = reviewOf(o, p.id);
  const go = (k: number) => goToPlot(o, o.plots[k], reviewOf(o, o.plots[k].id));
  return (
    <div className="ol-strip" data-plot={p.id}>
      <button className="ol-link back" data-act="outline-strip-back" onClick={() => openOverview('outline')}>
        <Icon name="back" size={14} />
        大纲
      </button>
      <span className="ol-strip-t">
        第 {i + 1} 条<span className="yr">{eraText(timeCell(o, p, era)[0], era)}</span>
      </span>
      <PlotStatusTag s={r?.status ?? 'todo'} />
      <span className="sp" />
      <button className="ol-ic" data-act="outline-strip-prev" aria-label="上一条" title="上一条" disabled={i === 0} onClick={() => go(i - 1)}>
        <Icon name="up" size={13} />
      </button>
      <button className="ol-ic" data-act="outline-strip-next" aria-label="下一条" title="下一条" disabled={i === o.plots.length - 1} onClick={() => go(i + 1)}>
        <Icon name="down" size={13} />
      </button>
    </div>
  );
}

/** 地图上的小牌子(放在地图的名牌层里;换选了别的就不看了) */
export function PlotPin({ civ, world, toClient }: { civ: Civ | null; world: World; toClient: MutableRefObject<WorldToClient | null> }) {
  const { focus } = useOutlineUi();
  const { sel } = useSelection();
  const t = useCivTime();
  const o = useOutlineCtx(civ);
  const holds = focusHolds(focus, sel);
  useEffect(() => {
    if (focus && !holds) setOutlineFocus(null);
  }, [focus, holds]);
  const p = holds && o ? o.plots.find((x) => x.id === focus.plot) : undefined;
  const r = p && o ? reviewOf(o, p.id) : undefined;
  const cell = p && o ? plotCell(o, p, r) : -1;
  const near = p && o && t.year !== null ? Math.abs(t.year - plotAt(o, p.id)) <= PIN_YEARS : true;
  if (!p || !o || cell < 0 || !near) return null;
  const s = r?.status ?? 'todo';
  return (
    <MapPin x={world.mesh.x[cell]} y={world.mesh.y[cell]} toClient={toClient}>
      <span className={`num ${s}`}>{o.plots.indexOf(p) + 1}</span>
      {plotHeadline(o, p)}
      {s !== 'todo' && s !== 'natural' && <PlotStatusTag s={s} />}
    </MapPin>
  );
}

/** 立在世界坐标 (x, y) 上的牌子(下面一根短杆指着那一点),每帧跟着地图走(转到球背面的不显示) */
function MapPin({ x, y, toClient, children }: { x: number; y: number; toClient: MutableRefObject<WorldToClient | null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      const at = toClient.current?.(x, y) ?? null;
      if (el) {
        el.style.visibility = at ? '' : 'hidden';
        if (at) el.style.transform = `translate(${Math.round(at[0] - el.offsetWidth / 2)}px, ${Math.round(at[1] - el.offsetHeight - 4)}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [x, y, toClient]);
  return (
    <div ref={ref} className="ol-pin" style={{ visibility: 'hidden' }} aria-hidden="true">
      <div className="lb">{children}</div>
      <i className="stem" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 时间轴上的情节记号

/** 时间轴上的一条情节 */
export interface PlotTick {
  id: number;
  n: number;
  year: number;
  status: PlotStatus | 'todo';
  /** 正看着的那条 */
  on: boolean;
  /** 悬停的小卡 */
  tip: ReactNode;
  pick: () => void;
}

/** 时间轴上的情节记号(没有大纲 = undefined) */
export function usePlotTicks(civ: Civ | null): PlotTick[] | undefined {
  const o = useOutlineCtx(civ);
  const { focus } = useOutlineUi();
  const { sel } = useSelection();
  const list = useEdits().interventions;
  const era = useEra();
  const on = focusHolds(focus, sel) ? focus.plot : -1;
  return useMemo(() => {
    if (!o || !o.plots.length) return undefined;
    return o.plots.map((p, i) => {
      const r = reviewOf(o, p.id);
      const s = r?.status ?? 'todo';
      const res = r ? resultText(o, p, r, list, ivBase(o.civ)) : '';
      return {
        id: p.id,
        n: i + 1,
        year: plotAt(o, p.id),
        status: s,
        on: p.id === on,
        pick: () => goToPlot(o, p, r),
        tip: (
          <>
            <div className="h">
              <span>第 {i + 1} 条</span>
              <span>{eraText(timeCell(o, p, era)[0], era)}</span>
              <span className="sp" />
              <PlotStatusTag s={s} />
            </div>
            <div className="q">{plotText(p)}</div>
            {res && <div className="r">{eraText(res, era)}</div>}
          </>
        ),
      };
    });
  }, [o, on, list, era]);
}

/** 时间轴轨道上的情节记号(TimelineMarks 里,压在基线上);悬停出小卡,below = 小卡朝下弹(时间轴在顶上) */
export function PlotTicks({ ticks, end, width, below }: { ticks: readonly PlotTick[]; end: number; width: number; below: boolean }) {
  const [hot, setHot] = useState<number | null>(null);
  if (width <= 0 || end <= 0) return null;
  const x = (y: number) => (Math.min(end, Math.max(0, y)) / end) * width;
  const tip = ticks.find((t) => t.id === hot);
  const TIP_W = 300;
  return (
    <>
      {ticks.map((t) => (
        <span
          key={t.id}
          className={`ol-tick ${t.status}${t.on ? ' on' : ''}`}
          data-plot={t.id}
          style={{ left: x(t.year) }}
          onPointerEnter={(e) => e.buttons === 0 && setHot(t.id)}
          onPointerLeave={() => setHot((h) => (h === t.id ? null : h))}
          onClick={t.pick}
        >
          {t.on && <b>{t.n}</b>}
        </span>
      ))}
      {tip && (
        <div className={`ol-tip${below ? ' below' : ''}`} style={{ left: Math.min(Math.max(0, x(tip.year) - TIP_W / 2), Math.max(0, width - TIP_W)), width: TIP_W }}>
          {tip.tip}
        </div>
      )}
    </>
  );
}
