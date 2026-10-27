/**
 * 立约与中立地的整理(界面、编年史用):按史事(treaty / breach / expire / neutral / exile,字段见 types.ts 的 AnnalKind)
 * 推出每份约、每处中立地的来龙去脉,和推演里(treaties.ts)同一套规则。纯函数,只引 types / growth / timeline,不引推演代码。
 *
 * - 约:几国、怎么立的(自己立 / 议和顺带)、互不侵犯还是有限竞争、会盟的城(约名照它起:"丹枫关之约")、居间的国家和它出使的名臣、
 *   期限、续约、背约、约废(约满不续 / 剩不到两国)、共同的强邻、两国之约以哪道山河为界、中立地
 * - 中立地:哪州、依哪份约、几国共建(或议和划的缓冲)、谁让出的、撤销的年份和还给了谁、住过谁(Person.exile)
 * 按 civ 缓存(同一份史事只整理一次)。
 */
import type { Annal, Civ, Person, Year } from './types';
import { polityAlive, polityName } from './growth';
import { ownersAt } from './timeline';

/** 作者下令立的约、划的中立地(史事 treaty / neutral 的 cause = decree)记在 Annal.opt 里的几样选项(按位) */
export const OPT_LIMITED = 1;
export const OPT_KEEP = 2;
export const OPT_QUIET = 4;
export const OPT_LASTING = 8;
/** 干预立约 / 划中立地没生效的原因(史事 intervene 的 b 列;−1 = 生效了,−2 州键指不到,−3 下令的国家已亡) */
export const IV_NOBODY = -8;
export const IV_REFUSED = -9;
export const IV_NO_ZONE = -10;

/** 一份约 */
export interface TreatyInfo {
  /** 约的编号(史事 treaty 的 war 列) */
  id: number;
  /** 立约那一条史事的下标 */
  annal: number;
  /** 立约的几国(按入约先后) */
  parties: number[];
  /** pact 互不侵犯(两国);limited 有限竞争(三国以上:再加各守今疆;作者下令立的照作者选的) */
  kind: 'pact' | 'limited';
  /** self 推演里几国自己立的;peace 议和时顺带立的;decree 作者下令立的(干预「立约」「划中立地」) */
  how: 'self' | 'peace' | 'decree';
  /** 作者下令立的、选了"约期内不许背约" */
  keep: boolean;
  /** 立约的年份;头一个期限(年;0 = 作者下令立的一直有效的约) */
  start: Year;
  term: number;
  /** 眼下这一期到哪年(续过约的按最后一次续约算;一直有效 = Infinity) */
  until: Year;
  /** 会盟的城(−1 = 没有)、所在州 */
  settlement: number;
  region: number;
  /** 居间的国家(−1 = 没有) */
  by: number;
  /** 共同的强邻(−1 = 没有) */
  foe: number;
  /** 续约:哪年、续约的几国、续几年 */
  renewals: { year: Year; parties: number[]; term: number; annal: number }[];
  /** 背约:哪年、谁背约打谁、那场战争 */
  breaches: { year: Year; by: number; against: number; war: number; annal: number }[];
  /** 约废的年份、怎么废的(expire 约满不续;lapse 剩不到两国);还在 = 不给 */
  ended?: Year;
  end?: 'expire' | 'lapse';
  /** 中立地的编号(−1 = 没有) */
  zone: number;
}

/** 一处中立地 */
export interface ZoneInfo {
  /** 中立地的编号(史事 neutral 的 war 列) */
  id: number;
  /** 设立那一条史事的下标 */
  annal: number;
  region: number;
  /** 州里的城(没有 = −1) */
  settlement: number;
  /** 依的那份约 */
  treaty: number;
  /** treaty 几国立约时共建;peace 两国议和时划的缓冲 */
  how: 'treaty' | 'peace';
  /** 共建的几国 */
  founders: number[];
  /** 让出那州的国家(−1 = 原是无主之地) */
  owner: number;
  from: Year;
  /** 撤销的年份;还给了谁(−1 = 没还,成了无主之地);还在 = 不给 */
  ended?: Year;
  back?: number;
  /** 作者下令划的:不送人去、一直留着(约废了也不撤)、到哪年撤(没选 = 不给) */
  quiet?: boolean;
  lasting?: boolean;
  until?: Year;
  /** 放逐 / 出奔到这里的人物(Person.id,按先后) */
  residents: number[];
}

export interface TreatyBook {
  treaties: TreatyInfo[];
  zones: ZoneInfo[];
  /** 国家 → 称臣的年份(按先后;立约以后称过臣的退出那份约) */
  submits: Map<number, Year[]>;
}

const cache = new WeakMap<readonly Annal[], TreatyBook>();

/** 这份历史里所有的约、中立地(按编号) */
export function treatyBook(civ: Civ): TreatyBook {
  const A = civ.annals ?? [];
  const hit = cache.get(A);
  if (hit) return hit;
  const treaties: TreatyInfo[] = [];
  const zones: ZoneInfo[] = [];
  const submits = new Map<number, Year[]>();
  A.forEach((e, i) => {
    switch (e.kind) {
      case 'submit': {
        const s = submits.get(e.a);
        if (s) s.push(e.year);
        else submits.set(e.a, [e.year]);
        return;
      }
      case 'treaty': {
        const ps = (e.ps ?? [e.a, e.b]).slice();
        const term = e.n ?? 20;
        if (e.cause === 'renew') {
          const x = treaties[e.war];
          if (!x) return;
          x.renewals.push({ year: e.year, parties: ps, term, annal: i });
          x.until = e.year + term;
          return;
        }
        const decree = e.cause === 'decree';
        treaties[e.war] = {
          id: e.war,
          annal: i,
          parties: ps,
          // 作者下令立的:种类、不许背约照作者选的(Annal.opt;位见上面的 OPT_*)
          kind: (decree ? ((e.opt ?? 0) & OPT_LIMITED) !== 0 : ps.length >= 3) ? 'limited' : 'pact',
          how: e.cause === 'peace' ? 'peace' : decree ? 'decree' : 'self',
          keep: decree && ((e.opt ?? 0) & OPT_KEEP) !== 0,
          start: e.year,
          term,
          until: term > 0 ? e.year + term : Infinity,
          settlement: e.settlement,
          region: e.region,
          by: e.by ?? -1,
          foe: e.foe ?? -1,
          renewals: [],
          breaches: [],
          zone: -1,
        };
        return;
      }
      case 'breach': {
        treaties[e.n ?? -1]?.breaches.push({ year: e.year, by: e.a, against: e.b, war: e.war, annal: i });
        return;
      }
      case 'expire': {
        const x = treaties[e.war];
        if (!x) return;
        x.ended = e.year;
        x.end = e.cause === 'lapse' ? 'lapse' : 'expire';
        return;
      }
      case 'neutral': {
        if (e.cause === 'lapse') {
          const z = zones[e.war];
          if (!z) return;
          z.ended = e.year;
          z.back = e.a;
          return;
        }
        const z: ZoneInfo = { id: e.war, annal: i, region: e.region, settlement: e.settlement, treaty: e.n ?? -1, how: e.cause === 'peace' ? 'peace' : 'treaty', founders: (e.ps ?? []).slice(), owner: e.a, from: e.year, residents: [] };
        if (e.cause === 'decree') {
          const opt = e.opt ?? 0;
          if (opt & OPT_QUIET) z.quiet = true;
          if (opt & OPT_LASTING) z.lasting = true;
          if (e.until !== undefined) z.until = e.until;
        }
        zones[e.war] = z;
        const x = treaties[e.n ?? -1];
        if (x) x.zone = e.war;
        return;
      }
    }
  });
  for (const x of civ.people ?? []) if (x.exile) zones[x.exile.zone]?.residents.push(x.id);
  for (const z of zones) z?.residents.sort((a, b) => (civ.people![a].exile!.year - civ.people![b].exile!.year) || a - b);
  const out = { treaties, zones, submits };
  cache.set(A, out);
  return out;
}

/** 约名:用户改过的名字;没改过 = "丹枫关之约"(会盟的城;没有城 = 空串) */
export function treatyName(civ: Civ, id: number): string {
  const own = civ.treatyNames?.[id];
  if (own) return own;
  const x = treatyBook(civ).treaties[id];
  const s = x && x.settlement >= 0 ? civ.settlements[x.settlement] : undefined;
  return s?.name ? `${s.name}之约` : '';
}

/**
 * 编年史里称呼这份约的名字:议和时顺带立的约不起名(用户改过名的除外)= 空串,编年史照"甲与乙之约"称呼;
 * 其余同 treatyName
 */
export function treatyCallName(civ: Civ, id: number): string {
  return treatyBook(civ).treaties[id]?.how === 'peace' && !civ.treatyNames?.[id] ? '' : treatyName(civ, id);
}

/** 条约卡片、国家卡片上的约名:有名字用名字,没有(议和顺带立的、没有会盟的城)= "甲与乙之约"(按立约那年的国名) */
export function treatyTitle(civ: Civ, id: number): string {
  const name = treatyCallName(civ, id);
  if (name) return name;
  const x = treatyBook(civ).treaties[id];
  if (!x) return '';
  const n = (p: number) => (civ.polities[p] ? polityName(civ.polities[p], x.start) : '');
  return x.parties.length >= 2 ? `${n(x.parties[0])}与${n(x.parties[1])}之约` : '前约';
}

/** 约 x 在 year 那一刻还在约里的几国:约没废、没背约、国还在、立约(续约)以后没向别国称臣过(和推演里 treaties.ts 的 member 一样) */
export function treatyMembersAt(civ: Civ, x: TreatyInfo, year: Year): number[] {
  if (year < x.start || (x.ended !== undefined && year >= x.ended)) return [];
  let ps = x.parties;
  let since = x.start;
  for (const r of x.renewals) {
    if (r.year > year) break;
    ps = r.parties;
    since = r.year;
  }
  const subs = treatyBook(civ).submits;
  return ps.filter((p) => {
    const P = civ.polities[p];
    // 背约退出的、亡了 / 被并的、立约(续约)以后向别国称臣过的不算
    if (!P || !polityAlive(P, year) || x.breaches.some((b) => b.by === p && b.year <= year)) return false;
    return !(subs.get(p) ?? []).some((y) => y >= since && y <= year);
  });
}

/** 国家 p 在 year 那一刻在的约(国家卡片"立约"一行用) */
export function treatiesOfAt(civ: Civ, p: number, year: Year): TreatyInfo[] {
  return treatyBook(civ).treaties.filter((x) => x && treatyMembersAt(civ, x, year).includes(p));
}

/** year 那一刻还在的中立地(地图、州卡片用;下标不连续时跳过空位) */
export function zonesAt(civ: Civ, year: Year): ZoneInfo[] {
  return treatyBook(civ).zones.filter((z) => z && z.from <= year && (z.ended === undefined || year < z.ended));
}

/**
 * 居间的国家当时在朝的名臣(出使说合的那位):year 那一刻在朝的名臣里入仕最早的;没有 = null
 */
export function envoyOf(civ: Civ, polity: number, year: Year): Person | null {
  let best: Person | null = null;
  for (const x of civ.people ?? []) {
    if (x.role !== 'minister' || x.polity !== polity) continue;
    if ((x.from ?? Infinity) > year || (x.until !== undefined && x.until <= year) || (x.died !== undefined && x.died <= year)) continue;
    if (!best || (x.from ?? 0) < (best.from ?? 0)) best = x;
  }
  return best;
}

/**
 * 两国之约以哪道山河为界(编年史"以云隐山为界"):立约那年,锚点所在州归约里的一国、在陆上挨着另一国国土的山脉、大河里
 * 最显要的那一处(civ.places 的下标);没有 = −1
 */
export function treatyLine(civ: Civ, x: TreatyInfo): number {
  if (x.parties.length !== 2) return -1;
  const [a, b] = x.parties;
  const reg = civ.regions;
  const own = ownersAt(civ, x.start).polity;
  let best = -1;
  civ.places.forEach((pl, i) => {
    if ((pl.kind !== 'mountains' && pl.kind !== 'river') || pl.cell === undefined || pl.cell < 0 || pl.cell >= reg.of.length) return;
    const r = reg.of[pl.cell];
    if (r < 0 || r >= reg.count) return;
    const o = own[r];
    if (o !== a && o !== b) return;
    const other = o === a ? b : a;
    let edge = false;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1] && !edge; k++) edge = own[reg.adj[k]] === other && reg.adjKind[k] <= 2;
    // 显示档小的更显要(1 = 总览就显示);一样的取大的
    const q = best >= 0 ? civ.places[best] : null;
    if (edge && (!q || pl.rank < q.rank || (pl.rank === q.rank && (pl.size ?? 0) > (q.size ?? 0)))) best = i;
  });
  return best;
}
