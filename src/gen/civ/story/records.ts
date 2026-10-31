/**
 * 世界之最(世界概览「之最」页):15 条"到这一年为止"的纪录 —— 谁保持、多少、从哪年起保持、历来换过谁。
 * 纯计算,只读推演记下的历史,不改历史。
 *
 * 年数(在位、寿数、掌权、国祚、存续、打仗)按起止的年份相减("1223–1274 在位"是 51 年,和写出来的年份对得上)。
 * 比法:每条纪录按"到这一年为止"的数比,大的保持;一样大的,先到这个数的保持,
 * 后到的只记"另有几位同为这个数"。同一个人、同一国、同一朝按编号认:改了国号、换了名字不算换人。
 *
 * 怎么算得快:除了"最大的城"(按这一年的人口),每条的数只增不减。所以按年往后扫一遍(recordBook):
 * 某一年只有数在这一年里变过的那几个(在位的君主、这一年打下州的将领……)才可能刷新纪录,别的不用看;
 * 扫出每条纪录换人的年份(纪录的沿革)。拨时间轴时只查表(recordsAt):保持者从沿革里找,
 * 数、并列的有几个现算(每条几千个,不到 1 毫秒)。同一份历史只扫一遍(按 civ.annals 缓存)。
 *
 * 时间的约定和国家页一样:"到 Y 年为止" = 第 Y 年那一刻,年份 ≤ Y 的事都算上;纪录换人记在换了以后的第一个整年。
 */
import type { Civ, Person, Year } from '../types';
import { Layer } from '../types';
import { CAPITAL_BOOST, GROWTH_A, annexedRemnants, dynastyTitle, polityName, populationAt } from '../growth';
import { peopleIndex } from './peopleInfo';
import { kidsOf } from './lineageInfo';
import { personName } from './peopleText';
import { regionLabel } from './display';
import { royalSeg } from '../regime';

/** 15 条纪录 */
export type RecordKey =
  | 'reign'
  | 'old'
  | 'took'
  | 'held'
  | 'serve'
  | 'regent'
  | 'kids'
  | 'dynasty'
  | 'realm'
  | 'big'
  | 'capitals'
  | 'war'
  | 'warTook'
  | 'flip'
  | 'city';

/** 三组,按这个顺序列 */
export const RECORD_GROUPS: readonly { name: string; keys: readonly RecordKey[] }[] = [
  { name: '人物', keys: ['reign', 'old', 'took', 'held', 'serve', 'regent', 'kids'] },
  { name: '王朝和国家', keys: ['dynasty', 'realm', 'big', 'capitals'] },
  { name: '战争和地方', keys: ['war', 'warTook', 'flip', 'city'] },
];

/** 纪录名 */
export const RECORD_TITLE: Record<RecordKey, string> = {
  reign: '在位最久的君主',
  old: '最长寿的君主',
  took: '攻下州最多的将领',
  held: '击退来攻最多的守将',
  serve: '历仕君主最多的名臣',
  regent: '掌实权最久的权臣',
  kids: '子嗣最多的君主',
  dynasty: '国祚最长的一朝',
  realm: '存续最久的国家',
  big: '疆域最大的国家',
  capitals: '迁都最多的国家',
  war: '打得最久的仗',
  warTook: '一场仗攻下州最多',
  flip: '易手最多的州',
  city: '最大的城',
};

/** 还没有人 / 国保持时那一条写什么 */
export const RECORD_NONE: Record<RecordKey, string> = {
  reign: '还没有君主',
  old: '还没有君主',
  took: '还没有将领攻下过州',
  held: '还没有守将击退过来攻',
  serve: '还没有名臣',
  regent: '还没有人掌过实权',
  kids: '还没有君主有子嗣',
  dynasty: '还没有王朝',
  realm: '还没有国家',
  big: '还没有国家',
  capitals: '还没有国家迁过都',
  war: '还没打过仗',
  warTook: '还没打过仗',
  flip: '还没有州易过手',
  city: '还没有城',
};

/** 数后面的单位("51 年""22 州");最大的城写人口(populationLabel),不用它 */
export const RECORD_UNIT: Record<RecordKey, string> = {
  reign: '年',
  old: '岁',
  took: '州',
  held: '次',
  serve: '位君主',
  regent: '年',
  kids: '子',
  dynasty: '年',
  realm: '年',
  big: '州',
  capitals: '次',
  war: '年',
  warTook: '州',
  flip: '回',
  city: '',
};

/** 纪录的保持者:一个人、一朝、一国、一场仗、一个州、一座城 */
export type RecordRef =
  | { kind: 'person'; id: number }
  | { kind: 'dynasty'; polity: number; dynasty: number; from: Year; to: Year }
  | { kind: 'polity'; id: number }
  | { kind: 'war'; war: number; a: number; b: number; from: Year; to: Year }
  | { kind: 'region'; id: number }
  | { kind: 'settlement'; id: number };

/** 并列时数保持者用的量词:几位(人)、几朝、几国、几场(仗)、几州、几座(城) */
export const RECORD_COUNTER: Record<RecordRef['kind'], string> = {
  person: '位',
  dynasty: '朝',
  polity: '国',
  war: '场',
  region: '州',
  settlement: '座',
};

/** 并列那一句:"另有 14 位同为 51 年""另有 3 国同为 2 次";value = 写好的数 */
export function tieNote(r: Pick<RecordAt, 'ref' | 'ties'>, value: string): string {
  return `另有 ${r.ties} ${RECORD_COUNTER[r.ref.kind]}同为 ${value}`;
}

/** 一条纪录在某一年的样子 */
export interface RecordAt {
  key: RecordKey;
  ref: RecordRef;
  /** 多少(取整;最大的城 = 人口,千人) */
  value: number;
  /** 这个数是哪一刻到的(疆域最大 = 鼎盛那一刻,易手最多 = 末次易手,迁都最多 = 末次迁都) */
  at: Year;
  /** 另有几个同为这个数(不算保持者;最大的城不算并列) */
  ties: number;
  /** 从哪年起归他(整年) */
  since: number;
  /** 到这一年为止换过几任(算上现在这位) */
  count: number;
  /** 上一任:被刷新时他的数 */
  prev?: { ref: RecordRef; value: number };
}

/** 历来的一任(新的在前) */
export interface RecordTenure {
  ref: RecordRef;
  /** 从哪年起保持(整年) */
  from: number;
  /** 哪年被刷新(还保持着 = undefined) */
  to?: number;
  /** 这一任到头时的数(还保持着 = 这一年的数) */
  value: number;
  /** 这个数是哪一刻到的(同 RecordAt.at) */
  at: Year;
  /** 刷新他的是谁(还保持着 = undefined) */
  by?: RecordRef;
}

/** 一条纪录:谁能比、各自的数怎么算、扫出来的沿革 */
interface Track {
  key: RecordKey;
  refs: RecordRef[];
  /** 第 i 个在 y 那一刻的数(取整;≤ 0 = 不算) */
  val: (i: number, y: Year) => number;
  /** 第 i 个第一次到 v 的那一刻 */
  reach: (i: number, v: number) => Year;
  /** 沿革:第 k 任是谁(refs 的下标)、从哪年起 */
  items: number[];
  from: number[];
  /** 算不算并列(最大的城不算) */
  ties: boolean;
}

export interface RecordBook {
  tracks: Map<RecordKey, Track>;
  /** 各州易手、各国州数用的是哪一份日志、到哪年(推演延长了要重扫) */
  endYear: Year;
}

/**
 * 逐年往后扫,扫出纪录换人的年份。每一段 [a, b] 是第 item 个的数可能变的时候
 * (在位的那些年、某一次攻下州的那一刻……;按 a 排好序)。某一年只比"上一任"和这一年里数可能变过的那几个。
 */
function sweep(segs: { a: number; b: number; i: number }[], val: Track['val'], reach: Track['reach'], end: number): { items: number[]; from: number[] } {
  const items: number[] = [];
  const from: number[] = [];
  segs.sort((x, y) => x.a - y.a || x.i - y.i);
  const m = segs.length;
  let H = -1;
  let p = 0;
  let act: number[] = [];
  const last = Math.floor(end);
  for (let y = m ? Math.max(0, Math.ceil(segs[0].a)) : last + 1; y <= last; y++) {
    while (p < m && segs[p].a <= y) act.push(p++);
    if (!act.length) {
      if (p >= m) break;
      y = Math.max(y, Math.ceil(segs[p].a) - 1);
      continue;
    }
    let best = H;
    let bv = H >= 0 ? val(H, y) : 0;
    let br = H >= 0 ? reach(H, bv) : Infinity;
    for (const k of act) {
      const i = segs[k].i;
      if (i === best) continue;
      const v = val(i, y);
      if (v <= 0 || v < bv) continue;
      if (v > bv) {
        best = i;
        bv = v;
        br = reach(i, v);
        continue;
      }
      const r = reach(i, v);
      // 同一刻到的:原来的保持者不让;新来的几个之间按编号
      if (r < br || (r === br && best !== H && i < best)) {
        best = i;
        br = r;
      }
    }
    if (best !== H) {
      items.push(best);
      from.push(y);
      H = best;
    }
    const keep: number[] = [];
    for (const k of act) if (segs[k].b > y) keep.push(k);
    act = keep;
  }
  return { items, from };
}

/** 数按"从 base 那年起算到 y 那年,不过 end 那年;elig 那一刻起才算"长的一类(在位、寿数、国祚、存续、打仗) */
function spanTrack(key: RecordKey, refs: RecordRef[], elig: number[], base: number[], endAt: number[], end: Year): Track {
  const val = (i: number, y: Year) => (elig[i] <= y ? Math.floor(Math.min(endAt[i], y)) - Math.floor(base[i]) : 0);
  const reach = (i: number, v: number) => Math.max(elig[i], Math.floor(base[i]) + v);
  const segs = refs.map((_, i) => ({ a: elig[i], b: endAt[i], i }));
  return { key, refs, val, reach, ...sweep(segs, val, reach, end), ties: true };
}

/** 数一次一次往上加的一类(攻下州、击退来攻、子嗣、迁都、易手……):steps[i] = 第 i 个每次加的那一刻、加完是几(按先后) */
function stepTrack(key: RecordKey, refs: RecordRef[], steps: { t: number[]; v: number[] }[], end: Year): Track {
  const val = (i: number, y: Year) => {
    const { t, v } = steps[i];
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo ? v[lo - 1] : 0;
  };
  const reach = (i: number, v: number) => {
    const s = steps[i];
    for (let k = 0; k < s.t.length; k++) if (s.v[k] >= v) return s.t[k];
    return Infinity;
  };
  const segs: { a: number; b: number; i: number }[] = [];
  steps.forEach((s, i) => s.t.forEach((t) => segs.push({ a: t, b: t, i })));
  return { key, refs, val, reach, ...sweep(segs, val, reach, end), ties: true };
}

/** 把一串"哪一刻加了一"(可以没排好序)排成 stepTrack 要的样子 */
function countSteps(times: number[]): { t: number[]; v: number[] } {
  const t = [...times].sort((a, b) => a - b);
  return { t, v: t.map((_, k) => k + 1) };
}

const cache = new WeakMap<object, RecordBook & { people: number; annals: number; polities: number }>();

/** 整理一遍世界之最(同一份历史只整理一次) */
export function recordBook(civ: Civ): RecordBook {
  const key = civ.annals;
  const hit = cache.get(key);
  const people = civ.people?.length ?? 0;
  if (hit && hit.endYear === civ.endYear && hit.people === people && hit.annals === civ.annals.length && hit.polities === civ.polities.length) return hit;
  const end = civ.endYear;
  const tracks = new Map<RecordKey, Track>();
  const add = (t: Track) => tracks.set(t.key, t);
  const P = civ.people ?? [];
  const ix = peopleIndex(civ);
  const A = civ.annals;
  const pers = (x: Person): RecordRef => ({ kind: 'person', id: x.id });

  // ---- 人物 ----
  const rulers = P.filter((x) => x.role === 'ruler' && x.from !== undefined && x.polity >= 0 && x.polity < civ.polities.length);
  add(
    spanTrack(
      'reign',
      rulers.map(pers),
      rulers.map((x) => x.from!),
      rulers.map((x) => x.from!),
      rulers.map((x) => x.until ?? Infinity),
      end,
    ),
  );
  // 作者立的君主不写卒年(生死归人物卡管),寿数不比
  const mortal = rulers.filter((x) => x.author === undefined);
  add(
    spanTrack(
      'old',
      mortal.map(pers),
      mortal.map((x) => x.from!),
      mortal.map((x) => x.born),
      mortal.map((x) => x.died ?? Infinity),
      end,
    ),
  );
  // 将领(含领过兵的宗室):他领兵时本国攻下的州、他守的战役打退几次(和人物卡上同一个数)
  const generals = ix.generals.flat();
  const took: { t: number[]; v: number[] }[] = [];
  const held: { t: number[]; v: number[] }[] = [];
  for (const x of generals) {
    const tk: number[] = [];
    const hd: number[] = [];
    for (const c of x.commands ?? []) {
      for (let i = Math.max(0, c.first); i <= c.last && i < A.length; i++) {
        const e = A[i];
        if (e.war !== c.war) continue;
        if (e.kind === 'conquer' && e.a === x.polity) tk.push(e.year);
        if (e.kind === 'battle' && e.b === x.polity) hd.push(e.year);
      }
    }
    took.push(countSteps(tk));
    held.push(countSteps(hd));
  }
  add(stepTrack('took', generals.map(pers), took, end));
  add(stepTrack('held', generals.map(pers), held, end));
  // 名臣:在朝时本国换过几位君主(入朝时在位的那位算第一位)
  const ministers = ix.ministers.flat().filter((x) => x.from !== undefined);
  add(
    stepTrack(
      'serve',
      ministers.map(pers),
      ministers.map((x) => {
        const to = x.until ?? Infinity;
        const ts: number[] = [];
        for (const r of ix.rulers[x.polity] ?? []) {
          if (r.from === undefined || !(r.from < to) || !((r.until ?? Infinity) > x.from!)) continue;
          ts.push(Math.max(x.from!, r.from));
        }
        return countSteps(ts);
      }),
      end,
    ),
  );
  // 掌实权的几段加起来
  const regents = P.filter((x) => x.regencies?.length);
  const segsOf = regents.map((x) => x.regencies!.map((g) => [g.from, g.until ?? Infinity] as const).sort((a, b) => a[0] - b[0]));
  {
    const val = (i: number, y: Year) => {
      let s = 0;
      for (const [a, b] of segsOf[i]) if (a <= y) s += Math.floor(Math.min(b, y)) - Math.floor(a);
      return s;
    };
    const reach = (i: number, v: number) => {
      let s = 0;
      for (const [a, b] of segsOf[i]) {
        const n = Math.floor(b) - Math.floor(a);
        if (s + n >= v) return Math.max(a, Math.floor(a) + (v - s));
        s += n;
      }
      return Infinity;
    };
    const segs = segsOf.flatMap((gs, i) => gs.map(([a, b]) => ({ a, b, i })));
    add({ key: 'regent', refs: regents.map(pers), val, reach, ...sweep(segs, val, reach, end), ties: true });
  }
  // 子嗣:做了君主以后算,出生在这年以前的儿子
  add(
    stepTrack(
      'kids',
      rulers.map(pers),
      rulers.map((x) => countSteps(kidsOf(civ, x).map((k) => Math.max(x.from!, k.born)))),
      end,
    ),
  );

  // ---- 王朝和国家 ----
  const dyn: RecordRef[] = [];
  for (const p of civ.polities) {
    if (p.lineage === 'republic') continue;
    const ds = p.dynasties?.length ? p.dynasties : [{ year: p.founded }];
    ds.forEach((d, i) => {
      if (!royalSeg(p, i)) return;
      const from = i === 0 ? p.founded : d.year;
      const to = Math.min(ds[i + 1]?.year ?? Infinity, p.ended ?? Infinity);
      if (to > from) dyn.push({ kind: 'dynasty', polity: p.id, dynasty: i, from, to });
    });
  }
  const dspan = (r: RecordRef) => (r.kind === 'dynasty' ? r : { from: 0, to: 0 });
  add(
    spanTrack(
      'dynasty',
      dyn,
      dyn.map((r) => dspan(r).from),
      dyn.map((r) => dspan(r).from),
      dyn.map((r) => dspan(r).to),
      end,
    ),
  );
  const pols = civ.polities;
  const polRefs = pols.map((p): RecordRef => ({ kind: 'polity', id: p.id }));
  add(
    spanTrack(
      'realm',
      polRefs,
      pols.map((p) => p.founded),
      pols.map((p) => p.founded),
      pols.map((p) => p.ended ?? Infinity),
      end,
    ),
  );
  // 各国州数(国家层;按整年看,和国家页「州」一列同一个数:一年里的变化全生效以后才数)、各州易手:从头翻一遍变化日志
  const L = civ.log;
  let R = civ.regions.count;
  for (let k = 0; k < L.size; k++) R = Math.max(R, L.region[k] + 1);
  const owner = new Int16Array(R).fill(-1);
  const size = new Int32Array(pols.length);
  const peak = new Int32Array(pols.length);
  const bigSteps = pols.map(() => ({ t: [] as number[], v: [] as number[] }));
  const flips: number[][] = Array.from({ length: R }, () => []);
  // 这一年里这国的州数最后一次变的那一刻(鼎盛记在那一刻:写"哪年鼎盛"是那件事的年份,到下一个整年国家页上就是这么多州)
  const lastT = new Float64Array(pols.length);
  for (let k = 0; k < L.size; ) {
    const y = Math.ceil(L.year[k]);
    const touched: number[] = [];
    for (; k < L.size && L.year[k] <= y; k++) {
      if (L.layer[k] !== Layer.Polity) continue;
      const r = L.region[k];
      const v = L.value[k];
      const o = owner[r];
      if (o === v) continue;
      if (o >= 0) {
        flips[r].push(L.year[k]);
        if (o < pols.length) {
          size[o]--;
          lastT[o] = L.year[k];
        }
      }
      owner[r] = v;
      if (v >= 0 && v < pols.length) {
        size[v]++;
        lastT[v] = L.year[k];
        touched.push(v);
      }
    }
    for (const p of touched) {
      if (size[p] > peak[p]) {
        peak[p] = size[p];
        bigSteps[p].t.push(lastT[p]);
        bigSteps[p].v.push(size[p]);
      }
    }
  }
  add(stepTrack('big', polRefs, bigSteps, end));
  add(
    stepTrack(
      'capitals',
      polRefs,
      pols.map((p) => countSteps((p.capitals ?? []).slice(1).map((c) => c.year))),
      end,
    ),
  );

  // ---- 战争和地方 ----
  // 一场仗:宣战到议和;没议和就有一方亡了的,到亡国那一刻;到现在还在打的一直算。
  // 攻下几州只数打下来的:议和时割让的、亡国时一并归过去的残部不算(和推演里给每一仗排统帅时一样,见 people.ts 的 warsOf)
  const ceded = new Set<number>();
  A.forEach((e, i) => {
    if (e.kind === 'peace' && e.region > 0) {
      for (let j = Math.max(0, i - e.region); j < i; j++) if (A[j].kind === 'conquer' && A[j].war === e.war) ceded.add(j);
    } else if (e.kind === 'fall' && e.war >= 0) for (const j of annexedRemnants(civ, i)) ceded.add(j);
  });
  const wars: (RecordRef & { kind: 'war' })[] = [];
  const warTook: number[][] = [];
  const byWar = new Map<number, number>();
  for (let i = 0; i < A.length; i++) {
    const e = A[i];
    if (e.kind === 'war' && !byWar.has(e.war)) {
      const to = Math.min(pols[e.a]?.ended ?? Infinity, pols[e.b]?.ended ?? Infinity);
      byWar.set(e.war, wars.length);
      wars.push({ kind: 'war', war: e.war, a: e.a, b: e.b, from: e.year, to });
      warTook.push([]);
    } else if (e.kind === 'peace') {
      const w = byWar.get(e.war);
      if (w !== undefined && wars[w].to > e.year) wars[w].to = Math.max(wars[w].from, e.year);
    } else if (e.kind === 'conquer' && !ceded.has(i)) {
      const w = byWar.get(e.war);
      if (w !== undefined) warTook[w].push(e.year);
    }
  }
  add(
    spanTrack(
      'war',
      wars,
      wars.map((w) => w.from),
      wars.map((w) => w.from),
      wars.map((w) => w.to),
      end,
    ),
  );
  add(stepTrack('warTook', wars, warTook.map(countSteps), end));
  const regRefs = flips.map((_, r): RecordRef => ({ kind: 'region', id: r }));
  add(stepTrack('flip', regRefs, flips.map(countSteps), end));
  add(cityTrack(civ, end));

  const book = { tracks, endYear: end, people, annals: civ.annals.length, polities: civ.polities.length };
  cache.set(key, book);
  return book;
}

/**
 * 最大的城:这一年人口最多的城(人口有涨有落,不是只增不减):逐年比。人口 = 上限 × 生产能力倍数 × 国都加成 × 洗劫后剩下的 ÷ S 形成长,
 * 后三样都不超过 1(国都加成立都以前没有),所以"最大的上限 × 最大的倍数 × 国都加成 × S 形"是它的上界。
 * 还在的城按上界从大到小看,上界比这一年已经找到的还小就不用算它的人口;S 形那一项算出哪年以前都追不上,那几年直接跳过
 */
function cityTrack(civ: Civ, end: Year): Track {
  const S = civ.settlements;
  const n = S.length;
  const refs = S.map((s): RecordRef => ({ kind: 'settlement', id: s.id }));
  const boost = 1 + CAPITAL_BOOST;
  const top = new Float64Array(n);
  const ub = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = S[i];
    let cap = s.capacity;
    for (const r of s.reshaped ?? []) cap = Math.max(cap, r.capacity);
    let dev = 1;
    const dc = s.devCap;
    if (dc) for (let k = 1; k < dc.length; k += 2) dev = Math.max(dev, dc[k]);
    // 留一点余量:人口里的 e 指数是舍入到 24 位的
    top[i] = cap * dev * 1.000001;
    ub[i] = top[i] * (s.capitalFrom !== undefined ? boost : 1);
  }
  const before = (a: number, b: number) => ub[b] - ub[a] || a - b;
  const starts = S.map((_, i) => i).sort((a, b) => S[a].founded - S[b].founded || a - b);
  const ends = S.map((_, i) => i)
    .filter((i) => S[i].ended !== undefined)
    .sort((a, b) => S[a].ended! - S[b].ended! || a - b);
  const alive: number[] = [];
  const isAlive = new Uint8Array(n);
  const place = (i: number) => {
    let lo = 0;
    let hi = alive.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (before(alive[mid], i) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const skipTo = new Float64Array(n);
  const skipAt = new Float64Array(n);
  const val = (i: number, y: Year) => populationAt(S[i], y);
  const items: number[] = [];
  const from: number[] = [];
  let H = -1;
  let sp = 0;
  let ep = 0;
  for (let y = n ? Math.max(0, Math.ceil(S[starts[0]].founded)) : Infinity; y <= Math.floor(end); y++) {
    for (; sp < n && S[starts[sp]].founded <= y; sp++) {
      const i = starts[sp];
      if (S[i].ended !== undefined && S[i].ended! <= y) continue;
      alive.splice(place(i), 0, i);
      isAlive[i] = 1;
    }
    for (; ep < ends.length && S[ends[ep]].ended! <= y; ep++) {
      const i = ends[ep];
      if (!isAlive[i]) continue;
      alive.splice(alive.indexOf(i), 1);
      isAlive[i] = 0;
    }
    let best = H >= 0 && isAlive[H] ? H : -1;
    let bv = best >= 0 ? populationAt(S[best], y) : 0;
    for (const i of alive) {
      if (ub[i] <= bv) break;
      if (i === best || (y < skipTo[i] && bv >= skipAt[i])) continue;
      const s = S[i];
      const capital = s.capitalFrom !== undefined && y > s.capitalFrom;
      const cap = top[i] * (capital ? boost : 1);
      if (cap <= bv) continue;
      if (cap / (1 + GROWTH_A * Math.exp(-s.growth * (y - s.founded))) <= bv) {
        // S 形到哪年才可能超过 bv(立都那年加成要上去,不跳过它)
        let t = s.growth > 0 ? Math.floor(s.founded + Math.log((GROWTH_A * bv) / (cap - bv)) / s.growth) : Infinity;
        if (!capital && s.capitalFrom !== undefined) t = Math.min(t, Math.floor(s.capitalFrom));
        skipTo[i] = t;
        skipAt[i] = bv;
        continue;
      }
      const v = populationAt(s, y);
      if (v > bv) {
        best = i;
        bv = v;
      }
    }
    if (best >= 0 && bv > 0 && best !== H) {
      items.push(best);
      from.push(y);
      H = best;
    }
  }
  return { key: 'city', refs, val, reach: () => -Infinity, items, from, ties: false };
}

/** 第 y 年那一任在沿革里的下标(还没有 = −1) */
function tenureAt(t: Track, y: number): number {
  let lo = 0;
  let hi = t.from.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t.from[mid] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * 沿革里第 k 任被刷新时他的数:下一任到他那个数的前一刻(同一年里先后到的,不按年底算,免得写成"破了某某的 6 位君主"却也是 6 位);
 * 最大的城按换人那一年的人口
 */
function brokenValue(t: Track, k: number): number {
  const i = t.items[k];
  const at = t.from[k + 1];
  if (t.key === 'city') return t.val(i, at);
  const next = t.items[k + 1];
  const rt = t.reach(next, t.val(next, at));
  return t.val(i, Math.min(at, rt - 1e-6));
}

/** 某一年(取整)的各条纪录;还没有人保持的 = null */
export function recordsAt(book: RecordBook, year: number): Map<RecordKey, RecordAt | null> {
  const y = Math.floor(year);
  const out = new Map<RecordKey, RecordAt | null>();
  for (const [key, t] of book.tracks) {
    const k = tenureAt(t, y);
    if (k < 0) {
      out.set(key, null);
      continue;
    }
    const i = t.items[k];
    const value = t.val(i, y);
    if (!(value > 0)) {
      out.set(key, null);
      continue;
    }
    let ties = 0;
    if (t.ties) for (let j = 0; j < t.refs.length; j++) if (j !== i && t.val(j, y) === value) ties++;
    const rec: RecordAt = { key, ref: t.refs[i], value, at: t.reach(i, value), ties, since: t.from[k], count: k + 1 };
    if (k > 0) {
      const p = t.items[k - 1];
      rec.prev = { ref: t.refs[p], value: brokenValue(t, k - 1) };
    }
    out.set(key, rec);
  }
  return out;
}

/** 一条纪录到这一年为止历来的保持者,新的在前 */
export function recordHistory(book: RecordBook, key: RecordKey, year: number): RecordTenure[] {
  const t = book.tracks.get(key);
  if (!t) return [];
  const y = Math.floor(year);
  const k = tenureAt(t, y);
  const out: RecordTenure[] = [];
  for (let j = k; j >= 0; j--) {
    const i = t.items[j];
    const to = j < k ? t.from[j + 1] : undefined;
    const value = to !== undefined ? brokenValue(t, j) : t.val(i, y);
    out.push({ ref: t.refs[i], from: t.from[j], to, value, at: t.reach(i, value), by: j < k ? t.refs[t.items[j + 1]] : undefined });
  }
  return out;
}

/** 保持者的名字(不带身份;人物和人物卡上一样写,国名按那时的国号) */
export function recordName(civ: Civ, ref: RecordRef, at: Year): string {
  const pols = civ.polities;
  switch (ref.kind) {
    case 'dynasty': {
      const p = pols[ref.polity];
      return dynastyTitle(p, ref.dynasty) || polityName(p, Math.min(ref.to, at) - 1 / 512);
    }
    case 'polity': {
      const p = pols[ref.id];
      return polityName(p, Math.max(p.founded, Math.min(p.ended ?? Infinity, at) - 1 / 512));
    }
    case 'war':
      return `${pols[ref.a] ? polityName(pols[ref.a], ref.from) : '无主之地'}伐${pols[ref.b] ? polityName(pols[ref.b], ref.from) : '无主之地'}`;
    case 'settlement':
      return civ.settlements[ref.id]?.name ?? '';
    case 'region':
      return regionLabel(civ, ref.id);
    case 'person': {
      const x = civ.people?.[ref.id];
      return x ? personName(civ, x) : '';
    }
  }
}
