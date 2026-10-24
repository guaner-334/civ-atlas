/**
 * 侧栏「大纲」一组(宽屏的侧栏、手机的世界卡片都放在「国家」上面;逐年推演里不放),和几处共用的零件:
 *
 *   没写大纲    「先有故事？」一句说明 +「写大纲」(打开概览的「大纲」页)
 *   写好了      每条一行:年份、作者写的那句(没写 = 发生什么),右边批改的章;下面一句和「照大纲推演」(还没推过)/ 合计(推过了)
 *   正在推      查完的打上章,正在查的那条转圈、底下一行"没自然发生，在第 N 年硬改，接着推",后面的写"等着"
 * 点一行 = 收起概览、时间轴跳到那一年(推过了 = 落定的那年)、地图上选中它说的国家 / 州 / 城。
 * 照大纲推演的提示条(进度、推完)也在这里拼好,App 接后台线程时调。
 */
import { useMemo, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import { keyCells, regionOfKey, resolveKey, resolvePersonKey, type PlotReview, type PlotStatus, type Plot } from '../gen/edits';
import { yearShort, eraText, type Era } from '../gen/era';
import { useEdits } from './editsStore';
import { getSelection, setCivTime, setSelection, type MapSelection } from './civView';
import { closeOverview, openOverview } from './overviewStore';
import { setOutlineFocus, startOutline, useOutlineUi, type OutlineRun } from './outlineStore';
import type { ToastInput } from './toastStore';
import { Icon, type IconName } from './icons';
import { PLOT_KIND_INFO, STATUS_NAMES, plotText, countsText, plotNo, plotPolityId, plotWindow, reviewCounts, stageText, type OutlineCtx } from './outlineInfo';
import './outline.css';

/** 侧栏里最多列几条(多了写"还有 N 条") */
const SIDE_ROWS = 12;

const STATUS_ICON: Record<PlotStatus | 'todo', IconName> = { natural: 'check', forced: 'pen', failed: 'close', story: 'lines', todo: 'ring' };

/** 批改的章(ic = 只要图标:侧栏) */
export function PlotStatusTag({ s, ic }: { s: PlotStatus | 'todo'; ic?: boolean }) {
  return (
    <span className={`ol-st ${s}${ic ? ' ic' : ''}`} title={ic ? STATUS_NAMES[s] : undefined} data-status={s}>
      <Icon name={STATUS_ICON[s]} size={13} />
      {!ic && STATUS_NAMES[s]}
    </span>
  );
}

/** 正在查的那一条的章(转圈) */
export function PlotRunTag() {
  return (
    <span className="ol-st run ic" title="正在查">
      <i className="ol-spin" />
    </span>
  );
}

/** 一条情节在列表里写什么:作者写的那句(去掉句末的句号),没写 = 发生什么 */
export const plotLine = plotText;

/** 大纲的说法要用的:这份历史、大纲、批改(推着的时候用推到现在的那一份)、作者的标记和人物 */
export function useOutlineCtx(civ: Civ | null): OutlineCtx | null {
  const edits = useEdits();
  const { run } = useOutlineUi();
  const plots = edits.outline?.plots;
  const review = run ? run.review : edits.outline?.review;
  return useMemo(() => (civ && plots ? { civ, plots, review, marks: edits.marks, characters: edits.characters } : null), [civ, plots, review, edits.marks, edits.characters]);
}

/**
 * 点一条:地图上看它说的那件事 —— 跳到那一年(推过了 = 落定的那年),选中它说的国家(立起来的国家;亡国 = 并了它的那国)/ 州 / 城
 * (说不出选什么的留着现在选中的),记下从大纲点过来的是哪一条(卡片顶上一条、地图上的小牌子)
 */
export function goToPlot(o: OutlineCtx, p: Plot, r: PlotReview | undefined) {
  const year = r && r.status !== 'failed' ? r.year : plotWindow(o, p).at;
  closeOverview();
  setCivTime({ year: Math.min(o.civ.endYear, Math.max(0, year)), playing: false, scrubbing: false, story: false });
  const sel = plotTarget(o, p, r) ?? getSelection().sel;
  if (sel) setSelection(sel);
  setOutlineFocus(sel ? { plot: p.id, sel } : null);
}

/** 一条情节在地图上选中什么(没有可选的 = null) */
export function plotTarget(o: OutlineCtx, p: Plot, r: PlotReview | undefined): MapSelection | null {
  const civ = o.civ;
  if (r?.polity) {
    const q = resolveKey(civ, r.polity);
    if (q?.kind === 'polity') return { kind: 'polity', id: q.id };
  }
  if (p.kind === 'death' && p.person) {
    const x = resolvePersonKey(civ, p.person);
    if (x >= 0) return { kind: 'person', id: x };
  }
  if ((p.kind === 'capital' || (p.kind === 'disaster' && p.type === 'plague')) && p.city) {
    const c = resolveKey(civ, p.city);
    if (c?.kind === 'settlement') return { kind: 'settlement', id: c.id };
  }
  // 亡国:选中并了它的那国(亡了的国家地图上已经没有了)
  const b = p.kind === 'fall' ? plotPolityId(o, p.b) : -1;
  if (b >= 0) return { kind: 'polity', id: b };
  const a = plotPolityId(o, p.a);
  if (a >= 0 && p.kind !== 'split') return { kind: 'polity', id: a };
  const key = p.region ?? p.regions?.[0];
  if (key) {
    const reg = regionOfKey(key, keyCells(civ.regions));
    if (reg >= 0 && reg < civ.regions.count) return { kind: 'region', id: reg };
  }
  return a >= 0 ? { kind: 'polity', id: a } : null;
}

/** 照大纲推演的提示条:"照大纲推演：第 5 / 10 条",正在硬改时底下一句 */
export function outlineRunToast(run: OutlineRun, o: OutlineCtx, era: Era | undefined, stop: () => void): ToastInput {
  const p = run.at !== null ? o.plots.find((x) => x.id === run.at) : undefined;
  const more = p && run.fix !== null ? [eraText(stageText(o, p, run.fix), era)] : [];
  return {
    id: 'outline',
    kind: 'progress',
    text: `照大纲推演：第 ${Math.min(run.total, run.done + 1)} / ${run.total} 条`,
    progress: run.total ? run.done / run.total : 0,
    more,
    action: { label: '取消', act: 'outline-stop', onClick: stop },
  };
}

/** 照大纲推演好了的提示条 */
export function outlineDoneToast(review: readonly PlotReview[], open: () => void): ToastInput {
  const n = reviewCounts(review);
  return {
    id: 'outline-done',
    kind: n.failed ? 'warn' : 'ok',
    text: '已照大纲推演',
    more: [countsText(n)],
    action: { label: '看结果', act: 'outline-open', onClick: open },
    ttl: 7000,
  };
}

/** 侧栏「大纲」一组 */
export function OutlineSide({ civ, era }: { civ: Civ | null; era?: Era | null }) {
  const edits = useEdits();
  const { run } = useOutlineUi();
  const o = useOutlineCtx(civ);
  const plots = edits.outline?.plots ?? [];
  if (!plots.length || !o)
    return (
      <section className="sb-sec ol-side" data-testid="outline-side">
        <div className="sb-sec-head">
          <span>大纲</span>
        </div>
        <div className="sb-group">
          <div className="ol-empty">
            <b>先有故事？</b>
            一条条写下故事里的大事，世界照着往下推；推完逐条看有没有发生。
            <button className="ol-btn" data-act="outline-write" onClick={() => openOverview('outline')}>
              <Icon name="plus" size={15} />
              写大纲
            </button>
          </div>
        </div>
      </section>
    );
  const review = o.review;
  const byId = new Map((review ?? []).map((r) => [r.id, r]));
  const shown = plots.slice(0, SIDE_ROWS);
  const n = reviewCounts(review);
  let foot: ReactNode;
  if (run) foot = <div className="ol-sum">第 {Math.min(run.total, run.done + 1)} / {run.total} 条。算的时候地图照样能拖、能点。</div>;
  else if (review?.length)
    foot = <div className="ol-sum">{countsText(n)}。点一条到地图上看。</div>;
  else
    foot = (
      <>
        <div className="ol-sum">还没照着推演过。地图上现在是照常推出来的历史。</div>
        <div className="ol-acts">
          <button className="ol-btn primary" data-act="outline-run" disabled={!civ} onClick={startOutline}>
            照大纲推演
          </button>
        </div>
      </>
    );
  return (
    <section className="sb-sec ol-side" data-testid="outline-side">
      <div className="sb-sec-head">
        <span>
          大纲<em>{plots.length} 条</em>
        </span>
        <button className="sb-link" data-act="outline-open" onClick={() => openOverview('outline')}>
          打开大纲
        </button>
      </div>
      <div className="sb-group">
        {shown.map((p) => {
          const r = byId.get(p.id);
          const now = run && run.at === p.id && !r;
          const waiting = run && !r && !now;
          let mark: ReactNode = null;
          if (r) mark = <PlotStatusTag s={r.status} ic />;
          else if (now) mark = <PlotRunTag />;
          else if (waiting) mark = <span className="ol-st wait">等着</span>;
          const y = r && r.status !== 'failed' && r.status !== 'story' ? r.year : plotWindow(o, p).at;
          return (
            <button key={p.id} className={`sb-row ol-row${era ? ' era' : ''}${now ? ' on' : ''}${waiting ? ' dim' : ''}`} data-plot={p.id} onClick={() => goToPlot(o, p, r)}>
              <span className="ol-y">{yearShort(y, era)}</span>
              <span className="ol-t">
                <span>{plotLine(p)}</span>
                {now && run.fix !== null && <span className="ol-sub">{eraText(`没自然发生，在第 ${run.fix} 年硬改，接着推`, era)}</span>}
              </span>
              {mark}
            </button>
          );
        })}
        {plots.length > shown.length && (
          <button className="sb-row ol-row" data-act="outline-more" onClick={() => openOverview('outline')}>
            <span className="ol-t">
              <span>还有 {plots.length - shown.length} 条，第 {plotNo(plots, plots[shown.length].id)} 条起在大纲里看</span>
            </span>
            <Icon name="chevron" size={14} className="sb-chev" />
          </button>
        )}
      </div>
      {foot}
    </section>
  );
}
