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
  PLOT_CHECK_ONLY,
  PLOT_SPAN_DEFAULT,
  cleanIntervention,
  cleanOutline,
  keyCells,
  ownInterventions,
  parsePersonKey,
  polityKey,
  regionKey,
  regionOfKey,
  resolveKey,
  resolvePersonKey,
  type AuthorMark,
  type Intervention,
  type Plot,
  type PlotReason,
  type PlotReview,
} from './edits';
import { characterLeanings, type AuthorCharacter } from './characters';

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
  /** 每条之间(和开始之前)问一次:true = 不推了,返回 null */
  stop?: () => boolean;
  /** 上一次的结果(没有 = 从头算) */
  cache?: OutlineCache | null;
  /** 这个世界、这组参数的键(和 cache 对得上才用;不给 = 不用上一次的) */
  key?: string;
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
}

/**
 * 照大纲推演。params = 推这个世界用的参数(推演年数在 params.endYear;干预不看,用 input.interventions)。
 * 中途叫停 = null
 */
export async function runOutline(world: World, params: Partial<CivParams>, input: OutlineInput, hooks: OutlineHooks = {}): Promise<OutlineResult | null> {
  const stop = hooks.stop ?? (() => false);
  const plots = cleanOutline({ plots: input.plots })?.plots ?? [];
  const own = ownInterventions(input.interventions.flatMap((v) => cleanIntervention(v) ?? []));
  const endYear = params.endYear ?? END_YEAR_DEFAULT;
  const ctx: Ctx = { world, params: { ...params, endYear }, endYear, plots, characters: input.characters ?? [], marks: input.marks ?? [] };
  const key = hooks.key === undefined ? null : `${hooks.key}|${JSON.stringify([own, endYear, ctx.characters, ctx.marks])}`;
  const prev = key !== null && hooks.cache?.key === key ? hooks.cache.steps : [];
  const steps: OutlineCache['steps'] = [];
  let st: State = { snaps: [], list: own, floor: 0, done: new Map() };
  let reuse = true;
  let reused = 0;
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
      st = step(ctx, st, pick);
    }
    steps.push({ sig, after: st });
    hooks.progress?.(st.done.size, plots.length, [...st.done.values()]);
    if (hooks.pause) await hooks.pause();
    if (stop()) return null;
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
      // 那几年里有一阵两国在盟(早先结的、作者下令的;窗口里散了的也算):查窗口头尾两年和作者下令结盟的那几年
      const at = [lo, hi];
      for (const v of civ.interventions ?? []) if (v.kind === 'ally' && v.from > lo && v.from <= hi) at.push(Math.ceil(v.from));
      for (const y of at) {
        if (!polityAlive(civ.polities[a], y) || !polityAlive(civ.polities[b], y)) continue;
        const x = polityTies(civ, a, y).allies.find((t) => t.id === b);
        if (x) return { year: Math.max(lo, Math.floor(x.since)) };
      }
      return null;
    }
    case 'capital':
      return a < 0 || R.city < 0 ? null : yearFound(findAnnal(civ, lo, hi, (e) => (e.kind === 'capital' || e.kind === 'dynasty') && e.a === a && e.settlement === R.city));
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
      const l = relationsAt(civ, hi).liege.get(a);
      return l && l.liege === b ? { year: Math.max(lo, Math.floor(l.since)) } : null;
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
  if (p.type === 'plague') {
    if (e.kind !== 'plague' || R.city < 0) return false;
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

/** 查一条情节(必要时硬改),返回查完以后的样子(传进来的不改) */
function step(ctx: Ctx, prev: State, pick: Pick): State {
  const st: State = { snaps: prev.snaps.slice(), list: prev.list, floor: prev.floor, done: new Map(prev.done) };
  const { plot: p, lo, hi, at } = pick;
  const put = (r: PlotReview) => {
    st.done.set(p.id, r);
    if (r.status === 'natural' || r.status === 'forced') st.floor = Math.max(st.floor, r.year + 1);
    st.snaps = prune(st);
    return st;
  };
  const fail = (f: Fail, year = at): State => put({ id: p.id, status: 'failed', year, reason: f.reason, ...(f.who ? { who: f.who } : {}) });
  if (p.kind === 'story') return put({ id: p.id, status: 'story', year: at });
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
