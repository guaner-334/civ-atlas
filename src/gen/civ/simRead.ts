/**
 * 读口 sim.read@1:推演进行中给插件看的稳定数据(州、国、城、民族、官方表、史事)。
 * 和官方各子系统内部怎么写无关;交出去的一律是新做的一份,读口自己不改推演的任何状态、不取随机数。
 * 字段名和工具插件读历史的接口同名的,意思也一样;编号只在这一次推演里有效。
 */
import type { CultureKind, FaithKind, MigrationDir, Polity, RulerLeanings, Settlement } from './types';
import { Layer } from './types';
import type { CivSim } from './engine/sim';
import { annalOf, type PluginAnnal } from './engine/plugin';
import type { CivApi } from './api';
import { cultureModelOf } from './cultures';
import { diplomacyModelOf } from './diplomacy';
import { CAPITAL_BOOST, capacityAt, capitalAt, capitalLevel, devFactorAt, populationAt, portAt, settlementRank } from './growth';
import { effOf, polityModelOf, regentOf, rulerOf, type PolityModel } from './polities';
import { faithSimOf } from './religion';
import { KM_PER_UNIT } from './scale';
import { OFFICIAL, type OfficialDef, type OfficialName } from './simOfficial';
import { goalOf, lengthOf, warModelOf } from './wars';
import { councilModelOf } from './council';
import { dynastyIndexAt } from './polityRoot';
import { reformedSeg, royalSeg, segRegime, type Regime } from './regime';
import { segAt } from './policy';
import type { PolicyFocus, PolicyPreset, TrekDir } from '../edits';
import { leaningsAt, reignBorn } from './rulers';
import { broodOf, claimants } from './royals';
import type { RegencyKind } from './regents';
import { treatyModelOf } from './treaties';
import { liveTrade } from './trade';
import { trekModelOf } from './migration';
import { plagueModelOf } from './plague';

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
  /** 国教(信仰编号;没有 = −1;信仰每隔几年才算一步,是最近那一步的) */
  faith: number;
  /** 此刻的政体:王室 / 共和 / 军政府 */
  regime: Regime;
  /** 共和、军政府是改出来的(本国原来有君主) */
  reformed: boolean;
  /** 议政:0 君主独断、1 设了议事会、2 设了议会 */
  charter: number;
  /** 此刻是第几段(dynasties 的下标) */
  dynasty: number;
  /** 朝代和政体分段(按先后;没改朝换代过 = 只有立国那一段):from 那年起、什么政体、seat 这一段兴起的城(第一段 = 立国时的国都) */
  dynasties: { from: number; regime: Regime; seat: number }[];
  /** 议事定下的规矩 */
  rules: SimRules;
  /** 此刻照的方针;没有 = 不给 */
  policy?: SimPolicy;
}

/** 征法 0 代收、1 分成、2 直征;fief = 分封了边地;军制 −1 边镇、0 州郡征发、0.5 监军、1 禁军;官制 −1 自辟、0 荐举、0.5 参半、1 铨选 */
export interface SimRules {
  tax: number;
  fief: boolean;
  army: number;
  office: number;
}

/** 一国的方针 */
export interface SimPolicy {
  /** 从这一刻的下一刻起照它 */
  from: number;
  /** 一键选的哪一种(只管说法) */
  preset?: PolicyPreset;
  /** 打仗胆量、开拓、沿海(负 = 偏内陆)、和谈底线:−50…50,加在君主的倾向上;不给 = 0 */
  war?: number;
  expand?: number;
  coast?: number;
  peace?: number;
  /** 发展重点 */
  focus?: PolicyFocus;
  /** 亲国、仇国(此刻的编号;还没立国的不在) */
  friends: number[];
  foes: number[];
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
  /** 建城时的民族 */
  culture: number;
  /** 此刻的人口上限(千人;算上生产能力、国都,不算受灾的折损;毁了 = 0) */
  capacity: number;
}

/** 城受的一次灾:sack 洗劫、famine 饥荒、plague 瘟疫、quake 地震水旱、slump 大疫以后的凋敝;loss = 当时人口折损几成,之后慢慢长回来 */
export interface SimSack {
  year: number;
  settlement: number;
  loss: number;
  cause: 'sack' | 'famine' | 'plague' | 'quake' | 'slump';
}

/** 一场战争 */
export interface SimWar {
  id: number;
  /** 攻方、守方 */
  a: number;
  b: number;
  /** 宣战那年 */
  start: number;
  /** 议和那年;还在打 = 不给 */
  end?: number;
  /** 这场仗里易手的州(按先后;by = 拿下它的一方) */
  takes: { year: number; region: number; by: number }[];
  /**
   * 还在打的才有:攻方拿下几州就议和、最多打几年(从宣战算),照攻方此刻说了算的人的倾向和方针算。
   * 讨伐民变、宗室争位、迁来的一支开的仗不看目标(没有 goal),打得更久;攻方国力是守方好几倍的灭国之战也不看目标
   */
  goal?: number;
  length?: number;
}

/** 两国议和以后的停战:until 那年以前互不宣战 */
export interface SimTruce {
  a: number;
  b: number;
  /** 议和那年 */
  since: number;
  until: number;
}

/** 记恨:a 在上一场和 b 的仗里净丢了州,until 那年以前看邻国时更想打 b */
export interface SimGrudge {
  a: number;
  b: number;
  /** 那场仗议和那年 */
  since: number;
  until: number;
}

/** 各州最近一次换国家(按州) */
export interface SimHandover {
  /** 哪年(从来没归过国家 = −Infinity) */
  since: Float64Array;
  /** 换到现在这国以前归哪国(−1 = 无主,或没换过) */
  prev: Int16Array;
}

/** 此刻的邦交 */
export interface SimPacts {
  /** 结着的盟(两国都还在):since 结盟那年,foe 共御的强邻(没有 = −1);作者、插件下令结的有期限的 until = 到哪年 */
  alliances: { a: number; b: number; since: number; foe: number; until?: number }[];
  /** 藩属 a 向宗主 b 称臣,since 称臣那年 */
  vassals: { a: number; b: number; since: number }[];
  /** 还没废的约 */
  treaties: SimTreaty[];
  /** 此刻的中立地 */
  zones: SimZone[];
}

export interface SimTreaty {
  /** 约的编号(史事 treaty 的 war 列) */
  id: number;
  /** 此刻还在约里的几国(按入约先后) */
  members: number[];
  /** 首次立约那年、最近一次立约或续约那年 */
  start: number;
  since: number;
  /** 约满那年;一直有效 = 不给 */
  until?: number;
  /** 有限竞争(还各守今疆:不进约国旁边的无主之地、不收约国的藩属);不然是互不侵犯 */
  limited: boolean;
  /** 约期内不许背约 */
  keep: boolean;
  /** 共同的强邻(没有 = −1) */
  foe: number;
  /** 这份约的中立地(SimZone.id;没有 = −1) */
  zone: number;
}

export interface SimZone {
  id: number;
  region: number;
  /** 依的那份约 */
  treaty: number;
  from: number;
  /** 让出那州的国家(原是无主之地 = −1) */
  owner: number;
  /** 定了哪年撤;不给 = 跟着约走 */
  until?: number;
}

/** 君主、掌权的人的倾向:开拓、好战、发展、重商,各 0–100 */
export interface Leanings {
  expand: number;
  war: number;
  develop: number;
  trade: number;
}

/** 掌实权的:march 引兵入朝、heir 太子监国、uncle 宗室摄政、minister 名臣辅政、chancellor 大臣专权、general 大将专权 */
export type SimRegencyKind = RegencyKind;

/** 一国此刻在位的那一位 */
export interface SimRuler {
  polity: number;
  /** 全国第几位(0 起,跨朝连续) */
  k: number;
  /** 第几段(SimPolity.dynasties 的下标) */
  dynasty: number;
  born: number;
  /** 即位那年 */
  from: number;
  /** 此刻的倾向(作者、插件改过的按改过的) */
  leanings: Leanings;
  /** 有人掌着实权(推演照他的倾向):哪一种、掌权那年、生年;没有 = 不给 */
  regent?: { kind: SimRegencyKind; since: number; born: number; leanings: Leanings };
  /** 此刻在世的儿子(按生年;heir = 预定的继承人);共和、军政府的执政和作者立的君主没有 */
  sons: { born: number; heir: boolean }[];
  /** 他此刻寿终的话会据地争位的儿子(生年,按长幼) */
  claimants: number[];
}

/** 物产(和官方表 res.* 的后缀同一套) */
export type SimResource = 'grain' | 'livestock' | 'copper' | 'iron' | 'coal' | 'timber' | 'salt' | 'fish' | 'oil' | 'rare' | 'gold';

/** 一条还没废的商道 */
export interface SimTrade {
  /** 商道的编号(按开通先后) */
  id: number;
  /** 买方国家、产地(州) */
  buyer: number;
  from: number;
  /** 开通那年 */
  opened: number;
  /** 此刻运的货 */
  goods: SimResource[];
  /** 断着(打仗挡着) */
  broken: boolean;
  /** 此刻的路线:经过的州,产地 → 买方国都所在的州 */
  path: number[];
}

/** 一支在路上的大迁徙 */
export interface SimTrek {
  /** 第几次大迁徙(按动身先后) */
  id: number;
  culture: number;
  /** 动身那年 */
  start: number;
  /** 路线:依次走过的州(出发的州 … 落脚的州)、到每一州的时刻(动身时就定了) */
  route: number[];
  years: number[];
  /** 此刻走到 route 的第几州 */
  at: number;
  /** 总体朝哪个方位走 */
  dir: TrekDir;
  /** 到了能占几州 */
  size: number;
  /** 为什么走:crowd 老家挤、famine 灾年、scatter 本族的国散了或亡了 */
  push: 'crowd' | 'famine' | 'scatter';
  /** 冲着什么去:chaos 那边大乱、plague 疫后空了、rich 富庶、tribal 部落地带 */
  pull: 'chaos' | 'plague' | 'rich' | 'tribal';
  /** 冲着哪国去(−1 = 部落地带) */
  target: number;
}

/** 正在传的那一场瘟疫 */
export interface SimPlague {
  /** 第几场(史事 plague 的 war 列) */
  id: number;
  /** 起疫那年 */
  start: number;
  /** 大瘟疫(传得远、死得多)、全球大疫 */
  great: boolean;
  pandemic: boolean;
  /** 作者、插件下的瘟疫和全球大疫的轻重(1–3);自己起的 = 0 */
  level: number;
  /** 这一场染过的州、上一年刚染上的州(下一年从这几州往外传);都是升序 */
  regions: number[];
  front: number[];
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

export interface SimFaith {
  id: number;
  /** 民间信仰 / 大教 / 教派 */
  kind: FaithKind;
  /** 民间信仰:哪个民族的 */
  culture?: number;
  /** 教派:从哪个大教分出来 */
  parent?: number;
  /** 大教 / 教派:创立(分出)的年份 */
  founded?: number;
  /** 大教:圣城(城的编号) */
  holy?: number;
}

/** 一条史事;a、b 按种类是国、民族或城的编号,region、settlement、war 没有 = −1 */
export type SimAnnal = PluginAnnal;

export { OFFICIAL_NAMES, officialUnit, type OfficialName } from './simOfficial';

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
  /** 到此刻有过的信仰(下标 = 信仰编号,和 owners('faith')、SimPolity.faith 同一套) */
  faiths(): SimFaith[];
  /** 官方表此刻的值(最近一次算的),个数 = 州数或国数;这一组还没装 = 全是 0 */
  official(name: OfficialName): Float64Array;
  /** [from, to] 年里的史事(按发生先后) */
  annals(from: number, to?: number): SimAnnal[];
  /** [from, to] 年里城受的灾(按先后) */
  sacks(from: number, to?: number): SimSack[];
  /** 所有战争(打完的也在;下标 = 战争编号,和史事的 war 同一套) */
  wars(): SimWar[];
  /** 两国之间此刻还在的停战 */
  truces(): SimTruce[];
  /** 此刻还记着的仇 */
  grudges(): SimGrudge[];
  /** 各州最近一次换国家 */
  handover(): SimHandover;
  /** 盟约、藩属、约和中立地 */
  pacts(): SimPacts;
  /** 在世的各国此刻在位的那一位(按国的编号) */
  rulers(): SimRuler[];
  /** 还没废的商道(发展度每算一步跟着走一步,是最近那一步的) */
  trades(): SimTrade[];
  /** 在路上的大迁徙 */
  treks(): SimTrek[];
  /** 正在传的瘟疫;没有 = null */
  plague(): SimPlague | null;
}

/** 物产的下标 → 名字(次序同发展度的 RESOURCES) */
export const SIM_RESOURCES: readonly SimResource[] = ['grain', 'livestock', 'copper', 'iron', 'coal', 'timber', 'salt', 'fish', 'oil', 'rare', 'gold'];

const TREK_DIR: Readonly<Record<MigrationDir, TrekDir>> = { 东: 'east', 南: 'south', 西: 'west', 北: 'north' };

const leanOf = (l: RulerLeanings): Leanings => ({ expand: l.expand, war: l.war, develop: l.develop, trade: l.trade });

/** 此刻的人口上限:populationAt 里 S 形曲线的那个上限 */
function ceilingAt(s: Settlement, t: number): number {
  if (!(t >= s.founded) || (s.ended !== undefined && t >= s.ended)) return 0;
  let cap = capacityAt(s, t);
  if (s.devCap) cap *= devFactorAt(s.devCap, t);
  if (s.capitalFrom !== undefined && t > s.capitalFrom) cap *= 1 + CAPITAL_BOOST * capitalLevel(s, t);
  return cap;
}

/** 国家 p 此刻在位的那一位 */
function rulerNow(pm: PolityModel, p: number, t: number): SimRuler {
  const P: Polity = pm.polities[p];
  const r = rulerOf(pm, p, t);
  const out: SimRuler = { polity: p, k: r.k, dynasty: r.dynasty, born: reignBorn(r), from: r.from, leanings: leanOf(leaningsAt(r, t).leanings), sons: [], claimants: [] };
  const g = regentOf(pm, p, t, r);
  if (g) out.regent = { kind: g.kind, since: g.start, born: g.born, leanings: leanOf(g.leanings) };
  if (!r.crown && royalSeg(P, r.dynasty)) {
    const tag = pm.rtag[p];
    const br = broodOf(pm.knobs, pm.rbase, tag, r, P);
    if (br.heir !== undefined && br.heir <= t) out.sons.push({ born: br.heir, heir: true });
    for (const x of br.extra) if (x.born <= t && x.life > t) out.sons.push({ born: x.born, heir: false });
    out.sons.sort((a, b) => a.born - b.born);
    out.claimants = claimants(pm.knobs, pm.rbase, tag, r, P, t);
  }
  return out;
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

  const alive = (p: number) => p >= 0 && p < pm.polities.length && pm.polities[p].ended === undefined;

  /** 方针里的国家键 → 此刻的编号(还没立国的去掉) */
  const picked = (keys: readonly string[] | undefined): number[] => {
    const out: number[] = [];
    for (const k of keys ?? []) {
      const q = pm.iv ? pm.iv.resolve(k) : -1;
      if (q >= 0) out.push(q);
    }
    return out;
  };

  const policyNow = (p: number, t: number): SimPolicy | null => {
    const seg = pm.policies.size ? segAt(pm.policies.get(p), t) : null;
    if (!seg) return null;
    const v = seg.v;
    const out: SimPolicy = { from: seg.t, friends: picked(v.friends), foes: picked(v.foes) };
    if (v.preset !== undefined) out.preset = v.preset;
    for (const k of ['war', 'expand', 'coast', 'peace'] as const) if (v[k] !== undefined) out[k] = v[k];
    if (v.focus !== undefined) out.focus = v.focus;
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
      const cm = councilModelOf(sim);
      const fs = faithSimOf(sim);
      const foes: number[][] = pm.polities.map(() => []);
      for (const w of wm?.active ?? []) {
        if (w.a < foes.length && !foes[w.a].includes(w.b)) foes[w.a].push(w.b);
        if (w.b < foes.length && !foes[w.b].includes(w.a)) foes[w.b].push(w.a);
      }
      return pm.polities.map((P, p) => {
        const power = api?.power?.(p) ?? -1;
        const seg = dynastyIndexAt(P, t);
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
          faith: fs ? fs.stateFaith(p) : -1,
          regime: segRegime(P, seg),
          reformed: reformedSeg(P, seg),
          charter: cm ? cm.charter(p) : 0,
          dynasty: seg,
          dynasties: P.dynasties?.length ? P.dynasties.map((d, i) => ({ from: d.year, regime: segRegime(P, i), seat: d.seat })) : [{ from: P.founded, regime: segRegime(P, 0), seat: P.capital }],
          rules: cm ? cm.rules(p) : { tax: 0, fief: false, army: 0, office: 0 },
        };
        const policy = policyNow(p, t);
        if (policy) info.policy = policy;
        if (P.ended !== undefined) info.ended = P.ended;
        if (P.parent !== undefined) info.parent = P.parent;
        return info;
      });
    },

    settlements() {
      const t = sim.now;
      return pm.settlements.map((s) => {
        const population = populationAt(s, t);
        const info: SimSettlement = {
          id: s.id,
          cell: s.cell,
          region: s.region,
          founded: s.founded,
          port: portAt(s, t),
          population,
          rank: settlementRank(population),
          culture: s.culture,
          capacity: ceilingAt(s, t),
        };
        if (s.ended !== undefined) info.ended = s.ended;
        return info;
      });
    },

    sacks(from, to = Infinity) {
      const hi = Math.min(to, sim.now);
      const out: SimSack[] = [];
      for (const s of pm.settlements) {
        const list = s.sacks;
        if (!list) continue;
        // 按年份先后记的:从尾上往回找
        let i = list.length;
        while (i > 0 && list[i - 1].year >= from) i--;
        for (; i < list.length && list[i].year <= hi; i++) out.push({ year: list[i].year, settlement: s.id, loss: list[i].loss, cause: list[i].cause ?? 'sack' });
      }
      return out.sort((a, b) => a.year - b.year || a.settlement - b.settlement);
    },

    cultures() {
      return (cultureModelOf(sim)?.cultures ?? pm.cultures).map((c) => {
        const info: SimCulture = { id: c.id, kind: c.kind, hearth: c.hearth, born: c.born };
        if (c.ended !== undefined) info.ended = c.ended;
        if (c.parent !== undefined) info.parent = c.parent;
        return info;
      });
    },

    faiths() {
      return (faithSimOf(sim)?.list ?? []).map((f) => {
        const info: SimFaith = { id: f.id, kind: f.kind };
        if (f.culture !== undefined) info.culture = f.culture;
        if (f.parent !== undefined) info.parent = f.parent;
        if (f.founded !== undefined) info.founded = f.founded;
        if (f.holy !== undefined) info.holy = f.holy;
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
      for (; i < all.length && all[i].year <= to; i++) out.push(annalOf(all[i]));
      return out;
    },

    wars() {
      const wm = warModelOf(sim);
      if (!wm) return [];
      const t = sim.now;
      const api = (sim.api as Partial<CivApi>).war;
      return wm.wars.map((w) => {
        const info: SimWar = { id: w.id, a: w.a, b: w.b, start: w.start, takes: w.takes.map((x) => ({ year: x.year, region: x.region, by: x.by })) };
        if (w.end !== undefined) info.end = w.end;
        else {
          // 和推演里议和那一步的算法一样
          const eff = effOf(pm, w.a, t);
          const length = lengthOf(wm, w) * eff.war;
          if (api?.revolt?.(w)) info.length = wm.k.REVOLT_LENGTH * length;
          else {
            info.goal = Math.max(1, goalOf(wm, w) + eff.goal);
            info.length = length;
          }
        }
        return info;
      });
    },

    truces() {
      const wm = warModelOf(sim);
      const out: SimTruce[] = [];
      if (!wm) return out;
      const t = sim.now;
      for (const [key, since] of wm.truce) {
        const a = Math.floor(key / 32768);
        const b = key % 32768;
        const until = since + wm.k.TRUCE;
        if (t < until && alive(a) && alive(b)) out.push({ a, b, since, until });
      }
      return out.sort((x, y) => x.a - y.a || x.b - y.b);
    },

    grudges() {
      const wm = warModelOf(sim);
      const out: SimGrudge[] = [];
      if (!wm) return out;
      const t = sim.now;
      for (const [key, since] of wm.grudge) {
        const a = Math.floor(key / 32768);
        const b = key % 32768;
        const until = since + wm.k.GRUDGE_YEARS;
        if (t < until && alive(a) && alive(b)) out.push({ a, b, since, until });
      }
      return out.sort((x, y) => x.a - y.a || x.b - y.b);
    },

    handover() {
      const wm = warModelOf(sim);
      if (!wm) return { since: new Float64Array(R).fill(-Infinity), prev: new Int16Array(R).fill(-1) };
      return { since: wm.since.slice(0, R), prev: wm.prev.slice(0, R) };
    },

    pacts() {
      const t = sim.now;
      const dm = diplomacyModelOf(sim);
      const alliances: SimPacts['alliances'] = [];
      const vassals: SimPacts['vassals'] = [];
      const seen = new Set<number>();
      const pair = (a: number, b: number) => Math.min(a, b) * 32768 + Math.max(a, b);
      if (dm) {
        for (const x of dm.pacts) {
          if (!alive(x.a) || !alive(x.b)) continue;
          seen.add(pair(x.a, x.b));
          alliances.push({ a: x.a, b: x.b, since: x.since, foe: x.foe });
        }
        for (const [v, l] of dm.liege) if (dm.liegeOf(v) === l) vassals.push({ a: v, b: l, since: dm.sworn.get(v) ?? -Infinity });
        vassals.sort((x, y) => x.a - y.a);
      }
      // 作者、插件下令结的
      for (const v of pm.iv?.list ?? []) {
        if (v.kind !== 'ally' || !(t >= v.from) || (v.until !== undefined && !(t < v.until))) continue;
        const a = pm.iv!.resolve(v.a);
        const b = pm.iv!.resolve(v.b);
        if (a === b || !alive(a) || !alive(b) || seen.has(pair(a, b))) continue;
        seen.add(pair(a, b));
        alliances.push({ a, b, since: v.from, foe: -1, ...(v.until !== undefined ? { until: v.until } : {}) });
      }
      const tm = treatyModelOf(sim);
      const treaties: SimTreaty[] = [];
      const zones: SimZone[] = [];
      if (tm) {
        for (const x of tm.live) {
          const info: SimTreaty = { id: x.id, members: tm.members(x), start: x.start, since: x.since, limited: x.multi, keep: x.keep, foe: x.foe, zone: x.zone };
          if (x.term > 0) info.until = x.since + x.term;
          treaties.push(info);
        }
        for (const z of tm.zones) {
          if (z.ended !== undefined) continue;
          const info: SimZone = { id: z.id, region: z.region, treaty: z.treaty, from: z.from, owner: z.owner };
          if (z.until !== undefined) info.until = z.until;
          zones.push(info);
        }
      }
      return { alliances, vassals, treaties, zones };
    },

    rulers() {
      const t = sim.now;
      const out: SimRuler[] = [];
      for (let p = 0; p < pm.polities.length; p++) if (alive(p)) out.push(rulerNow(pm, p, t));
      return out;
    },

    trades() {
      const t = sim.now;
      return liveTrade(sim).map(({ r, broken }) => {
        const goods: SimResource[] = [];
        for (const g of r.goods) if (g.until === undefined && g.from <= t) goods.push(SIM_RESOURCES[g.res]);
        return { id: r.id, buyer: r.buyer, from: r.from, opened: r.events[0]?.year ?? t, goods, broken, path: (r.paths[r.paths.length - 1]?.regions ?? []).slice() };
      });
    },

    treks() {
      const t = sim.now;
      const out: SimTrek[] = [];
      (trekModelOf(sim)?.list ?? []).forEach((M, id) => {
        if (M.settled !== undefined || !(M.year <= t)) return;
        let at = 0;
        while (at + 1 < M.years.length && M.years[at + 1] <= t) at++;
        out.push({ id, culture: M.culture, start: M.year, route: M.route.slice(), years: M.years.slice(), at, dir: TREK_DIR[M.dir], size: M.size, push: M.push, pull: M.pull, target: M.target });
      });
      return out;
    },

    plague() {
      const ob = plagueModelOf(sim)?.now;
      if (!ob) return null;
      const regions: number[] = [];
      for (let r = 0; r < ob.hit.length; r++) if (ob.hit[r]) regions.push(r);
      return { id: ob.k, start: ob.t0, great: ob.great, pandemic: ob.pan !== undefined, level: ob.level, regions, front: ob.front.slice() };
    },
  };
}
