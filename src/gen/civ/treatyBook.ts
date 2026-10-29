/**
 * 这份历史里所有的约、中立地(treatyBook):按史事推出每份约、每处中立地的来龙去脉(规则、字段见 treatyInfo.ts 的文件头)。
 * 单独放:约的稳定键(edits.ts 的 treatyKey、resolveKey,读存档也要用到)只用得到这一样,不用跟着带上国名、国界那些。纯函数。
 */
import type { Annal, Civ, Year } from './types';

/** 作者下令立的约、划的中立地(史事 treaty / neutral 的 cause = decree)记在 Annal.opt 里的几样选项(按位) */
export const OPT_LIMITED = 1;
export const OPT_KEEP = 2;
export const OPT_QUIET = 4;
export const OPT_LASTING = 8;

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
