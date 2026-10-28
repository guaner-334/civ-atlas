/**
 * 照大纲推演(大纲的格式见 gen/edits.ts 文件头"大纲"):先照常推,按情节的年份先后逐条查 ——
 * 自然发生了就算;没发生、能直接让它发生的,在那一年硬改(下几条普通干预,带 plot = 这条情节的编号),从那一年接着推;
 * 做不到的写明原因。大纲没写到的地方照常发生。
 *
 * 一条情节怎么走(窗口 = 情节那年的前后 span 年,硬改的年份 Y = 情节那年,但不早于 floor):
 *   ① 推到第 Y 年年初停一下(S:硬改从这一刻接着推)
 *   ② 接着推到窗口最后一年年底(C),查这几年里发生了没有:发生了 = 照着发生了
 *   ③ 没发生:在 S 上看能不能改(这国那年在不在、那州有没有人住……),能改就带上硬改的干预从 S 接着推到窗口最后一年年底(C2),
 *      再查一遍:成了 = 硬改的,不成 = 做不到(干预不留)
 * 查过的情节落定在某一年(发生的那年 / 硬改的那年),floor = 那一年的下一年:后面的硬改不早于它,前面查过的不会被推翻。
 *
 * **顺着引**(input.tries > 0 才引;不给 = 照上面直接硬改):②没发生、这种情节能引的(GUIDE_KINDS),先在它前面几十年悄悄给情节里的国家定方针
 * (打仗胆量、开拓、仇国 / 亲国、和谈底线,加在那国当时自己的方针上;再加减国力、动荡,见 civ/policy.ts),引到窗口最后一年年底为止,再换回原来的方针。
 * 看邻国二十几年才一次、看内政四十年一次,窗口里常常一眼都没看,引了也白引:引出来的方针另替动手的那国在窗口里每隔几年多看一眼
 * (邻国只看仇国;灭国从起引那年就看,得先打几仗),见 civ/interventions.ts 的"多看一眼"。
 * 只引情节里写到的国家(占地引 a,没说亡于谁的灭国引它最大的几个邻国),挡路的第三国不动。
 * 几种引法(从哪年起 × 引多重 × 引谁)按"引得多轻"排(各国加减的量 × 引了几国 × 引了几年,轻的在前),一版版试:
 * 从起引那一刻(不早于 floor)接着推到窗口最后一年年底再查,头一版查得到的就用它(= 引得最轻的),标「顺着引了一把」;
 * 最多试 tries 版,都没成才照③硬改(批改记下试了几版)。引出来的方针带 plot 和 guide = true(编年史不写)。
 *
 * 停下来、接着推都用 civ/index.ts 的 startContinue(各层从 Civ 重建"接下来该发生什么",接着推和一口气推完一样),
 * 中间几步不整理(不起名、不配人物、不修路;partial),最后推到推演年数那一刻才整理一次 —— 所以结果和带着同样的干预从第 0 年一口气推完一样
 * (单测核对)。查"去世"要人物,那一步整理一次。停下来的那几刻(快照)都留着:推到某一刻时从最晚的、还用得上的那一份接着推
 * (快照之后才生效的干预可以接上,见 startContinue)。接不上的(有地形大事的世界)每一步都从第 0 年推到那一刻(结果一样,只是慢)。
 *
 * 改了几条情节再推:上一次每一步结束时的样子记在 OutlineCache 里,前面那几步挑出来的情节一模一样就直接用,
 * 从第一条不一样的那一步接着算(前面的历史不动)。
 *
 * 纯计算,不碰 DOM;在 worker 和 Node 里都能跑。
 */
import type { World } from './world';
import { generateCiv, startContinue } from './civ';
import type { Annal, Civ, CivParams } from './civ/types';
import { playStop } from './civ/play';
import { capitalAt, polityAlive } from './civ/growth';
import { logIndexAfter, ownersAt } from './civ/timeline';
import { polityTies, relationsAt } from './civ/diplomacy';
import { nearestCell } from './civ/frontier';
import {
  END_YEAR_DEFAULT,
  OUTLINE_ALLY_YEARS,
  GUIDE_LOOK_MAX,
  OUTLINE_TRIES_MAX,
  POLICY_KNOB_MAX,
  PLOT_CHECK_ONLY,
  PLOT_SPAN_DEFAULT,
  cleanIntervention,
  cleanOutline,
  commandAt,
  commandYear,
  keyCells,
  ownInterventions,
  plotNeedsRedo,
  parsePersonKey,
  polityKey,
  regionKey,
  regionOfKey,
  resolveKey,
  resolvePersonKey,
  ticksAt,
  type AuthorMark,
  type GuideLook,
  type Intervention,
  type Plot,
  type PlotKind,
  type PlotReason,
  type PlotReview,
} from './edits';
import { characterLeanings, type AuthorCharacter } from './characters';
import { emptyPolicy, policiesFrom, type PolicyIv } from './civ/policy';

/** 照大纲推演的输入 */
export interface OutlineInput {
  /** 情节(先过 cleanOutline) */
  plots: readonly unknown[];
  /** 这个世界现在的干预(上一次照大纲硬改出来的那几条先去掉) */
  interventions: readonly Intervention[];
  /** 作者的人物(即位的情节读生年、性格) */
  characters?: readonly AuthorCharacter[];
  /** 作者标记(一片地方用标记圈的) */
  marks?: readonly AuthorMark[];
  /** 没自然发生的情节,硬改前最多试几版顺着引(0 / 不给 = 不引,直接硬改;最多 OUTLINE_TRIES_MAX) */
  tries?: number;
}

/** 照大纲推演的结果 */
export interface OutlineResult {
  /** 推到推演年数的整段历史(和带着 interventions 从第 0 年一口气推完一样;不和 cache 里的快照共用数组) */
  civ: Civ;
  /** 作者自己的干预 + 硬改出来的(按硬改的先后,带 plot) */
  interventions: Intervention[];
  /** 每条情节的批改(按情节的先后) */
  review: PlotReview[];
  /** 这一次每一步的样子(下一次改了几条情节再推时传回来) */
  cache: OutlineCache;
  /** 前面有几条直接用了上一次的(没重算) */
  reused: number;
}

/** 推的时候的回调(都可以不给) */
export interface OutlineHooks {
  /** 每查完一条报一次:查完了几条、一共几条、到现在的批改(按查的先后) */
  progress?: (done: number, total: number, review: readonly PlotReview[]) => void;
  /** 每条之间等一下(worker 里等一个宏任务,好让新到的消息排进来) */
  pause?: () => Promise<void>;
  /**
   * 开始查一条(fix = null)/ 查完没发生、开始试第 trial.n 版引法(一共最多 trial.of 版)/ 开始在第 fix 年硬改:哪一条(界面上的进度用)
   */
  stage?: (id: number, fix: number | null, trial?: { n: number; of: number }) => void;
  /** 每条之间(和开始之前)问一次:true = 不推了,返回 null */
  stop?: () => boolean;
  /** 上一次的结果(没有 = 从头算) */
  cache?: OutlineCache | null;
  /** 这个世界、这组参数的键(和 cache 对得上才用;不给 = 不用上一次的) */
  key?: string;
  /** 中途叫停时交出已经定下来的那几步(给了 key 才交;下一次照大纲推演传回 cache,定下来的那几条不重算) */
  keep?: (cache: OutlineCache) => void;
}

/** 停下来的一刻:那一刻的历史、推它时带着前几条干预、整理过没有(有人物) */
interface Snap {
  civ: Civ;
  n: number;
  full: boolean;
}

/** 推到某一条情节之前的样子 */
interface State {
  snaps: Snap[];
  list: Intervention[];
  floor: number;
  done: Map<number, PlotReview>;
}

/** 上一次照大纲推演每一步结束时的样子 */
export interface OutlineCache {
  key: string;
  steps: { sig: string; after: State }[];
}

/** 推演里用的样子:世界、参数、推演年数 */
interface Ctx {
  world: World;
  params: Partial<CivParams>;
  endYear: number;
  plots: Plot[];
  characters: readonly AuthorCharacter[];
  marks: readonly AuthorMark[];
  tries: number;
  stage?: OutlineHooks['stage'];
  pause?: OutlineHooks['pause'];
  stop: () => boolean;
}

/**
 * 照大纲推演。params = 推这个世界用的参数(推演年数在 params.endYear;干预不看,用 input.interventions)。
 * 中途叫停 = null(已经定下来的几步交给 hooks.keep)
 */
export async function runOutline(world: World, params: Partial<CivParams>, input: OutlineInput, hooks: OutlineHooks = {}): Promise<OutlineResult | null> {
  const stop = hooks.stop ?? (() => false);
  const plots = cleanOutline({ plots: input.plots })?.plots ?? [];
  const own = ownInterventions(input.interventions.flatMap((v) => cleanIntervention(v) ?? []));
  const endYear = params.endYear ?? END_YEAR_DEFAULT;
  const tries = Math.min(OUTLINE_TRIES_MAX, Math.max(0, Math.floor(input.tries ?? 0) || 0));
  const ctx: Ctx = { world, params: { ...params, endYear }, endYear, plots, characters: input.characters ?? [], marks: input.marks ?? [], tries, stage: hooks.stage, pause: hooks.pause, stop };
  const key = hooks.key === undefined ? null : `${hooks.key}|${JSON.stringify([own, endYear, ctx.characters, ctx.marks, tries])}`;
  const prev = key !== null && hooks.cache?.key === key ? hooks.cache.steps : [];
  const steps: OutlineCache['steps'] = [];
  let st: State = { snaps: [], list: own, floor: 0, done: new Map() };
  let reuse = true;
  let reused = 0;
  /** 叫停:已经定下来的几步交出去留着 */
  const halt = () => {
    if (key !== null && steps.length) hooks.keep?.({ key, steps: steps.slice() });
    return null;
  };
  if (stop()) return null;
  for (;;) {
    const pick = choose(ctx, st);
    if (!pick) break;
    const sig = `${JSON.stringify(pick.plot)}@${pick.lo},${pick.hi},${pick.at}`;
    const k = steps.length;
    if (reuse && prev[k]?.sig === sig) {
      st = prev[k].after;
      reused++;
    } else {
      reuse = false;
      hooks.stage?.(pick.plot.id, null);
      const next = await step(ctx, st, pick);
      if (!next) return halt();
      st = next;
    }
    steps.push({ sig, after: st });
    hooks.progress?.(st.done.size, plots.length, [...st.done.values()]);
    if (hooks.pause) await hooks.pause();
    if (stop()) return halt();
  }
  // 推到最后不记进快照(记着的那几步下一次还要用);交出去的是复制的一份,和记着的快照不共用数组
  // (worker 把结果的数组 transfer 给主线程,共用的话记着的快照就空了)
  const civ = structuredClone(advance(ctx, { ...st, snaps: st.snaps.slice() }, endYear, true));
  const review = plots.map((p) => st.done.get(p.id)!);
  return { civ, interventions: st.list.slice(), review, cache: { key: key ?? '', steps }, reused };
}

// ---------------------------------------------------------------------------
// 先后

/** 下一条要查的情节:窗口 [lo, hi](已经夹进推演年数;lo > hi = 超出了)、本来该在哪年(at) */
interface Pick {
  plot: Plot;
  lo: number;
  hi: number;
  at: number;
}

const spanOf = (p: Plot) => p.span ?? PLOT_SPAN_DEFAULT;

/** 还没查的情节里,能查的(跟着的那条查过了)按本来该在哪年排,同一年按列表先后 */
function choose(ctx: Ctx, st: State): Pick | null {
  let best: Pick | null = null;
  for (const p of ctx.plots) {
    if (st.done.has(p.id)) continue;
    let lo: number;
    let hi: number;
    let at: number;
    if (p.after !== undefined) {
      const ref = st.done.get(p.after);
      if (!ref) continue;
      lo = ref.year;
      hi = ref.year + spanOf(p);
      at = Math.min(hi, ref.year + 1);
    } else {
      lo = p.year - spanOf(p);
      hi = p.year + spanOf(p);
      at = p.year;
    }
    if (!best || at < best.at) best = { plot: p, lo: Math.max(0, lo), hi: Math.min(ctx.endYear - 1, hi), at };
  }
  return best;
}

// ---------------------------------------------------------------------------
// 推到某一刻

/** 这一刻的历史能不能拿来接着推现在的干预列表:它之后接上的干预都在它以后才生效 */
function usable(s: Snap, list: readonly Intervention[]): boolean {
  if (s.n > list.length) return false;
  for (let i = s.n; i < list.length; i++) if (!(list[i].from > s.civ.endYear)) return false;
  return true;
}

/** 推到 t 那一刻(full = 要整理过的:人物);从最晚的、用得上的那份快照接着推;新推出来的记进快照 */
function advance(ctx: Ctx, st: State, t: number, full: boolean): Civ {
  let best: Snap | null = null;
  for (const s of st.snaps) {
    if (!usable(s, st.list) || s.civ.endYear > t) continue;
    // 要整理过的:同一刻那份没整理过就不能用(接着推要推到更晚的一刻)
    if (s.civ.endYear === t && full && !s.full) continue;
    if (!best || s.civ.endYear > best.civ.endYear || (s.civ.endYear === best.civ.endYear && s.n > best.n)) best = s;
  }
  const list = st.list;
  const params = { ...ctx.params, interventions: list.length ? list : undefined, endYear: t };
  if (best && best.civ.endYear === t) {
    if (best.n === list.length) return best.civ;
    // 同一刻、后面接上的干预都还没生效:历史一样,只是带着的干预列表长了
    const civ = { ...best.civ, interventions: list.slice() };
    st.snaps.push({ civ, n: list.length, full: best.full });
    return civ;
  }
  const run = best ? startContinue(ctx.world, best.civ, params) : null;
  const civ = run ? (full ? run.finish() : run.partial()) : generateCiv(ctx.world, params);
  st.snaps.push({ civ, n: list.length, full: full || !run });
  return civ;
}

/** 一条情节查完以后:只留以后还用得上的快照(floor 以前的只留最晚的一份) */
function prune(st: State): Snap[] {
  const cut = playStop(st.floor);
  let base: Snap | null = null;
  const later: Snap[] = [];
  for (const s of st.snaps) {
    if (!usable(s, st.list)) continue;
    if (s.civ.endYear >= cut) later.push(s);
    else if (!base || s.civ.endYear > base.civ.endYear || (s.civ.endYear === base.civ.endYear && s.n > base.n)) base = s;
  }
  return base ? [base, ...later] : later;
}

// ---------------------------------------------------------------------------
// 一条情节

/** 一条情节在某份历史里认出来的:国家、州、城、人物的编号(−1 = 认不出) */
interface Refs {
  a: number;
  b: number;
  /** 键(`plot:编号` 换成了那一国的键;认不出 = null) */
  aKey: string | null;
  bKey: string | null;
  /** `plot:编号` 指的那条没立起国家 */
  refFailed: 'a' | 'b' | null;
  region: number;
  city: number;
  /** 一片地方的几州(占据、饥荒选的几州) */
  area: number[];
}

function refsOf(ctx: Ctx, civ: Civ, p: Plot, done: ReadonlyMap<number, PlotReview>): Refs {
  let refFailed: 'a' | 'b' | null = null;
  const key = (k: string | undefined, who: 'a' | 'b'): string | null => {
    if (k === undefined) return null;
    if (!k.startsWith('plot:')) return k;
    const r = done.get(Number(k.slice(5)))?.polity;
    if (!r) refFailed ??= who;
    return r ?? null;
  };
  const aKey = key(p.a, 'a');
  const bKey = key(p.b, 'b');
  const pol = (k: string | null) => {
    const r = k ? resolveKey(civ, k) : null;
    return r?.kind === 'polity' ? r.id : -1;
  };
  const of = keyCells(civ.regions);
  const reg = (k: string | undefined) => {
    const r = k ? regionOfKey(k, of) : -1;
    return r >= 0 && r < civ.regions.count ? r : -1;
  };
  const cityRef = p.city ? resolveKey(civ, p.city) : null;
  let area: number[] = [];
  if (p.regions) area = p.regions.map(reg).filter((r) => r >= 0);
  else if (p.mark !== undefined) {
    const m = ctx.marks.find((x) => x.id === p.mark);
    if (m?.regions) area = m.regions.map(reg).filter((r) => r >= 0);
    else if (m?.at) {
      const c = nearestCell(ctx.world, m.at[0], m.at[1]);
      const r = c >= 0 && ctx.world.water[c] === 0 ? civ.regions.of[c] : -1;
      if (r >= 0) area = [r];
    }
  }
  return {
    a: pol(aKey),
    b: pol(bKey),
    aKey,
    bKey,
    refFailed,
    region: reg(p.region),
    city: cityRef?.kind === 'settlement' ? cityRef.id : -1,
    area: [...new Set(area)],
  };
}

/** 第 y 年这国在不在:不在 = 原因 */
function presence(civ: Civ, id: number, y: number): PlotReason | null {
  const P = id >= 0 ? civ.polities[id] : undefined;
  if (!P || y < P.founded) return 'notYet';
  return polityAlive(P, y) ? null : 'gone';
}

/** 史事里年份落在 [lo, hi] 这几年的下标范围 */
function annalRange(civ: Civ, lo: number, hi: number): [number, number] {
  const A = civ.annals;
  const at = (y: number) => {
    let l = 0;
    let h = A.length;
    while (l < h) {
      const m = (l + h) >> 1;
      if (A[m].year < y) l = m + 1;
      else h = m;
    }
    return l;
  };
  return [at(lo), at(hi + 1)];
}

/** 查出来的:哪一年、立起来的国家(立国、分裂) */
interface Found {
  year: number;
  polity?: number;
}

/** 这几年里有没有一条史事合乎 test */
function findAnnal(civ: Civ, lo: number, hi: number, test: (e: Annal) => boolean): Annal | null {
  const [i0, i1] = annalRange(civ, lo, hi);
  for (let i = i0; i < i1; i++) if (test(civ.annals[i])) return civ.annals[i];
  return null;
}

const yearFound = (e: Annal | null, polity?: number): Found | null => (e ? { year: Math.floor(e.year), ...(polity !== undefined ? { polity } : {}) } : null);

/** 那一片地方:有一年年底有人住的州全归 a(有人住的至少一州) */
function heldIn(civ: Civ, a: number, area: readonly number[], lo: number, hi: number): Found | null {
  if (a < 0 || !area.length) return null;
  const end = (y: number) => y + 255 / 256;
  const o = ownersAt(civ, end(lo));
  const ok = () => {
    let any = false;
    for (const r of area) {
      if (o.culture[r] < 0) continue;
      if (o.polity[r] !== a) return false;
      any = true;
    }
    return any;
  };
  if (ok()) return { year: lo };
  const log = civ.log;
  let i = logIndexAfter(log, end(lo));
  for (let y = lo + 1; y <= hi; y++) {
    const until = end(y);
    for (; i < log.size && log.year[i] <= until; i++) {
      if (log.layer[i] === 0) o.culture[log.region[i]] = log.value[i];
      else o.polity[log.region[i]] = log.value[i];
    }
    if (ok()) return { year: y };
  }
  return null;
}

/** 史事 intervene 那条干预的种类 */
const ivKind = (civ: Civ, e: Annal) => civ.interventions?.[e.war]?.kind;

/** 照着发生了没有(这份历史里窗口那几年) */
function happened(ctx: Ctx, civ: Civ, p: Plot, R: Refs, lo: number, hi: number): Found | null {
  const { a, b } = R;
  const pair = (e: Annal) => (e.a === a && e.b === b) || (e.a === b && e.b === a);
  switch (p.kind) {
    case 'found': {
      if (R.region < 0) return null;
      const e = findAnnal(civ, lo, hi, (e) => e.region === R.region && (((e.kind === 'found' || e.kind === 'split' || e.kind === 'revolt') && e.a >= 0) || (e.kind === 'intervene' && e.a >= 0 && ivKind(civ, e) === 'found')));
      return yearFound(e, e?.a);
    }
    case 'split': {
      if (R.region < 0 || (p.a !== undefined && a < 0)) return null;
      const from = (e: Annal) => p.a === undefined || e.b === a;
      const e = findAnnal(civ, lo, hi, (e) => e.region === R.region && e.a >= 0 && from(e) && (e.kind === 'split' || e.kind === 'revolt' || (e.kind === 'intervene' && ivKind(civ, e) === 'found' && e.b >= 0)));
      return yearFound(e, e?.a);
    }
    case 'fall': {
      if (a < 0 || (p.b !== undefined && b < 0)) return null;
      const by = (x: number) => p.b === undefined || x === b;
      return yearFound(findAnnal(civ, lo, hi, (e) => (e.kind === 'fall' && e.a === a && by(e.b)) || (e.kind === 'merge' && e.b === a && by(e.a))));
    }
    case 'hold':
      return heldIn(civ, a, R.area, lo, hi);
    case 'war':
      return a < 0 || b < 0 ? null : yearFound(findAnnal(civ, lo, hi, (e) => e.kind === 'war' && e.a === a && e.b === b));
    case 'ally': {
      if (a < 0 || b < 0) return null;
      const e = findAnnal(civ, lo, hi, (e) => e.kind === 'alliance' && pair(e));
      if (e) return yearFound(e);
      // 那几年里有一阵两国在盟(早先结的、作者下令的;窗口里散了的也算):查窗口头尾两年和作者下令结盟的那几刻
      // (逐年推演年中下令的,查下令的那一格:那一年年初还没结盟)
      const at = [lo, hi];
      for (const v of civ.interventions ?? []) if (v.kind === 'ally' && commandAt(v) > ticksAt(lo) && commandAt(v) < ticksAt(hi + 1)) at.push(commandYear(v));
      for (const y of at) {
        if (!polityAlive(civ.polities[a], y) || !polityAlive(civ.polities[b], y)) continue;
        const x = polityTies(civ, a, y).allies.find((t) => t.id === b);
        if (x) return { year: Math.max(lo, Math.floor(x.since)) };
      }
      return null;
    }
    case 'capital':
      // 改朝换代的那条也记着国都,没迁也记:那一刻真在那城立了都才算
      return a < 0 || R.city < 0
        ? null
        : yearFound(findAnnal(civ, lo, hi, (e) => e.a === a && e.settlement === R.city && (e.kind === 'capital' || (e.kind === 'dynasty' && !!civ.settlements[R.city].capitalSpans?.some((x) => x.polity === a && x.from === e.year)))));
    case 'death': {
      const id = resolvePersonKey(civ, p.person!);
      const P = id >= 0 ? civ.people?.[id] : undefined;
      if (!P || P.died === undefined) return null;
      const y = Math.floor(P.died);
      if (y < lo || y > hi || (p.how && P.fate !== p.how)) return null;
      return { year: y };
    }
    case 'crown': {
      if (a < 0) return null;
      return yearFound(findAnnal(civ, lo, hi, (e) => e.kind === 'intervene' && e.a === a && e.b === -1 && (() => {
        const v = civ.interventions?.[e.war];
        return v?.kind === 'crown' && v.char === p.char;
      })()));
    }
    case 'disaster':
      return yearFound(findAnnal(civ, lo, hi, (e) => disasterHit(civ, p, R, e)));
    case 'submit': {
      if (a < 0 || b < 0) return null;
      const e = findAnnal(civ, lo, hi, (e) => e.kind === 'submit' && e.a === a && e.b === b);
      if (e) return yearFound(e);
      // 那几年里有一阵是它的藩属(早先称的臣;窗口里又自立了的也算):查窗口头尾两年
      for (const y of [lo, hi]) {
        const l = relationsAt(civ, y).liege.get(a);
        if (l && l.liege === b) return { year: Math.max(lo, Math.floor(l.since)) };
      }
      return null;
    }
    case 'peace':
      return a < 0 || b < 0 ? null : yearFound(findAnnal(civ, lo, hi, (e) => e.kind === 'peace' && pair(e)));
    case 'dynasty':
      return a < 0 ? null : yearFound(findAnnal(civ, lo, hi, (e) => e.kind === 'dynasty' && e.a === a));
    case 'revolt':
      return a < 0 ? null : yearFound(findAnnal(civ, lo, hi, (e) => e.kind === 'revolt' && e.b === a));
    case 'collapse':
      return a < 0 ? null : yearFound(findAnnal(civ, lo, hi, (e) => e.kind === 'collapse' && e.a === a));
    case 'story':
      return null;
  }
}

/** 这条史事是不是情节说的那场天灾:瘟疫传到那座城所在的州的主人 / 起在那州;饥荒在那国 / 那几州;地震水旱在那一处 */
function disasterHit(civ: Civ, p: Plot, R: Refs, e: Annal): boolean {
  // 全球大疫:那座城起了一场(自己发生的、作者下的都记一条 pandemic)
  if (p.type === 'pandemic') return R.city >= 0 && e.kind === 'pandemic' && e.settlement === R.city;
  if (p.type === 'plague') {
    if (R.city < 0) return false;
    // 作者下的瘟疫:下令那条记着那座城、起了疫(城在无主之地时不另记 plague)
    if (e.kind === 'intervene') return e.settlement === R.city && e.b > 0 && (() => {
      const v = civ.interventions?.[e.war];
      return v?.kind === 'disaster' && v.type === 'plague';
    })();
    if (e.kind !== 'plague') return false;
    const r = civ.settlements[R.city].region;
    return e.region === r || ownersAt(civ, e.year).polity[r] === e.a;
  }
  // 地震水旱只有作者下的:看下令那条史事记的那一处(受灾的那几国各记一条 famine,记的是城最大的那一州,不一定是那一处),有州受灾才算
  if (p.type === 'quake') return R.region >= 0 && e.kind === 'intervene' && e.region === R.region && e.b > 0 && (() => {
    const v = civ.interventions?.[e.war];
    return v?.kind === 'disaster' && v.type === 'quake';
  })();
  if (e.kind !== 'famine' || e.cause === 'quake') return false;
  if (p.a !== undefined) return R.a >= 0 && e.a === R.a;
  if (!R.area.length) return false;
  if (R.area.includes(e.region)) return true;
  const o = ownersAt(civ, e.year).polity;
  return R.area.some((r) => o[r] === e.a);
}

/** 做不到:原因、说的是谁 */
interface Fail {
  reason: PlotReason;
  who?: 'a' | 'b';
}

/** 第 Y 年 a、b(情节里给了的)在不在 */
function bothThere(civ: Civ, p: Plot, R: Refs, Y: number): Fail | null {
  if (R.refFailed) return { reason: 'refFailed', who: R.refFailed };
  if (p.a !== undefined) {
    const r = presence(civ, R.a, Y);
    if (r) return { reason: r, who: 'a' };
  }
  if (p.b !== undefined) {
    const r = presence(civ, R.b, Y);
    if (r) return { reason: r, who: 'b' };
  }
  return null;
}

/**
 * 第 Y 年年初怎么硬改(S = 推到那一刻的历史;C = 推到窗口最后一年年底的,有人物时查人物用):
 * 硬改的干预(还没带 plot),或做不到的原因
 */
function planFix(ctx: Ctx, S: Civ, C: Civ, p: Plot, R: Refs, Y: number): Intervention[] | Fail {
  if (PLOT_CHECK_ONLY.includes(p.kind)) return bothThere(S, p, R, Y) ?? { reason: 'unsupported' };
  const miss = bothThere(S, p, R, Y);
  if (miss) return miss;
  const A = R.aKey!;
  const B = R.bKey!;
  switch (p.kind) {
    case 'found':
    case 'split': {
      if (R.region < 0) return { reason: 'missing' };
      if (S.culture[R.region] < 0) return { reason: 'empty' };
      if (p.kind === 'split' && p.a !== undefined && S.polity[R.region] !== R.a) return { reason: 'notOwned', who: 'a' };
      const region = regionKey(S, R.region);
      return [p.kind === 'found' && p.name ? { kind: 'found', region, from: Y, name: p.name } : { kind: 'found', region, from: Y }];
    }
    case 'fall':
      return [p.b !== undefined ? { kind: 'destroy', a: A, from: Y, b: B } : { kind: 'destroy', a: A, from: Y }];
    case 'hold': {
      if (!R.area.length) return { reason: 'missing' };
      const lived = R.area.filter((r) => S.culture[r] >= 0);
      if (!lived.length) return { reason: 'empty' };
      const lack = lived.filter((r) => S.polity[r] !== R.a);
      if (!lack.length) return { reason: 'noEffect' };
      return lack.map((r) => ({ kind: 'cede', a: A, region: regionKey(S, r), from: Y }));
    }
    case 'war':
      return [{ kind: 'declare', a: A, b: B, from: Y }];
    case 'ally':
      return [{ kind: 'ally', a: A, b: B, from: Y, until: Y + OUTLINE_ALLY_YEARS }];
    case 'capital': {
      if (R.city < 0) return { reason: 'missing' };
      const s = S.settlements[R.city];
      if (s.ended !== undefined && s.ended <= Y) return { reason: 'ruined' };
      if (S.polity[s.region] !== R.a) return { reason: 'notOwned', who: 'a' };
      if (capitalAt(S.polities[R.a], Y) === R.city) return { reason: 'noEffect' };
      return [{ kind: 'move', a: A, city: p.city!, from: Y }];
    }
    case 'death': {
      const id = resolvePersonKey(C, p.person!);
      const P = id >= 0 ? C.people?.[id] : undefined;
      const owner = parsePersonKey(p.person)!.polity;
      if (!P) return { reason: 'missing' };
      if (P.born > Y) return { reason: 'unborn' };
      if (P.died !== undefined && P.died < Y) return { reason: 'dead' };
      if (P.role === 'ruler' && !(P.from !== undefined && P.from <= Y && (P.until === undefined || P.until > Y))) return { reason: 'notReigning' };
      return [{ kind: 'death', a: owner, person: p.person!, from: Y }];
    }
    case 'crown': {
      const c = ctx.characters.find((x) => x.id === p.char);
      if (!c) return { reason: 'missing' };
      if (c.born > Y) return { reason: 'unborn' };
      if (c.died !== undefined && c.died <= Y) return { reason: 'dead' };
      const base = { kind: 'crown' as const, a: A, char: c.id, from: Y, born: c.born };
      return [c.died !== undefined ? { ...base, until: c.died, leanings: characterLeanings(c) } : { ...base, leanings: characterLeanings(c) }];
    }
    case 'disaster': {
      const level = p.level ?? 2;
      if (p.type === 'pandemic') {
        if (R.city < 0) return { reason: 'missing' };
        const s = S.settlements[R.city];
        if (s.ended !== undefined && s.ended <= Y) return { reason: 'ruined' };
        return [{ kind: 'disaster', type: 'pandemic', level, from: Y, city: p.city!, ...(p.slump !== undefined ? { slump: p.slump } : {}) }];
      }
      if (p.type === 'plague') {
        if (R.city < 0) return { reason: 'missing' };
        const s = S.settlements[R.city];
        if (s.ended !== undefined && s.ended <= Y) return { reason: 'ruined' };
        return [{ kind: 'disaster', type: 'plague', level, from: Y, city: p.city! }];
      }
      if (p.type === 'quake') return R.region < 0 ? { reason: 'missing' } : [{ kind: 'disaster', type: 'quake', level, from: Y, region: p.region! }];
      if (p.a !== undefined) return [{ kind: 'disaster', type: 'famine', level, from: Y, a: A }];
      return R.area.length ? [{ kind: 'disaster', type: 'famine', level, from: Y, regions: R.area.map((r) => regionKey(S, r)) }] : { reason: 'missing' };
    }
    default:
      return { reason: 'unsupported' };
  }
}

/** 硬改了没成:原因(宣战看两国那一刻是不是在打仗;别的说不清) */
function whyNot(civ: Civ, p: Plot, R: Refs, Y: number): Fail {
  if (p.kind === 'war' && R.a >= 0 && R.b >= 0) {
    const open = new Set<number>();
    for (const e of civ.annals) {
      if (e.year >= Y) break;
      if (e.kind === 'war' && ((e.a === R.a && e.b === R.b) || (e.a === R.b && e.b === R.a))) open.add(e.war);
      else if (e.kind === 'peace' || e.kind === 'fall') open.delete(e.war);
    }
    return { reason: open.size ? 'atWar' : 'border' };
  }
  return { reason: 'noEffect' };
}

/** 查一条情节(必要时顺着引、硬改),返回查完以后的样子(传进来的不改);中途叫停 = null */
async function step(ctx: Ctx, prev: State, pick: Pick): Promise<State | null> {
  const st: State = { snaps: prev.snaps.slice(), list: prev.list, floor: prev.floor, done: new Map(prev.done) };
  const { plot: p, lo, hi, at } = pick;
  /** 顺着引试了几版都没成 */
  let guides = 0;
  const put = (r: PlotReview) => {
    st.done.set(p.id, guides && (r.status === 'forced' || r.status === 'failed') ? { ...r, tried: guides } : r);
    if (r.status === 'natural' || r.status === 'guided' || r.status === 'forced') st.floor = Math.max(st.floor, r.year + 1);
    st.snaps = prune(st);
    return st;
  };
  const fail = (f: Fail, year = at): State => put({ id: p.id, status: 'failed', year, reason: f.reason, ...(f.who ? { who: f.who } : {}) });
  if (p.kind === 'story') return put({ id: p.id, status: 'story', year: at });
  // 大纲搬过来以后要填的几项对不上、还没重新指(edits.ts 文件头"要重新指")
  if (plotNeedsRedo(p)) return fail({ reason: 'redo' });
  if (lo > hi) return fail({ reason: 'beyond' });
  const Y = Math.max(at, st.floor);
  const canFix = !PLOT_CHECK_ONLY.includes(p.kind) && Y <= hi;
  const people = p.kind === 'death';
  const S = canFix ? advance(ctx, st, playStop(Y), false) : null;
  const C = advance(ctx, st, playStop(hi + 1), people);
  const R = refsOf(ctx, C, p, st.done);
  const got = happened(ctx, C, p, R, lo, hi);
  const polity = (civ: Civ, f: Found) => (f.polity !== undefined ? { polity: polityKey(civ, f.polity) } : {});
  if (got) return put({ id: p.id, status: 'natural', year: got.year, ...polity(C, got) });
  if (ctx.tries > 0 && GUIDE_KINDS.includes(p.kind) && !R.refFailed) {
    const g = await guide(ctx, st, pick);
    if (g === null) return null;
    if (typeof g === 'number') guides = g;
    else {
      st.list = g.list;
      st.snaps = g.snaps;
      return put({ id: p.id, status: 'guided', year: g.found.year, ...polity(g.civ, g.found) });
    }
  }
  if (!S) {
    if (PLOT_CHECK_ONLY.includes(p.kind)) return fail(bothThere(C, p, R, Math.min(Y, hi)) ?? { reason: 'unsupported' });
    return fail({ reason: 'crowded' });
  }
  const RS = refsOf(ctx, S, p, st.done);
  const plan = planFix(ctx, S, C, p, RS, Y);
  if (!Array.isArray(plan)) return fail(plan, Y);
  const fixes = plan.flatMap((v) => {
    const c = cleanIntervention(v);
    return c ? [{ ...c, plot: p.id }] : [];
  });
  if (!fixes.length) return fail({ reason: 'noEffect' }, Y);
  ctx.stage?.(p.id, Y);
  const tried: State = { ...st, list: [...st.list, ...fixes] };
  const C2 = advance(ctx, tried, playStop(hi + 1), people);
  // 硬改的去世只能写成"去世":再查时不看遇弑、战死
  const loose: Plot = p.kind === 'death' && p.how ? { ...p, how: undefined } : p;
  const got2 = happened(ctx, C2, loose, refsOf(ctx, C2, p, st.done), lo, hi);
  if (!got2) {
    // 没成:干预不留(试推出来的快照用不上了)
    return fail(whyNot(C, p, R, Y), Y);
  }
  st.list = tried.list;
  return put({ id: p.id, status: 'forced', year: got2.year, ...polity(C2, got2), ...(p.kind === 'death' && p.how ? { asDeath: true as const } : {}) });
}

// ---------------------------------------------------------------------------
// 顺着引

/**
 * 能顺着引的情节:灭国、占地、开战、结盟、称臣、议和(方针 + 国力);改朝换代、民变、大崩解(动荡)。
 * 分裂不引:说的是某一州自立,动荡只让整个国家更容易分裂,挑哪州起事看离心力(20 个种子里一条也没引成)
 */
const GUIDE_KINDS: readonly PlotKind[] = ['fall', 'hold', 'war', 'ally', 'submit', 'peace', 'dynasty', 'revolt', 'collapse'];
/** 从窗口头一年往前几年起引(引早了,事会在窗口之前就发生) */
const GUIDE_LEADS = [0, 10, 25, 50, 80];
/** 引多重:方针的滑条加减多少(满格 POLICY_KNOB_MAX);国力加两倍、减一样多(百分数,+40% / −20% 起),动荡加减一样多(满格见 civ/policy.ts 的 GUIDE_UNREST) */
const GUIDE_STRENGTHS = [20, 35, 50];
/** 窗口里每隔几年多看一眼(最多 GUIDE_LOOK_MAX 眼,窗口长了拉开) */
const GUIDE_LOOK_STEP = 5;
/** 灭国没说亡于谁:挑几个最大的邻国来引 */
const GUIDE_NEIGHBORS = 2;

/** 引一国:滑条加减多少、国力 / 动荡加减多少、仇国、亲国(国家键) */
interface GuideOne {
  a: string;
  war?: number;
  expand?: number;
  peace?: number;
  power?: number;
  unrest?: number;
  look?: GuideLook;
  foes?: string[];
  friends?: string[];
}

/** 一版引法:从哪年起(lead 年前)、多重、引谁(variant = targets 给的第几种)、轻重 */
interface GuidePlan {
  lead: number;
  s: number;
  variant: number;
  cost: number;
}

/** 起引那一刻的样子:那一刻的历史、认出来的国家、起引的年份 */
interface GuideAt {
  G: number;
  S: Civ;
  R: Refs;
}

/** 这条情节最多有几种"引谁"(实际几种看起引那一刻,见 targets) */
const variantsOf = (p: Plot) => (p.kind === 'fall' && p.b === undefined ? GUIDE_NEIGHBORS + 1 : 1);

/** 第 G 年这国最大的几个邻国(按州数) */
function neighborsOf(S: Civ, a: number, n: number): number[] {
  const { adjStart, adj, count } = S.regions;
  const size = new Map<number, number>();
  const near = new Set<number>();
  for (let r = 0; r < count; r++) {
    const o = S.polity[r];
    if (o >= 0) size.set(o, (size.get(o) ?? 0) + 1);
    if (o !== a) continue;
    for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
      const q = S.polity[adj[k]];
      if (q >= 0 && q !== a) near.add(q);
    }
  }
  return [...near].sort((x, y) => size.get(y)! - size.get(x)! || x - y).slice(0, n);
}

/** 第 G 年 a 的国土挨着这几州(含它自己的)里的一州 */
function touches(S: Civ, a: number, regions: Iterable<number>): boolean {
  const { adjStart, adj } = S.regions;
  for (const r of regions) {
    if (S.polity[r] === a) return true;
    for (let k = adjStart[r]; k < adjStart[r + 1]; k++) if (S.polity[adj[k]] === a) return true;
  }
  return false;
}

/** 第 G 年 b 的几州 */
function regionsOf(S: Civ, b: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < S.regions.count; r++) if (S.polity[r] === b) out.push(r);
  return out;
}

/** 那片地方第 G 年在谁手里(除了 a,按占的州数,最多 3 国) */
function holdersOf(S: Civ, a: number, area: readonly number[]): number[] {
  const n = new Map<number, number>();
  for (const r of area) {
    const o = S.polity[r];
    if (o >= 0 && o !== a) n.set(o, (n.get(o) ?? 0) + 1);
  }
  return [...n].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 3).map((x) => x[0]);
}

/**
 * 第 variant 种引法引谁、怎么引(力度 s;years = 窗口里替动手的那国多看一眼的那几年);这一刻没有这一种 = null。
 * 打仗的一方多看几眼邻国,大崩解的那国多看几眼内政,改朝换代的多看几眼王朝(称臣看打仗的那一方;结盟、议和、民变不多看)
 */
function targets(at: GuideAt, p: Plot, variant: number, s: number, years: number[]): GuideOne[] | null {
  const { S, R } = at;
  const war: GuideLook = { kind: 'war', years };
  const A = R.aKey!;
  const B = R.bKey!;
  const key = (id: number) => polityKey(S, id);
  // 开战、亡于某国、称臣、议和:两国得接壤(打仗只打邻国);占地:a 得挨着那片地方
  const near = (x: number, y: number) => touches(S, x, regionsOf(S, y));
  switch (p.kind) {
    case 'war':
      return near(R.a, R.b) ? [{ a: A, war: s, power: 2 * s, foes: [B], look: war }] : null;
    case 'fall': {
      // 亡于谁的那国更强、更想打它;它自己弱下去
      const weak = { a: A, power: -s };
      if (p.b !== undefined) return near(R.b, R.a) ? [{ a: B, war: s, expand: s, power: 2 * s, foes: [A], look: war }, weak] : null;
      const ns = neighborsOf(S, R.a, GUIDE_NEIGHBORS);
      const pick = variant < GUIDE_NEIGHBORS ? (ns[variant] !== undefined ? [ns[variant]] : []) : ns.length > 1 ? ns : [];
      return pick.length ? [...pick.map((n) => ({ a: key(n), war: s, expand: s, power: 2 * s, foes: [A], look: war })), weak] : null;
    }
    case 'hold': {
      if (!touches(S, R.a, R.area)) return null;
      const foes = holdersOf(S, R.a, R.area).map(key);
      return [{ a: A, war: s, expand: s, power: 2 * s, ...(foes.length ? { foes } : {}), look: war }];
    }
    case 'ally':
      return [
        { a: A, friends: [B] },
        { a: B, friends: [A] },
      ];
    case 'submit':
      if (!near(R.a, R.b)) return null;
      return [
        { a: B, war: s, power: 2 * s, foes: [A], look: war },
        { a: A, war: -s, peace: -s, power: -s },
      ];
    case 'peace':
      if (!near(R.a, R.b)) return null;
      return [
        { a: A, war: -s, peace: -s },
        { a: B, war: -s, peace: -s },
      ];
    case 'collapse':
      return [{ a: A, unrest: s, look: { kind: 'politics', years } }];
    case 'dynasty':
      return [{ a: A, unrest: s, look: { kind: 'dynasty', years } }];
    case 'revolt':
      return [{ a: A, unrest: s }];
    default:
      return null;
  }
}

/** 方针的旋钮加上 d,夹回 ±POLICY_KNOB_MAX */
const knob = (x: number | undefined, d: number | undefined) => Math.max(-POLICY_KNOB_MAX, Math.min(POLICY_KNOB_MAX, (x ?? 0) + (d ?? 0)));

/** 一国第 G 年起引之前真在照的、作者定的方针(那一刻的历史里生效了的,跳过顺着引出来的;没有 / 罢了 = null) */
function heldPolicy(S: Civ, a: string, G: number): PolicyIv | null {
  const r = resolveKey(S, a);
  const segs = r?.kind === 'polity' ? policiesFrom(S.annals, S.interventions).get(r.id) : undefined;
  for (let i = (segs?.length ?? 0) - 1; i >= 0; i--) {
    const v = segs![i].v;
    if (segs![i].t < G && !v.guide) return emptyPolicy(v) ? null : v;
  }
  return null;
}

/**
 * 一版引法的干预列表:每国在第 G 年定一条方针(那国当时真在照的自己的方针加上这版的加减,仇国、亲国添进去),
 * 第 E 年换回它(G、E 之间作者给它定过方针的不用换:那条会盖掉引的这条)。都带 plot、guide。
 * 前面情节引同一国、换回的那一刻落在 (G, E] 里的:那条挪到第 E 年当这次的换回(不然它会提前盖掉这次引的;
 * 原地改、不删,干预的下标不变。改了前面的,接不上快照,那一版从第 0 年推,结果一样,只是慢)
 */
function guideList(S: Civ, list: readonly Intervention[], who: readonly GuideOne[], p: Plot, G: number, E: number): Intervention[] {
  const add: Intervention[] = [];
  const tag = { plot: p.id, guide: true as const };
  const ours = new Set(who.map((g) => g.a));
  const moved = new Set<string>();
  const out = list.map((x) => {
    if (x.kind !== 'policy' || !x.guide || !ours.has(x.a) || !(x.from > G && x.from <= E)) return x;
    moved.add(x.a);
    return { ...x, from: E };
  });
  for (const g of who) {
    const base = heldPolicy(S, g.a, G);
    const foes = [...(g.foes ?? []), ...(base?.foes ?? []).filter((k) => !g.friends?.includes(k))];
    const friends = [...(g.friends ?? []), ...(base?.friends ?? []).filter((k) => !g.foes?.includes(k))];
    const v: Record<string, unknown> = { kind: 'policy', a: g.a, from: G, war: knob(base?.war, g.war), expand: knob(base?.expand, g.expand), coast: base?.coast, peace: knob(base?.peace, g.peace), foes, friends, focus: base?.focus, power: g.power, unrest: g.unrest, look: g.look, ...tag };
    const c = cleanIntervention(v);
    if (c) add.push(c);
    // 作者的方针按生效那一刻比(逐年推演年中下的,第 E 年第几格才生效:第 E 年年初照样要换回)
    if (moved.has(g.a) || list.some((x) => x.kind === 'policy' && x.a === g.a && !x.guide && commandAt(x) > ticksAt(G) && commandAt(x) <= ticksAt(E))) continue;
    // 换回的那条在第 E 年年初:原来那条是年中下的,它的第几格不抄
    const { plot: _p, guide: _g, fromTick: _t, ...back } = base ?? { kind: 'policy' as const, a: g.a, from: E };
    void _p;
    void _g;
    void _t;
    const r = cleanIntervention({ ...back, from: E, ...tag });
    if (r) add.push(r);
  }
  return add.length ? [...out, ...add] : [];
}

/**
 * 没自然发生的一条情节,一版版试着顺着引(见文件头"顺着引"):成了 = 那一版的干预列表、快照和查到的;
 * 都没成 = 试了几版(没得试 = 0);中途叫停 = null
 */
async function guide(ctx: Ctx, st: State, pick: Pick): Promise<{ list: Intervention[]; snaps: Snap[]; civ: Civ; found: Found } | number | null> {
  const { plot: p, lo, hi, at } = pick;
  const E = hi + 1;
  const plans: GuidePlan[] = [];
  const leads = new Set<number>();
  for (const lead of GUIDE_LEADS) {
    const G = Math.max(lo - lead, st.floor, 0);
    if (G > hi || leads.has(G)) continue;
    leads.add(G);
    const n = variantsOf(p);
    for (let variant = 0; variant < n; variant++) {
      // 引了几国(灭国另把亡的那国削弱)
      const many = p.kind === 'fall' ? (p.b === undefined && variant === GUIDE_NEIGHBORS ? GUIDE_NEIGHBORS : 1) + 1 : p.kind === 'ally' || p.kind === 'submit' || p.kind === 'peace' ? 2 : 1;
      // 结盟只添亲国,不分轻重
      for (const s of p.kind === 'ally' ? [GUIDE_STRENGTHS[0]] : GUIDE_STRENGTHS) plans.push({ lead: G, s, variant, cost: s * many * (E - G) });
    }
  }
  plans.sort((x, y) => x.cost - y.cost);
  const of = Math.min(ctx.tries, plans.length);
  // 多看几眼的那几年:窗口里每隔几年一眼;灭国从起引那年就看(得先打几仗才灭得了)
  const looks = (G: number) => {
    const from = p.kind === 'fall' ? G : lo;
    const step = Math.max(GUIDE_LOOK_STEP, Math.ceil((hi - from + 1) / GUIDE_LOOK_MAX));
    const years: number[] = [];
    for (let y = from; y <= hi && years.length < GUIDE_LOOK_MAX; y += step) if (y >= G) years.push(y);
    return years;
  };
  const ats = new Map<number, GuideAt | null>();
  const atOf = (G: number): GuideAt | null => {
    if (ats.has(G)) return ats.get(G)!;
    const S = advance(ctx, st, playStop(G), false);
    const R = refsOf(ctx, S, p, st.done);
    const ok = !bothThere(S, p, R, G) && R.aKey !== null && (p.b === undefined || R.bKey !== null) && (p.kind !== 'hold' || R.area.length > 0);
    const r = ok ? { G, S, R } : null;
    ats.set(G, r);
    return r;
  };
  let n = 0;
  for (const plan of plans) {
    if (n >= of) break;
    const g = atOf(plan.lead);
    const who = g && targets(g, p, plan.variant, plan.s, looks(g.G));
    if (!g || !who) continue;
    const list = guideList(g.S, st.list, who, p, g.G, E);
    if (!list.length) continue;
    n++;
    ctx.stage?.(p.id, null, { n, of });
    const tl: State = { ...st, snaps: st.snaps.slice(), list };
    const C = advance(ctx, tl, playStop(hi + 1), false);
    const found = happened(ctx, C, p, refsOf(ctx, C, p, st.done), lo, hi);
    if (found) return { list: tl.list, snaps: tl.snaps, civ: C, found };
    if (ctx.pause) await ctx.pause();
    if (ctx.stop()) return null;
  }
  return n;
}
