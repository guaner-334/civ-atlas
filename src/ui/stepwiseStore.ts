/**
 * 逐年推演的界面状态(和 civView.ts 一样的小 store;界面在 Stepwise.tsx,一步怎么算在 worker 的 turn,数据格式见 gen/edits.ts、gen/stepwise.ts)。
 *
 * 一个世界的修改里有进度(edits.play)就是在逐年推演:历史只算到"现在"(play.year 年初),
 * 时间轴只放这一段([since, 下一次停的那年],见 ui/stepwisePlan.ts 的 nextStep / pauseYear),"现在"以后是还没发生的。
 *
 * - 往下走:播放头在算好的历史里走(导播开着按导播的排期,关着按固定速度);播放头走进最后算好的那一步时,
 *   在后台算下一步(App 交给 worker 的 turn),算得比放得慢就放慢一点等它,不停顿。
 * - 停一下:一步走完说该停了(每隔几年、出大事、到能推的最后一年),播放头走到那一年就停下:
 *   卡片列出这一段的大事(和导播放的一样挑)、倒计时,倒计时走完、点「接着演绎」接着走。这一段一件大事也没有就不停(接着走)。
 * - 干预:国家 / 州 / 城的干预先进单子(pendingStore.ts,和推演模式的待推演是同一个单子),下一步开始时一起交给 worker,
 *   生效年份 = 下一步从哪年起(nextYear)。打开干预页时倒计时停住,点「接着演绎」再走。
 *
 * 不碰 DOM;算一步、存回推演模式、从某一年开始由 App 实现(setStepwiseActions)。
 */
import { useSyncExternalStore } from 'react';
import type { ChronicleEntry } from '../gen/civ/chronicle';
import { cleanPlay, issueCommands, type Intervention, type WorldEdits } from '../gen/edits';
import { stepwiseToNormal } from '../gen/stepwise';
import type { PauseWhy, StepPlan, StepReviewItem } from './stepwisePlan';

/** 停在哪:这一段(from 到 to 年年初)、为什么停、这一段的大事(和导播放这一段时挑的一样) */
export interface StepStop {
  from: number;
  to: number;
  why: PauseWhy;
  /** 出大事也停时,这一步里的头等大事(卡片标题"出了一件大事") */
  big: readonly ChronicleEntry[];
  items: readonly StepReviewItem[];
}

/** 倒计时:一共几秒、还剩几秒、在走没有;停着的原因:user = 点了「先停着」,act = 在干预 */
export interface StepClock {
  total: number;
  left: number;
  run: boolean;
  why: 'user' | 'act' | null;
}

export type StepDialog =
  /** 从推演模式第 year 年开始之前的设置 */
  | { kind: 'start'; year: number }
  /** 中途改推进设置 */
  | { kind: 'settings' }
  /** 存回推演模式 */
  | { kind: 'save' };

export interface StepwiseState {
  /** 当前世界在逐年推演 */
  on: boolean;
  /** 这次从第几年起演绎 */
  start: number;
  /** 这一段从哪年起(开始的那年、上一次停下的那年、打开时的"现在") */
  since: number;
  /** 推到哪年年初了("现在";历史算到这一刻之前) */
  now: number;
  /** 正在算的一步:从哪年起、照哪份打算走(走几年、走完停不停;没在算 = null) */
  busy: { from: number; to: number; plan: StepPlan; t0: number } | null;
  /** 推到的这一年要停一下(走完的那一步说的):播放头走到这里就停 */
  due: { why: PauseWhy; big: readonly ChronicleEntry[] } | null;
  /** 停着看这一段的大事 */
  stop: StepStop | null;
  /** 正在看卡片里的第几件(−1 = 镜头拉远看全部) */
  cur: number;
  clock: StepClock | null;
  dialog: StepDialog | null;
}

const INIT: StepwiseState = { on: false, start: 0, since: 0, now: 0, busy: null, due: null, stop: null, cur: -1, clock: null, dialog: null };

let S: StepwiseState = INIT;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

function patch(p: Partial<StepwiseState>) {
  let changed = false;
  for (const k in p) if (p[k as keyof StepwiseState] !== S[k as keyof StepwiseState]) changed = true;
  if (!changed) return;
  S = { ...S, ...p };
  subs.forEach((f) => f());
}

export function getStepwise(): StepwiseState {
  return S;
}

export function useStepwise(): StepwiseState {
  return useSyncExternalStore(subscribe, getStepwise, getStepwise);
}

/** 只看在不在逐年推演(地图、侧栏按它换样子;别的变了不重新渲染) */
export function useStepwiseOn(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => S.on,
    () => S.on,
  );
}

/** 只看是不是停着看这一段的大事(手机上这时时间轴胶囊让开) */
export function useStepwiseStopped(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!S.stop,
    () => !!S.stop,
  );
}

export function subscribeStepwise(f: () => void): () => void {
  return subscribe(f);
}

// ---------------------------------------------------------------------------
// 时间轴上播放头的位置(往下走时每帧都变,不经过 React)。
// 往下走时地图的年份(civView 的 year)按整年换(讲一件事时停在那件事那一刻):一年只重画一次地图;播放头照样平滑地走

let head: number | null = null;
const headSubs = new Set<() => void>();
/** 往下走时播放头在哪年(没在走 = null,按时间轴的年份画) */
export function setStepHead(y: number | null) {
  if (y === head) return;
  head = y;
  headSubs.forEach((f) => f());
}
export function getStepHead(): number | null {
  return head;
}
export function subscribeStepHead(f: () => void): () => void {
  headSubs.add(f);
  return () => {
    headSubs.delete(f);
  };
}

// ---------------------------------------------------------------------------
// 用的人正按着地图(拖、捏合、滚轮):这一会儿世界先不往下走,算好的一步等松开再换上(换历史要重画整张地图,拖着的时候会卡一下)

let gesture = false;
const gestureEnd = new Set<() => void>();
let wheelTimer: ReturnType<typeof setTimeout> | undefined;
export function setStepGesture(on: boolean) {
  if (on === gesture) return;
  gesture = on;
  if (!on) [...gestureEnd].forEach((f) => f());
}
/** 滚轮一下:按着一小会儿(停下 250 毫秒算松开) */
export function stepWheel() {
  setStepGesture(true);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => setStepGesture(false), 250);
}
export function getStepGesture(): boolean {
  return gesture;
}
/** 松开的时候调一次 f */
export function onStepGestureEnd(f: () => void): () => void {
  const g = () => {
    gestureEnd.delete(g);
    f();
  };
  gestureEnd.add(g);
  return () => gestureEnd.delete(g);
}

// ---------------------------------------------------------------------------
// App 做的几件事

export interface StepwiseActions {
  /** 算一步:在"现在"下这几条干预(from 已经是"现在"),接着走 years 年;交出去了 = true */
  turn(years: number, commands: unknown[]): boolean;
  /** 从推演模式第 year 年开始(drop = 不带的那几条以后的干预,laterInterventions 的 index):另存一个世界、打开它 */
  start(year: number, drop: readonly number[]): void;
  /** 存回推演模式:asNew = 存成新世界(不然覆盖原来那个);open = 存好以后打开它 */
  saveBack(asNew: boolean, open: boolean): void;
}

let actions: StepwiseActions | null = null;
export function setStepwiseActions(a: StepwiseActions | null) {
  actions = a;
}
export function stepwiseActions(): StepwiseActions | null {
  return actions;
}

// ---------------------------------------------------------------------------
// 进出逐年推演

/** 换了世界 / 不在逐年推演了:从头来 */
export function leaveStepwise() {
  if (S !== INIT) patch(INIT);
}

/**
 * 逐年推演的世界打开了(或者从别处换成了它):历史推到第 now 年年初,这一段从"现在"数起。
 * 开着的开始设置、存回的窗口照留(换世界由 leaveStepwise 收)
 */
export function enterStepwise(start: number, now: number) {
  patch({ on: true, start, since: now, now, busy: null, due: null, stop: null, cur: -1, clock: null, dialog: S.dialog?.kind === 'start' ? null : S.dialog });
}

/** 一步交出去了:从第 from 年起,照 plan 走 */
export function stepSent(from: number, plan: StepPlan) {
  patch({ busy: { from, to: plan.to, plan, t0: performance.now() } });
}

/**
 * 一步算回来了:推到第 now 年年初;due = 走完要不要停。返回这一步每秒算了几年(调放的速度用;算得太快量不准 = null)
 */
export function stepArrived(now: number, due: StepwiseState['due']): number | null {
  const b = S.busy;
  patch({ now, busy: null, due });
  if (!b) return null;
  const sec = (performance.now() - b.t0) / 1000;
  return sec > 0.005 ? (b.to - b.from) / sec : null;
}

/** 一步没算成(线程被重开、换了世界……):下次再交 */
export function stepLost() {
  if (S.busy) patch({ busy: null });
}

/** 下一步从哪年起(新下的干预在这一年年初生效):在算的那一步算完以后的那一年,没在算 = 现在 */
export function nextYear(s: StepwiseState = S): number {
  return s.busy ? s.busy.to : s.now;
}

// ---------------------------------------------------------------------------
// 停一下

/** 播放头走到"现在"、这一年该停:停下来看这一段的大事;countdown = 倒计时几秒(0 = 不倒计时) */
export function enterStop(stop: StepStop, countdown: number) {
  patch({ stop, cur: -1, due: null, clock: countdown > 0 ? { total: countdown, left: countdown, run: true, why: null } : null });
}

/** 这一段一件大事也没有:不停,这一年当作新的一段的开头,接着走 */
export function passStop(at: number) {
  patch({ since: at, due: null });
}

/** 接着演绎:从停下的那一年起数下一段(App 接着放、接着算) */
export function resumeFromStop() {
  const st = S.stop;
  if (!st) return;
  patch({ stop: null, cur: -1, clock: null, since: st.to });
}

/** 卡片里正在看第几件 */
export function setReviewCur(cur: number) {
  patch({ cur });
}

/** 倒计时走了 dt 秒;走完了 = true */
export function tickClock(dt: number): boolean {
  const c = S.clock;
  if (!c || !c.run) return false;
  const left = Math.max(0, c.left - dt);
  patch({ clock: { ...c, left } });
  return left <= 0;
}

/** 倒计时停住(先停着 / 在干预);再点「接着演绎」才走 */
export function holdClock(why: 'user' | 'act') {
  const c = S.clock;
  if (c && c.run) patch({ clock: { ...c, run: false, why } });
}

// ---------------------------------------------------------------------------
// 弹窗

export function openStepDialog(d: StepDialog | null) {
  patch({ dialog: d });
}

/** 中途改了"每隔几年停一下":这一段还从同一年数起(nextStep 自己按新的算) */
export function stepwiseChanged() {
  subs.forEach((f) => f());
}

/**
 * 存回推演模式存成的普通世界的修改:单子里还没交出去的干预(queued)当作在"现在"下的(在那一年年初生效)一起存进去,
 * 再照 gen/stepwise.ts 的 stepwiseToNormal 换成普通世界(推演年数 = 现在那一年)。存不回(推得太远)= null
 */
export function saveBackEdits(edits: WorldEdits, queued: readonly Intervention[]): WorldEdits | null {
  const play = cleanPlay(edits.play);
  if (!play) return null;
  const now = queued.map((v) => ({ ...v, from: play.year }) as Intervention);
  return stepwiseToNormal(now.length ? { ...edits, play: issueCommands(play, now).play } : edits);
}

/** 单测用 */
export function _resetStepwise() {
  S = INIT;
}
