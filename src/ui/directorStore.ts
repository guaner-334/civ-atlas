/**
 * 导播:时间轴播放时,镜头自己移到出事的地方、事发地一个圆环 + 名牌、底下一条字幕(编年史原句)。
 * 排哪件、停多久、镜头去哪是 directorPlan.ts 的纯计算;这里管开关、设置和"放到哪了",界面在 Director.tsx。
 *
 * - 开关、节奏(自动 / 固定速度)、一件事停多久记在浏览器里,默认关;镜头跟着谁(一个国家 / 一个人)记在这个世界的修改里
 *   (gen/edits.ts 文件头"导播跟着谁",按稳定键;换世界跟着换,存档带着),找回、接着跟下一位见 followInfo.ts。
 * - 开着时由 Director.tsx 的 DirectorEngine 推进时间轴(CivTimeline 自己的播放这时不走):年份按排期的时钟走,
 *   到一段事上请地图飞过去(useDirectorFly → App),字幕条和地图上的标记显示正在放的这一件。
 *   这一段放完,字幕最多再留 DIRECTOR_LINGER 秒(下一段先到就换)。
 * - 停下(暂停、拖地图、缩放、点地图、选中东西……)时字幕还在:导播停在这件事上等着(held);
 *   「回到导播」、右边的「导播」按钮或时间轴的播放接着放,镜头飞回这一段。
 * - 世界照大纲推演推过:照大纲放(directorPlan.ts 的 plots),字幕条上面一块「照大纲放 第几 / 几条」,点 × 不照(outline)。
 * - 走过的"略过的"(关注别国 / 事太多 / 来不及放)进列表,新的在上;点一条镜头飞过去、停在那件事上(和拖了地图一样等着)。
 *   拖时间轴跳到别的年份、关掉导播、换世界时清空。
 */
import { useSyncExternalStore } from 'react';
import { createListeners } from './createStore';
import { directorAt, directorNext, directorYear, type DirectorCaption, type DirectorPlan, type DirectorSkip } from './directorPlan';
// 逐年推演(Stepwise.tsx)也用这里:历史一步步算出来,排期一份份接着放(directorFeed / directorStep),开关另记一份(setDirectorMode)
import type { Focus } from './flyTo';
import { getCivTime, pausePlayback, setCivTime, type CivTime, type PlaySpeed } from './civView';
import { getEdits, setFollow, subscribeEdits } from './editsStore';
import type { FollowRef } from '../gen/edits';

/** 一段放完以后,字幕在下一段来之前最多再留几秒 */
export const DIRECTOR_LINGER = 2;
/** 一件事停多久:短 / 标准 / 长(directorPlan 的 pace.hold) */
export const HOLD_STEPS: readonly number[] = [0.5, 1, 2];
/** 略过的列表最多留几件(新的在上,再多的从最老的丢) */
export const SKIP_LIST_MAX = 200;

export type PaceMode = 'auto' | 'fixed';

/** 字幕条上的那一件 */
export interface DirectorShown {
  cap: DirectorCaption;
  /** 这一段里后面还有几件 */
  left: number;
  /** 还有能「下一件」的 */
  next: boolean;
  /** 从略过的列表里点开的(不是排期里正在放的) */
  peek: boolean;
}

export interface DirectorState {
  on: boolean;
  /** 节奏:自动 = 事少快、事多慢;固定速度 = 照时间轴的 1× / 4× */
  pace: PaceMode;
  /** 一件事停多久的系数(HOLD_STEPS 之一) */
  hold: number;
  shown: DirectorShown | null;
  /** 停着等你:字幕还在,镜头归你 */
  held: boolean;
  /** 走过的略过的(新的在上) */
  list: DirectorSkip[];
  /** 宽屏右上的列表收起了(只剩标题) */
  folded: boolean;
  /** 开着的弹层:设置(宽屏是字幕条上面的弹层,手机是底部卡片)/ 手机上拉起的略过列表 */
  panel: 'settings' | 'list' | null;
  /** 设置里正在选跟哪个人(「一个人」、名牌上的「换人」点开的选人列表) */
  picking: boolean;
  /** 照大纲放(世界照大纲推演推过时;字幕条上面那一块的 × 关掉,这一次打开网页里不再照大纲) */
  outline: boolean;
}

// ---------------------------------------------------------------------------
// 记在浏览器里的:开关、节奏、停多久

const KEY = 'wenming-ditu:director';

/**
 * 开关分两份记:推演模式(on,默认关)和逐年推演(onStep,默认开;逐年推演就是看着世界一步步往下走,导播跟着放)。
 * 节奏、停多久两边共用
 */
let onInfer = false;
let onStep = true;
/** 现在是不是在逐年推演(App 按打开的世界设,见 setDirectorMode) */
let stepMode = false;

function load(): Pick<DirectorState, 'on' | 'pace' | 'hold'> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<DirectorState> & { onStep?: unknown }) | null;
    if (v && typeof v === 'object') {
      onInfer = v.on === true;
      onStep = v.onStep !== false;
      return { on: onInfer, pace: v.pace === 'fixed' ? 'fixed' : 'auto', hold: HOLD_STEPS.includes(v.hold as number) ? (v.hold as number) : 1 };
    }
  } catch {
    /* 存不了 / 坏了:用默认 */
  }
  return { on: false, pace: 'auto', hold: 1 };
}

function save() {
  if (stepMode) onStep = S.on;
  else onInfer = S.on;
  try {
    localStorage.setItem(KEY, JSON.stringify({ on: onInfer, onStep, pace: S.pace, hold: S.hold }));
  } catch {
    /* 隐私模式:只管这一次 */
  }
}

// ---------------------------------------------------------------------------
// 共享状态

let S: DirectorState = { ...load(), shown: null, held: false, list: [], folded: false, panel: null, picking: false, outline: true };
const subs = createListeners();

function patch(p: Partial<DirectorState>) {
  let changed = false;
  for (const k in p) if (p[k as keyof DirectorState] !== S[k as keyof DirectorState]) changed = true;
  if (!changed) return;
  S = { ...S, ...p };
  subs.emit();
}

export function getDirector(): DirectorState {
  return S;
}

/** 照大纲放 / 不照(排期从这一年重来) */
export function setDirectorOutline(outline: boolean) {
  patch({ outline });
}

export function useDirector(): DirectorState {
  return subs.use(getDirector);
}

/** 只看开关(App 用:字幕换一件时不跟着重新渲染) */
export function useDirectorOn(): boolean {
  return subs.use(() => S.on);
}

// ---- 请地图飞过去(App 订阅;每次请求 stamp 都不同) ----

let flyReq: { focus: Focus; stamp: number } | null = null;
const flySubs = createListeners();
function fly(focus: Focus | null) {
  if (!focus) return;
  flyReq = { focus, stamp: (flyReq?.stamp ?? 0) + 1 };
  flySubs.emit();
}
export function getDirectorFly(): { focus: Focus; stamp: number } | null {
  return flyReq;
}
export function useDirectorFly(): { focus: Focus; stamp: number } | null {
  return flySubs.use(() => flyReq);
}

// ---- 字幕底下那道进度线:每帧都变,不经过 React ----

let progress = 0;
const progSubs = new Set<(p: number) => void>();
function setProgress(p: number) {
  if (p === progress) return;
  progress = p;
  progSubs.forEach((f) => f(p));
}
export function subscribeDirectorProgress(f: (p: number) => void): () => void {
  progSubs.add(f);
  f(progress);
  return () => {
    progSubs.delete(f);
  };
}

// ---------------------------------------------------------------------------
// 放到哪了(DirectorEngine 推进;命令按钮改)

const E = {
  plan: null as DirectorPlan | null,
  /** 排这份时的设置(变了就从当前年份重排) */
  key: '',
  /** 放到第几秒 */
  t: 0,
  /** 上一帧在放的段、件(−1 = 没在放) */
  seg: -1,
  item: -1,
  /** 最近放的那一段放完的时刻、镜头 */
  lastEnd: -Infinity,
  lastShot: null as Focus | null,
  /** plan.skipped 里还没走到的第一件 */
  skipAt: 0,
  /** 导播最后把时间轴留在哪一年(停下后时间轴被拖到别处 = 跳到了别的年份) */
  year: null as number | null,
  /** 正在推进时间轴 */
  driving: false,
  /** 刚打开导播:没在放就放起来 */
  start: false,
};

/** 接着放还是从 year 重新排(make = 从这一年排到最后一年;key = 排期用的设置) */
export function directorBegin(make: (from: number) => DirectorPlan, key: string, year: number) {
  const p = E.plan;
  const same = !!p && E.t < p.duration && Math.abs(directorYear(p, E.t) - year) < 1e-6;
  if (same && E.key === key) {
    // 停下又放、回到导播:镜头飞回正在放的这一段(放完了在等下一段:飞回刚放的那一段)
    E.driving = true;
    E.year = getCivTime().year;
    const at = directorAt(p, E.t);
    fly(at ? p.segments[at.seg].shot : E.t < E.lastEnd + DIRECTOR_LINGER ? E.lastShot : null);
    if (at) E.seg = at.seg;
    patch({ held: false, shown: S.shown?.peek ? null : S.shown });
    sync(year);
    return;
  }
  E.plan = make(year);
  E.key = key;
  E.t = 0;
  E.seg = -1;
  E.item = -1;
  E.lastEnd = -Infinity;
  E.lastShot = null;
  E.skipAt = 0;
  E.year = getCivTime().year;
  E.driving = true;
  // 跳到了别的年份:略过的列表说的已经不是眼前的事了。设置开着(在里面改了设置、同一年重排)时字幕先留着,别把弹层收掉
  patch({ shown: same && S.panel === 'settings' ? S.shown : null, held: false, ...(same ? {} : { list: [] }) });
  setProgress(0);
}

/** 往前走 dt 秒;返回这一刻的年份,放完了 = null */
export function directorAdvance(dt: number): number | null {
  const p = E.plan;
  if (!p) return null;
  E.t += dt;
  if (E.t >= p.duration) {
    E.t = p.duration;
    E.driving = false;
    E.year = null;
    patch({ shown: null, held: false });
    setProgress(0);
    return null;
  }
  const y = directorYear(p, E.t);
  E.year = y;
  sync(y);
  return y;
}

/** 按 E.t 更新字幕、请镜头飞、把走过的略过的放进列表 */
function sync(year: number) {
  const p = E.plan;
  if (!p) return;
  if (E.skipAt < p.skipped.length && p.skipped[E.skipAt].entry.year <= year) {
    const add: DirectorSkip[] = [];
    while (E.skipAt < p.skipped.length && p.skipped[E.skipAt].entry.year <= year) add.push(p.skipped[E.skipAt++]);
    const have = new Set(S.list.map((s) => s.entry.id));
    const fresh = add.filter((s) => !have.has(s.entry.id)).reverse();
    if (fresh.length) patch({ list: [...fresh, ...S.list].slice(0, SKIP_LIST_MAX) });
  }
  const at = directorAt(p, E.t);
  if (at) {
    const seg = p.segments[at.seg];
    if (at.seg !== E.seg) {
      E.seg = at.seg;
      E.lastShot = seg.shot;
      fly(seg.shot);
    }
    E.lastEnd = seg.at + seg.hold;
    // 在放的那件;两件之间空着(固定速度时等下一件发生)= 刚放完的那件接着留着;镜头还在飞 = 字幕还没出来(上一段的多留着)
    let k = at.item;
    if (k < 0) for (let i = seg.items.length - 1; i >= 0 && k < 0; i--) if (seg.items[i].at <= E.t) k = i;
    if (k < 0) return;
    const it = seg.items[k];
    if (k !== E.item || S.shown?.cap !== it) {
      E.item = k;
      patch({ shown: { cap: it, left: seg.items.length - 1 - k, next: k + 1 < seg.items.length || at.seg + 1 < p.segments.length, peek: false } });
    }
    setProgress(Math.min(1, Math.max(0, (E.t - it.at) / Math.max(1e-6, it.hold))));
    return;
  }
  E.seg = -1;
  E.item = -1;
  const sh = S.shown;
  if (!sh || sh.peek) return;
  // 放完了:字幕多留一会儿(设置开着时一直留着,别把弹层收掉)
  if (E.t < E.lastEnd + DIRECTOR_LINGER || S.panel === 'settings') {
    const next = directorNext(p, E.t) >= 0;
    if (sh.left !== 0 || sh.next !== next) patch({ shown: { ...sh, left: 0, next } });
    setProgress(1);
  } else {
    patch({ shown: null });
    setProgress(0);
  }
}

/** 时间轴停下了(暂停、拖地图、选中东西……):字幕还在就停在这件事上等着;停下的同时跳到了别的年份(拖时间轴、点了一条纪事)= 收掉 */
export function directorStopped() {
  E.driving = false;
  const y = getCivTime().year;
  if (y !== E.year) return directorTimeMoved(getCivTime());
  if (S.shown) patch({ held: true });
}

/** 导播最后写进时间轴的年份(别处改了年份 = 和它对不上) */
export function getDirectorYear(): number | null {
  return E.year;
}

/** 停着的时候时间轴被拖到 / 跳到别的年份:字幕、略过的列表都收掉,下次放从那一年重排 */
export function directorTimeMoved(t: CivTime) {
  if (t.playing || E.driving) return;
  if (t.year === E.year) return;
  E.plan = null;
  E.year = t.year;
  if (S.shown || S.held || S.list.length) patch({ shown: null, held: false, list: [] });
  setProgress(0);
}

/** 换了世界 / 导播停用了(回放世界形成、导出视频……):从头来 */
export function directorReset(keepList = false) {
  E.plan = null;
  E.driving = false;
  E.seg = -1;
  E.item = -1;
  patch({ shown: null, held: false, ...(keepList ? {} : { list: [] }), panel: S.panel === 'list' ? null : S.panel });
  setProgress(0);
}

/** 用的人自己动了地图(拖、缩放、点):放着的话停下,镜头交还 */
export function directorHandBack() {
  if (E.driving && getCivTime().playing) pausePlayback();
  handSubs.emit();
}

/** 用的人一动地图就调 f(逐年推演停一下时一件件飞过去的那串,一动地图就不再自己飞) */
const handSubs = createListeners();
export function onDirectorHandBack(f: () => void): () => void {
  return handSubs.subscribe(f);
}

/** 这一刻正在放一段(镜头在飞或字幕在走):逐年推演等下一步时不放慢这一段 */
export function directorNarrating(): boolean {
  return !!E.plan && directorAt(E.plan, E.t) !== null;
}

/** DirectorEngine:刚打开导播、时间轴没在放 → 放起来(只取一次) */
export function takeDirectorStart(): boolean {
  const s = E.start;
  E.start = false;
  return s;
}

// ---------------------------------------------------------------------------
// 按钮

/** 下一件:这一段里还没出字幕的下一件,没有就下一段的第一件(镜头这时才起飞,字幕马上换) */
export function directorNextItem() {
  const p = E.plan;
  if (!p || S.held) return;
  const at = directorAt(p, E.t);
  let to = at ? (p.segments[at.seg].items.find((it) => it.at > E.t + 1e-9)?.at ?? -1) : -1;
  if (to < 0) {
    const n = directorNext(p, E.t);
    if (n >= 0) to = p.segments[n].items[0].at;
  }
  if (to >= 0) E.t = Math.max(E.t, to);
}

/** 全部跳过:这一段剩下的都不放了,接着往下走 */
export function directorSkipAll() {
  const p = E.plan;
  if (!p) return;
  const at = directorAt(p, E.t);
  if (at) E.t = Math.max(E.t, p.segments[at.seg].at + p.segments[at.seg].hold);
  E.lastEnd = -Infinity;
  E.item = -1;
  patch({ shown: null, panel: S.panel === 'settings' ? null : S.panel });
  setProgress(0);
}

/** 回到导播:接着放(DirectorEngine 接着这份排期放、镜头飞回来) */
export function directorResume() {
  patch({ held: false, panel: S.panel === 'list' ? null : S.panel });
  const t = getCivTime();
  if (!t.playing) setCivTime({ playing: true, story: false, scrubbing: false });
}

/** 点略过的一条:镜头飞过去,字幕换成这件,停着等你 */
export function directorPeek(s: DirectorSkip) {
  patch({ shown: { cap: s, left: 0, next: false, peek: true }, held: true, panel: null });
  if (getCivTime().playing) pausePlayback();
  setProgress(0);
  fly(s.shot);
}

/** 右边的「导播」按钮:关着 = 打开(没在放就放起来);停着等你 = 回到导播;放着 = 关掉 */
export function directorButton() {
  if (!S.on) return setDirectorOn(true);
  if (S.held) return directorResume();
  setDirectorOn(false);
}

/**
 * 在逐年推演 / 推演模式之间换(App 按打开的世界设):开关换成那一边记着的(逐年推演默认开、推演模式默认关),
 * 字幕、略过的列表从头来
 */
export function setDirectorMode(step: boolean) {
  if (step === stepMode) return;
  stepMode = step;
  E.plan = null;
  E.driving = false;
  E.start = false;
  patch({ on: step ? onStep : onInfer, shown: null, held: false, list: [], panel: null, folded: false });
  setProgress(0);
}

/** 逐年推演的开始设置里改导播开关:只改逐年推演那一份(推演模式里开着的照旧) */
export function setStepDirectorOn(on: boolean) {
  if (stepMode) return setDirectorOn(on);
  onStep = on;
  save();
  subs.emit();
}

/** 逐年推演那一份开关(开始设置里显示) */
export function stepDirectorOn(): boolean {
  return stepMode ? S.on : onStep;
}

/** 请地图飞到一处(逐年推演停一下时一件件看这一段的大事) */
export function directorFlyTo(focus: Focus | null) {
  fly(focus);
}

// ---------------------------------------------------------------------------
// 逐年推演:历史一步步算出来,排期也一份份接着排(每份 = 算好的那几年,[from, to))

/**
 * 接着放一份新排的(上一份放完了、下一步也算好了):字幕、略过的列表、刚放完那段的余韵都留着,
 * 时钟从这一份的第 0 秒起。还没放过(刚开始、换了设置)用 directorBegin
 */
export function directorFeed(plan: DirectorPlan, key: string) {
  E.lastEnd -= E.t;
  E.plan = plan;
  E.key = key;
  E.t = 0;
  E.seg = -1;
  E.item = -1;
  E.skipAt = 0;
  E.driving = true;
  E.year = plan.from;
  if (S.held) patch({ held: false });
}

/**
 * 逐年推演往前走 dt 秒:放到这一份的最后一年就停在那里等下一份(时钟照走,字幕放完照常多留一会儿再收);
 * 返回这一刻的年份(没有排期 = null)
 */
export function directorStep(dt: number): number | null {
  const p = E.plan;
  if (!p) return null;
  E.t += dt;
  E.driving = true;
  const y = directorYear(p, E.t);
  E.year = y;
  sync(y);
  return y;
}

/** 这一份放完了(逐年推演:可以接下一份了) */
export function directorDone(): boolean {
  return !E.plan || E.t >= E.plan.duration - 1e-9;
}

/** 正在放的这一份排期(逐年推演认"还是不是它") */
export function directorPlanNow(): DirectorPlan | null {
  return E.plan;
}

export function setDirectorOn(on: boolean) {
  if (on === S.on) return;
  E.plan = null;
  E.driving = false;
  E.start = on;
  patch({ on, shown: null, held: false, list: [], panel: null, folded: false });
  setProgress(0);
  save();
}

/** 节奏:自动 / 固定速度(speed = 时间轴的 1× / 4×,固定速度时照它走) */
export function setDirectorPace(pace: PaceMode, speed?: PlaySpeed) {
  if (speed !== undefined && getCivTime().speed !== speed) setCivTime({ speed });
  patch({ pace });
  save();
}

export function setDirectorHold(hold: number) {
  patch({ hold: HOLD_STEPS.includes(hold) ? hold : 1 });
  save();
}

// ---- 镜头跟着谁(记在这个世界的修改里;找回、接着跟下一位见 followInfo.ts) ----

/** 镜头跟着谁;null = 全世界的大事 */
export function getDirectorFollow(): FollowRef | null {
  return getEdits().follow ?? null;
}

export function useDirectorFollow(): FollowRef | null {
  return useSyncExternalStore(
    (f) => subscribeEdits(f),
    getDirectorFollow,
    getDirectorFollow,
  );
}

/** 改镜头跟着谁(不记撤销步、不改历史) */
export function setDirectorFollow(f: FollowRef | null) {
  setFollow(f);
}

export function setDirectorPanel(panel: DirectorState['panel']) {
  patch({ panel });
}

/** 设置里换成选人列表(true)/ 回到设置(false) */
export function setDirectorPicking(picking: boolean) {
  patch({ picking });
}

export function setDirectorFolded(folded: boolean) {
  patch({ folded });
}

export function clearDirectorList() {
  patch({ list: [], panel: S.panel === 'list' ? null : S.panel });
}
