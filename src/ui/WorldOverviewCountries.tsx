/**
 * 世界概览的"国家"页:到时间轴当前这一年为止出现过的国家,一国一行 ——
 * 颜色、名称(当年的国号)、存续年份、州数、人口(境内各州的总人口)、疆域小图(0 年到结束年份,均匀取 13 个年份的州数)、
 * 国都、主体民族(占几成)、国教、时代(按国都所在的州,和国家卡片一样)、外交(宗主 / 藩属 / 盟国写名字,邻国写个数)。
 * 现存的按州数排在前面;已亡的变淡排在后面(先列最大的几个,其余点"显示全部"):国都、人口、国教、时代写亡国前一年的,
 * 外交写亡于谁 / 并入谁。
 * 窄屏(手机)只留国旗、国名、存续、州数,下面一行小字写人口、时代、国教,有宗主 / 藩属 / 盟国的再加一行。
 * 点一行 = 收起概览、选中这个国家(地图飞过去由选中逻辑负责);已亡的国家先把时间轴拨到它亡国前一年,地图上看得到它。
 */
import { useMemo, useState } from 'react';
import type { Civ, Polity, StateFaith } from '../gen/civ/types';
import { capitalAt, polityName, populationLabel, regionPopulationAt } from '../gen/civ/growth';
import { cultureLabel } from '../gen/civ/display';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { canCross } from '../gen/civ/polities';
import { polityTies, type PolityTies } from '../gen/civ/diplomacy';
import { stateFaithAt } from '../gen/civ/religion';
import { developmentAt, eraLevel, eraOf } from '../gen/civ/development';
import { ERA_COLORS, eraName } from '../render/civ/era';
import { setCivTime, setSelection } from './civView';
import { closeOverview } from './overviewStore';
import { PolityFlag } from './Flag';
import { useEra } from './editsStore';
import { yearAt, yearFull, yearShort, yearSpan, type Era } from '../gen/era';

/** 疆域小图取几个年份 */
export const SPARK_N = 13;
/** 已亡国家先列几个 */
const DEAD_SHOWN = 5;

export interface PolityHistory {
  /** 每国 SPARK_N 个年份的州数(第 i 国在 [i * SPARK_N, (i + 1) * SPARK_N)) */
  spark: Int32Array;
  /** 取样的年份 */
  years: number[];
  /** 每国最多时的州数 */
  peak: Int32Array;
  /** 所有国家里最多时的州数(小图的纵轴) */
  max: number;
  /** 各民族同样取样的州数、最多时的州数、所有民族里最多时的州数(民族页的地盘小图) */
  cultureSpark: Int32Array;
  culturePeak: Int32Array;
  cultureMax: number;
}

const historyCache = new WeakMap<object, PolityHistory>();

/** 各国、各民族历年的州数(疆域小图、已亡国家按鼎盛时的大小排);同一份历史只算一次(改名不重算) */
export function polityHistory(civ: Civ): PolityHistory {
  const hit = historyCache.get(civ.log);
  if (hit && hit.peak.length === civ.polities.length && hit.culturePeak.length === civ.cultures.length) return hit;
  const P = civ.polities.length;
  const C = civ.cultures.length;
  const spark = new Int32Array(P * SPARK_N);
  const cultureSpark = new Int32Array(C * SPARK_N);
  const years: number[] = [];
  let own: Owners | undefined;
  for (let i = 0; i < SPARK_N; i++) {
    const y = Math.round((civ.endYear * i) / (SPARK_N - 1));
    years.push(y);
    own = ownersAt(civ, y, own);
    for (let r = 0; r < civ.regions.count; r++) {
      const p = own.polity[r];
      if (p >= 0) spark[p * SPARK_N + i]++;
      const c = own.culture[r];
      if (c >= 0 && c < C) cultureSpark[c * SPARK_N + i]++;
    }
  }
  const peaks = (s: Int32Array, n: number) => {
    const peak = new Int32Array(n);
    let max = 1;
    for (let p = 0; p < n; p++) {
      let m = 0;
      for (let i = 0; i < SPARK_N; i++) m = Math.max(m, s[p * SPARK_N + i]);
      peak[p] = m;
      max = Math.max(max, m);
    }
    return { peak, max };
  };
  const pp = peaks(spark, P);
  const cp = peaks(cultureSpark, C);
  const h = { spark, years, peak: pp.peak, max: pp.max, cultureSpark, culturePeak: cp.peak, cultureMax: cp.max };
  historyCache.set(civ.log, h);
  return h;
}

/** 国家在 y 年之前最后还在的那一年(已亡的 = 亡国前一年;还在的 = y) */
export function lastAliveYear(p: Polity, y: number): number {
  if (p.ended === undefined || p.ended > y) return y;
  return Math.max(Math.ceil(p.founded), Math.ceil(p.ended) - 1);
}

/** 时代:第几个时代(ERA_COLORS、eraName 的下标)、走了几成(0–1) */
export interface EraAt {
  era: number;
  progress: number;
}

/** 已亡国家的结局:亡于谁 / 并入谁(by = 国家编号;没人灭的 < 0) */
interface PolityEnd {
  how: 'fall' | 'merge';
  by: number;
}

export interface CountryRow {
  p: Polity;
  alive: boolean;
  name: string;
  /** 当年的州数(已亡 = 0) */
  regions: number;
  capital: string;
  culture: string;
  /** 主体民族占这国州数的几成(0–1) */
  share: number;
  /** 下面几样取的是哪一年(现存的 = 这一年;已亡的 = 亡国前一年) */
  at: number;
  /** 境内各州的总人口(千人) */
  pop: number;
  faith: StateFaith | null;
  /** 国都所在州的时代(没有发明数据的旧存档 = null) */
  era: EraAt | null;
  /** 宗主、藩属、盟国(已亡 = null) */
  ties: PolityTies | null;
  /** 邻国(已亡 = 空) */
  near: number[];
  /** 已亡的:亡于谁 / 并入谁 */
  end: PolityEnd | null;
}

let rowOwners: Owners | undefined;
let rowDev: Float32Array | undefined;

/** 国都所在州在 y 年的时代;dev = 那一年的发展数据 */
function eraAt(civ: Civ, p: Polity, y: number, dev: Float32Array | undefined): EraAt | null {
  const cap = civ.settlements[capitalAt(p, y)];
  return dev && cap && cap.region >= 0 ? eraOf(eraLevel(dev, cap.region)) : null;
}

const endCache = new WeakMap<object, Map<number, PolityEnd>>();

/** 各国的结局(按史事查,和国家卡片"结局"一样取第一条);同一份史事只查一次 */
function polityEnds(civ: Civ): Map<number, PolityEnd> {
  let m = endCache.get(civ.annals);
  if (m) return m;
  m = new Map();
  for (const a of civ.annals) {
    if (a.kind === 'fall' && !m.has(a.a)) m.set(a.a, { how: 'fall', by: a.b });
    else if (a.kind === 'merge' && !m.has(a.b)) m.set(a.b, { how: 'merge', by: a.a });
  }
  endCache.set(civ.annals, m);
  return m;
}

/** 已亡国家亡国前一年的人口、国都、国教、时代(和时间轴停在哪年无关,同一份历史每国只算一次;名字显示时现取,改名跟着变) */
interface LastLook {
  at: number;
  pop: number;
  capital: number;
  faith: StateFaith | null;
  era: EraAt | null;
}

const lastCache = new WeakMap<object, Map<number, LastLook>>();
let lastOwners: Owners | undefined;
let lastDev: Float32Array | undefined;

function lastLook(civ: Civ, p: Polity): LastLook {
  let m = lastCache.get(civ.log);
  if (!m) lastCache.set(civ.log, (m = new Map()));
  const hit = m.get(p.id);
  if (hit) return hit;
  const at = lastAliveYear(p, Infinity);
  lastOwners = ownersAt(civ, at, lastOwners);
  let pop = 0;
  for (let r = 0; r < civ.regions.count; r++) if (lastOwners.polity[r] === p.id) pop += regionPopulationAt(civ, r, at);
  if (civ.development) lastDev = developmentAt(civ.development, at, lastDev);
  const look = { at, pop, capital: capitalAt(p, at), faith: stateFaithAt(civ.religion, p.id, at), era: eraAt(civ, p, at, civ.development ? lastDev : undefined) };
  m.set(p.id, look);
  return look;
}

/**
 * y 年(取整)的国家表:到这一年为止立过国的;现存的按州数排,已亡的按鼎盛时的大小排。
 * 已亡的只给前 deadN 个(人口、国教这些要按亡国前一年另算),deadTotal 是一共几个
 */
export function countryRows(civ: Civ, y: number, deadN = Infinity): { alive: CountryRow[]; dead: CountryRow[]; deadTotal: number } {
  if (!civ.viable || !civ.polities.length) return { alive: [], dead: [], deadTotal: 0 };
  rowOwners = ownersAt(civ, y, rowOwners);
  const own = rowOwners;
  const reg = civ.regions;
  const P = civ.polities.length;
  const size = new Int32Array(P);
  const pop = new Float64Array(P);
  // 每国各民族占几个州、邻国(只数现存国家的;邻国和国家卡片同一个算法)
  const mix = new Map<number, Map<number, number>>();
  const near = new Map<number, Set<number>>();
  for (let r = 0; r < reg.count; r++) {
    const p = own.polity[r];
    if (p < 0) continue;
    size[p]++;
    pop[p] += regionPopulationAt(civ, r, y);
    const c = own.culture[r];
    if (c >= 0) {
      let m = mix.get(p);
      if (!m) mix.set(p, (m = new Map()));
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    const Pp = civ.polities[p];
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const q = own.polity[reg.adj[k]];
      if (q < 0 || q === p || !canCross(civ, Pp, reg.adjKind[k], y)) continue;
      let s = near.get(p);
      if (!s) near.set(p, (s = new Set()));
      s.add(q);
    }
  }
  if (civ.development) rowDev = developmentAt(civ.development, y, rowDev);
  const dev = civ.development ? rowDev : undefined;
  const hist = polityHistory(civ);
  const alive: CountryRow[] = [];
  const gone: Polity[] = [];
  for (const p of civ.polities) {
    if (p.founded > y) continue;
    if (p.ended !== undefined && p.ended <= y) {
      gone.push(p);
      continue;
    }
    let best = p.culture;
    let bestN = 0;
    let total = 0;
    for (const [c, n] of mix.get(p.id) ?? []) {
      total += n;
      if (n > bestN || (n === bestN && c < best)) {
        best = c;
        bestN = n;
      }
    }
    const cu = civ.cultures[best];
    const cap = civ.settlements[capitalAt(p, y)];
    alive.push({
      p,
      alive: true,
      name: polityName(p, y),
      regions: size[p.id],
      capital: cap?.name || '—',
      culture: cu ? cultureLabel(cu) : '—',
      share: total ? bestN / total : 1,
      at: y,
      pop: pop[p.id],
      faith: stateFaithAt(civ.religion, p.id, y),
      era: eraAt(civ, p, y, dev),
      ties: polityTies(civ, p.id, y),
      near: [...(near.get(p.id) ?? [])],
      end: null,
    });
  }
  alive.sort((a, b) => b.regions - a.regions || a.p.id - b.p.id);
  gone.sort((a, b) => hist.peak[b.id] - hist.peak[a.id] || a.id - b.id);
  const ends = polityEnds(civ);
  const dead = gone.slice(0, deadN).map((p): CountryRow => {
    const cu = civ.cultures[p.culture];
    const last = lastLook(civ, p);
    const cap = civ.settlements[last.capital];
    return {
      p,
      alive: false,
      name: polityName(p, last.at),
      regions: 0,
      capital: cap?.name || '—',
      culture: cu ? cultureLabel(cu) : '—',
      share: 1,
      at: last.at,
      pop: last.pop,
      faith: last.faith,
      era: last.era,
      ties: null,
      near: [],
      end: ends.get(p.id) ?? null,
    };
  });
  return { alive, dead, deadTotal: gone.length };
}

/** 表格里的人口:"5642 万""900 人"(和国家卡片同样取整,不带"约") */
export function popCell(pop: number): string {
  return pop > 0 ? populationLabel(pop).replace(/^约 /, '').replace(/万人$/, '万') : '—';
}

/** 一串国名:两个以内全写,多了写"甲、乙 等 5 国" */
function fewNames(names: string[]): string {
  return names.length <= 2 ? names.join('、') : `${names[0]}、${names[1]} 等 ${names.length} 国`;
}

/**
 * 外交一格:[小标签, 内容] —— 宗主、藩属、盟国、邻国(个数;手机不写)。已亡的写亡于谁 / 并入谁。
 * full = 悬停提示用:名字全写、邻国也写名字
 */
function tieParts(civ: Civ, r: CountryRow, opts: { phone?: boolean; full?: boolean } = {}): [string, string][] {
  const nm = (q: number) => (civ.polities[q] ? polityName(civ.polities[q], r.at) : '');
  const list = (ids: number[]) => (opts.full ? ids.map(nm).join('、') : fewNames(ids.map(nm)));
  if (!r.alive) return r.end && civ.polities[r.end.by] ? [[r.end.how === 'fall' ? '亡于' : '并入', nm(r.end.by)]] : [];
  const t = r.ties;
  const out: [string, string][] = [];
  if (t?.liege) out.push(['宗主', nm(t.liege.liege)]);
  if (t?.vassals.length) out.push(['藩属', list(t.vassals.map((v) => v.id))]);
  if (t?.allies.length) out.push(['盟国', list(t.allies.map((v) => v.id))]);
  if (!opts.phone && r.near.length) out.push(['邻国', opts.full ? list(r.near) : String(r.near.length)]);
  return out;
}

/** 手机上名字下面那行小字:人口、时代、国教(已亡的前面加"亡国前") */
function phoneLine(civ: Civ, r: CountryRow): string {
  const faith = r.faith && civ.religion?.faiths[r.faith.faith];
  const parts = [r.pop > 0 ? populationLabel(r.pop).replace(/^约 /, '') : '', r.era ? eraName(r.era.era) : '', faith ? `国教${faith.name}` : ''].filter(Boolean);
  if (!parts.length) return '';
  return (r.alive ? '' : '亡国前 ') + parts.join('，');
}

/** 点一行:收起概览、选中这国(已亡的先把时间轴拨到它还在的最后一年) */
function locate(p: Polity, y: number) {
  closeOverview();
  const last = lastAliveYear(p, y);
  if (last !== y) setCivTime({ year: last, playing: false, scrubbing: false, story: false });
  setSelection({ kind: 'polity', id: p.id });
}

export function CountriesPage({ civ, year }: { civ: Civ | null; year: number }) {
  const [all, setAll] = useState(false);
  const era = useEra();
  const rows = useMemo(() => (civ ? countryRows(civ, year, all ? Infinity : DEAD_SHOWN) : null), [civ, year, all]);
  const hist = useMemo(() => (civ && civ.viable && civ.polities.length ? polityHistory(civ) : null), [civ]);
  if (!civ) return <div className="ov-empty">正在生成世界</div>;
  if (!rows || !hist || (!rows.alive.length && !rows.dead.length))
    return <div className="ov-empty">{civ.viable ? `${yearFull(year, era)}还没有国家` : '这颗星球上还没有文明'}</div>;
  const more = rows.deadTotal - rows.dead.length;
  const end = Math.floor(civ.endYear);
  return (
    <div className="ov-table ov-countries">
      <div className="ov-tr ov-th">
        <span />
        <span>名称</span>
        <span>存续</span>
        <span className="num">州</span>
        <span className="num ov-pop">人口</span>
        <span className="ov-c-spark">疆域 {era ? yearSpan(0, end, era) : `0–${end} 年`}</span>
        <span className="ov-c-cap">国都</span>
        <span className="ov-c-cu">主体民族</span>
        <span className="ov-c-faith">国教</span>
        <span className="ov-c-era">时代</span>
        <span className="ov-c-tie">外交</span>
      </div>
      {[...rows.alive, ...rows.dead].map((r) => (
        <CountryLine key={r.p.id} civ={civ} r={r} year={year} hist={hist} era={era} />
      ))}
      <div className="ov-foot">
        {more > 0 && (
          <>
            另有 {more} 个已亡国家 ·{' '}
            <button className="ov-link" data-act="all-dead" onClick={() => setAll(true)}>
              显示全部
            </button>{' '}
            ·{' '}
          </>
        )}
        点击一行在地图上定位{rows.dead.length > 0 && '。已亡的国家写亡国前一年的国都、人口、国教、时代'}
      </div>
    </div>
  );
}

function CountryLine({ civ, r, year, hist, era }: { civ: Civ; r: CountryRow; year: number; hist: PolityHistory; era?: Era }) {
  const { p } = r;
  const color = `rgb(${p.color.join(',')})`;
  const b = p.id * SPARK_N;
  const faith = r.faith && civ.religion?.faiths[r.faith.faith];
  const ties = tieParts(civ, r);
  const phoneTies = tieParts(civ, r, { phone: true });
  const line = phoneLine(civ, r);
  return (
    <button className={`ov-tr ov-row${r.alive ? '' : ' dead'}`} data-polity={p.id} onClick={() => locate(p, year)}>
      <PolityFlag id={p.id} year={year} w={21} className="ov-flag" fallback={<i className="ov-sw" style={{ background: color }} />} />
      <span className="ov-name">{r.name}</span>
      <span className="ov-years">
        {yearShort(p.founded, era)}–{r.alive ? '' : yearShort(Math.ceil(p.ended!), era)}
      </span>
      <span className="num ov-regions">{r.alive ? r.regions : '已亡'}</span>
      <span className="num ov-pop">{popCell(r.pop)}</span>
      <span className="ov-c-spark ov-spark" title={hist.years.map((yy, i) => `${yearAt(yy, era)} ${hist.spark[b + i]} 州`).join('\n')}>
        {hist.years.map((yy, i) => {
          const n = hist.spark[b + i];
          return <i key={yy} style={{ height: Math.max(1, Math.round((n / hist.max) * 20)), background: color, opacity: n ? 1 : 0.2 }} />;
        })}
      </span>
      <span className="ov-c-cap">{r.capital}</span>
      <span className="ov-c-cu ov-sub">
        {r.culture}
        {r.alive && r.share < 0.995 && <em> {Math.round(r.share * 100)}%</em>}
      </span>
      <span className="ov-c-faith" title={faith ? `${yearAt(r.faith!.from, era)}起奉为国教` : undefined}>
        {faith ? faith.name : '—'}
      </span>
      <span className="ov-c-era" title={r.era ? '国都所在的州走到了哪个时代' : undefined}>
        {r.era ? (
          <>
            <i className="ov-era-sw" style={{ background: `rgb(${ERA_COLORS[r.era.era].join(',')})` }} />
            {eraName(r.era.era)}
            <em>{Math.floor(r.era.progress * 100)}%</em>
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="ov-c-tie" title={ties.length ? tieParts(civ, r, { full: true }).map(([k, v]) => `${k} ${v}`).join('\n') : undefined}>
        {ties.length
          ? ties.map(([k, v]) => (
              <span key={k}>
                <b>{k}</b>
                {v}
              </span>
            ))
          : '—'}
      </span>
      {line && <span className="ov-m">{line}</span>}
      {phoneTies.length > 0 && (
        <span className="ov-m ov-m-ties">
          {phoneTies.map(([k, v]) => (
            <span key={k}>
              <b>{k}</b>
              {v}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
