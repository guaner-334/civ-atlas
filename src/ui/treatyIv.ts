/**
 * 干预「立约」「划中立地」两页(TreatyPage.tsx)的数据和说法:
 *
 *   - 中立地放哪(推荐几处):和推演里几国共建中立地挑州是同一套(gen/civ/treaties.ts 的 pickZone)——
 *     一州在陆上碰到的国家越多越靠前;一样多时挨着几国交界的关隘的在前;再一样时有城的在前、人少的在前。
 *     只挑下令那国碰得到的州(它自己的州,或者挨着它的别国的州、无主之地),要碰到两国以上;有人住、不是国都、还不是中立地,
 *     原主划出去以后还剩不止两州
 *   - 居间默认挑谁:不在约里、至少和其中两国陆上接壤、州最多的那国(推演里按国力挑,这里按州数估)
 *   - 填写页底下"编年史"那一句预览
 *   - 地图上推荐那几处的名牌(ZonePlates,TargetPlates.tsx 摆):这一页开着时登记,关了收起
 */
import { useSyncExternalStore } from 'react';
import { AdjKind, type Civ, type Year } from '../gen/civ/types';
import type { World } from '../gen/world';
import { capitalAt, polityAlive, populationAt, regionPopulationAt } from '../gen/civ/growth';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { regionLabel } from '../gen/civ/story/display';
import { regionPasses } from '../gen/civ/passes';
import { cnNumber } from '../gen/civ/story/chronicle';
import { treatiesOfAt, treatyMembersAt, treatyTitle, type TreatyInfo } from '../gen/civ/story/treatyInfo';
import { nameAt } from './Interventions';
import { nationsWord, zoneOfRegionAt } from './treatyRows';

const land = (k: number) => k === AdjKind.Flat || k === AdjKind.River || k === AdjKind.Mountain;

let owners: Owners | undefined;
/** year 那一刻各州归谁(国家;−1 = 无主)、住着哪族(−1 = 没人住);拷贝 */
function ownersOfYear(civ: Civ, year: Year): { polity: Int16Array; culture: Int16Array } {
  owners = ownersAt(civ, year, owners);
  return { polity: Int16Array.from(owners.polity), culture: Int16Array.from(owners.culture) };
}

/** 推荐的一处中立地 */
export interface ZoneChoice {
  region: number;
  /** 那州原属哪国(−1 = 无主之地) */
  owner: number;
  /** 碰到的国家(连同主人):下令的那国在最前,其余按编号 */
  touch: number[];
  /** 挨着几国交界的关隘;关隘的名字(没起名 = 空串) */
  pass: boolean;
  passName: string;
  /** 和别国之间要翻山 */
  climb: boolean;
}

/**
 * 州 r 能不能做下令那国 a 的中立地、碰到哪几国(不能 = null):有人住、不是国都、还不是中立地、原主还剩不止两州;
 * 碰到的国家(陆上)要有 a、至少两国。only = 只算这几国(立约那页:碰到约里的几国)
 */
export function zoneChoiceAt(civ: Civ, world: World, a: number, r: number, year: Year, only?: readonly number[]): ZoneChoice | null {
  const reg = civ.regions;
  if (r < 0 || r >= reg.count) return null;
  const own = ownersOfYear(civ, year);
  return choiceOf(civ, world, own, sizesOf(own.polity), a, r, year, only);
}

function sizesOf(own: Int16Array): Map<number, number> {
  const n = new Map<number, number>();
  for (const o of own) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  return n;
}

function choiceOf(
  civ: Civ,
  world: World,
  own: { polity: Int16Array; culture: Int16Array },
  size: Map<number, number>,
  a: number,
  r: number,
  year: Year,
  only?: readonly number[],
): ZoneChoice | null {
  const reg = civ.regions;
  const o = own.polity[r];
  if (own.culture[r] < 0 || zoneOfRegionAt(civ, r, year)) return null;
  if (o >= 0) {
    const P = civ.polities[o];
    if (!P || (size.get(o) ?? 0) <= 2 || civ.settlements[capitalAt(P, year)]?.region === r) return null;
    if (only && !only.includes(o)) return null;
  }
  const ok = (q: number) => q >= 0 && (!only || only.includes(q));
  const got = new Set<number>();
  if (ok(o)) got.add(o);
  let climb = false;
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
    if (!land(reg.adjKind[k])) continue;
    const q = own.polity[reg.adj[k]];
    if (!ok(q)) continue;
    got.add(q);
    if (q !== o && reg.adjKind[k] === AdjKind.Mountain) climb = true;
  }
  if (!got.has(a) || got.size < 2) return null;
  // 挨着几国交界的关隘(这州的主人和对面的国家不是同一国,对面是碰到的那几国之一)
  const gate = regionPasses(world, reg);
  let pass = false;
  let passName = '';
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1] && !pass; k++) {
    const q = own.polity[reg.adj[k]];
    if (gate[k] < 0 || !land(reg.adjKind[k]) || q < 0 || q === o || !got.has(q)) continue;
    pass = true;
    passName = civ.places.find((pl) => pl.kind === 'pass' && pl.cell === gate[k])?.name ?? '';
  }
  const touch = [a, ...[...got].filter((q) => q !== a).sort((x, y) => x - y)];
  return { region: r, owner: o, touch, pass, passName, climb };
}

/** 州 r 里那一刻还在的城(没有 = −1) */
function cityIn(civ: Civ, r: number, year: Year): number {
  for (const s of civ.settlements) if (s.region === r && s.founded <= year && (s.ended === undefined || s.ended > year)) return s.id;
  return -1;
}

/**
 * 下令那国 a 在 year 那一刻推荐的几处中立地(最多 max 处,按推荐先后;见文件头)。
 * only = 只算这几国(立约那页同时划中立地:碰到约里的几国越多越靠前)
 */
export function zoneChoices(civ: Civ, world: World, a: number, year: Year, max = 4, only?: readonly number[]): ZoneChoice[] {
  const reg = civ.regions;
  const own = ownersOfYear(civ, year);
  const size = sizesOf(own.polity);
  // 候选:a 的州,和挨着它的州
  const cands = new Set<number>();
  for (let r = 0; r < reg.count; r++) {
    if (own.polity[r] !== a) continue;
    cands.add(r);
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (land(reg.adjKind[k])) cands.add(reg.adj[k]);
  }
  const out: { c: ZoneChoice; s: number[] }[] = [];
  for (const r of cands) {
    const c = choiceOf(civ, world, own, size, a, r, year, only);
    if (!c) continue;
    const city = cityIn(civ, r, year);
    const pop = city >= 0 ? populationAt(civ.settlements[city], year) : regionPopulationAt(civ, r, year);
    out.push({ c, s: [c.touch.length, c.pass ? 1 : 0, city >= 0 ? 1 : 0, -pop, -reg.seat[r]] });
  }
  out.sort((x, y) => {
    for (let i = 0; i < x.s.length; i++) if (x.s[i] !== y.s[i]) return y.s[i] - x.s[i];
    return 0;
  });
  return out.slice(0, max).map((x) => x.c);
}

/** 国家 p 那一刻的名字 */
const pn = (civ: Civ, p: number, year: Year) => (civ.polities[p] ? nameAt(civ.polities[p], year) : '某国');

/**
 * 推荐那一行的说法:"渭国的州。渭国、大羽王朝、后乾衍国三国交界，挨着丹枫关" / "大羽王朝的州。三国交界，要翻山" /
 * "无主之地。后景罗国、太元皇朝两国交界，不用谁让地"(full = 写出是哪几国)
 */
export function zoneChoiceText(civ: Civ, c: ZoneChoice, year: Year, full: boolean): string {
  const whose = c.owner >= 0 ? `${pn(civ, c.owner, year)}的州` : '无主之地';
  const names = full || c.owner < 0 ? c.touch.map((p) => pn(civ, p, year)).join('、') : '';
  const tail = c.pass ? `，挨着${c.passName || '隘口'}` : c.climb ? '，要翻山' : '';
  return `${whose}。${names}${nationsWord(c.touch.length)}交界${tail}${c.owner < 0 ? '，不用谁让地' : ''}`;
}

/** 地图上名牌的小字:"三国交界，挨着隘口" / "无主，两国交界" */
export function zonePlateText(c: ZoneChoice): string {
  return `${c.owner < 0 ? '无主，' : ''}${nationsWord(c.touch.length)}交界${c.pass ? '，挨着隘口' : ''}`;
}

/** 居间默认挑谁:不在约里、至少和其中两国陆上接壤、州最多的那国(没有 = −1) */
export function mediatorFor(civ: Civ, parties: readonly number[], year: Year): number {
  if (parties.length < 2) return -1;
  const reg = civ.regions;
  const own = ownersOfYear(civ, year).polity;
  const size = sizesOf(own);
  const touch = new Map<number, Set<number>>();
  for (let r = 0; r < reg.count; r++) {
    const o = own[r];
    if (o < 0 || parties.includes(o)) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const q = own[reg.adj[k]];
      if (!land(reg.adjKind[k]) || !parties.includes(q)) continue;
      let s = touch.get(o);
      if (!s) touch.set(o, (s = new Set()));
      s.add(q);
    }
  }
  let best = -1;
  for (const [o, s] of touch) {
    if (s.size < 2 || !polityAlive(civ.polities[o], year)) continue;
    if (best < 0 || (size.get(o) ?? 0) > (size.get(best) ?? 0) || ((size.get(o) ?? 0) === (size.get(best) ?? 0) && o < best)) best = o;
  }
  return best;
}

/** 这几国那一刻同在、还没设过中立地的一份约(划中立地依它设,和推演里一样;没有 = null) */
export function sharedTreaty(civ: Civ, founders: readonly number[], year: Year): TreatyInfo | null {
  if (founders.length < 2) return null;
  for (const x of treatiesOfAt(civ, founders[0], year)) {
    if (x.zone >= 0) continue;
    const ms = treatyMembersAt(civ, x, year);
    if (founders.every((p) => ms.includes(p))) return x;
  }
  return null;
}

/** 州 r 里的城名(没有城 = 州名;让出的写城名,和编年史一样) */
function placeOf(civ: Civ, r: number, year: Year): string {
  const s = cityIn(civ, r, year);
  return s >= 0 ? civ.settlements[s].name || regionLabel(civ, r) : regionLabel(civ, r);
}

/** 立约那页底下的预览:"渭国与大羽王朝、后乾衍国立约，互不侵犯，各守今疆，以三十年为期；拉文海姆王国居间。三国以星河域为中立地。" */
export function treatyPreview(
  civ: Civ,
  o: { a: number; ps: readonly number[]; limited: boolean; term: number; keep: boolean; by: number; zone: number },
  year: Year,
): string {
  const others = o.ps.map((p) => pn(civ, p, year)).join('、');
  const what = o.limited ? '互不侵犯，各守今疆' : '互不侵犯';
  const span = o.term > 0 ? `以${cnNumber(o.term)}年为期` : '不设期限';
  const by = o.by >= 0 ? `；${pn(civ, o.by, year)}居间` : '';
  const zone = o.zone >= 0 ? `${nationsWord(o.ps.length + 1)}以${regionLabel(civ, o.zone)}为中立地。` : '';
  return `${pn(civ, o.a, year)}与${others}立约，${what}，${span}${o.keep ? '，约期内不背约' : ''}${by}。${zone}`;
}

/** 划中立地那页底下的预览:"渭国、大羽王朝、后乾衍国立约互不侵犯，以星河域为中立地，渭国让出丹枫关。"(已同在一份约里:"依丹枫关之约") */
export function zonePreview(civ: Civ, founders: readonly number[], r: number, year: Year): string {
  const own = ownersOfYear(civ, year).polity;
  const o = own[r];
  const names = founders.map((p) => pn(civ, p, year)).join('、');
  const x = sharedTreaty(civ, founders, year);
  const head = x ? `${names}依${treatyTitle(civ, x.id)}，以${regionLabel(civ, r)}为中立地` : `${names}立约互不侵犯，以${regionLabel(civ, r)}为中立地`;
  return `${head}${o >= 0 ? `，${pn(civ, o, year)}让出${placeOf(civ, r, year)}` : ''}。`;
}

// ---------------------------------------------------------------------------
// 地图上推荐那几处的名牌(划中立地那页开着时;TargetPlates.tsx 摆)

export interface ZonePlate {
  region: number;
  /** 第几处(1 起) */
  n: number;
  name: string;
  note: string;
  on: boolean;
}

let plates: { list: ZonePlate[]; pick: (r: number) => void } | null = null;
const subs = new Set<() => void>();

/** 登记 / 收起地图上推荐那几处的名牌(pick = 点了名牌选那一处) */
export function setZonePlates(v: { list: ZonePlate[]; pick: (r: number) => void } | null) {
  plates = v;
  for (const f of subs) f();
}

export function useZonePlates() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => plates,
    () => plates,
  );
}
