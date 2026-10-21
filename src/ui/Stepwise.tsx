/**
 * 逐年推演的界面(状态在 stepwiseStore.ts,一步走几年、停不停在 stepwisePlan.ts;弹窗在 StepwiseDialogs.tsx):
 *
 *   StepwiseEngine   不画东西:播放头在算好的历史里往前走(导播开着按导播的排期,关着按固定速度),
 *                    走进最后算好的那一步时请 App 在后台算下一步;一步走完说该停,播放头走到那里就停下、列出这一段的大事、倒计时
 *   StepTimeline     时间轴只放这一段:"现在"以前实线和事件圆点,以后虚线、尽头一面小旗(到这儿停一下);右边「存回推演模式」。
 *                    手机是胶囊:只放这一段 + 小旗,右边一个速度按钮
 *   StepDock         时间轴上面(宽屏):「下一步生效的干预」单子、在干预时的"第 N 年停着"、停一下时的"这一段的大事"卡片;
 *                    手机上只有单子(收起成一行)
 *   StepReviewSheet  手机停一下时的底部卡片
 *   StepPins         停一下时地图上按先后标出这一段的大事(1、2、3……;正在看的那件带光晕)
 *   StepSideGroup    侧栏 / 手机世界卡片里「这个故事」一组(推进设置、存回推演模式)
 *   StepEffectTime   干预页上的"生效时间:第 N 年年初(下一步)"
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import type { ChronicleEntry } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { advanceOf, type Advance } from '../gen/edits';
import { eraText, yearAt, yearFull, yearShort, type Era } from '../gen/era';
import { directorPlan, type DirectorPlan, type DirectorShot } from './directorPlan';
import {
  directorBegin,
  directorDone,
  directorFeed,
  directorFlyTo,
  directorNarrating,
  directorPlanNow,
  directorStep,
  directorStopped,
  onDirectorHandBack,
  setDirectorPace,
  takeDirectorStart,
  useDirector,
} from './directorStore';
import { getCivTime, pickChronicleEntry, setCivTime, subscribeCivTime, useSelection, clearSelection } from './civView';
import { useEdits, useEra } from './editsStore';
import { usePanel } from './panelStore';
import { getPending, removePending, usePending } from './pendingStore';
import { STEP_DOT_IMPORTANCE, STEP_RATE, nextStep, pauseYear, reviewItems, stepEase, stepPause, stepRate, type StepReviewItem } from './stepwisePlan';
import {
  enterStop,
  getStepwise,
  holdClock,
  nextYear,
  openStepDialog,
  passStop,
  resumeFromStop,
  setReviewCur,
  getStepGesture,
  getStepHead,
  setStepHead,
  stepArrived,
  stepSent,
  stepwiseActions,
  subscribeStepHead,
  tickClock,
  useStepwise,
  type StepwiseState,
} from './stepwiseStore';
import { entryWeight, evType } from './timelineLayout';
import { TimelineYear } from './JumpYear';
import { baseRegions } from './eras';
import { Icon } from './icons';
import type { WorldToClient } from './EventPins';
import type { Focus } from './flyTo';
import './timeline.css';
import './stepwise.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** 推进设置的一句话:"一步一年，每 25 年停一下" */
const STEP_NAMES = ['', '一年', '两年', '三年', '四年', '五年'];
export function advanceBrief(a: Advance): string {
  return `一步${STEP_NAMES[a.step] ?? `${a.step} 年`}，每 ${a.every} 年停一下`;
}

/** 时间轴的播放状态里要看的几样(年份每帧都变,不跟着它重新渲染) */
function usePlayState(): { playing: boolean; speed: 1 | 4 } {
  const key = useSyncExternalStore(
    (f) => subscribeCivTime(f),
    () => {
      const t = getCivTime();
      return `${t.playing ? 1 : 0}${t.speed}`;
    },
  );
  return { playing: key[0] === '1', speed: key.slice(1) === '4' ? 4 : 1 };
}

/** 播放头那一年(年份每帧都变时只在取整的那一年变了才重新渲染);在逐年推演里不过"现在" */
function useStepYear(now: number): number {
  return useSyncExternalStore(subscribeCivTime, () => Math.floor(Math.min(now, Math.max(0, getCivTime().year ?? now)) + 1e-6));
}

/** 这一段到哪年停(时间轴上小旗的那一年):停着 = 停的那年;不然按"每隔几年"从这一段的开头数 */
export function segmentEnd(s: StepwiseState, adv: Advance): number {
  if (s.stop) return s.stop.to;
  return Math.max(s.now, pauseYear(adv, s.since, Math.max(s.since, s.now - 1)));
}

// ---------------------------------------------------------------------------
// 接着演绎(倒计时走完、点按钮、按时间轴的播放)

export function continueStepwise() {
  const s = getStepwise();
  if (!s.stop || s.stop.why === 'end') return;
  resumeFromStop();
  setCivTime({ year: getStepwise().now, playing: true, scrubbing: false, story: false });
}

/** 时间轴的播放键、空格:停着看这一段的大事时 = 接着演绎;不然播放 / 暂停 */
export function stepwiseToggle() {
  if (getStepwise().stop) return continueStepwise();
  setCivTime({ playing: !getCivTime().playing, story: false, scrubbing: false });
}

/** ← →:在这一段里往前 / 往后走 dy 年(不过"现在",也不出这一段),停下播放 */
export function stepwiseNudge(dy: number) {
  const s = getStepwise();
  const from = s.stop ? s.stop.from : s.since;
  const cur = Math.floor(Math.min(s.now, Math.max(from, getCivTime().year ?? s.now)));
  setCivTime({ year: Math.min(s.now, Math.max(from, cur + dy)), playing: false, story: false, scrubbing: false });
}

// ---------------------------------------------------------------------------
// 停一下时一件件看:镜头先拉远看全部,再一件件飞过去

let review: { items: readonly StepReviewItem[]; world: World; timer: number; on: boolean } | null = null;
const REVIEW_ALL = 1.6;
const REVIEW_FLY = 0.6;
const REVIEW_HOLD = { big: 3, major: 2.4, minor: 1.6 } as const;

/** 包住这几件事发地的镜头(世界坐标;x 跨过东西两头接起来的按离第一件近的那边算) */
function overviewShot(world: World, items: readonly StepReviewItem[]): Focus | null {
  const W = world.width;
  const H = world.height;
  const pts = items.flatMap((it) => (it.cap.pin ? [it.cap.pin] : []));
  if (!pts.length) return null;
  const x0 = pts[0][0];
  let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [px, py] of pts) {
    const x = px + W * Math.round((x0 - px) / W);
    l = Math.min(l, x);
    r = Math.max(r, x);
    t = Math.min(t, py);
    b = Math.max(b, py);
  }
  const pad = Math.max(40, (r - l) * 0.15, (b - t) * 0.15);
  const box: [number, number, number, number] = [l - pad, t - pad, r + pad, b + pad];
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const x = cx - W * Math.floor(cx / W);
  return { box, x, y: cy, lon: (x / W) * 360 - 180, lat: 90 - (cy / H) * 180 };
}

/** 第 i 件(−1 = 先拉远看全部,这时第一件先亮着:接下来放的就是它) */
function reviewRun(i: number) {
  const r = review;
  if (!r || !r.on) return;
  clearTimeout(r.timer);
  setReviewCur(Math.max(0, i));
  const it = i >= 0 ? r.items[i] : null;
  directorFlyTo(it ? (it.shot as DirectorShot | null) : overviewShot(r.world, r.items));
  const n = r.items.length;
  if (i + 1 >= n) return;
  const hold = it ? REVIEW_FLY + REVIEW_HOLD[it.cap.tier] : REVIEW_ALL;
  r.timer = window.setTimeout(() => reviewRun(i + 1), hold * 1000);
}

/** 点卡片里的一件:镜头飞过去,接着从它往下看(导播关着时只飞这一件) */
export function reviewGo(i: number) {
  const r = review;
  if (!r) return;
  if (r.on) return reviewRun(i);
  setReviewCur(i);
  const it = r.items[i];
  if (it) directorFlyTo(it.shot as DirectorShot | null);
}

function reviewStop() {
  if (review) clearTimeout(review.timer);
}

// ---------------------------------------------------------------------------
// 推进:播放头往前走、请算下一步、到了就停

let genCount = 0;
/** 最近几步从交出去到换上历史用了几毫秒(检查脚本看) */
const stepMs: number[] = [];

export function StepwiseEngine({ world, civ }: { world: World; civ: Civ | null }) {
  const st = useStepwise();
  const edits = useEdits();
  const adv = advanceOf(edits);
  const advRef = useRef(adv);
  advRef.current = adv;
  const d = useDirector();
  const { playing, speed } = usePlayState();
  const era = useEra();
  const panel = usePanel();
  const { sel } = useSelection();
  const civRef = useRef(civ);
  civRef.current = civ;
  /** 最近几步每秒算了几年(调放的速度用) */
  const computed = useRef<number | null>(null);
  const gen = useMemo(() => ++genCount, [world, era]);

  // 一步算回来了(历史换成推得更远的那一份):看要不要停
  const prevCiv = useRef<Civ | null>(null);
  useEffect(() => {
    const prev = prevCiv.current;
    prevCiv.current = civ;
    const s = getStepwise();
    const b = s.busy;
    if (!s.on || !b || !civ || !prev || civ === prev || !(civ.endYear >= b.to - 1 / 128)) return;
    const r = stepPause(advRef.current, b.from, b.plan, fullChronicle(civ), fullChronicle(prev));
    stepMs.push(performance.now() - b.t0);
    if (stepMs.length > 50) stepMs.shift();
    const v = stepArrived(b.to, r.why ? { why: r.why, big: r.big } : null);
    if (v !== null) computed.current = computed.current === null ? v : computed.current * 0.6 + v * 0.4;
  }, [civ]);

  // 检查脚本用:现在推到哪、这一段、停没停、最近几步每秒算几年
  useEffect(() => {
    (window as unknown as { __wfStep: unknown }).__wfStep = () => {
      const s = getStepwise();
      return {
        on: s.on,
        start: s.start,
        since: s.since,
        now: s.now,
        busy: !!s.busy,
        due: s.due?.why ?? null,
        stop: s.stop ? { from: s.stop.from, to: s.stop.to, why: s.stop.why, items: s.stop.items.length } : null,
        clock: s.clock,
        rate: computed.current,
        stepMs: [...stepMs],
      };
    };
  }, []);

  // 刚打开导播(右边的按钮):没在放就放起来
  useEffect(() => {
    if (!st.on || !d.on || !takeDirectorStart()) return;
    const s = getStepwise();
    if (!s.stop && !getCivTime().playing) setCivTime({ playing: true, story: false, scrubbing: false });
  }, [st.on, d.on]);

  // 往下走
  const stopped = !!st.stop;
  useEffect(() => {
    if (!st.on || !playing || stopped || !world) return;
    const dirOn = d.on;
    const fixed = d.pace === 'fixed' || !dirOn;
    const want = fixed ? STEP_RATE[speed] : STEP_RATE[4];
    const focus = d.focus !== null ? { kind: 'polity' as const, id: d.focus, others: 'none' as const } : null;
    const key = `${gen}|${d.pace}|${speed}|${d.hold}|${d.focus ?? ''}`;
    const rate = () => stepRate(want, computed.current);
    /** 从 from 年排到算好的最后一年 */
    const make = (from: number): DirectorPlan => {
      const c = civRef.current!;
      const to = Math.max(from, getStepwise().now);
      const r = rate();
      return directorPlan(world, c, { from, to, entries: fullChronicle(c), focus, pace: fixed ? { mode: 'fixed', rate: r, hold: d.hold } : { mode: 'auto', rate: r, hold: d.hold }, era: era ?? null });
    };
    /** 从哪年接着走:这一段里时间轴停的那年(编年史里点到这一段以前的事、看完再放,从这一段的开头接着走) */
    const yearNow = () => {
      const s = getStepwise();
      return Math.min(s.now, Math.max(s.since, getCivTime().year ?? s.now));
    };
    /** 播放头走进最后算好的那一步了:请算下一步(单子里的干预一起交出去,在"现在"生效) */
    const ask = (y: number) => {
      const s = getStepwise();
      if (!s.on || s.busy || s.due || s.stop) return;
      const plan = nextStep(advRef.current, s.since, s.now);
      if (plan.years <= 0) {
        stepArrived(s.now, { why: 'end', big: [] });
        return;
      }
      if (s.now - y > plan.years + 1e-6) return;
      const queued = getPending().filter((x) => x.kind === 'iv');
      const cmds = queued.flatMap((x) => (x.kind === 'iv' ? [{ ...x.v, from: s.now }] : []));
      if (!stepwiseActions()?.turn(plan.years, cmds)) return;
      for (const x of queued) removePending(x.id);
      stepSent(s.now, plan);
    };
    /** 播放头走到"现在"、这一年该停:列出这一段的大事,停下来;一件也没有(只是到了"每隔几年")就不停 */
    const arrive = (): boolean => {
      const s = getStepwise();
      const due = s.due;
      const c = civRef.current;
      if (!due || !c) return false;
      const items = reviewItems(world, c, s.since, s.now, fullChronicle(c), era);
      if (!items.length && due.why === 'every') {
        passStop(s.now);
        return false;
      }
      setCivTime({ year: s.now, playing: false, scrubbing: false, story: false });
      enterStop({ from: s.since, to: s.now, why: due.why, big: due.big, items }, advRef.current.countdown);
      return true;
    };
    // pos = 播放头真正走到哪(平滑);shown = 写进时间轴的年份(地图按它画):按整年换,讲一件事时停在那件事那一刻,
    // 到了"现在"就是"现在"。一年只重画一次地图(往下走得慢,每帧都重画太费)
    let pos = yearNow();
    let shown = getCivTime().year;
    if (dirOn) directorBegin(make, key, pos);
    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(100, Math.max(0, t - last)) / 1000;
      last = t;
      if (!getCivTime().playing) return;
      const s = getStepwise();
      if (!s.on || s.stop) return;
      // 用的人正按着地图(拖、捏合、滚轮):先不往下走,松开接着走
      if (getStepGesture()) {
        raf = requestAnimationFrame(frame);
        return;
      }
      // 别处改了年份(拖了时间轴、点了一条纪事):从那一年接着走(导播从那一年重排)
      const cur = getCivTime().year;
      if (cur !== shown) {
        pos = yearNow();
        shown = cur;
        if (dirOn) directorBegin(make, key, pos);
      }
      ask(pos);
      const r = rate();
      // 还在等下一步算出来:快追上了就放慢;后面就是要停的那年了就照常走到
      const ease = getStepwise().due ? 1 : stepEase(s.now - pos, r);
      let exact = false;
      if (dirOn) {
        const p = directorPlanNow();
        if (!p) directorBegin(make, key, pos);
        else if (directorDone() && s.now > p.to + 1e-6) directorFeed(make(p.to), key);
        const yy = directorStep(dt * (directorNarrating() ? 1 : ease));
        if (yy !== null) pos = Math.min(s.now, yy);
        exact = directorNarrating();
      } else pos = Math.min(s.now, pos + dt * r * ease);
      setStepHead(pos);
      const q = exact || pos >= s.now - 1e-6 ? pos : Math.max(shown ?? -Infinity, Math.floor(pos + 1e-9));
      if (q !== shown) {
        shown = q;
        setCivTime({ year: q });
      }
      const at = pos >= getStepwise().now - 1e-6 && (!dirOn || directorDone());
      if (at && getStepwise().due && arrive()) return;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      setStepHead(null);
      // 停下来:地图换成播放头真正停的那一刻
      if (getCivTime().year === shown && shown !== pos && !getStepwise().stop) setCivTime({ year: pos });
      if (dirOn) directorStopped();
    };
  }, [st.on, playing, stopped, world, gen, era, d.on, d.pace, d.hold, d.focus, speed]);

  // 停一下:镜头先拉远看全部,再一件件飞过去(导播关着不自己飞,点一件才飞);用的人动了地图就不再自己飞
  useEffect(() => {
    const s = st.stop;
    if (!s || !s.items.length) return;
    review = { items: s.items, world, timer: 0, on: d.on };
    if (d.on) reviewRun(-1);
    else setReviewCur(0);
    const off = onDirectorHandBack(reviewStop);
    return () => {
      reviewStop();
      off();
      review = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 换了一次停下才重来;中途开关导播不打断
  }, [st.stop, world]);

  // 倒计时
  const running = !!st.stop && !!st.clock?.run;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const t = performance.now();
      const dt = (t - last) / 1000;
      last = t;
      if (tickClock(dt)) continueStepwise();
    }, 200);
    return () => window.clearInterval(id);
  }, [running]);

  // 停着的时候打开了干预页:倒计时停住(一个人用,不催),点「接着演绎」再走
  const acting = !!sel && panel.tab === 'cmd';
  useEffect(() => {
    if (acting && getStepwise().stop) holdClock('act');
  }, [acting, st.stop]);

  return null;
}

// ---------------------------------------------------------------------------
// 时间轴

/** 圆点挤在一起(间距小于 gap 像素)时留分量重的 */
function stepDots(list: readonly ChronicleEntry[], x: (y: number) => number, gap: number): { px: number; e: ChronicleEntry }[] {
  const kept: { px: number; w: number; e: ChronicleEntry }[] = [];
  for (const e of list) {
    const px = x(e.year);
    const w = entryWeight(e);
    const prev = kept[kept.length - 1];
    if (prev && px - prev.px < gap) {
      if (w > prev.w) Object.assign(prev, { px, w, e });
      continue;
    }
    kept.push({ px, w, e });
  }
  return kept;
}

export function StepTimeline({ civ, phone, hidden }: { civ: Civ | null; phone: boolean; hidden?: boolean }) {
  const st = useStepwise();
  const edits = useEdits();
  const adv = advanceOf(edits);
  const era = useEra();
  const d = useDirector();
  const { playing, speed } = usePlayState();
  const year = useStepYear(st.now);
  // 地图上画到的那一刻(往下走时一年换一次,讲一件事时停在那件事那一刻):圆点画到这里为止,以后的还没发生
  const upTo = useSyncExternalStore(subscribeCivTime, () => Math.min(st.now, getCivTime().year ?? st.now));
  const from = st.stop ? st.stop.from : st.since;
  const to = Math.max(from + 1, segmentEnd(st, adv));
  // 一段只有几十年:比整段历史的时间轴细一层,重要度 2 的事也画
  const all = useMemo(() => (civ && civ.viable ? fullChronicle(civ).filter((e) => e.importance >= STEP_DOT_IMPORTANCE) : []), [civ]);
  const marks = useMemo(() => all.filter((e) => e.year >= from && e.year <= upTo), [all, from, upTo]);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden]);
  // 播放头和进度按 CSS 变量画(播放时不重新渲染整条;往下走时跟着平滑的播放头,停着时跟着时间轴的年份)
  const rootRef = useRef<HTMLDivElement>(null);
  const trackW = useRef(0);
  useEffect(() => {
    const put = () => {
      const s = getStepwise();
      const y = Math.min(s.now, Math.max(from, getStepHead() ?? getCivTime().year ?? s.now));
      const W = Math.max(0, trackW.current - (phone ? 13 : 16));
      rootRef.current?.style.setProperty('--sx', `${((y - from) / Math.max(1e-9, to - from)) * W}px`);
    };
    put();
    const a = subscribeCivTime(put);
    const b = subscribeStepHead(put);
    return () => {
      a();
      b();
    };
  }, [from, to, st.now, width, phone]);
  if (!civ || !civ.viable || hidden) return null;

  trackW.current = width;
  const W = Math.max(0, width - (phone ? 13 : 16));
  const x = (y: number) => ((y - from) / Math.max(1e-9, to - from)) * W;
  const nowX = x(Math.min(st.now, to));
  const ticks: number[] = [];
  const stepLen = Math.max(1, adv.step);
  if (W > 0 && (stepLen / (to - from)) * W >= 4) for (let y = from + stepLen; y < to; y += stepLen) ticks.push(x(y));
  const dots = W > 0 ? stepDots(marks, x, phone ? 8 : 9) : [];
  const done = st.now >= to;
  const auto = d.on && d.pace === 'auto';
  const toggle = stepwiseToggle;
  const scrubTo = (cx: number, end = false) => {
    const el = track.current;
    if (!el || W <= 0) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (cx - r.left) / W));
    const y = Math.min(st.now, Math.max(from, from + f * (to - from)));
    setCivTime({ year: y, playing: false, story: false, scrubbing: !end });
  };
  const toLabel = `${yearAt(to, era)}${st.stop ? ' ' : ''}停一下`;
  return (
    <div
      ref={rootRef}
      className={`civ-timeline timebar dock-inline sw-bar${phone ? ' phone' : ''}`}
      data-step-from={from}
      data-step-to={to}
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <button className={`tb-play${playing ? ' on' : ''}`} onClick={toggle} aria-label={playing ? '暂停' : st.stop ? '接着演绎' : '播放'} data-act="step-play">
        <i aria-hidden="true" />
      </button>
      <TimelineYear world={baseRegions(civ)} range={{ from, to: st.now }} year={year} end={st.now} era={era} narrow={phone} locked={false} below={false} />
      <div
        ref={track}
        className="sw-track"
        role="slider"
        aria-label="这一段的时间轴"
        aria-valuemin={from}
        aria-valuemax={st.now}
        aria-valuenow={year}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          scrubTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) scrubTo(e.clientX);
        }}
        onPointerUp={(e) => scrubTo(e.clientX, true)}
      >
        {ticks.map((tx, i) => (
          <i key={i} className="sw-tick" style={{ left: tx }} />
        ))}
        <i className="sw-fill" />
        {!done && <i className="sw-future" style={{ left: nowX + (phone ? 11 : 12), width: Math.max(0, W - nowX - (phone ? 11 : 12)) }} />}
        {dots.map((k) => (
          <button
            key={k.e.id}
            className="sw-dot"
            data-ev={evType(k.e)}
            style={{ left: k.px }}
            aria-label={`${yearShort(k.e.year, era)} ${eraText(k.e.text, era)}`}
            onPointerDown={stop}
            onClick={() => pickChronicleEntry(k.e)}
          />
        ))}
        {!phone && !done && W - nowX > 260 && (
          <span className="sw-fut-note" style={{ left: (nowX + W) / 2 }}>
            以后的事还没发生
          </span>
        )}
        <span className="sw-flag" style={{ left: W }} aria-hidden="true">
          <Icon name="flag" size={phone ? 15 : 18} />
        </span>
        {!phone && (
          <>
            <span className="sw-lab first">{yearShort(from, era)}</span>
            <span className="sw-lab last" style={{ left: W + 16 }}>
              {toLabel}
            </span>
          </>
        )}
        <i className="sw-head" />
      </div>
      {phone ? (
        <button
          className="tb-speed tb-speed-one"
          data-act="speed"
          onClick={() => (d.on ? (auto ? setDirectorPace('fixed', 1) : speed === 1 ? setDirectorPace('fixed', 4) : setDirectorPace('auto')) : setCivTime({ speed: speed === 4 ? 1 : 4 }))}
        >
          {auto ? '自动' : `${speed}×`}
        </button>
      ) : (
        <>
          <span className="tb-speed" role="group" aria-label="播放速度">
            {d.on && (
              <button className={auto ? 'on' : ''} aria-pressed={auto} data-act="speed-auto" onClick={() => setDirectorPace('auto')}>
                自动
              </button>
            )}
            {([1, 4] as const).map((s) => (
              <button key={s} className={!auto && speed === s ? 'on' : ''} aria-pressed={!auto && speed === s} onClick={() => (d.on ? setDirectorPace('fixed', s) : setCivTime({ speed: s }))}>
                {s}×
              </button>
            ))}
          </span>
          <button className="sw-save" data-act="step-save" onClick={() => openStepDialog({ kind: 'save' })}>
            <Icon name="save" size={15} />
            存回推演模式
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 时间轴上面:单子、停着的提示、这一段的大事

/** 这一段的标题:"第 2650–2675 年的大事" / "出了一件大事" */
function stopTitle(s: NonNullable<StepwiseState['stop']>, era: Era | null | undefined): string {
  if (s.why === 'big') return '出了一件大事';
  return `${eraText(`第 ${Math.floor(s.from)}–${Math.floor(s.to)} 年`, era)}的大事`;
}

/** 一件事的年份:"2655";打到现在还没打完的仗 "2662 起" */
function rowYear(it: StepReviewItem, era: Era | null | undefined, phone: boolean): string {
  const y = yearShort(it.cap.entry.year, era);
  return it.cap.entry.ongoing && !phone ? `${y} 起` : y;
}

/** 一件事的正文;打到现在还没打完的仗写开头一句 + "还在打" */
function rowText(it: StepReviewItem): string {
  return it.cap.entry.ongoing ? `${it.cap.text.replace(/[。，,.]$/, '')}，还在打` : it.cap.text;
}

function Countdown({ s, phone }: { s: StepwiseState; phone: boolean }) {
  const c = s.clock;
  if (s.stop?.why === 'end') return <span className="sw-count">已经推到能推的最后一年</span>;
  if (!c || !c.run) return <span className={`sw-count${phone ? ' small' : ''}`}>停着，等你点「接着演绎」</span>;
  return (
    <span className="sw-count">
      <b>{Math.ceil(c.left)} 秒</b>后接着演绎
    </span>
  );
}

function ReviewRows({ items, cur, era, phone }: { items: readonly StepReviewItem[]; cur: number; era: Era | null | undefined; phone: boolean }) {
  return (
    <div className="sw-rows">
      {items.map((it, i) => (
        <button key={it.cap.entry.id} className={`sw-row${i === cur ? ' cur' : ''}`} data-ev={it.cap.type} data-entry={it.cap.entry.id} onClick={() => reviewGo(i)}>
          <span className="sw-num">{i + 1}</span>
          <span className="sw-y">{rowYear(it, era, phone)}</span>
          <span className="sw-t">{it.cap.typeName}</span>
          <span className="sw-x">{rowText(it)}</span>
        </button>
      ))}
    </div>
  );
}

/** 倒计时那道蓝线:还剩几成 */
function ClockLine({ s }: { s: StepwiseState }) {
  const c = s.clock;
  if (!c) return null;
  return (
    <div className="sw-line" aria-hidden="true">
      <i style={{ width: `${(c.left / Math.max(1e-9, c.total)) * 100}%` }} />
    </div>
  );
}

function ReviewCard({ s, era }: { s: StepwiseState; era: Era | null | undefined }) {
  const st = s.stop!;
  return (
    <div className="sw-review dr-avoid" role="region" aria-label={stopTitle(st, era)} onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
      <ClockLine s={s} />
      <div className="sw-review-head">
        <b>{stopTitle(st, era)}</b>
        <span className="sw-sp" />
        <Countdown s={s} phone={false} />
        {s.clock?.run && (
          <button className="sw-btn" data-act="step-hold" onClick={() => holdClock('user')}>
            先停着
          </button>
        )}
        {st.why !== 'end' && (
          <button className="sw-btn pri" data-act="step-go" onClick={continueStepwise}>
            接着演绎
          </button>
        )}
      </div>
      {st.items.length > 0 && <ReviewRows items={st.items} cur={s.cur} era={era} phone={false} />}
    </div>
  );
}

/** 「下一步生效的干预」单子(宽屏浮在时间轴上面;手机收起成一行,点开看每一条) */
function StepQueue({ phone }: { phone: boolean }) {
  const s = useStepwise();
  const era = useEra();
  const list = usePending().filter((x) => x.kind === 'iv');
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const y = nextYear(s);
  const shown = !phone || open;
  return (
    <div className={`sw-queue${phone ? ' phone' : ''}`} data-pending={list.length} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <div className="sw-queue-head">
        {phone ? (
          <button className="sw-queue-title" aria-expanded={open} onClick={() => setOpen(!open)}>
            下一步生效的干预<em>{list.length} 条</em>
          </button>
        ) : (
          <span className="sw-queue-title">
            下一步生效的干预<em>{list.length} 条</em>
          </span>
        )}
        {shown && (
          <button className="sw-link" data-act="step-queue-clear" onClick={() => list.forEach((x) => removePending(x.id))}>
            清空
          </button>
        )}
      </div>
      {shown && (
        <>
          <div className="sw-queue-rows">
            {list.map((x) => (
              <div key={x.id} className="sw-queue-row">
                <span className="sw-queue-yr">{yearAt(y, era)}</span>
                <span className="sw-queue-text">{eraText(x.text, era)}</span>
                <button className="sw-queue-x" data-act="step-unqueue" onClick={() => removePending(x.id)} title="删掉这一条" aria-label="删掉这一条">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="sw-queue-note">{yearFull(y, era)}年初生效。</div>
        </>
      )}
    </div>
  );
}

export function StepDock({ phone }: { phone: boolean }) {
  const s = useStepwise();
  const era = useEra();
  const panel = usePanel();
  const { sel } = useSelection();
  if (!s.on) return null;
  const acting = !!sel && panel.tab === 'cmd';
  if (phone)
    return (
      <div className="sw-dock phone">
        <StepQueue phone />
      </div>
    );
  return (
    <div className="sw-dock">
      <StepQueue phone={false} />
      {s.stop && acting && (
        <div className="sw-held" data-act="step-held" onPointerDown={stop} onClick={stop}>
          <Icon name="timer" size={18} />
          <b>{yearFull(s.now, era)}停着</b>
          <span>{s.clock ? '你在干预，倒计时先停下' : '你在干预'}</span>
          <button className="sw-btn pri" data-act="step-go" onClick={continueStepwise}>
            接着演绎
          </button>
        </div>
      )}
      <span className="sw-dock-sp" />
      {s.stop && !acting && <ReviewCard s={s} era={era} />}
    </div>
  );
}

/** 手机停一下:底部卡片(选中了东西时让开,详情卡片在那儿) */
export function StepReviewSheet() {
  const s = useStepwise();
  const era = useEra();
  const { sel } = useSelection();
  // 卡片拉起来时停着的倒计时照走;选中了东西(在看、在干预):倒计时停住
  useEffect(() => {
    if (sel && getStepwise().stop) holdClock('act');
  }, [sel, s.stop]);
  if (!s.on || !s.stop || sel) return null;
  const st = s.stop;
  return (
    <section className="sw-sheet" role="region" aria-label={stopTitle(st, era)} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <ClockLine s={s} />
      <div className="sw-grip" />
      <div className="sw-sheet-head">
        <b>{stopTitle(st, era)}</b>
        <Countdown s={s} phone />
      </div>
      {st.items.length > 0 && <ReviewRows items={st.items} cur={s.cur} era={era} phone />}
      {st.why !== 'end' && <div className="sw-sheet-note">趁现在可以干预：点地图上的国家。</div>}
      <div className="sw-sheet-btns">
        {s.clock?.run && (
          <button className="sw-big" data-act="step-hold" onClick={() => holdClock('user')}>
            先停着
          </button>
        )}
        {st.why !== 'end' && (
          <button className="sw-big pri" data-act="step-go" onClick={continueStepwise}>
            接着演绎
          </button>
        )}
      </div>
      <button className="sw-sheet-save" data-act="step-save" onClick={() => openStepDialog({ kind: 'save' })}>
        存回推演模式
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 地图上的编号点

export function StepPins({ toClient, phone }: { toClient: MutableRefObject<WorldToClient | null>; phone: boolean }) {
  const s = useStepwise();
  const items = s.stop?.items ?? null;
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!items?.length) return;
    let raf = 0;
    const frame = () => {
      const layer = root.current;
      if (!layer) return;
      const r = layer.getBoundingClientRect();
      layer.querySelectorAll<HTMLElement>('.sw-pin').forEach((el) => {
        const it = items[Number(el.dataset.i)];
        const c = it?.cap.pin ? (toClient.current?.(it.cap.pin[0], it.cap.pin[1]) ?? null) : null;
        const x = c ? c[0] - r.left : NaN;
        const y = c ? c[1] - r.top : NaN;
        if (!(x >= 0 && y >= 0 && x <= r.width && y <= r.height)) el.style.visibility = 'hidden';
        else {
          el.style.visibility = 'visible';
          el.style.transform = `translate(${x}px, ${y}px)`;
        }
      });
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [items, toClient]);
  if (!items?.length) return null;
  return (
    <div ref={root} className="sw-pins" aria-hidden="true">
      {items.map((it, i) =>
        it.cap.pin ? (
          <div key={it.cap.entry.id} className={`sw-pin${i === s.cur ? ' cur' : ''}`} data-i={i} data-ev={it.cap.type} style={{ visibility: 'hidden' }}>
            <i className="sw-pin-n">{i + 1}</i>
            {phone && i === s.cur && it.cap.place && <span className="sw-pin-lb">{it.cap.place}</span>}
          </div>
        ) : null,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 侧栏「这个故事」、干预页的生效时间

export function StepSideGroup() {
  const edits = useEdits();
  const adv = advanceOf(edits);
  return (
    <section className="sb-sec" data-step-side>
      <div className="sb-sec-head">
        <span>这个故事</span>
      </div>
      <div className="sb-group">
        <button className="sb-row" data-act="step-settings" onClick={() => openStepDialog({ kind: 'settings' })}>
          <Icon name="sliders" size={17} className="sb-ico" />
          <span className="sb-row-main">
            <b>推进设置</b>
          </span>
          <span className="sb-row-side">{advanceBrief(adv)}</span>
          <Icon name="chevron" size={14} className="sb-chev" />
        </button>
        <button className="sb-row" data-act="step-save" onClick={() => openStepDialog({ kind: 'save' })}>
          <Icon name="save" size={17} className="sb-ico" />
          <span className="sb-row-main">
            <b>存回推演模式</b>
          </span>
          <Icon name="chevron" size={14} className="sb-chev" />
        </button>
      </div>
    </section>
  );
}

/** 干预页最上面:生效时间固定是下一步开始的那一年年初(在"现在"干预) */
export function StepEffectTime({ phone }: { phone: boolean }) {
  const s = useStepwise();
  const era = useEra();
  return (
    <div className="sw-effect" data-step-effect={nextYear(s)}>
      <span className="sw-effect-k">生效时间</span>
      <span className="sw-effect-v">
        <b>{yearFull(nextYear(s), era)}年初</b>
        <span className="sw-chip">下一步</span>
      </span>
      <span className="sw-effect-note">{phone ? '只在「现在」干预；想改以前的事，存回推演模式。' : '只在「现在」干预；改以前的事请存回推演模式。'}</span>
    </div>
  );
}

/** 手机干预页底部:已加几条(点开看每一条,能删)、返回、接着演绎 */
export function StepCommandFoot({ onBack }: { onBack: () => void }) {
  const s = useStepwise();
  const era = useEra();
  const list = usePending().filter((x) => x.kind === 'iv');
  const [open, setOpen] = useState(false);
  const y = nextYear(s);
  const go = () => {
    clearSelection();
    if (getStepwise().stop) continueStepwise();
    else setCivTime({ playing: true, story: false, scrubbing: false });
  };
  return (
    <>
      {list.length > 0 && (
        <div className="sw-cfoot">
          <button className="sw-cfoot-sum" data-act="step-queue" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span>
              已加 {list.length} 条干预，{yearFull(y, era)}年初生效
            </span>
            <Icon name={open ? 'down' : 'chevron'} size={15} />
          </button>
          {open && (
            <div className="sw-cfoot-rows">
              {list.map((x) => (
                <div key={x.id} className="sw-queue-row">
                  <span className="sw-queue-text">{eraText(x.text, era)}</span>
                  <button className="sw-queue-x" data-act="step-unqueue" onClick={() => removePending(x.id)} aria-label="删掉这一条">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="cp-foot sw-cfoot-btns">
        <button className="cp-btn" data-act="back" onClick={onBack}>
          返回
        </button>
        <button className="cp-btn primary" data-act="step-go" onClick={go}>
          接着演绎
        </button>
      </div>
    </>
  );
}

/** 这一条干预已经在单子里了(干预页上变淡,写"已在下一步生效的干预里") */
export const STEP_QUEUED = '已在下一步生效的干预里';
