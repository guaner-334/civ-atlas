/**
 * 民族的文化特质(民族卡片「特质」一节,也给 AI 写风俗当材料):从这一族住的地方和它经历的历史里"读"出来,
 * 只描述,不进推演、不反过来改历史(同一份历史读几遍都一样)。
 *
 * 读哪段历史:时间轴那一年往前 TRAIT_SPAN(300)年(出现得晚的从出现那年起;已消亡的读消亡前的那一段),
 * 所以同一族不同时代读出来可以不一样。每族最多三条,按显著程度排;一条也够不上就不写。
 *
 *   尚武  本族之国这段时间打下的州,比各族平均多一截
 *   重商  住的州里港口多,本族之国的市税占收入的份额比各国平均高
 *   崇文  信息能力在世上靠前
 *   敬神  几乎全信大教,而且圣城在本族的城里、或者这段时间有教派在本族之国分出
 *   善骑  游牧民族,或住的州多半是草原、荒漠
 *   善航  海洋民族,或住的州多半有港口
 *   坚忍  本族之国亡过几回、避兵迁徙过几回,族还在
 *
 * 分两步:worldFacts 把这一段里各族的数一次数好(按世界和年份缓存),readTraits 只看一族的数、按门槛定特质和来由
 * (纯函数,单测拿造出来的数逐条试门槛)。门槛按 20 个种子各族的分布定(多数族读出一到三条,七种都出得来)。
 */
import { Biome } from '../../biomes';
import { developmentAt } from '../development';
import { BOOK_COLS, fiscalAt } from '../fiscalBook';
import { polityAlive, polityName, portAt } from '../growth';
import { faithAt } from '../religion';
import { ownersAt } from '../engine/timeline';
import type { Civ, Culture, CultureKind, Year } from '../types';

/** 往前读几年 */
export const TRAIT_SPAN = 300;

export type TraitKey = 'martial' | 'mercantile' | 'learned' | 'pious' | 'horse' | 'sea' | 'enduring';

export const TRAIT_WORDS: Record<TraitKey, string> = {
  martial: '尚武',
  mercantile: '重商',
  learned: '崇文',
  pious: '敬神',
  horse: '善骑',
  sea: '善航',
  enduring: '坚忍',
};

/** 每族最多几条 */
export const TRAIT_MAX = 3;

export interface Trait {
  key: TraitKey;
  /** 两个字的词:"尚武" */
  word: string;
  /** 一句来由(从哪看出来的) */
  why: string;
  /** 显著程度:够上门槛 = 1,越大越显著(排序用) */
  strength: number;
}

/** 读的那一段历史(整年,含两头) */
export interface TraitWindow {
  from: number;
  to: number;
}

/**
 * 时间轴停在 year 时读哪一段:往前 TRAIT_SPAN 年,出现得晚的从出现那年起;已消亡的读到消亡前一年;
 * 还没出现、没能兴起的 = null
 */
export function traitWindow(cu: Pick<Culture, 'born' | 'ended' | 'unborn'>, year: Year): TraitWindow | null {
  if (cu.unborn || !(year >= cu.born)) return null;
  const born = Math.floor(cu.born);
  const to = cu.ended !== undefined && cu.ended <= year ? Math.max(born, Math.ceil(cu.ended) - 1) : Math.floor(year);
  return { from: Math.max(born, to - TRAIT_SPAN), to };
}

/** 一族在那一段里的数(readTraits 只看这些) */
export interface CultureFacts {
  kind: CultureKind;
  /** 段末住几州(0 = 一州也没有了) */
  regions: number;
  // 尚武
  /** 本族之国(国家的民族 = 这一族)这段时间打下几州(不算议和时割来的) */
  conquests: number;
  /** 各族平均打下几州(这段时间在世的各族,一州没打的也算) */
  conquestsAvg: number;
  /** 本族之国这段时间宣战几回 */
  wars: number;
  // 重商 / 善航
  /** 住的州里有港口城的几州 */
  ports: number;
  /** 本族之国的市税占田赋、工商、市税合计的几成(按收入加权;没有国家 = −1) */
  market: number;
  /** 各国平均(同上,段末在世、记着账的各国) */
  marketAvg: number;
  // 崇文
  /** 信息能力(住的各州平均)在世上排第几(1 起;没排上 = 0) */
  infoRank: number;
  /** 排了几族(段末住着三州以上的) */
  infoOf: number;
  // 敬神
  /** 住的州里信大教(含教派)的几成 */
  great: number;
  /** 圣城在本族住的州里的大教(段末那座城还在、那一州住的是本族) */
  holy: string;
  /** 这段时间在本族之国分出的教派:教名、年份、国名 */
  sect: { name: string; year: number; polity: string } | null;
  // 善骑
  /** 住的州里草原、荒漠的几成 */
  steppe: number;
  // 坚忍
  /** 本族之国这段时间亡了几回 */
  falls: number;
  /** 这段时间迁徙了几波 */
  migrations: number;
  /** 其中避兵锋迁走的几波 */
  flights: number;
  /** 住的州里归异族之国(国家的民族不是本族)的几成 */
  foreign: number;
}

/** 草原、荒漠(善骑) */
const STEPPE = new Set<number>([Biome.Steppe, Biome.Savanna, Biome.ColdDesert, Biome.TemperateDesert, Biome.HotDesert]);

const COL_LAND = BOOK_COLS.indexOf('田赋');
const COL_CRAFT = BOOK_COLS.indexOf('工商');
const COL_MARKET = BOOK_COLS.indexOf('市税');

/** 一段时间里各族的数(按民族编号);worldFacts 算一次缓存起来 */
interface WorldFacts {
  key: string;
  /** 段末各州住的民族 */
  culture: Int16Array;
  regions: Int32Array;
  conquests: Int32Array;
  conquestsAvg: number;
  wars: Int32Array;
  ports: Int32Array;
  market: Float64Array;
  marketAvg: number;
  infoRank: Int32Array;
  infoOf: number;
  great: Int32Array;
  steppe: Int32Array;
  falls: Int32Array;
  foreign: Int32Array;
}

const cache = new WeakMap<Civ, WorldFacts>();

/** 史事里第一条年份 ≥ year 的下标(史事按年份排好) */
function annalFrom(civ: Civ, year: number): number {
  const A = civ.annals;
  let lo = 0;
  let hi = A.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (A[mid].year < year) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function worldFacts(civ: Civ, win: TraitWindow): WorldFacts {
  const key = `${win.from}|${win.to}`;
  const hit = cache.get(civ);
  if (hit && hit.key === key) return hit;
  const C = civ.cultures.length;
  const R = civ.regions.count;
  const y = win.to;
  const own = ownersAt(civ, y);
  const faith = faithAt(civ, y);
  const rel = civ.religion;
  const cultureOf = (p: number) => (p >= 0 && civ.polities[p] ? civ.polities[p].culture : -1);

  const regions = new Int32Array(C);
  const foreign = new Int32Array(C);
  const great = new Int32Array(C);
  const steppe = new Int32Array(C);
  for (let r = 0; r < R; r++) {
    const c = own.culture[r];
    if (c < 0 || c >= C) continue;
    regions[c]++;
    const po = cultureOf(own.polity[r]);
    if (po >= 0 && po !== c) foreign[c]++;
    if (STEPPE.has(civ.regions.biome[r])) steppe[c]++;
    const f = faith[r];
    if (f >= 0 && rel?.faiths[f] && rel.faiths[f].kind !== 'folk') great[c]++;
  }

  // 港口:段末还在的港口城所在的州(一州最多算一次)
  const ports = new Int32Array(C);
  const portRegion = new Uint8Array(R);
  for (const s of civ.settlements) {
    if (s.region < 0 || s.region >= R || s.founded > y || (s.ended !== undefined && s.ended <= y) || !portAt(s, y)) continue;
    if (portRegion[s.region]) continue;
    portRegion[s.region] = 1;
    const c = own.culture[s.region];
    if (c >= 0 && c < C) ports[c]++;
  }

  // 打下的州、宣战、亡国(这段时间里;议和时割来的州不算打下的)
  const conquests = new Int32Array(C);
  const wars = new Int32Array(C);
  const falls = new Int32Array(C);
  const A = civ.annals;
  for (let i = annalFrom(civ, win.from); i < A.length && A[i].year <= y; i++) {
    const a = A[i];
    const c = a.kind === 'conquer' || a.kind === 'war' || a.kind === 'fall' ? cultureOf(a.a) : -1;
    if (c < 0 || c >= C) continue;
    if (a.kind === 'conquer') {
      if (!isCession(civ, i)) conquests[c]++;
    } else if (a.kind === 'war') wars[c]++;
    else falls[c]++;
  }

  // 在世的族(段末住着人的):平均打下几州
  let alive = 0;
  let conqSum = 0;
  for (let c = 0; c < C; c++)
    if (regions[c] > 0) {
      alive++;
      conqSum += conquests[c];
    }

  // 市税:段末在世、记着账的本族之国,按收入加权
  const mk = new Float64Array(C);
  const income = new Float64Array(C);
  let mkAll = 0;
  let incAll = 0;
  for (const p of civ.polities) {
    if (!polityAlive(p, y)) continue;
    const row = fiscalAt(civ, p.id, y);
    if (!row) continue;
    const v = row.values;
    const inc = v[BOOK_COLS[COL_LAND]] + v[BOOK_COLS[COL_CRAFT]] + v[BOOK_COLS[COL_MARKET]];
    if (!(inc > 0)) continue;
    mkAll += v[BOOK_COLS[COL_MARKET]];
    incAll += inc;
    const c = p.culture;
    if (c < 0 || c >= C) continue;
    mk[c] += v[BOOK_COLS[COL_MARKET]];
    income[c] += inc;
  }
  const market = new Float64Array(C).fill(-1);
  for (let c = 0; c < C; c++) if (income[c] > 0) market[c] = mk[c] / income[c];

  // 信息能力:住的各州平均,段末住着三州以上的族排名
  const infoRank = new Int32Array(C);
  let infoOf = 0;
  const dev = civ.development;
  if (dev && dev.snaps.length) {
    const lv = developmentAt(dev, y);
    const sum = new Float64Array(C);
    for (let r = 0; r < R; r++) {
      const c = own.culture[r];
      if (c >= 0 && c < C) sum[c] += lv[r * 5 + 2];
    }
    const ranked: { c: number; v: number }[] = [];
    for (let c = 0; c < C; c++) if (regions[c] >= INFO_MIN_REGIONS) ranked.push({ c, v: sum[c] / regions[c] });
    ranked.sort((a, b) => b.v - a.v || a.c - b.c);
    ranked.forEach((x, i) => (infoRank[x.c] = i + 1));
    infoOf = ranked.length;
  }

  const out: WorldFacts = {
    key,
    culture: own.culture,
    regions,
    conquests,
    conquestsAvg: alive ? conqSum / alive : 0,
    wars,
    ports,
    market,
    marketAvg: incAll > 0 ? mkAll / incAll : 0,
    infoRank,
    infoOf,
    great,
    steppe,
    falls,
    foreign,
  };
  cache.set(civ, out);
  return out;
}

/** 第 i 条史事(攻占)是不是议和时割让的:往后连着的 conquer 走到 peace,peace 记的割让州数够得着它 */
function isCession(civ: Civ, i: number): boolean {
  const A = civ.annals;
  const a = A[i];
  let k = i;
  while (k + 1 < A.length && A[k + 1].kind === 'conquer' && A[k + 1].year === a.year) k++;
  const p = A[k + 1];
  return !!p && p.kind === 'peace' && p.year === a.year && p.region > 0 && k + 1 - i <= p.region;
}

/** 崇文排名只排住着这么多州以上的族(一两州的小族信息能力高低偶然性大) */
export const INFO_MIN_REGIONS = 3;

/** 一族在 win 这一段里的数 */
export function cultureFacts(civ: Civ, id: number, win: TraitWindow): CultureFacts {
  const cu = civ.cultures[id];
  const w = worldFacts(civ, win);
  const rel = civ.religion;
  const y = win.to;
  // 圣城在本族城里的大教;这段时间在本族之国分出的教派(取最近的)
  let holy = '';
  let sect: CultureFacts['sect'] = null;
  for (const f of rel?.faiths ?? []) {
    // 圣城那座城段末还在、它那一州段末住的是本族(城的 culture 是建城时的民族,后来那一州可能改了族)
    if (f.kind === 'great' && f.holy !== undefined && (f.founded ?? 0) <= y && !holy) {
      const s = civ.settlements[f.holy];
      if (s && s.founded <= y && (s.ended === undefined || s.ended > y) && s.region >= 0 && w.culture[s.region] === id) holy = f.name;
    }
    if (f.kind === 'sect' && f.polity !== undefined && f.founded !== undefined && f.founded >= win.from && f.founded <= y) {
      const p = civ.polities[f.polity];
      if (p && p.culture === id && (!sect || f.founded >= sect.year)) sect = { name: f.name, year: Math.floor(f.founded), polity: polityName(p, f.founded) };
    }
  }
  // 迁徙:这段时间的几波;避兵锋的(起因那国的民族不是本族)
  let migrations = 0;
  let flights = 0;
  for (const m of cu?.migrations ?? []) {
    if (m.year < win.from || m.year > y) continue;
    migrations++;
    const i = annalFrom(civ, m.year);
    let a: Civ['annals'][number] | undefined;
    for (let k = i; k < civ.annals.length && civ.annals[k].year === m.year && !a; k++) if (civ.annals[k].kind === 'migrate' && civ.annals[k].a === id) a = civ.annals[k];
    const by = a && a.war >= 0 ? civ.polities[a.war] : undefined;
    if (by && by.culture !== id) flights++;
  }
  return {
    kind: cu?.kind ?? 'farm',
    regions: w.regions[id] ?? 0,
    conquests: w.conquests[id] ?? 0,
    conquestsAvg: w.conquestsAvg,
    wars: w.wars[id] ?? 0,
    ports: w.ports[id] ?? 0,
    market: w.market[id] ?? -1,
    marketAvg: w.marketAvg,
    infoRank: w.infoRank[id] ?? 0,
    infoOf: w.infoOf,
    great: w.regions[id] ? w.great[id] / w.regions[id] : 0,
    holy,
    sect,
    steppe: w.regions[id] ? w.steppe[id] / w.regions[id] : 0,
    falls: w.falls[id] ?? 0,
    migrations,
    flights,
    foreign: w.regions[id] ? w.foreign[id] / w.regions[id] : 0,
  };
}

// ---------------------------------------------------------------------------
// 门槛

/** 门槛(按 20 个种子各族的分布定;改了单测里的造数跟着改) */
export const TRAIT_RULES = {
  /** 尚武:打下的州 ≥ 各族平均 × ratio,而且至少 min 州 */
  martial: { ratio: 1.5, min: 5 },
  /** 重商:港口州至少 minPorts 个、占住的州 ports 以上,而且本族之国的市税份额 ≥ 各国平均 × ratio */
  mercantile: { ports: 0.25, minPorts: 3, ratio: 1.1 },
  /** 崇文:信息能力排前 top 名(也不超过排了名的族的 share) */
  learned: { top: 4, share: 0.3 },
  /** 敬神:信大教的州占 great 以上,而且圣城在本族的城里、或者这段时间有教派在本族之国分出 */
  pious: { great: 0.9 },
  /** 善骑:游牧民族,或草原荒漠占住的州 steppe 以上 */
  horse: { steppe: 0.45 },
  /** 善航:海洋民族,或港口州至少 minPorts 个、占住的州 ports 以上 */
  sea: { ports: 0.45, minPorts: 3 },
  /** 坚忍:本族之国亡国、避兵迁徙的回数(住的州 foreign 以上归异族之国的再算一回)≥ min,族还在 */
  enduring: { min: 2, foreign: 0.4 },
} as const;

/** 生计本身就是游牧、海洋的:善骑、善航至少这么显著(排在门槛刚够的别的特质前面) */
const KIND_STRENGTH = 1.2;

const DIGITS = '零一二三四五六七八九十';

/**
 * 几成:0.6 → "六成",0.54 → "五成多",0.58 → "近六成";九成以上按半成:0.95 → "九成五";整成写"都",不到半成写"极少数"
 * (接在"住的州"后面,见 ofRegions)
 */
export function tenths(x: number): string {
  if (x >= 0.995) return '都';
  if (x < 0.05) return '极少数';
  if (x >= 0.925) return '九成五';
  const n = Math.round(x * 10);
  if (x < n / 10 - 0.015) return `近${DIGITS[n]}成`;
  return x > n / 10 + 0.015 ? `${DIGITS[n]}成多` : `${DIGITS[n]}成`;
}

/** 是平均的几倍:"三倍""两倍多" */
function fold(n: number, avg: number): string {
  const k = n / avg;
  const whole = Math.floor(k + 1e-9);
  const w = whole <= 10 ? ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'][whole] : String(whole);
  return k - whole >= 0.3 ? `${w}倍多` : `${w}倍`;
}

/** "住的州六成" / "住的州都":接"有港口""信大教"这类说法 */
const ofRegions = (x: number) => `住的州${tenths(x)}`;

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 按门槛读特质(纯函数):最多 TRAIT_MAX 条,按显著程度排 */
export function readTraits(f: CultureFacts): Trait[] {
  const out: Trait[] = [];
  const add = (key: TraitKey, strength: number, why: string) => {
    if (strength >= 1) out.push({ key, word: TRAIT_WORDS[key], why, strength });
  };
  if (f.regions <= 0) return out;
  const R = TRAIT_RULES;
  const portShare = f.ports / f.regions;

  // 尚武
  {
    const s = f.conquests / Math.max(R.martial.min, f.conquestsAvg * R.martial.ratio);
    const war = f.wars > 0 ? `、宣战 ${f.wars} 回` : '';
    add('martial', s, `本族之国打下 ${f.conquests} 州${war}${f.conquestsAvg >= 1 ? `，是各族平均的${fold(f.conquests, f.conquestsAvg)}` : ''}`);
  }
  // 重商
  {
    const ok = f.ports >= R.mercantile.minPorts && portShare >= R.mercantile.ports && f.market >= 0 && f.marketAvg > 0;
    const s = ok ? Math.min(portShare / R.mercantile.ports, f.market / (f.marketAvg * R.mercantile.ratio)) : 0;
    add('mercantile', s, `市税占本族之国进项 ${pct(f.market)}，各国平均 ${pct(f.marketAvg)}；${f.ports} 州有港口`);
  }
  // 崇文
  if (f.infoRank > 0) {
    const top = Math.min(R.learned.top, Math.max(1, Math.floor(f.infoOf * R.learned.share)));
    const s = f.infoRank <= top ? 1 + (top - f.infoRank) / (top + 1) : 0;
    add('learned', s, f.infoRank === 1 ? '信息能力在世上数第一' : `信息能力在世上排第 ${f.infoRank}`);
  }
  // 敬神
  {
    const tie = f.holy ? `${f.holy}的圣城在本族的城里` : f.sect ? `${f.sect.name} ${f.sect.year} 年在${f.sect.polity}分出` : '';
    const s = tie && f.great >= R.pious.great ? f.great / R.pious.great : 0;
    add('pious', s, `${ofRegions(f.great)}信大教；${tie}`);
  }
  // 善骑
  {
    const s = Math.max(f.kind === 'nomad' ? KIND_STRENGTH : 0, f.steppe / R.horse.steppe);
    const land = f.steppe >= R.horse.steppe / 2 ? `${ofRegions(f.steppe)}是草原、荒漠` : '';
    add('horse', s, f.kind === 'nomad' ? (land ? `游牧；${land}` : '游牧民族') : land);
  }
  // 善航
  {
    const s = Math.max(f.kind === 'sea' ? KIND_STRENGTH : 0, f.ports >= R.sea.minPorts ? portShare / R.sea.ports : 0);
    const coast = f.ports > 0 ? `${ofRegions(portShare)}有港口` : '';
    add('sea', s, f.kind === 'sea' ? (coast ? `海洋民族；${coast}` : '海洋民族') : coast);
  }
  // 坚忍
  {
    const ruled = f.foreign >= R.enduring.foreign;
    const s = (f.falls + f.flights + (ruled ? 1 : 0)) / R.enduring.min;
    const parts = [
      f.falls > 0 ? `本族之国亡过 ${f.falls} 回` : '',
      f.flights > 0 ? `避兵迁徙 ${f.flights} 回` : '',
      ruled ? `${ofRegions(f.foreign)}归异族之国` : '',
    ].filter(Boolean);
    add('enduring', s, `${parts.join('、')}，族还在 ${f.regions} 州`);
  }
  // 善骑和善航都够上:只留更显著的那个
  const h = out.findIndex((t) => t.key === 'horse');
  const sea = out.findIndex((t) => t.key === 'sea');
  if (h >= 0 && sea >= 0) out.splice(out[h].strength >= out[sea].strength ? sea : h, 1);
  out.sort((a, b) => b.strength - a.strength || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return out.slice(0, TRAIT_MAX);
}

/** 一样显著时的先后 */
const ORDER: TraitKey[] = ['enduring', 'martial', 'pious', 'learned', 'mercantile', 'horse', 'sea'];

/** 民族卡片「特质」一节:读哪一段、读出来的几条;还没出现、没能兴起 = null */
export function cultureTraits(civ: Civ, id: number, year: Year): { window: TraitWindow; traits: Trait[]; facts: CultureFacts } | null {
  const cu = civ.cultures[id];
  if (!cu) return null;
  const win = traitWindow(cu, year);
  if (!win) return null;
  const facts = cultureFacts(civ, id, win);
  return { window: win, traits: readTraits(facts), facts };
}
