/**
 * 思潮:世上的几种说法(天命之说、律法之说……),每州每说一个接受度 0–1。推演里每 STEP(20)年算一步,
 * 紧跟在发展度那一步后面(同一刻,读发展度刚算完的五种能力、眼下能用的物产)。
 * **先只算只看**:不影响推演里的任何东西,同一个种子的国界、兴亡、战争、人物一个都不变。纯计算,不碰 DOM。
 *
 * **数表**(THOUGHTS,一说一行):名字、冒出来的前提(发明表 INVENTIONS 里的几样:那样能力到了那一档)、助长的发明(到了扎得更深)、
 *   在哪扎根(root:一条公式)、对头(哪几说盛了它就衰)、主张、以后支持什么做法 / 政体(改制那一步才用,现在只记着)。
 *
 * **冒出来**:世上第一次有州满足前提 —— 有一座镇以上的城(EMERGE_POP)、前提的几样能力都到了那一档、合到 EMERGE_FIT —— 那座城始倡这一说,
 *   记一条 origin(那年、那州、那城、那族、那国),那州的接受度至少 ORIGIN_SEED。每说只冒一次,之后只靠传。
 *   同一步里有几州都满足,取估出的那一刻最早的(一样早取合得最好的);那一刻按上一步到这一步的能力线性估出跨过前提的时候
 *   (这一步以前就够了的 = 这一步;不早于那州归了现在的民族、国家,不早于那座城建城)。
 * **传开**(每步):
 *   - 向邻州学:向接受度最高的有人住的邻州靠拢,同一国里快(SAME_STATE 倍)、跨国慢,翻山、过海峡、走航线更慢(航线随运输能力快一点);
 *     这州合得来的学得多(合不来的只学到 RECEPT 那几成,前提差得远的学不进来);有报刊(信息到了报刊那一档)的州学得快 PRESS_UP 倍。
 *     一步至多追平最高的邻州。
 *   - 扎根:接受度往"这州能到多高"长 —— 标 = 合 × 前提够不够(差 BELOW 档 = 0,过了 ABOVE 档 = 1)× 助长 × (1 − 别的几说压的几成:
 *     每一说 CROWD,对头另加);
 *     刚传进来的(不到 FOOT)长得慢。
 *   - 退潮:比标高的每年往下掉差距的 FADE:时代变了合不来了(天命之说到了印刷、报刊的时代渐衰)、对头盛了、这州没人住了。
 *   - 移民:征服以后迁进来的本国人带着本国的说法(这州的接受度往那国的国中靠 MIGRANT_MIX)。避兵外迁的不知从哪州来,不算。
 *   民族不进接受度的算法(哪族的人都一样;民族只用来看有没有人住、迁进来的是不是那国的人)。
 * **各国**:国中 = 国里有人住的各州按人口(城加乡村)加权;到 ARRIVE(半成)的那一刻算这一说传进本国(按上一步到这一步线性估,不早于立国);
 *   始倡这一说的那国 = 冒出来那年。
 *
 * **怎么算**:合、思潮、国中各是一张数表(ideoTables.ts,规则用数表的公式语言写),由数表引擎(tables/)每 STEP 年算一步;
 *   这里是事件层:每步把归属、能力、人口、城、物产填进输入表,算之前把移民写进去,算完找冒出来的、记各国的接受度、存快照。
 * 结果是 Civ.ideology:每 SNAP 年一份的各州接受度(加结束那年)、各国每 STEP 年一份的接受度、各国各说传进本国的年份、冒出来的大事,
 *   还有接着推(CivSim.fromCiv)要用的全精度状态。任意年份用 ideologyAt、polityIdeologyAt 查(前后两份线性插值)。
 * 只用加减乘除,跨 CPU 逐位一致;不用随机数。
 */
import type { Civ, IdeoEvent, Ideology, IdeoState, Year } from './types';
import type { TableCard } from './tables';
import { AdjKind, Layer } from './types';
import type { CivSim } from './sim';
import { TableEngine } from './tables';
import { CAP_COUNT, CAPS, INVENTIONS, RESOURCE_COUNT, Res, devModelOf, type DevModel } from './development';
import { populationAt } from './growth';
import { ideoCards } from './ideoTables';
import { subSeed } from './rand';

/** 一说一行 */
export interface Thought {
  name: string;
  /** 冒出来的前提:这几样发明(INVENTIONS 的名字)那一档都到了 */
  needs: readonly string[];
  /** 助长:到了这样发明那一档扎得更深(没有 = 不写) */
  boost?: string;
  /** 在哪扎根(给人看的) */
  where: string;
  /**
   * 合(0–1,超出的压回来):数表的公式语言,能读 能力.生产 / 运输 / 信息 / 行政 / 动员、城(城的规模 0–1)、城民(千人)、港口、
   * 粮、矿(眼下能用几档)、国号(档位,不在国里 = −1)、州数、has(国)
   */
  root: string;
  /** 对头:哪几说盛了它就衰(说名 → 压几成;对头的接受度 × 这个数,加起来从这州能到的高度里扣掉) */
  rivals?: Readonly<Record<string, number>>;
  /** 主张(一句话) */
  say: string;
  /** 以后支持什么做法 / 政体(改制那一步才用) */
  backs: readonly string[];
}

/** 思潮表(下标就是快照里每州的第几说) */
export const THOUGHTS: readonly Thought[] = [
  {
    name: '天命之说',
    needs: ['文字'],
    where: '农本大国',
    root: 'if(has(国), 0.2 + 0.1 * min(2, 粮) + 0.1 * clamp(国号, 0, 3) + 0.1 * min(1, 州数 / 20) - 0.15 * 港口 - 0.1 * max(0, 能力.信息 - 3), 0)',
    rivals: { 民权之说: 0.6, 共治之说: 0.3, 均产之说: 0.3 },
    say: '君权受之于天,守成为上',
    backs: ['君主世袭', '敬天祭祀'],
  },
  {
    name: '律法之说',
    needs: ['成文法'],
    where: '治理得好的国家',
    root: 'if(has(国), 0.35 + 0.08 * min(6, 能力.行政) + 0.04 * clamp(国号, 0, 3), 0)',
    say: '以法治国,法不避贵',
    backs: ['成文法', '铨选官吏'],
  },
  {
    name: '共治之说',
    needs: ['帆船'],
    boost: '字母',
    where: '商城、港口',
    root: '0.1 + 0.3 * 港口 + 0.45 * 城 + 0.04 * 能力.运输 + if(has(国), 0.15 * max(0, 1 - 州数 / 12), 0.05)',
    rivals: { 天命之说: 0.3 },
    say: '国事由城中众人共议',
    backs: ['城中议事', '推举执政'],
  },
  {
    name: '技艺之说',
    needs: ['水车'],
    boost: '高炉',
    where: '矿区、工坊',
    root: '0.1 + 0.1 * min(4, 矿) + 0.05 * 能力.生产 + 0.25 * 城',
    say: '百工技艺可以富国',
    backs: ['官办矿冶', '工坊'],
  },
  {
    name: '民权之说',
    needs: ['印刷术'],
    boost: '报刊',
    where: '大城',
    root: '0.05 + 0.55 * 城 + 0.06 * 能力.信息 + 0.1 * 港口',
    rivals: { 天命之说: 0.4, 国族之说: 0.2 },
    say: '国之本在民,民可议政',
    backs: ['立宪', '议会'],
  },
  {
    name: '国族之说',
    needs: ['报刊', '征兵制'],
    where: '大国',
    root: 'if(has(国), 0.15 + 0.05 * 能力.动员 + 0.05 * 能力.信息 + 0.2 * min(1, 州数 / 20), 0)',
    rivals: { 共治之说: 0.2, 均产之说: 0.3 },
    say: '一国之民同心,举国为一',
    backs: ['征兵', '举国动员'],
  },
  {
    name: '均产之说',
    needs: ['机械织机'],
    where: '工坊大城',
    root: '0.05 + 0.5 * 城 + 0.05 * 能力.生产',
    rivals: { 天命之说: 0.2, 国族之说: 0.3 },
    say: '田产工坊当归众人',
    backs: ['均田', '公产'],
  },
];
export const THOUGHT_COUNT = THOUGHTS.length;

/** 快照里接受度存成 × 这个数(Uint8) */
export const IDEO_SCALE = 250;
/** 国中到这么多算这一说传进本国(卡片上不到这么多的不写) */
export const ARRIVE = 0.05;

/** 每多少年算一步(和发展度一样,跟着它算)、多少年存一份各州的快照 */
const STEP = 20;
const SNAP = 100;
/** 冒出来:那座城至少多少人(千人)、合至少多少;那州的接受度至少多少 */
const EMERGE_POP = 8;
const EMERGE_FIT = 0.55;
const ORIGIN_SEED = 0.3;
/** 前提够不够:差 BELOW 档 = 0,过了 ABOVE 档 = 1;助长的发明没到时能到的高度只剩 1 − BOOST */
const BELOW = 1;
const ABOVE = 0.8;
const BOOST = 0.3;
/** 别的几说盛了,各说能到的高度都低一点(每一说的接受度 × CROWD;对头另加) */
const CROWD = 0.12;
/** 向邻州学:每年追上差距的比例;同一国里快几倍;邻接边的类型 → 学得多快(航线另加运输能力的几成) */
const LEARN = 0.025;
const SAME_STATE = 2.5;
const LINK: readonly number[] = (() => {
  const t = [1, 1, 1, 1, 1];
  t[AdjKind.River] = 1.1;
  t[AdjKind.Mountain] = 0.35;
  t[AdjKind.Strait] = 0.6;
  t[AdjKind.SeaRoute] = 0.25;
  return t;
})();
const SEA_PER_TRANSPORT = 0.08;
/** 合不来的州只学到几成 */
const RECEPT = 0.3;
/** 有报刊的州学得快几倍 */
const PRESS_UP = 1.5;
/** 扎根:每年长差距的几成;不到 FOOT 的长得慢(按比例);退潮:每年掉差距的几成 */
const GROW = 0.02;
const FOOT = 0.1;
const FADE = 0.006;
/** 移民:迁进来的州往那国的国中靠几成 */
const MIGRANT_MIX = 0.5;
/** 城的规模 = 城民 / (城民 + CITY_HALF) */
const CITY_HALF = 40;
/** 没有助长的发明时,助长的档位写成这个(一定够) */
const NO_BOOST = -100;

/** 发明的名字 → 哪样能力、哪一档 */
function invention(name: string): { cap: number; level: number } {
  const v = INVENTIONS.find((x) => x.name === name);
  if (!v) throw new Error(`思潮表:发明表里没有「${name}」`);
  return { cap: v.cap, level: v.level };
}

// 发明表、能力的名字在 development.ts 里,它和 sim.ts、这个文件互相引用:下面两样第一次用到时才拼(模块刚载入时它们可能还没有)
let needs: { cap: number; level: number }[][] | null = null;
let cards: TableCard[] | null = null;

/** 各说的前提(能力的下标、档位;一样或两样) */
function needsOf(): { cap: number; level: number }[][] {
  return (needs ??= THOUGHTS.map((t) => {
    if (t.needs.length < 1 || t.needs.length > 2) throw new Error(`思潮表:「${t.name}」的前提要一样或两样`);
    return t.needs.map(invention);
  }));
}

/** 思潮的数表(规则里的常数都取这个文件里的;测试拿它在几州的小图上单算) */
export function ideoTableCards(): TableCard[] {
  if (cards) return cards;
  const NEEDS = needsOf();
  cards = ideoCards(
    {
      NAMES: THOUGHTS.map((t) => t.name),
      CAPS,
      ROOTS: THOUGHTS.map((t) => t.root),
      NEED_A_CAP: NEEDS.map((n) => n[0].cap),
      NEED_A_LV: NEEDS.map((n) => n[0].level),
      NEED_B_CAP: NEEDS.map((n) => n[n.length - 1].cap),
      NEED_B_LV: NEEDS.map((n) => n[n.length - 1].level),
      BOOST_CAP: THOUGHTS.map((t) => (t.boost ? invention(t.boost).cap : 0)),
      BOOST_LV: THOUGHTS.map((t) => (t.boost ? invention(t.boost).level : NO_BOOST)),
      RIVAL: THOUGHTS.flatMap((t) => THOUGHTS.map((u) => (u === t ? 0 : CROWD + (t.rivals?.[u.name] ?? 0)))),
      BELOW,
      ABOVE,
      BOOST,
      LEARN,
      SAME_STATE,
      LINK,
      SEA_ROUTE: AdjKind.SeaRoute,
      SEA_PER_TRANSPORT,
      RECEPT,
      PRESS_CAP: invention('报刊').cap,
      PRESS_LV: invention('报刊').level,
      PRESS_UP,
      GROW,
      FOOT,
      FADE,
      CITY_HALF,
    },
    STEP,
  );
  return cards;
}

// ---------------------------------------------------------------------------
// 推演里的模型

export interface IdeoModel {
  /** 州数(地形大事以后按新的州表补齐) */
  R: number;
  d: DevModel;
  eng: TableEngine;
  /** 上一步算到哪一年;史事读到第几条 */
  last: Year;
  annals: number;
  /** 各说冒出来过没有 */
  emerged: Uint8Array;
  events: IdeoEvent[];
  snaps: Uint8Array[];
  snapYears: Year[];
  /** 各国每 STEP 年一份的接受度(× IDEO_SCALE,说数个一份) */
  series: ({ from: Year; v: number[] } | undefined)[];
  /** 各国各说传进本国的年份(国 × 说数;没传进 = NaN) */
  arrive: number[];
}

const models = new WeakMap<CivSim, IdeoModel>();

/** 推演引擎上挂着的思潮模型(测试、统计用) */
export function ideoModelOf(sim: CivSim): IdeoModel | undefined {
  return models.get(sim);
}

function emptyModel(d: DevModel, seed: number): IdeoModel {
  const reg = d.pm.terrain.regions;
  const R = d.R;
  const eng = new TableEngine({
    seed: subSeed(seed, 'civ-ideology'),
    cards: ideoTableCards(),
    units: { region: { count: R, adjStart: reg.adjStart, adj: reg.adj, adjKind: reg.adjKind, seat: reg.seat } },
    owner: '国',
  });
  eng.setPolities(d.pm.polities.length);
  eng.start(0);
  return { R, d, eng, last: -Infinity, annals: 0, emerged: new Uint8Array(THOUGHT_COUNT), events: [], snaps: [], snapYears: [], series: [], arrive: [] };
}

/** 登记思潮(generateCiv 里,installDevelopment 之后):跟着发展度每 STEP 年算一步 */
export function installIdeology(sim: CivSim, seed: number): void {
  const d = devModelOf(sim);
  if (!d) return;
  hook(sim, emptyModel(d, seed));
}

/**
 * 接着推(CivSim.fromCiv 调用,在 resumeDevelopment 之后):从 Civ.ideology.state 接上(地形大事以后州多了的补 0);
 * 没存状态的(加思潮以前的历史)从现在起算,还没冒出来的照常冒
 */
export function resumeIdeology(sim: CivSim, civ: Civ): void {
  const d = devModelOf(sim);
  if (!d) return;
  const m = emptyModel(d, civ.seed);
  const K = THOUGHT_COUNT;
  const ideo = civ.ideology;
  const st = ideo?.state;
  if (ideo && st) {
    const keep = ideo.snapYears.length - (st.tail ? 1 : 0);
    m.snaps = ideo.snaps.slice(0, keep).map((x) => padTo(x, m.R * K));
    m.snapYears = ideo.snapYears.slice(0, keep);
    m.events = ideo.events.map((e) => ({ ...e }));
    for (const e of m.events) m.emerged[e.thought] = 1;
    m.series = ideo.polities.map((s) => (s ? { from: s.from, v: Array.from(s.v) } : undefined));
    m.arrive = Array.from(ideo.arrive);
    m.last = st.last;
    m.annals = st.annals;
    for (const id of ['合', '思潮', '国中']) {
      const to = m.eng.get(id);
      const from = st.tables.data[id];
      const v = new Float64Array(to.length);
      if (from) v.set(from.subarray(0, Math.min(from.length, v.length)));
      m.eng.set(id, v);
    }
    m.eng.resume(st.last);
  } else {
    // 没存状态:跟着发展度从它上一步算到的那一年接着算,史事从现在起读
    m.last = d.last;
    m.annals = civ.annals.length;
    if (m.last > -Infinity) m.eng.resume(m.last);
  }
  hook(sim, m);
}

function padTo(a: Uint8Array, n: number): Uint8Array {
  if (a.length >= n) return a.slice();
  const b = new Uint8Array(n);
  b.set(a);
  return b;
}

function hook(sim: CivSim, m: IdeoModel): void {
  models.set(sim, m);
  m.d.afterStep = (y, prev) => tick(sim, m, y, prev);
}

/** 州 r 此刻的城(还在的那一座;没有 = undefined) */
function cityIn(d: DevModel, r: number) {
  const c = d.pm.cityOf[r];
  if (c < 0) return undefined;
  const s = d.pm.settlements[c];
  return s.ended === undefined ? s : undefined;
}

/** 算一步(第 y 年,发展度这一步刚算完;prev = 这一步开头各州的能力) */
function tick(sim: CivSim, m: IdeoModel, y: Year, prev: Float64Array): void {
  const { d, eng } = m;
  const pm = d.pm;
  const R = m.R;
  const K = THOUGHT_COUNT;
  const P = pm.polities.length;
  const ownC = sim.owners[Layer.Culture];
  const ownP = sim.owners[Layer.Polity];
  const t0 = m.last > -Infinity ? m.last : y;

  // 输入表:各州归属、能力、城的人口、一州的人口、港口、粮、矿;各国的国号、州数
  eng.setPolities(P);
  const [iC, iP, iCap, iCity, iPop, iPort, iGrain, iMine] = ['民族', '国', '能力', '城民', '人数', '港口', '粮', '矿'].map((id) => eng.input(id));
  const rural = d.ruralNow?.().data;
  const cur = d.cur;
  const avail = d.availNow;
  for (let r = 0; r < R; r++) {
    iC[r] = ownC[r];
    iP[r] = ownP[r];
    for (let c = 0; c < CAP_COUNT; c++) iCap[r * CAP_COUNT + c] = cur[r * CAP_COUNT + c];
    const s = cityIn(d, r);
    const cp = s ? populationAt(s, y) : 0;
    iCity[r] = cp;
    iPop[r] = cp + (rural && r < rural.length ? rural[r] : 0);
    iPort[r] = pm.port[r];
    const o = r * RESOURCE_COUNT;
    iGrain[r] = avail[o + Res.Grain];
    iMine[r] = avail[o + Res.Copper] + avail[o + Res.Iron] + avail[o + Res.Coal];
  }
  const iTier = eng.input('国号');
  const iSize = eng.input('州数');
  for (let p = 0; p < P; p++) {
    const titles = pm.polities[p].titles;
    iTier[p] = titles?.length ? Math.max(0, titles[titles.length - 1].tier) : 0;
    iSize[p] = pm.size[p];
  }

  // 移民:上一步以来征服后迁进来的本国人,这州的接受度往那国的国中(上一步算完的)靠
  for (; m.annals < sim.annalCount; m.annals++) {
    const a = sim.annal(m.annals);
    if (a.kind !== 'migrate') continue;
    const r = a.region;
    const p = a.war;
    if (!(r >= 0 && r < R && p >= 0 && p < P) || pm.polities[p].culture !== a.a) continue;
    for (let k = 0; k < K; k++) {
      const v = eng.value('思潮', r, k);
      eng.write('思潮', r, k, v + MIGRANT_MIX * (eng.value('国中', p, k) - v));
    }
  }

  // 冒出来:还没冒过的几说,这一步里满足前提的州中估出的那一刻最早的。各州的接受度算完、各国的(国中)算之前写进去,
  // 这一步的国中、快照都算上冒出来的那一州
  let emerged = false;
  const emerge = () => {
    emerged = true;
    const fit = eng.get('合');
    const need = needsOf();
    for (let k = 0; k < K; k++) {
      if (m.emerged[k]) continue;
      let at = -1;
      let tAt = Infinity;
      for (let r = 0; r < R; r++) {
        if (ownC[r] < 0 || iCity[r] < EMERGE_POP) continue;
        const f = fit[r * K + k];
        if (!(f >= EMERGE_FIT)) continue;
        let ok = true;
        let tc = -Infinity;
        for (const n of need[k]) {
          const a1 = cur[r * CAP_COUNT + n.cap];
          if (!(a1 >= n.level)) {
            ok = false;
            break;
          }
          const a0 = prev[r * CAP_COUNT + n.cap];
          if (a0 < n.level) tc = Math.max(tc, t0 + ((y - t0) * (n.level - a0)) / (a1 - a0));
        }
        if (!ok) continue;
        // 前提这一步以前就够了(这一步才有了城、合得来了):算这一步
        const s = cityIn(d, r)!;
        const t = Math.min(y, Math.max(tc > -Infinity ? tc : y, d.sinceC[r], d.sinceP[r], s.founded));
        if (t < tAt || (t === tAt && f > fit[at * K + k])) (tAt = t), (at = r);
      }
      if (at < 0) continue;
      m.emerged[k] = 1;
      eng.write('思潮', at, k, Math.max(eng.value('思潮', at, k), ORIGIN_SEED));
      const p = ownP[at];
      m.events.push({ year: tAt, kind: 'origin', thought: k, region: at, settlement: cityIn(d, at)!.id, culture: ownC[at], polity: p });
      if (p >= 0) {
        growArrive(m, P);
        if (Number.isNaN(m.arrive[p * K + k])) m.arrive[p * K + k] = tAt;
      }
    }
  };
  eng.step(y, (done) => {
    if (done.includes('思潮')) emerge();
  });
  if (!emerged) emerge();

  // 各国:这一步的接受度(按人口加权)记一份;到半成的那一刻算传进本国
  growArrive(m, P);
  const nat = eng.get('国中');
  for (let p = 0; p < P; p++) {
    const q = pm.polities[p];
    if (q.ended !== undefined || !pm.size[p]) continue;
    let s = m.series[p];
    if (!s) s = m.series[p] = { from: y, v: [] };
    // 中间亡过国的那几步补 0
    for (let at = s.from + (s.v.length / K) * STEP; at < y; at += STEP) for (let k = 0; k < K; k++) s.v.push(0);
    const base = s.v.length - K;
    for (let k = 0; k < K; k++) {
      const v1 = nat[p * K + k];
      const i = p * K + k;
      if (Number.isNaN(m.arrive[i]) && v1 >= ARRIVE) {
        const v0 = base >= 0 ? s.v[base + k] / IDEO_SCALE : 0;
        const f = v1 > v0 ? Math.min(1, Math.max(0, (ARRIVE - v0) / (v1 - v0))) : 1;
        m.arrive[i] = Math.min(y, Math.max(q.founded, t0 + (y - t0) * f));
      }
      s.v.push(Math.round(v1 * IDEO_SCALE));
    }
  }

  m.last = y;
  if (y % SNAP === 0) {
    m.snaps.push(quantize(eng.get('思潮')));
    m.snapYears.push(y);
  }
}

function growArrive(m: IdeoModel, P: number): void {
  while (m.arrive.length < P * THOUGHT_COUNT) m.arrive.push(NaN);
}

function quantize(a: Float64Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * IDEO_SCALE);
  return out;
}

/** 推演结束(或推到一半要接着推):整理一份(和此刻的全精度状态) */
export function finishIdeology(sim: CivSim, endYear: Year): Ideology | undefined {
  const m = models.get(sim);
  if (!m) return undefined;
  const K = THOUGHT_COUNT;
  const P = m.d.pm.polities.length;
  const snaps = m.snaps.slice();
  const snapYears = m.snapYears.slice();
  const tail = !snapYears.length || snapYears[snapYears.length - 1] < endYear;
  if (tail) {
    snaps.push(quantize(m.eng.get('思潮')));
    snapYears.push(endYear);
  }
  const polities = Array.from({ length: P }, (_, p) => {
    const s = m.series[p];
    return s ? { from: s.from, v: Uint8Array.from(s.v) } : null;
  });
  const arrive = new Float64Array(P * K).fill(NaN);
  arrive.set(m.arrive.slice(0, P * K));
  // 同一步里的几件按估出来的那一刻排(排序是稳定的)
  const events = m.events.map((e) => ({ ...e })).sort((a, b) => a.year - b.year);
  // 国中按此刻的国数存(上一步以后才立的国补 0;接着推时建表就按此刻的国数,两边一样长)
  const nat = new Float64Array(P * K);
  const natNow = m.eng.get('国中');
  nat.set(natNow.subarray(0, Math.min(natNow.length, nat.length)));
  const state: IdeoState = {
    last: m.last,
    annals: m.annals,
    tail,
    tables: { last: m.last, data: { 合: m.eng.get('合').slice(), 思潮: m.eng.get('思潮').slice(), 国中: nat } },
  };
  return { snaps, snapYears, polities, arrive, events, state };
}

// ---------------------------------------------------------------------------
// 查(界面、统计用)

/** 第 year 年各州各说的接受度(州 × 说数,0–1):前后两份快照线性插值;第一份以前 = 0,最后一份以后照最后一份 */
export function ideologyAt(ideo: Ideology, year: Year, out?: Float32Array): Float32Array {
  const { snaps, snapYears: ys } = ideo;
  const n = snaps.length ? snaps[snaps.length - 1].length : 0;
  const o = out && out.length === n ? out : new Float32Array(n);
  if (!snaps.length || !(year >= ys[0])) return o.fill(0);
  let i = 0;
  while (i + 1 < ys.length && ys[i + 1] <= year) i++;
  const a = snaps[i];
  const b = snaps[Math.min(i + 1, snaps.length - 1)];
  const w = i + 1 < ys.length ? (year - ys[i]) / (ys[i + 1] - ys[i]) : 0;
  for (let j = 0; j < n; j++) {
    const x = j < a.length ? a[j] : 0;
    const z = j < b.length ? b[j] : 0;
    o[j] = (x + (z - x) * w) / IDEO_SCALE;
  }
  return o;
}

/**
 * 第 year 年国家 p 各说的接受度(按人口加权,0–1;说数个):每 STEP 年一份,前后两份线性插值,
 * 第一份以前照第一份、最后一份以后照最后一份;那国从没在整 STEP 年上在过 = 全 0
 */
export function polityIdeologyAt(ideo: Ideology, p: number, year: Year, out?: Float32Array): Float32Array {
  const K = THOUGHT_COUNT;
  const o = out && out.length === K ? out : new Float32Array(K);
  const s = ideo.polities[p];
  if (!s || !s.v.length) return o.fill(0);
  const n = s.v.length / K;
  const x = Math.min(n - 1, Math.max(0, (year - s.from) / STEP));
  const i = Math.floor(x);
  const j = Math.min(n - 1, i + 1);
  const w = x - i;
  for (let k = 0; k < K; k++) {
    const a = s.v[i * K + k];
    o[k] = (a + (s.v[j * K + k] - a) * w) / IDEO_SCALE;
  }
  return o;
}

/** 国家 p 第 k 说传进本国的年份(国中第一次到 ARRIVE 的那一刻;始倡这一说的那国 = 冒出来那年);没传进 = NaN */
export function thoughtArrival(ideo: Ideology, p: number, k: number): number {
  const i = p * THOUGHT_COUNT + k;
  return i >= 0 && i < ideo.arrive.length ? ideo.arrive[i] : NaN;
}

/** 第 k 说世上头一处冒在哪(那年、那州、那城、那族、那国);还没冒出来 = undefined */
export function thoughtOrigin(ideo: Ideology, k: number): IdeoEvent | undefined {
  return ideo.events.find((e) => e.kind === 'origin' && e.thought === k);
}

/** 第 year 年国家 p 有哪几说(到 min 的,按接受度从高到低;一样高的按表里的先后):说的下标、几成、哪年传进本国 */
export function polityThoughts(ideo: Ideology, p: number, year: Year, min = ARRIVE): { thought: number; share: number; arrive: number }[] {
  const v = polityIdeologyAt(ideo, p, year);
  const out: { thought: number; share: number; arrive: number }[] = [];
  for (let k = 0; k < THOUGHT_COUNT; k++) if (v[k] >= min) out.push({ thought: k, share: v[k], arrive: thoughtArrival(ideo, p, k) });
  return out.sort((a, b) => b.share - a.share || a.thought - b.thought);
}
