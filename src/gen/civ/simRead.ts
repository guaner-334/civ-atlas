/**
 * 读口 sim.read@1:推演进行中给插件看的稳定数据(州、国、城、民族、官方表、史事)。
 * 和官方各子系统内部怎么写无关;交出去的一律是新做的一份,读口自己不改推演的任何状态、不取随机数。
 * 字段名和工具插件读历史的接口同名的,意思也一样;编号只在这一次推演里有效。
 */
import type { AnnalKind, CultureKind } from './types';
import { Layer } from './types';
import type { CivSim } from './engine/sim';
import type { CivApi } from './api';
import { cultureModelOf } from './cultures';
import { diplomacyModelOf } from './diplomacy';
import { capitalAt, populationAt, portAt, settlementRank } from './growth';
import { polityModelOf } from './polities';
import { faithSimOf } from './religion';
import { KM_PER_UNIT } from './scale';
import { TABLE_GROUP } from './tableGroups';
import { warModelOf } from './wars';

export const SIM_READ = 'sim.read@1';

export interface SimRegions {
  count: number;
  /** 平方公里 */
  area: Float64Array;
  /** 治所地块 */
  seat: Int32Array;
  /** 主导地貌(生物群落编号,和地图的 biome 同一套) */
  biome: Uint8Array;
  /** 1 = 临海 */
  coastal: Uint8Array;
  /** 平均宜居分 */
  habitability: Float32Array;
  /** 州 r 的邻居是 list[start[r] .. start[r + 1]),含海峡、航线 */
  neighbors: { start: Int32Array; list: Int32Array };
}

export type SimOwnerField = 'polity' | 'culture' | 'faith';

export interface SimPolity {
  id: number;
  founded: number;
  ended?: number;
  /** 此刻的国都(城的编号) */
  capital: number;
  culture: number;
  /** 从哪国分出来的 */
  parent?: number;
  /** 此刻有几州 */
  size: number;
  /** 国号档位 */
  tier: number;
  /** 国力(最近一次算的;这一年里才立的国还没算 = 0) */
  power: number;
  /** 国库攒到该有的几成(0–1) */
  treasury: number;
  /** 国用不足(0–1) */
  broke: number;
  /** 正和哪几国打仗(编号升序) */
  wars: number[];
  /** 盟国(编号升序) */
  allies: number[];
  /** 宗主;不是藩属 = −1 */
  liege: number;
}

export interface SimSettlement {
  id: number;
  cell: number;
  region: number;
  founded: number;
  ended?: number;
  port: boolean;
  /** 此刻的人口(千人) */
  population: number;
  /** 此刻的等级 0 村 / 1 镇 / 2 城 / 3 大城 */
  rank: number;
}

export interface SimCulture {
  id: number;
  kind: CultureKind;
  /** 发源的州 */
  hearth: number;
  born: number;
  ended?: number;
  parent?: number;
}

/** 一条史事;a、b 按种类是国、民族或城的编号,region、settlement、war 没有 = −1 */
export interface SimAnnal {
  year: number;
  kind: AnnalKind;
  a: number;
  b: number;
  region: number;
  settlement: number;
  war: number;
}

type OfficialDef = { unit: 'region' | 'polity'; table: string; col?: string };
const st = (t: string) => `${TABLE_GROUP.state}.${t}`;
const dv = (t: string) => `${TABLE_GROUP.dev}.${t}`;
const id = (t: string) => `${TABLE_GROUP.ideology}.${t}`;

/** 官方表的稳定名字 → 总登记里的「组名.表名」和栏名(按栏名找,官方以后加栏、换栏的先后不影响) */
const OFFICIAL = {
  /** 乡村人口(千人) */
  rural: { unit: 'region', table: st('乡口') },
  /** 中央管得到几成(0–1) */
  control: { unit: 'region', table: st('管辖') },
  unrest: { unit: 'polity', table: st('动荡') },
  'dev.production': { unit: 'region', table: dv('能力'), col: '生产' },
  'dev.transport': { unit: 'region', table: dv('能力'), col: '运输' },
  'dev.information': { unit: 'region', table: dv('能力'), col: '信息' },
  'dev.administration': { unit: 'region', table: dv('能力'), col: '行政' },
  'dev.mobilization': { unit: 'region', table: dv('动员') },
  /** 物产眼下能用多少(0–3 档) */
  'res.grain': { unit: 'region', table: dv('能用'), col: '粮' },
  'res.livestock': { unit: 'region', table: dv('能用'), col: '牲畜' },
  'res.copper': { unit: 'region', table: dv('能用'), col: '铜锡' },
  'res.iron': { unit: 'region', table: dv('能用'), col: '铁' },
  'res.coal': { unit: 'region', table: dv('能用'), col: '煤' },
  'res.timber': { unit: 'region', table: dv('能用'), col: '木材' },
  'res.salt': { unit: 'region', table: dv('能用'), col: '盐' },
  'res.fish': { unit: 'region', table: dv('能用'), col: '渔获' },
  'res.oil': { unit: 'region', table: dv('能用'), col: '石油' },
  'res.rare': { unit: 'region', table: dv('能用'), col: '稀有矿' },
  'res.gold': { unit: 'region', table: dv('能用'), col: '金银' },
  /** 各说的接受度(0–1) */
  'ideology.mandate': { unit: 'region', table: id('思潮'), col: '天命之说' },
  'ideology.law': { unit: 'region', table: id('思潮'), col: '律法之说' },
  'ideology.council': { unit: 'region', table: id('思潮'), col: '共治之说' },
  'ideology.craft': { unit: 'region', table: id('思潮'), col: '技艺之说' },
  'ideology.rights': { unit: 'region', table: id('思潮'), col: '民权之说' },
  'ideology.nation': { unit: 'region', table: id('思潮'), col: '国族之说' },
  'ideology.commons': { unit: 'region', table: id('思潮'), col: '均产之说' },
} as const satisfies Record<string, OfficialDef>;

export type OfficialName = keyof typeof OFFICIAL;
export const OFFICIAL_NAMES = Object.keys(OFFICIAL) as OfficialName[];

/** 官方表按什么记:region = 一州一个数,polity = 一国一个数(按国的编号) */
export function officialUnit(name: OfficialName): 'region' | 'polity' {
  return OFFICIAL[name].unit;
}

export interface SimRead {
  /** 此刻(年) */
  readonly year: number;
  regions(): SimRegions;
  /** 此刻各州归属;没有 = −1。信仰每隔几年才算一步,是最近那一步的 */
  owners(field: SimOwnerField): Int16Array;
  /** 所有国家(亡了的也在) */
  polities(): SimPolity[];
  /** 所有城(毁了的也在) */
  settlements(): SimSettlement[];
  cultures(): SimCulture[];
  /** 官方表此刻的值(最近一次算的),个数 = 州数或国数;这一组还没装 = 全是 0 */
  official(name: OfficialName): Float64Array;
  /** [from, to] 年里的史事(按发生先后) */
  annals(from: number, to?: number): SimAnnal[];
}

/** 这次推演的读口;没有能住人的地(没装国家模型)= null */
export function simRead(sim: CivSim): SimRead | null {
  const pm = polityModelOf(sim);
  if (!pm) return null;
  const T = pm.terrain;
  const R = sim.R;

  const official = (name: OfficialName): Float64Array => {
    const def: OfficialDef | undefined = OFFICIAL[name];
    if (!def) throw new Error(`没有官方表 ${String(name)}`);
    const n = def.unit === 'region' ? R : pm.polities.length;
    const out = new Float64Array(n);
    const card = sim.tables.card(def.table);
    const data = sim.tables.get(def.table);
    if (!card || !data) return out;
    const cols = card.cols?.length ?? 1;
    const col = def.col === undefined ? 0 : (card.cols ?? []).indexOf(def.col);
    if (col < 0) throw new Error(`官方表 ${def.table} 没有 ${def.col} 这一栏`);
    const m = Math.min(n, Math.floor(data.length / cols));
    for (let i = 0; i < m; i++) out[i] = data[i * cols + col];
    return out;
  };

  return {
    get year() {
      return sim.now;
    },

    regions() {
      const reg = T.regions;
      const area = new Float64Array(R);
      for (let r = 0; r < R; r++) area[r] = reg.area[r] * KM_PER_UNIT * KM_PER_UNIT;
      return {
        count: R,
        area,
        seat: reg.seat.slice(0, R),
        biome: reg.biome.slice(0, R),
        coastal: T.coastal.slice(0, R),
        habitability: T.meanSuit.slice(0, R),
        neighbors: { start: reg.adjStart.slice(0, R + 1), list: reg.adj.slice() },
      };
    },

    owners(field) {
      if (field === 'polity') return sim.owners[Layer.Polity].slice();
      if (field === 'culture') return sim.owners[Layer.Culture].slice();
      if (field !== 'faith') throw new Error(`没有归属 ${String(field)}`);
      const out = new Int16Array(R).fill(-1);
      const f = faithSimOf(sim)?.faith;
      if (f) out.set(f.subarray(0, Math.min(R, f.length)));
      return out;
    },

    polities() {
      const t = sim.now;
      // 不走 civApi:它第一次取时会建空表
      const api = (sim.api as Partial<CivApi>).war;
      const wm = warModelOf(sim);
      const dm = diplomacyModelOf(sim);
      const foes: number[][] = pm.polities.map(() => []);
      for (const w of wm?.active ?? []) {
        if (w.a < foes.length && !foes[w.a].includes(w.b)) foes[w.a].push(w.b);
        if (w.b < foes.length && !foes[w.b].includes(w.a)) foes[w.b].push(w.a);
      }
      return pm.polities.map((P, p) => {
        const power = api?.power?.(p) ?? -1;
        const info: SimPolity = {
          id: P.id,
          founded: P.founded,
          capital: capitalAt(P, t),
          culture: P.culture,
          size: pm.size[p] ?? 0,
          tier: pm.tier[p] ?? 0,
          power: power > 0 ? power : 0,
          treasury: api?.purse?.(p, t) ?? 1,
          broke: api?.broke?.(p, t) ?? 0,
          wars: foes[p].sort((x, y) => x - y),
          allies: dm ? dm.alliesOf(p) : [],
          liege: dm ? dm.liegeOf(p) : -1,
        };
        if (P.ended !== undefined) info.ended = P.ended;
        if (P.parent !== undefined) info.parent = P.parent;
        return info;
      });
    },

    settlements() {
      const t = sim.now;
      return pm.settlements.map((s) => {
        const population = populationAt(s, t);
        const info: SimSettlement = { id: s.id, cell: s.cell, region: s.region, founded: s.founded, port: portAt(s, t), population, rank: settlementRank(population) };
        if (s.ended !== undefined) info.ended = s.ended;
        return info;
      });
    },

    cultures() {
      return (cultureModelOf(sim)?.cultures ?? pm.cultures).map((c) => {
        const info: SimCulture = { id: c.id, kind: c.kind, hearth: c.hearth, born: c.born };
        if (c.ended !== undefined) info.ended = c.ended;
        if (c.parent !== undefined) info.parent = c.parent;
        return info;
      });
    },

    official,

    annals(from, to = Infinity) {
      const all = sim.annalsView;
      // 史事按年份先后记(引擎的时刻只往后走):从尾上往回找
      let i = all.length;
      while (i > 0 && all[i - 1].year >= from) i--;
      const out: SimAnnal[] = [];
      for (; i < all.length && all[i].year <= to; i++) {
        const e = all[i];
        out.push({ year: e.year, kind: e.kind, a: e.a, b: e.b, region: e.region, settlement: e.settlement, war: e.war });
      }
      return out;
    },
  };
}
