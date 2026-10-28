/**
 * 推一把发展(干预 boost;推演规则见 gen/civ/boost.ts)在界面上要算的东西和说法:
 *   填写页(BoostPage.tsx):国都现在在哪个时代、直接进进到哪个时代、治下各州在什么时代、跨时代要的物产治下几州有(缺的先用黄字说清)
 *   单子上的一行:"大澜王朝推一把发展：快 10 倍，1500–1550 年""大澜王朝推一把发展：直接进铁器时代"
 *   推完的提示条:"大澜王朝推一把发展：快 10 倍，到 1550 年"(后面由调用方接"；已从……起重新推演");没生效的黄色写原因
 *   「我的干预」一行:直接进补"，93 州";快几倍缺物产补"；缺铜锡，停在青铜门口"
 *   国家卡片概况「推一把」一行(时代下面,只在管着的那些年有;直接进的推的那一年起 BOOST_ROW_YEARS 年里有)
 */
import type { Civ } from '../gen/civ/types';
import { BOOST_YEARS_DEFAULT, YEAR_TICKS, commandAt, keyCells, polityKey, regionOfKey, type Intervention } from '../gen/edits';
import { BOOST_N } from '../gen/civ/boost';
import { ERAS, RESOURCES, developmentAt, eraLevel, eraOf } from '../gen/civ/development';
import { capitalAt, polityAlive, populationAt, regionCityAt } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/display';
import { ownersAt } from '../gen/civ/timeline';
import { interventionFate } from '../gen/stepwise';
import { eraText, spaced, yearAt, yearSpanAt, type Era } from '../gen/era';
import { nameAt, polityIdOf } from './Interventions';
import type { Pending } from './pendingStore';

export type BoostIv = Extract<Intervention, { kind: 'boost' }>;

/** 直接进的那一条在国家卡片上留几年 */
export const BOOST_ROW_YEARS = 20;

/** 进第 k 个时代要的物产(RESOURCES 的下标;同 development.ts 的 gateNeed:进青铜要铜锡,进铁器要铁,进工业要煤和铁,进电气要石油,进信息要稀有矿) */
function gateRes(k: number): number[] {
  const at = (name: string) => RESOURCES.indexOf(name as (typeof RESOURCES)[number]);
  return k === 1 ? [at('铜锡')] : k === 2 ? [at('铁')] : k === 5 ? [at('煤'), at('铁')] : k === 6 ? [at('石油')] : k === 7 ? [at('稀有矿')] : [];
}

let lvCache: { civ: Civ; y: number; lv: Float32Array } | null = null;
/** 那一年各州的五种能力(同一份历史同一年只算一次) */
function levelsAt(civ: Civ, y: number): Float32Array | null {
  if (!civ.development) return null;
  if (lvCache && lvCache.civ === civ && lvCache.y === y) return lvCache.lv;
  const lv = developmentAt(civ.development, y);
  lvCache = { civ, y, lv };
  return lv;
}

/** 填写页要的:国都、它的时代、直接进到哪、"现在"那一句、跨时代的门槛治下几州有、缺的那一道 */
export interface BoostLook {
  /** 国都所在州(没有 = −1)、城名、时代、走了几成(0–100) */
  capR: number;
  capCity: string;
  capEra: number;
  capPct: number;
  /** 直接进到第几个时代(国都已在最后一个时代 = −1) */
  next: number;
  /** 那一年这国的州 */
  lands: number[];
  /** "国都青月坞在青铜时代（4%），另外 92 州还在石器" */
  now: string;
  /** 推的州要跨的门槛(到国都的下一个时代为止):进第几个时代、要什么、治下几州有 */
  gates: { era: number; res: string; n: number }[];
  /** 缺的那一道(治下一州都没有;没有 = null) */
  lack: { era: number; res: string } | null;
}

/** 国家 pid 在 y 那一年推一把要看的(regions = 只推这几州;不给 = 整国) */
export function boostLook(civ: Civ, pid: number, regions: readonly number[] | null, y: number): BoostLook {
  const p = civ.polities[pid];
  const own = ownersAt(civ, y).polity;
  const lands: number[] = [];
  for (let r = 0; r < civ.regions.count; r++) if (own[r] === pid) lands.push(r);
  const lv = levelsAt(civ, y);
  const eraAt = (r: number) => (lv ? eraLevel(lv, r) : 0);
  const sid = p && polityAlive(p, y) ? capitalAt(p, y) : -1;
  const capR = sid >= 0 ? civ.settlements[sid].region : -1;
  const ce = capR >= 0 ? eraOf(eraAt(capR)) : { era: 0, progress: 0 };
  const capEra = ce.era;
  const next = capEra + 1 < ERAS.length ? capEra + 1 : -1;
  // 现在:国都在哪个时代,别的州各在哪(都和国都同一个时代的合成一句)
  const others = new Map<number, number>();
  for (const r of lands) if (r !== capR) others.set(eraOf(eraAt(r)).era, (others.get(eraOf(eraAt(r)).era) ?? 0) + 1);
  const pct = Math.floor(ce.progress * 100);
  const E = ERAS[capEra];
  let now: string;
  if (!others.size) now = `国都${civ.settlements[sid]?.name ?? ''}在${E}时代（${pct}%）`;
  else if (others.size === 1 && others.has(capEra)) now = `国都在${E}时代（${pct}%），${lands.length} 州都在${E}`;
  else
    now = `国都${civ.settlements[sid]?.name ?? ''}在${E}时代（${pct}%），另外 ${[...others]
      .sort((a, b) => b[0] - a[0])
      .map(([e, n]) => `${n} 州${e === capEra ? '也在' : e < capEra ? '还在' : '已在'}${ERAS[e]}`)
      .join('、')}`;
  // 门槛:推的州里最落后的那个时代的下一个,到国都的下一个时代;治下(连同选的几州)有这样物产的州数
  const scope = regions ? [...regions] : lands;
  const has = new Set([...lands, ...scope]);
  let lo = capEra;
  for (const r of scope) lo = Math.min(lo, eraOf(eraAt(r)).era);
  const res = civ.development?.resources;
  const gates: BoostLook['gates'] = [];
  for (let k = lo + 1; k <= Math.min(capEra + 1, ERAS.length - 1); k++) {
    for (const i of gateRes(k)) {
      let n = 0;
      if (res) for (const r of has) if (res[r * RESOURCES.length + i]) n++;
      gates.push({ era: k, res: RESOURCES[i], n });
    }
  }
  const miss = gates.find((g) => g.n === 0);
  return { capR, capCity: civ.settlements[sid]?.name ?? '', capEra, capPct: pct, next, lands, now, gates, lack: miss ? { era: miss.era, res: miss.res } : null };
}

/** "进青铜要铜锡、进铁器要铁：治下 41 州有铜锡、62 州有铁，不卡"(没有门槛 = 空串) */
export function gatesText(look: BoostLook): string {
  if (!look.gates.length) return '';
  const need = new Map<number, string[]>();
  for (const g of look.gates) need.set(g.era, [...(need.get(g.era) ?? []), g.res]);
  const head = [...need].map(([k, rs]) => `进${ERAS[k]}要${rs.join('和')}`).join('、');
  return `${head}：治下 ${look.gates.map((g) => `${g.n} 州有${g.res}`).join('、')}，不卡`;
}

/** 几州叫什么:"青月坞一带 9 州"(城最大的那州的城名,没城写州名;只有一州 = 那州的名字) */
export function boostRegionsName(civ: Civ, regions: readonly number[], y: number): string {
  if (!regions.length) return '';
  let at = regions[0];
  let most = -1;
  for (const r of regions) {
    const s = regionCityAt(civ, r, y);
    const n = s ? populationAt(s, y) : -1;
    if (n > most) {
      most = n;
      at = r;
    }
  }
  const s = regionCityAt(civ, at, y);
  const name = (s && populationAt(s, y) > 0 && s.name) || regionLabel(civ, at);
  return regions.length > 1 ? `${name}一带 ${regions.length} 州` : name;
}

/** 州键 → 这份历史里的州号(去掉指不到的) */
export function boostRegions(civ: Civ, v: BoostIv): number[] {
  return (v.regions ?? []).map((k) => regionOfKey(k, keyCells(civ.regions))).filter((r) => r >= 0 && r < civ.regions.count);
}

/** 力度那一半:"快 10 倍""直接进铁器时代"(不知道进到哪 = "直接进下一个时代") */
function howText(v: BoostIv, next: number): string {
  return v.mul !== undefined ? `快 ${v.mul} 倍` : next > 0 ? `直接进${ERAS[next]}时代` : '直接进下一个时代';
}

/** 谁:整国 = 国名 A;几州 = "青月坞一带 9 州" */
function whoText(civ: Civ, v: BoostIv, A: string): string {
  return v.regions ? boostRegionsName(civ, boostRegions(civ, v), v.from) || A : A;
}

/** 单子上的一行:"大澜王朝推一把发展：快 10 倍，1500–1550 年""大澜王朝推一把发展：直接进铁器时代"(next = 直接进到第几个时代) */
export function boostQueueText(civ: Civ, v: BoostIv, A: string, next: number, era: Era | undefined): string {
  const span = v.mul !== undefined ? `，${yearSpanAt(v.from, v.until ?? v.from + BOOST_YEARS_DEFAULT, era)}` : '';
  return `${whoText(civ, v, A)}推一把发展：${howText(v, next)}${span}`;
}

/** 这条推一把(第 i 条干预)的史事:生效了的 n 拆成推了几州、直接进到第几个时代(没生效 / 没推到 = null) */
function boostDone(civ: Civ, i: number): { regions: number; next: number } | null {
  const f = i >= 0 ? interventionFate(civ, i) : null;
  if (f?.state !== 'done') return null;
  const n = civ.annals[f.annal]?.n ?? 0;
  return { regions: Math.floor(n / BOOST_N), next: n % BOOST_N };
}

/**
 * 快几倍、整国:要跨的头一道门槛缺物产(生效那年、到期那年治下都一州没有),到期时国都还没进那个时代 ——"；缺铜锡，停在青铜门口"(别的 = 空串)
 */
function boostStall(civ: Civ, v: BoostIv): string {
  if (v.mul === undefined || v.regions) return '';
  const k = polityIdOf(civ, v.a);
  if (k < 0) return '';
  const look = boostLook(civ, k, null, v.from);
  if (!look.lack || look.capR < 0) return '';
  const end = Math.min(v.until ?? v.from + BOOST_YEARS_DEFAULT, civ.endYear);
  const lv = levelsAt(civ, end);
  const p = civ.polities[k];
  const sid = polityAlive(p, end) ? capitalAt(p, end) : -1;
  const r = sid >= 0 ? civ.settlements[sid].region : look.capR;
  if (lv && eraOf(eraLevel(lv, r)).era >= look.lack.era) return '';
  // 这些年里打下了有这样物产的州(不再缺了):不算停在门口
  const late = boostLook(civ, k, null, end).gates.find((g) => g.era === look.lack!.era && g.res === look.lack!.res);
  if (late && late.n > 0) return '';
  return `；缺${look.lack.res}，停在${ERAS[look.lack.era]}门口`;
}

/**
 * 「我的干预」一行(i = 在 civ.interventions 里的下标,−1 = 还没推演):"大澜王朝推一把发展：直接进铁器时代，93 州"
 * "有鹤皇朝推一把发展：快 10 倍，到 1550 年；缺铜锡，停在青铜门口";A = 国名
 */
export function boostText(civ: Civ, v: BoostIv, i: number, A: string, era: Era | undefined): string {
  const done = boostDone(civ, i);
  const head = `${whoText(civ, v, A)}推一把发展：${howText(v, done?.next ?? 0)}`;
  if (v.mul !== undefined) return `${head}，到${spaced(yearAt(v.until ?? v.from + BOOST_YEARS_DEFAULT, era))}${done ? boostStall(civ, v) : ''}`;
  return done ? `${head}，${done.regions} 州` : head;
}

/** 推完的提示条(后面由调用方接"；已从……起重新推演"):"大澜王朝推一把发展：快 10 倍，到 1550 年";没生效黄色写原因 */
export function boostDoneText(civ: Civ, v: BoostIv, i: number, A: string, era: Era | undefined): { ok: boolean; text: string } {
  const f = i >= 0 ? interventionFate(civ, i) : null;
  const who = whoText(civ, v, A);
  if (f?.state === 'void') {
    const why = f.why.startsWith('那一年') ? `第 ${v.from} 年${f.why.slice(3)}` : f.why;
    return { ok: false, text: `${who}推一把发展没生效：${eraText(why, era)}` };
  }
  const done = boostDone(civ, i);
  const head = `${who}推一把发展：${howText(v, done?.next ?? 0)}`;
  return { ok: true, text: v.mul !== undefined ? `${head}，到${spaced(yearAt(v.until ?? v.from + BOOST_YEARS_DEFAULT, era))}` : head };
}

/**
 * 国家卡片概况「推一把」一行(时代下面):单子里这国整国的一条 → "快 10 倍 待推演";推过的、这一年还管着的 →
 * "快 10 倍 到 1550 年" / "直接进铁器 1500 年"(推的那一年起 BOOST_ROW_YEARS 年里);都没有 = null
 */
export function boostRow(civ: Civ, id: number, year: number, pending: readonly Pending[], step: boolean, era: Era | undefined): { name: string; tag?: string; note?: string } | null {
  const key = polityKey(civ, id);
  for (let k = pending.length - 1; k >= 0; k--) {
    const x = pending[k];
    if (x.kind !== 'iv' || x.v.kind !== 'boost' || x.v.a !== key || x.v.regions) continue;
    const v = x.v;
    return { name: v.mul !== undefined ? `快 ${v.mul} 倍` : '直接进', tag: step ? '下一步生效' : '待推演' };
  }
  const list = civ.interventions ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i];
    // 年中下的(逐年推演停在年中时)到那一格才算
    if (v.kind !== 'boost' || v.a !== key || v.regions || year < commandAt(v) / YEAR_TICKS) continue;
    const done = boostDone(civ, i);
    if (!done) continue;
    if (v.mul !== undefined) {
      const until = v.until ?? v.from + BOOST_YEARS_DEFAULT;
      if (year < until) return { name: `快 ${v.mul} 倍`, note: `到${spaced(yearAt(until, era))}` };
    } else if (year < v.from + BOOST_ROW_YEARS && done.next > 0) return { name: `直接进${ERAS[done.next]}`, note: yearAt(v.from, era) };
  }
  return null;
}

/** 生效年份那一年这国的国名(面板标题上的;给单子、提示条用) */
export function boostActor(civ: Civ, pid: number, y: number): string {
  const p = civ.polities[pid];
  return p ? nameAt(p, y) : '';
}
