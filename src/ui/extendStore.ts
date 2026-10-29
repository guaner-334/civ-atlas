/**
 * 推演模式「再推 N 年」:推完的世界在时间轴末尾接着往后推,前面的历史一点不变(底层见 gen/civ/extend.ts、worker 的 extend)。
 * 这里是界面状态和纯计算;按钮、弹层、手机卡片在 ExtendYears.tsx,接后台线程在 App.tsx。
 *
 * - 选几年:100 / 500 / 1000 年或自己填(整数);默认 500 年,以后记住上次推的那一档(记在这个浏览器里)。
 *   一直能推到第 END_YEAR_MAX 年,填多了按推到上限算。
 * - 推的时候(busy):时间轴按推完的长度排好,新的一段推好了的浅蓝、没推到的虚线;按钮变成进度圈 +「停下」。
 *   停下 = 这次不推了,世界还是推之前那样。
 * - 推完(fresh):刚推的那一段在时间轴上垫一道浅蓝、起点一条细线;只在这次打开网页里标着(不进存档),
 *   再推一次换成新的那段,换世界、读档以后不标。
 * - "这台电脑约 N 秒":按这台电脑刚才推演用的时间估(生成世界时推文明那一步、上一次再推的实测毫秒数);估不出来 = null。
 * 不碰 DOM(浏览器存储读写包了 try),单测直接测(tests/extend-years.test.ts)。
 */
import { useSyncExternalStore } from 'react';
import { END_YEAR_MAX } from '../gen/edits';
import { yearFull, type Era } from '../gen/era';
import { momentFull, momentTail } from './stepTime';

/** 弹层里的三档 */
export const EXTEND_PRESETS = [100, 500, 1000] as const;
/** 打开弹层时先选着哪一档(以后记住上次推的) */
export const EXTEND_DEFAULT = 500;
/** 选的哪一档:100 / 500 / 1000 年,或自己填 */
export type ExtendPick = (typeof EXTEND_PRESETS)[number] | 'own';

/** 正在推的这一次 */
export interface ExtendBusy {
  /** 第几次再推(后台线程只认最新的) */
  xid: number;
  /** 从第几年接着推(推之前的结束年份) */
  from: number;
  /** 推到第几年 */
  to: number;
  /** 推演推到哪年了(还没回报 = null) */
  year: number | null;
  /** 整体进度 0–1(推演推完到整理完之间停在一个数上) */
  pct: number;
  /** 这个世界有地形大事:从第 0 年整段重推,没有分段进度 */
  slow: boolean;
}

/** 刚推的那一段(时间轴上垫浅蓝):从第 from 年推到第 to 年 */
export interface ExtendFresh {
  from: number;
  to: number;
}

export interface ExtendState {
  /** 选几年的弹层(电脑)/ 底部卡片(手机)开着 */
  open: boolean;
  /** 弹层里选着的那一档 */
  pick: ExtendPick;
  /** 自己填的年数(没填 = null) */
  own: number | null;
  busy: ExtendBusy | null;
  fresh: ExtendFresh | null;
}

// ---------------------------------------------------------------------------
// 记在浏览器里的:上次推的那一档

const KEY = 'wenming-ditu:extend';

function load(): Pick<ExtendState, 'pick' | 'own'> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { pick?: unknown; own?: unknown } | null;
    if (v && typeof v === 'object') {
      const own = cleanOwn(v.own);
      const pick = v.pick === 'own' ? 'own' : EXTEND_PRESETS.find((p) => p === v.pick);
      if (pick) return { pick, own };
    }
  } catch {
    /* 存不了 / 坏了:用默认 */
  }
  return { pick: EXTEND_DEFAULT, own: null };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ pick: S.pick, own: S.own }));
  } catch {
    /* 隐私模式:只管这一次 */
  }
}

/** 自己填的年数:正整数才认(别的 = null) */
function cleanOwn(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// 共享状态

let S: ExtendState = { open: false, ...load(), busy: null, fresh: null };
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
function patch(p: Partial<ExtendState>) {
  S = { ...S, ...p };
  for (const f of subs) f();
}

export function getExtend(): ExtendState {
  return S;
}
export function useExtend(): ExtendState {
  return useSyncExternalStore(subscribe, getExtend, getExtend);
}

/** 打开 / 收起选几年的弹层 */
export function setExtendOpen(open: boolean) {
  if (S.open !== open) patch({ open });
}

/** 弹层里换一档(own = 自己填的年数,只在选「自己填」时给) */
export function setExtendPick(pick: ExtendPick, own?: number | null) {
  patch(own === undefined ? { pick } : { pick, own: cleanOwn(own) });
}

/** 开始推 / 推的进度变了 / 推完、停下(null) */
export function setExtendBusy(busy: ExtendBusy | null) {
  if (S.busy !== busy) patch({ busy });
}

/** 收到后台的进度:只认正在推的这一次;进度只增不减 */
export function extendProgress(xid: number, year: number, pct: number) {
  const b = S.busy;
  if (!b || b.xid !== xid) return;
  patch({ busy: { ...b, year: Math.max(b.year ?? -Infinity, year), pct: Math.max(b.pct, Math.min(1, Math.max(0, pct))) } });
}

/** 刚推的那一段(null = 不标) */
export function setExtendFresh(fresh: ExtendFresh | null) {
  if (S.fresh !== fresh) patch({ fresh });
}

/** 换了世界:弹层收起,不在推,不标 */
export function resetExtend() {
  if (S.open || S.busy || S.fresh) patch({ open: false, busy: null, fresh: null });
}

/** App 挂上的做法:开始推 years 年 / 叫停正在推的这一次 */
export interface ExtendRunner {
  start: (years: number) => void;
  stop: () => void;
}
let runner: ExtendRunner | null = null;
export function setExtendRunner(r: ExtendRunner | null) {
  runner = r;
}
/** 弹层里点了「再推 N 年」:记住这一档、收起弹层、交给 App 开始推 */
export function extendStart(years: number) {
  save();
  patch({ open: false });
  runner?.start(years);
}
/** 「停下」:这次不推了,世界还是推之前那样 */
export function extendStop() {
  runner?.stop();
}

/** 单测用:恢复默认(连浏览器里记的一起忘掉) */
export function _resetExtendForTest() {
  S = { open: false, pick: EXTEND_DEFAULT, own: null, busy: null, fresh: null };
  speedK = null;
  for (const f of subs) f();
}

// ---------------------------------------------------------------------------
// 年数

/** 弹层里选的这一档是几年(自己填的没填 / 填 0 = null) */
export function pickYears(pick: ExtendPick, own: number | null): number | null {
  return pick === 'own' ? (own && own > 0 ? own : null) : pick;
}

/** 推到第 end 年的世界还能再推几年(到 END_YEAR_MAX 为止) */
export function extendRoom(end: number): number {
  return Math.max(0, END_YEAR_MAX - end);
}

/**
 * 弹层底下那一格:再推 years 年推到第几年(到上限为止)、填多了没有(over)、
 * 原来的那段在推完的时间轴上占左边百分之几(squeeze,取整)
 */
export function extendPlan(end: number, years: number): { to: number; over: boolean; squeeze: number } {
  const room = extendRoom(end);
  const n = Math.max(1, Math.round(years));
  const to = end + Math.min(n, room);
  return { to, over: n > room, squeeze: to > 0 ? Math.round((end / to) * 100) : 100 };
}

// ---------------------------------------------------------------------------
// 这台电脑大约要多久

/**
 * 推文明的耗时按"推演每推一年 + 整理每一年历史"算:推演一年的时间约是整理一年历史的 3 倍
 * (gen/civ/extend.ts 的 simShare 同一个比例)。从第 F 年推到第 T 年 ≈ k ×(3 ×(T − F)+ T)毫秒,
 * 从第 0 年整段推到第 T 年 ≈ k × 4T。k 按最近一次实测的推出来
 */
let speedK: number | null = null;
const cost = (from: number, to: number) => 3 * Math.max(0, to - from) + to;

/** 记下一次推文明用了多久:从第 from 年推到第 to 年(从第 0 年整段推的 from = 0)花了 ms 毫秒 */
export function noteExtendSpeed(from: number, to: number, ms: number) {
  const c = cost(from, to);
  if (!(ms > 0) || !(c > 0) || !Number.isFinite(ms)) return;
  speedK = ms / c;
}

/** 从第 from 年再推 years 年约要几毫秒(slow = 有地形大事,从第 0 年整段推);还没测过 = null */
export function extendMs(from: number, years: number, slow = false): number | null {
  if (speedK === null) return null;
  const to = Math.min(END_YEAR_MAX, from + Math.max(1, Math.round(years)));
  return speedK * (slow ? cost(0, to) : cost(from, to));
}

/** "约 0.3 秒""约 4 秒""约 2 分钟" */
export function durationText(ms: number): string {
  const s = ms / 1000;
  if (s < 0.95) return `约 ${Math.max(0.1, Math.round(s * 10) / 10)} 秒`;
  if (s < 59.5) return `约 ${Math.round(s)} 秒`;
  return `约 ${Math.round(s / 60)} 分钟`;
}

/** 月份怎么写:一年几个月、起的名字(没起 = null) */
type MonthNames = readonly string[] | null | undefined;

/**
 * 推的时候说到哪了,拆成三段(中间那段标主色):"正在推，到第 " "3240" " 年";推到一年中间的写到月 "… 年 9 月"(起了名字的写名字),
 * 正好在年初的只写年;纪年时整个年份标主色。推演推完、还在收尾 / 有地形大事从第 0 年重推 / 还没回报:只有第一段
 */
export function busyParts(b: ExtendBusy, era: Era | null | undefined, months: number, names: MonthNames, phone = false): [string, string, string] {
  if (b.slow) return [phone ? '有地形大事，要从第 0 年重推，慢一些' : '正在推（这个世界有地形大事，要从第 0 年重推，慢一些）', '', ''];
  if (b.year === null) return ['正在推', '', ''];
  if (b.year >= b.to) return ['收尾：起名、人物、道路', '', ''];
  const y = yearFull(b.year, era);
  const tail = momentTail(b.year, months, names, false);
  const m = /^(第 )(\d+)( 年)$/.exec(y);
  return m ? [`正在推，到${m[1]}`, m[2], m[3] + tail] : ['正在推，到', y, tail];
}

/** 「停下」的提示:这次不推了,世界还是推到原来那一刻("还是到第 1549 年 9 月";推到年初的只写年) */
export function stopTip(b: Pick<ExtendBusy, 'from'>, era: Era | null | undefined, months: number, names: MonthNames): string {
  return `停下：不推了，还是到${momentFull(b.from, months, era, names, false)}`;
}
