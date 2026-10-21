/**
 * 导播的界面(状态和"放到哪了"在 directorStore.ts,排期在 directorPlan.ts):
 *
 *   DirectorEngine   不画东西:导播开着、时间轴在放时推进年份(按排期的时钟),到一段事上请地图飞过去
 *   DirectorPin      地图上事发地的圆环(两圈光晕)+ 名牌(类型 + 地名);跟着地图走,名牌默认在右边,
 *                    放不下(出屏、压着字幕条 / 列表 / 侧栏 / 时间轴)换到左边、下边、上边
 *   DirectorCaption  时间轴上面的字幕条:左边一道事件颜色,第一行类型 + 年份 + 操作,第二行编年史原句,底下一道走完就换的进度线。
 *                    宽屏:后面还有几件、下一件、全部跳过、设置(齿轮,设置弹层在字幕条上面);
 *                    手机:略过几件、下一件、「⋯」(全部跳过、导播设置),正文最多两行。
 *                    停着等你时:"你在看地图,导播停在这件事上" +「回到导播」
 *   DirectorPanels   宽屏右上「导播略过的」列表(有才出现,能收起、清空);手机上拉起的略过列表、导播设置(底部卡片)
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import { fullChronicle } from '../gen/civ/religionText';
import { polityName } from '../gen/civ/growth';
import { yearAt, yearShort, type Era } from '../gen/era';
import { directorPlan, type DirectorCaption, type DirectorSkip } from './directorPlan';
import {
  HOLD_STEPS,
  clearDirectorList,
  directorAdvance,
  directorBegin,
  directorNextItem,
  directorPeek,
  directorReset,
  directorResume,
  directorSkipAll,
  directorStopped,
  directorTimeMoved,
  getDirectorYear,
  setDirectorFocus,
  setDirectorFolded,
  setDirectorHold,
  setDirectorOn,
  setDirectorPace,
  setDirectorPanel,
  subscribeDirectorProgress,
  takeDirectorStart,
  useDirector,
} from './directorStore';
import { getCivTime, setCivTime, subscribeCivTime, togglePlayback } from './civView';
import { useEra } from './editsStore';
import { baseRegions } from './eras';
import { playRate, replayStart } from './timelineLayout';
import { getStepwise } from './stepwiseStore';
import { STEP_RATE } from './stepwisePlan';
import { polityHistory } from './WorldOverviewCountries';
import { Icon } from './icons';
import { MenuItem, PopMenu } from './PopMenu';
import type { WorldToClient } from './EventPins';
import './timeline.css';
import './director.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** 时间轴的播放状态里导播要看的几样(年份每帧都变,不跟着它重新渲染) */
function usePlayState(): { playing: boolean; story: boolean; speed: 1 | 4 } {
  const key = useSyncExternalStore(
    (f) => subscribeCivTime(f),
    () => {
      const t = getCivTime();
      return `${t.playing ? 1 : 0}${t.story ? 1 : 0}${t.speed}`;
    },
  );
  return { playing: key[0] === '1', story: key[1] === '1', speed: key.slice(2) === '4' ? 4 : 1 };
}

let genCount = 0;

/**
 * 导播推进时间轴(off:回放世界形成、导出视频、新建时不放)。
 * stepwise = 在逐年推演:历史一步步现算,由 Stepwise.tsx 的 StepwiseEngine 推进(用同一套字幕、镜头),这里不推
 */
export function DirectorEngine({ world, civ, off, stepwise }: { world: World; civ: Civ | null; off: boolean; stepwise?: boolean }) {
  const d = useDirector();
  const { playing, story, speed } = usePlayState();
  const era = useEra();
  const has = !!civ && civ.viable && civ.cultures.length > 0;
  const drive = d.on && !off && has && !story && !stepwise;
  // 世界、历史、纪年换了:排期重来
  const gen = useMemo(() => ++genCount, [civ, world, era]);

  // 换了世界(按第一件地形大事以前的州认;改名、重推不算):字幕、列表、关注的国家都清掉
  const regions = civ ? baseRegions(civ) : null;
  useEffect(() => {
    directorReset();
    setDirectorFocus(null);
  }, [regions]);
  // 停用了(回放世界形成、导出视频……):收起字幕
  useEffect(() => {
    if (off) directorReset(true);
  }, [off]);
  // 停着的时候时间轴被拖到 / 跳到别的年份
  useEffect(() => subscribeCivTime(directorTimeMoved), []);
  // 刚打开导播:没在放就放起来(放到头了从结束年份前 400 年起)
  useEffect(() => {
    if (!drive || !civ || !takeDirectorStart()) return;
    if (!getCivTime().playing) togglePlayback(civ.endYear, replayStart(civ.endYear));
  }, [drive, civ, d.on]);

  useEffect(() => {
    if (!drive || !playing || !civ) return;
    const end = civ.endYear;
    const focus = d.focus !== null ? { kind: 'polity' as const, id: d.focus, others: 'none' as const } : null;
    const pace = d.pace === 'fixed' ? { mode: 'fixed' as const, rate: playRate(speed, end), hold: d.hold } : { mode: 'auto' as const, hold: d.hold };
    const key = `${gen}|${d.pace}|${d.pace === 'fixed' ? speed : ''}|${d.hold}|${d.focus ?? ''}`;
    const entries = fullChronicle(civ);
    const make = (from: number) => directorPlan(world, civ, { from, to: end, entries, focus, pace, era: era ?? null });
    const yearNow = () => Math.min(end, Math.max(0, getCivTime().year ?? end));
    directorBegin(make, key, yearNow());
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(100, Math.max(0, now - last)) / 1000;
      last = now;
      const cur = getCivTime();
      if (!cur.playing) return;
      // 别处改了年份(比如干预重推完从生效那年接着放):从那一年重排
      if (cur.year !== getDirectorYear()) directorBegin(make, key, yearNow());
      const y = directorAdvance(dt);
      if (y === null) {
        setCivTime({ year: null, playing: false, story: false });
        return;
      }
      if (y !== cur.year) setCivTime({ year: y });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      directorStopped();
    };
  }, [drive, playing, civ, world, era, gen, speed, d.pace, d.hold, d.focus]);

  return null;
}

// ---------------------------------------------------------------------------
// 地图上的圆环 + 名牌

/** 名牌离圆环中心多远(圆环半径 11 + 光晕) */
const PLATE_GAP = 24;
/** 名牌放哪一边:右、左、下、上 */
function plateOffset(side: number, w: number, h: number): [number, number] {
  switch (side) {
    case 1:
      return [-PLATE_GAP - w, -h / 2];
    case 2:
      return [-w / 2, PLATE_GAP];
    case 3:
      return [-w / 2, -PLATE_GAP - h];
    default:
      return [PLATE_GAP, -h / 2];
  }
}
type Box = [number, number, number, number];
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
/** 名牌要让开的东西:字幕条、略过的列表、设置、侧栏、时间轴、地图按钮 */
const AVOID = '.dr-avoid, .bottom-row, .sidebar, .map-controls, .phone-btns, .map-bar';
function plateSide(x: number, y: number, w: number, h: number, bw: number, bh: number, avoid: readonly Box[], prev: number): number {
  const pad = 8;
  const cost = (s: number) => {
    const [dx, dy] = plateOffset(s, w, h);
    const r: Box = [x + dx, y + dy, w, h];
    let c = (w * h - overlap(r, [pad, pad, bw - pad * 2, bh - pad * 2])) * 4;
    for (const a of avoid) c += overlap(r, a);
    return c;
  };
  // 右边放得下就放右边;不然上一帧那边还放得下就不换(镜头飞的时候不来回跳)
  if (cost(0) === 0) return 0;
  if (prev > 0 && cost(prev) === 0) return prev;
  let best = 0;
  let bc = Infinity;
  for (let s = 0; s < 4 && bc > 0; s++) {
    const c = cost(s);
    if (c < bc) [bc, best] = [c, s];
  }
  return best;
}

export function DirectorPin({ toClient, hidden }: { toClient: MutableRefObject<WorldToClient | null>; hidden?: boolean }) {
  const d = useDirector();
  const era = useEra();
  const cap = !hidden && d.on ? (d.shown?.cap ?? null) : null;
  const pin = cap?.pin ?? null;
  const root = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const side = useRef(-1);
  useLayoutEffect(() => {
    if (!pin) return;
    let raf = 0;
    let size: [number, number] | null = null;
    const frame = () => {
      const el = root.current;
      const pl = plate.current;
      const layer = el?.parentElement;
      if (!el || !pl || !layer) return;
      const r = layer.getBoundingClientRect();
      const c = toClient.current?.(pin[0], pin[1]) ?? null;
      const x = c ? c[0] - r.left : NaN;
      const y = c ? c[1] - r.top : NaN;
      if (!(x >= 0 && y >= 0 && x <= r.width && y <= r.height)) el.style.visibility = 'hidden';
      else {
        size ??= [pl.offsetWidth, pl.offsetHeight];
        const avoid: Box[] = [];
        document.querySelectorAll(AVOID).forEach((a) => {
          const b = a.getBoundingClientRect();
          if (b.width && b.height) avoid.push([b.left - r.left, b.top - r.top, b.width, b.height]);
        });
        side.current = plateSide(x, y, size[0], size[1], r.width, r.height, avoid, side.current);
        const [dx, dy] = plateOffset(side.current, size[0], size[1]);
        el.style.visibility = 'visible';
        el.style.transform = `translate(${x}px, ${y}px)`;
        pl.style.left = `${dx}px`;
        pl.style.top = `${dy}px`;
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [pin, cap, toClient]);
  if (!pin || !cap) return null;
  return (
    <div className="dr-pins">
      <div ref={root} className="dr-pin" data-ev={cap.type} data-entry={cap.entry.id} style={{ visibility: 'hidden' }}>
        <i className="dr-ring" />
        <div ref={plate} className="dr-plate">
          <b>{cap.typeName}</b>
          <span>{cap.place || capYear(cap, era)}</span>
        </div>
      </div>
    </div>
  );
}

/** 字幕上的年份:"2655 年";多年的战争刚开打 "2562 年起"(纪年照写) */
function capYear(c: DirectorCaption, era: Era | null | undefined): string {
  return `${yearAt(Math.floor(c.entry.year), era)}${c.label.endsWith('起') ? '起' : ''}`;
}

// ---------------------------------------------------------------------------
// 字幕条

export function DirectorCaption({ phone, civ, hidden }: { phone: boolean; civ: Civ | null; hidden?: boolean }) {
  const d = useDirector();
  const era = useEra();
  const prog = useRef<HTMLElement | null>(null);
  const setProg = useCallback((el: HTMLElement | null) => {
    prog.current = el;
  }, []);
  useEffect(() => subscribeDirectorProgress((p) => prog.current?.style.setProperty('--p', p.toFixed(4))), []);
  const wrap = useRef<HTMLDivElement>(null);
  const settings = !phone && d.panel === 'settings';
  // 设置弹层:点外面、按 Esc 收起
  useEffect(() => {
    if (!settings) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setDirectorPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setDirectorPanel(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [settings]);
  if (hidden || !d.on || !d.shown) return null;
  const { cap, left, next } = d.shown;
  const held = d.held;
  const n = d.list.length;
  const resume = (
    <button className="dr-btn pri" data-act="director-resume" onClick={directorResume}>
      <Icon name="play" size={phone ? 14 : 15} />
      回到导播
    </button>
  );
  const nextBtn = (
    <button className="dr-btn" data-act="director-next" disabled={!next} onClick={directorNextItem}>
      下一件
      <Icon name="chevron" size={phone ? 14 : 15} />
    </button>
  );
  let acts: ReactNode;
  if (phone) {
    const chip = n > 0 && (
      <button className="dr-chip" data-act="director-skipped" onClick={() => setDirectorPanel('list')}>
        <Icon name="list" size={13} />
        略过 {n} 件
      </button>
    );
    acts = held ? (
      <>
        {chip}
        {resume}
      </>
    ) : (
      <>
        {chip}
        {nextBtn}
        <PopMenu className="dr-more" icon={<Icon name="more" size={17} />} title="更多" act="director-more" align="right">
          <MenuItem act="director-skip" icon={<Icon name="chevron" size={17} />} onClick={directorSkipAll}>
            全部跳过
          </MenuItem>
          <MenuItem act="director-settings" icon={<Icon name="gear" size={17} />} onClick={() => setDirectorPanel('settings')}>
            导播设置
          </MenuItem>
        </PopMenu>
      </>
    );
  } else {
    acts = held ? (
      <>
        <span className="dr-muted">你在看地图，导播停在这件事上</span>
        {resume}
      </>
    ) : (
      <>
        {left > 0 && <span className="dr-muted">后面还有 {left} 件</span>}
        {nextBtn}
        <button className="dr-btn" data-act="director-skip" onClick={directorSkipAll}>
          全部跳过
        </button>
        <button
          className={`dr-btn only${settings ? ' on' : ''}`}
          data-act="director-settings"
          aria-label="导播设置"
          aria-expanded={settings}
          title="导播设置"
          onClick={() => setDirectorPanel(settings ? null : 'settings')}
        >
          <Icon name="gear" size={15} />
        </button>
      </>
    );
  }
  return (
    <div ref={wrap} className={`dr-capwrap dr-avoid${phone ? ' phone' : ''}`} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      {settings && <DirectorSettings civ={civ} phone={false} />}
      <div className={`dr-cap${held ? ' held' : ''}`} data-ev={cap.type} data-entry={cap.entry.id} role="status" aria-live="polite">
        <i className="dr-deco" aria-hidden="true">
          {!held && (
            <b className="dr-prog">
              <i ref={setProg} />
            </b>
          )}
        </i>
        <div className="dr-head">
          <b className="dr-tag">{cap.typeName}</b>
          <span className="dr-year">{capYear(cap, era)}</span>
          <span className="dr-sp" />
          {acts}
        </div>
        <div className="dr-text">{cap.text}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 设置

const HOLD_NAMES = ['短', '标准', '长'];

/**
 * 导播设置。inline = 放进别的窗口里原地展开(逐年推演开始之前的设置);sw = 开关管的不是现在这一份时换成它
 * (逐年推演开始之前,改的是逐年推演那一份开关)
 */
export function DirectorSettings({ civ, phone, inline, sw }: { civ: Civ | null; phone: boolean; inline?: boolean; sw?: { on: boolean; set: (on: boolean) => void } }) {
  const d = useDirector();
  const on = sw ? sw.on : d.on;
  const setOn = sw ? sw.set : setDirectorOn;
  const end = civ?.endYear ?? 0;
  const auto = d.pace === 'auto';
  // 镜头跟着一个国家:这一年还在的国家,鼎盛时大的在前(跟着的那国已经亡了也留在最前面)
  const year = Math.floor(Math.min(end, Math.max(0, getCivTime().year ?? end)));
  const choices = useMemo(() => {
    if (!civ || !civ.viable) return [];
    const peak = polityHistory(civ).peak;
    return civ.polities
      .filter((p) => p.id === d.focus || (p.founded <= year && (p.ended === undefined || p.ended > year)))
      .sort((a, b) => (b.id === d.focus ? 1 : 0) - (a.id === d.focus ? 1 : 0) || peak[b.id] - peak[a.id] || a.id - b.id)
      .map((p) => ({ id: p.id, name: polityName(p, Math.min(year, p.ended !== undefined ? p.ended - 1 : year)) }));
  }, [civ, year, d.focus]);
  const focusName = d.focus !== null ? choices.find((c) => c.id === d.focus)?.name : undefined;
  return (
    <div className={`dr-set${inline ? ' inline' : ' dr-avoid'}${phone ? ' dr-sheet phone' : ''}`} role={inline ? 'group' : 'dialog'} aria-label="导播设置" onPointerDown={stop} onClick={stop}>
      {phone && <div className="dr-grip" />}
      <div className="dr-set-head">
        导播
        <span className="dr-sp" />
        <button className={`dr-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label="导播" data-act="director-switch" onClick={() => setOn(!on)} />
      </div>
      <div className="dr-set-lead">{phone ? '时间往前走时，镜头自己移到出事的地方，底下一张字幕卡。拖一下地图，镜头就交还给你。' : '时间往前走时，镜头自己移到出事的地方，底下一条字幕。拖一下地图，镜头就交还给你。'}</div>

      <div className="dr-set-sec">镜头跟着</div>
      <div className="dr-seg">
        <button className={d.focus === null ? 'on' : ''} aria-pressed={d.focus === null} data-act="director-world" onClick={() => setDirectorFocus(null)}>
          全世界的大事
        </button>
        <label className={d.focus !== null ? 'on' : ''}>
          <span>{focusName ?? '一个国家'}</span>
          <select aria-label="镜头跟着哪一国" data-act="director-polity" value={d.focus ?? ''} onChange={(e) => setDirectorFocus(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="" disabled>
              选一个国家
            </option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!phone && <div className="dr-set-why">选一个国家：只放它的事，镜头跟着它；别国的事进「略过的」列表。</div>}

      <div className="dr-set-sec">节奏</div>
      <div className="dr-set-grp" role="radiogroup" aria-label="节奏">
        <button className="dr-set-row" role="radio" aria-checked={auto} data-act="director-auto" onClick={() => setDirectorPace('auto')}>
          <span className={`dr-radio${auto ? ' on' : ''}`} />
          <span className="dr-set-main">
            <span>自动</span>
            <small>事少快、事多慢：没事的年份一闪而过，有大事时放慢，放完再走</small>
          </span>
        </button>
        <button className="dr-set-row" role="radio" aria-checked={!auto} data-act="director-fixed" onClick={() => setDirectorPace('fixed')}>
          <span className={`dr-radio${auto ? '' : ' on'}`} />
          <span className="dr-set-main">
            <span>固定速度</span>
            <small>
              {phone ? '照 1×、4× 走，来不及放的进「略过的」列表' : `照时间轴上的 1×（每秒 ${inline || getStepwise().on ? STEP_RATE[1] : playRate(1, end)} 年）、4× 走，来不及放的进「略过的」列表`}
            </small>
          </span>
        </button>
      </div>

      <div className="dr-set-sec">一件事停多久</div>
      <div className="dr-seg">
        {HOLD_STEPS.map((h, i) => (
          <button key={h} className={d.hold === h ? 'on' : ''} aria-pressed={d.hold === h} data-act={`director-hold-${i}`} onClick={() => setDirectorHold(h)}>
            {HOLD_NAMES[i]}
          </button>
        ))}
      </div>
      <div className="dr-set-why last">
        {phone ? '标准：亡国、改朝换代、大战停 3 秒左右，小事 1–2 秒。' : '标准：亡国、改朝换代、大战停 3 秒左右，小事 1–2 秒；同一个地方接连几件合成一段。短的减半，长的加倍。'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 略过的列表、手机上的设置卡片

function SkipRow({ s, era, phone }: { s: DirectorSkip; era: Era | null | undefined; phone: boolean }) {
  return (
    <button className="dr-row" data-ev={s.type} data-entry={s.entry.id} onClick={() => directorPeek(s)}>
      <span className="y">{yearShort(s.entry.year, era)}</span>
      <span className="t">{s.typeName}</span>
      <span className={`x${phone ? ' two' : ''}`}>{s.text}</span>
    </button>
  );
}

export function DirectorPanels({ phone, civ, hidden }: { phone: boolean; civ: Civ | null; hidden?: boolean }) {
  const d = useDirector();
  const era = useEra();
  const { speed } = usePlayState();
  const sheet = useRef<HTMLDivElement>(null);
  const open = phone && !hidden && d.on ? d.panel : null;
  // 手机的底部卡片:点外面收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element;
      if (el.closest?.('.dr-sheet, .dr-capwrap, .pm-menu')) return;
      setDirectorPanel(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  if (hidden || !d.on) return null;
  const n = d.list.length;
  if (phone) {
    if (open === 'settings') return <DirectorSettings civ={civ} phone />;
    if (open !== 'list') return null;
    return (
      <div ref={sheet} className="dr-sheet dr-list-sheet dr-avoid" role="dialog" aria-label="导播略过的" onPointerDown={stop} onClick={stop}>
        <div className="dr-grip" />
        <div className="dr-sheet-head">
          导播略过的<em>{n} 件</em>
          <span className="dr-sp" />
          <button className="dr-close" aria-label="关上" data-act="director-list-close" onClick={() => setDirectorPanel(null)}>
            <Icon name="close" size={17} />
          </button>
        </div>
        {n > 0 && (
          <div className="dr-sheet-rows">
            {d.list.map((s) => (
              <SkipRow key={s.entry.id} s={s} era={era} phone />
            ))}
          </div>
        )}
        <div className="dr-note">导播来不及放的放在这里，新的在上。点一条，镜头飞过去。</div>
      </div>
    );
  }
  if (!n) return null;
  const who = d.focus !== null && civ?.polities[d.focus] ? polityName(civ.polities[d.focus], Math.floor(Math.min(civ.endYear, getCivTime().year ?? civ.endYear))) : null;
  const note = who
    ? `只放${who}的事，别国的事和来不及放的放在这里。点一条，镜头飞过去。`
    : d.pace === 'fixed'
      ? `${speed}× 时来不及一件件放，导播只放大事，其余的放在这里。点一条，镜头飞过去。`
      : '事多时导播只放大事，其余的放在这里。点一条，镜头飞过去。';
  return (
    <div className={`dr-list dr-avoid${d.folded ? ' folded' : ''}`} onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
      <div className="dr-list-head">
        导播略过的<em>{n} 件</em>
        <span className="dr-sp" />
        <button className="dr-link" data-act="director-clear" onClick={clearDirectorList}>
          清空
        </button>
        <button className="dr-fold" aria-label={d.folded ? '展开' : '收起'} aria-expanded={!d.folded} data-act="director-fold" onClick={() => setDirectorFolded(!d.folded)}>
          <Icon name={d.folded ? 'down' : 'up'} size={16} />
        </button>
      </div>
      {!d.folded && (
        <>
          <div className="dr-rows">
            {d.list.map((s) => (
              <SkipRow key={s.entry.id} s={s} era={era} phone={false} />
            ))}
          </div>
          <div className="dr-note">{note}</div>
        </>
      )}
    </div>
  );
}
