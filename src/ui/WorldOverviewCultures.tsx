/**
 * 世界概览的"民族"页:到时间轴当前这一年为止出现过的民族(没能兴起的不列),一族一行 ——
 * 色块、族名、存续(出现–消亡)、州数、人口(住的各州的总人口)、地盘小图(和国家页的疆域小图同一份取样)、类型、
 * 分自(分化出来的写母族)、所在国家(州最多的两国,多了写"等 N 国";一州都不在国家里写"尚无国家")。
 * 现存的按州数排在前面;已消亡的变淡排在后面(按鼎盛时的大小排):人口、所在国家写消亡前一年的。
 * 窄屏(手机)只留色块、族名、存续、州数,下面一行小字写类型(分化出来的写从哪族分出)、人口、多在哪国。
 * 点一行 = 收起概览、地图定位到这一族人口最多的州(和搜索一样);已消亡的先把时间轴拨到它消亡前一年。
 */
import { useMemo } from 'react';
import type { Civ, Culture } from '../gen/civ/types';
import { polityName, populationLabel, regionPopulationAt } from '../gen/civ/growth';
import { KIND_INFO, cultureLabel } from '../gen/civ/display';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { setCivTime } from './civView';
import { closeOverview } from './overviewStore';
import { openCulture } from './faithSelection';
import { SPARK_N, polityHistory, popCell, type PolityHistory } from './WorldOverviewCountries';
import { useEra } from './editsStore';
import { yearAt, yearFull, yearShort, yearSpan, type Era } from '../gen/era';

/** 民族 y 年还在(出现了、没消亡;没能兴起的不算) */
export function cultureAlive(cu: Culture, y: number): boolean {
  return !cu.unborn && cu.born <= y && (cu.ended === undefined || cu.ended > y);
}

/** 民族在 y 年之前最后还在的那一年(已消亡的 = 消亡前一年;还在的 = y) */
export function cultureLastYear(cu: Culture, y: number): number {
  if (cu.ended === undefined || cu.ended > y) return y;
  return Math.max(Math.ceil(cu.born), Math.ceil(cu.ended) - 1);
}

export interface CultureRow {
  cu: Culture;
  alive: boolean;
  /** 当年的州数(已消亡 = 0) */
  regions: number;
  /** 人口、所在国家取的是哪一年(现存的 = 这一年;已消亡的 = 消亡前一年) */
  at: number;
  /** 住的各州的总人口(千人) */
  pop: number;
  /** 住在哪些国家:[国家编号, 州数],州多的在前 */
  polities: [number, number][];
}

interface Tally {
  regions: number;
  pop: number;
  polities: Map<number, number>;
}

/** 数一遍各州:每个民族几个州、多少人、在哪些国家(only = 只数这一族) */
function tally(civ: Civ, own: Owners, y: number, only = -1): Map<number, Tally> {
  const out = new Map<number, Tally>();
  for (let r = 0; r < civ.regions.count; r++) {
    const c = own.culture[r];
    if (c < 0 || (only >= 0 && c !== only)) continue;
    let t = out.get(c);
    if (!t) out.set(c, (t = { regions: 0, pop: 0, polities: new Map() }));
    t.regions++;
    t.pop += regionPopulationAt(civ, r, y);
    const p = own.polity[r];
    if (p >= 0) t.polities.set(p, (t.polities.get(p) ?? 0) + 1);
  }
  return out;
}

const byCount = (m: Map<number, number>): [number, number][] => [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0]);

/** 已消亡民族消亡前一年的人口、所在国家(和时间轴停在哪年无关,同一份历史每族只算一次;名字显示时现取,改名跟着变) */
const lastCache = new WeakMap<object, Map<number, Pick<CultureRow, 'at' | 'pop' | 'polities'>>>();
let lastOwners: Owners | undefined;

function lastLook(civ: Civ, cu: Culture): CultureRow {
  let m = lastCache.get(civ.log);
  if (!m) lastCache.set(civ.log, (m = new Map()));
  let look = m.get(cu.id);
  if (!look) {
    const at = cultureLastYear(cu, Infinity);
    lastOwners = ownersAt(civ, at, lastOwners);
    const t = tally(civ, lastOwners, at, cu.id).get(cu.id);
    look = { at, pop: t?.pop ?? 0, polities: t ? byCount(t.polities) : [] };
    m.set(cu.id, look);
  }
  return { cu, alive: false, regions: 0, ...look };
}

let rowOwners: Owners | undefined;

/** y 年(取整)的民族表:现存的按州数排,已消亡的按鼎盛时的大小排 */
export function cultureRows(civ: Civ, y: number): { alive: CultureRow[]; dead: CultureRow[] } {
  if (!civ.viable || !civ.cultures.length) return { alive: [], dead: [] };
  rowOwners = ownersAt(civ, y, rowOwners);
  const counts = tally(civ, rowOwners, y);
  const hist = polityHistory(civ);
  const alive: CultureRow[] = [];
  const dead: CultureRow[] = [];
  for (const cu of civ.cultures) {
    if (cu.unborn || cu.born > y) continue;
    if (cultureAlive(cu, y)) {
      const t = counts.get(cu.id);
      alive.push({ cu, alive: true, regions: t?.regions ?? 0, at: y, pop: t?.pop ?? 0, polities: t ? byCount(t.polities) : [] });
    } else dead.push(lastLook(civ, cu));
  }
  alive.sort((a, b) => b.regions - a.regions || a.cu.id - b.cu.id);
  dead.sort((a, b) => hist.culturePeak[b.cu.id] - hist.culturePeak[a.cu.id] || a.cu.id - b.cu.id);
  return { alive, dead };
}

/** 点一行:收起概览、开民族卡片、地图转到这一族人口最多的州(已消亡的先把时间轴拨到它还在的最后一年) */
function locate(cu: Culture, y: number) {
  closeOverview();
  const last = cultureLastYear(cu, y);
  if (last !== y) setCivTime({ year: last, playing: false, scrubbing: false, story: false });
  openCulture(cu.id);
}

export function CulturesPage({ civ, year }: { civ: Civ | null; year: number }) {
  const era = useEra();
  const rows = useMemo(() => (civ ? cultureRows(civ, year) : null), [civ, year]);
  const hist = useMemo(() => (civ && civ.viable && civ.cultures.length ? polityHistory(civ) : null), [civ]);
  if (!civ) return <div className="ov-empty">正在生成世界</div>;
  if (!rows || !hist || (!rows.alive.length && !rows.dead.length))
    return <div className="ov-empty">{civ.viable ? `${yearFull(year, era)}还没有民族` : '这颗星球上还没有文明'}</div>;
  const end = Math.floor(civ.endYear);
  return (
    <div className="ov-table ov-cultures">
      <div className="ov-tr ov-th">
        <span />
        <span>族名</span>
        <span>存续</span>
        <span className="num">州</span>
        <span className="num ov-pop">人口</span>
        <span className="ov-c-spark">地盘 {era ? yearSpan(0, end, era) : `0–${end} 年`}</span>
        <span className="ov-c-kind">类型</span>
        <span className="ov-c-from">分自</span>
        <span className="ov-c-where">所在国家</span>
      </div>
      {[...rows.alive, ...rows.dead].map((r) => (
        <CultureLine key={r.cu.id} civ={civ} r={r} year={year} hist={hist} era={era} />
      ))}
      <div className="ov-foot">
        点击一行，地图定位到这一族人口最多的州{rows.dead.length > 0 && '。已消亡的民族写消亡前一年的人口和所在国家，点了先跳到那一年'}
      </div>
    </div>
  );
}

function CultureLine({ civ, r, year, hist, era }: { civ: Civ; r: CultureRow; year: number; hist: PolityHistory; era?: Era }) {
  const { cu } = r;
  const color = `rgb(${cu.color.join(',')})`;
  const b = cu.id * SPARK_N;
  const kind = KIND_INFO[cu.kind];
  const parent = cu.parent !== undefined ? civ.cultures[cu.parent] : undefined;
  const names = r.polities.map(([q]) => (civ.polities[q] ? polityName(civ.polities[q], r.at) : '')).filter(Boolean);
  // 手机上名字下面那行小字:类型(分化出来的写从哪族分出)、人口、多在哪国
  const pop = r.pop > 0 ? populationLabel(r.pop).replace(/^约 /, '') : '';
  const line = [
    parent ? `从${cultureLabel(parent)}分出` : `${kind.name}民族`,
    pop && (r.alive ? pop : `消亡前 ${pop}`),
    names.length ? `多在${names[0]}` : '尚无国家',
  ]
    .filter(Boolean)
    .join('，');
  return (
    <button className={`ov-tr ov-row${r.alive ? '' : ' dead'}`} data-culture={cu.id} onClick={() => locate(cu, year)}>
      <i className="ov-cu-sw" style={{ background: color }} />
      <span className="ov-name">{cultureLabel(cu)}</span>
      <span className="ov-years">
        {yearShort(cu.born, era)}–{r.alive ? '' : yearShort(Math.ceil(cu.ended!), era)}
      </span>
      <span className="num ov-regions">{r.alive ? r.regions : '已消亡'}</span>
      <span className="num ov-pop">{popCell(r.pop)}</span>
      <span className="ov-c-spark ov-spark" title={hist.years.map((yy, i) => `${yearAt(yy, era)} ${hist.cultureSpark[b + i]} 州`).join('\n')}>
        {hist.years.map((yy, i) => {
          const n = hist.cultureSpark[b + i];
          return <i key={yy} style={{ height: Math.max(1, Math.round((n / hist.cultureMax) * 20)), background: color, opacity: n ? 1 : 0.2 }} />;
        })}
      </span>
      <span className="ov-c-kind" title={kind.hint}>
        {kind.name}
      </span>
      <span className="ov-c-from ov-sub">{parent ? cultureLabel(parent) : '—'}</span>
      <span className="ov-c-where" title={names.length > 2 ? names.join('、') : undefined}>
        {names.length ? (
          <>
            {names.slice(0, 2).join('、')}
            {names.length > 2 && <em> 等 {names.length} 国</em>}
          </>
        ) : (
          '尚无国家'
        )}
      </span>
      <span className="ov-m">{line}</span>
    </button>
  );
}
