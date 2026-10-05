/**
 * 试推演的结果和现在比(助手用):按一批修改在后台把历史重推一遍以后,关注的国家结局变没变、
 * 别的国家里谁变化最大、第 from 年以后的大事多了哪些少了哪些。纯函数,不碰 DOM。
 *
 * 两份历史里的"同一个国家"按稳定键(gen/edits.ts 的 polityKey:立国时国都所在的州 + 那州第几个立国的)对上;
 * from 年以后才立的国家,立国年份差太多的不算同一个。只在试推演里有的国家没有编号(id = −1),不能对它下命令。
 */
import type { Civ } from '../../gen/civ/types';
import { ownersAt } from '../../gen/civ/timeline';
import { buildChronicle } from '../../gen/civ/chronicle';
import { polityKey, resolveKey } from '../../gen/edits';
import { nameAt } from '../prompts/rewrite';

/** 一个国家:id = 现在这份历史里的编号(只在试推演里有 = −1) */
export interface PolityRef {
  id: number;
  name: string;
}

/** 一个国家的结局 */
export interface Fate {
  /** 亡国的年份;到最后仍在 = 不给 */
  end?: number;
  /** 怎么亡的:被灭 / 并入别国 / 瓦解 */
  way?: 'fall' | 'merge' | 'collapse';
  /** 被谁灭、并入谁 */
  by?: PolityRef;
  /** 最后有几州(亡了的:亡国前一年) */
  size: number;
}

export interface FateChange {
  who: PolityRef;
  /** 现在的结局;这个国家现在没有(试推演里新出现的)= null */
  before: Fate | null;
  /** 试推演里的结局;试推演里没有了 = null */
  after: Fate | null;
}

export interface TrialEvent {
  year: number;
  text: string;
}

export interface TrialDiff {
  /** 修改从哪一年起生效(这一年以前两份历史一样) */
  from: number;
  endYear: number;
  /** 关注的国家(修改里点到的) */
  focus: FateChange[];
  /** 别的国家里变化最大的几个 */
  others: FateChange[];
  /** 到最后在世的国家:[现在, 试推演] */
  alive: [number, number];
  /** from 年以后的史事(重要度 2 以上):试推演里多出来的、不再发生的(各列前几条) */
  added: TrialEvent[];
  removed: TrialEvent[];
  addedCount: number;
  removedCount: number;
}

/** 别的国家最多列几个 */
const OTHERS_MAX = 6;
/** 大事各列几条 */
const EVENTS_MAX = 10;
/** from 年以后立的国家:立国年份差这么多以内才算同一个 */
const SAME_FOUNDING = 60;
/** 比较哪些史事:重要度 2 以上(大事只比 3 的话,改了一国的结局常常一条都不变) */
const NOTABLE = 2;

/** 第 y 年各国有几州(按年份缓存) */
function sizer(civ: Civ) {
  const cache = new Map<number, Map<number, number>>();
  return (id: number, y: number): number => {
    const Y = Math.max(0, Math.min(civ.endYear, y));
    let m = cache.get(Y);
    if (!m) {
      m = new Map();
      const own = Y >= civ.endYear ? civ.polity : ownersAt(civ, Y).polity;
      for (let r = 0; r < own.length; r++) if (own[r] >= 0) m.set(own[r], (m.get(own[r]) ?? 0) + 1);
      cache.set(Y, m);
    }
    return m.get(id) ?? 0;
  };
}

/** 到最后在世(还有国土)的国家数 */
function aliveAtEnd(civ: Civ): number {
  const s = new Set<number>();
  for (let r = 0; r < civ.polity.length; r++) if (civ.polity[r] >= 0) s.add(civ.polity[r]);
  return s.size;
}

/** 大事的对照键:年份 + 正文 */
const eventKey = (e: TrialEvent) => `${Math.floor(e.year)}|${e.text}`;

function notableEvents(civ: Civ, from: number): TrialEvent[] {
  return buildChronicle(civ)
    .filter((e) => e.year >= from && e.importance >= NOTABLE && e.kind !== 'intervene')
    .map((e) => ({ year: Math.floor(e.year), text: e.text }));
}

/**
 * 比较两份历史。before = 现在的(套上改名),after = 试推演的(套上同样的改名);
 * focus = 关注的国家(现在这份历史里的编号);from = 修改从哪一年起
 */
export function compareTrial(before: Civ, after: Civ, focus: readonly number[], from: number): TrialDiff {
  const P0 = before.polities;
  const P1 = after.polities;
  // 试推演里的国家 → 现在的编号
  const toBefore = new Map<number, number>();
  const toAfter = new Map<number, number>();
  for (const p of P1) {
    const r = resolveKey(before, polityKey(after, p.id));
    if (!r || r.kind !== 'polity') continue;
    const q = P0[r.id];
    if (q.founded >= from && Math.abs(q.founded - p.founded) > SAME_FOUNDING) continue;
    if (toAfter.has(r.id)) continue;
    toBefore.set(p.id, r.id);
    toAfter.set(r.id, p.id);
  }
  const size0 = sizer(before);
  const size1 = sizer(after);
  // 国名按 y 年的叫(关注的国家按 from 年;灭了它的国家按亡国那年),和材料、编年史里的叫法对得上
  const ref0 = (id: number, y = from): PolityRef => ({ id, name: nameAt(P0[id], y) });
  const ref1 = (id: number, y = from): PolityRef => {
    const b = toBefore.get(id);
    return b !== undefined ? ref0(b, y) : { id: -1, name: nameAt(P1[id], y) };
  };

  const fate = (civ: Civ, id: number, size: (id: number, y: number) => number, ref: (id: number, y: number) => PolityRef): Fate => {
    const p = civ.polities[id];
    if (p.ended === undefined) return { size: size(id, civ.endYear) };
    const end = Math.floor(p.ended);
    const last = Math.max(Math.floor(p.founded), end - 1);
    const merge = civ.annals.find((e) => e.kind === 'merge' && e.b === id);
    if (merge && merge.a >= 0) return { end, way: 'merge', by: ref(merge.a, merge.year), size: size(id, last) };
    const fall = civ.annals.find((e) => e.kind === 'fall' && e.a === id);
    if (fall && fall.b >= 0) return { end, way: 'fall', by: ref(fall.b, fall.year), size: size(id, last) };
    return { end, way: 'collapse', size: size(id, last) };
  };
  const fate0 = (id: number) => fate(before, id, size0, ref0);
  const fate1 = (id: number) => fate(after, id, size1, ref1);
  const change0 = (id: number): FateChange => {
    const a = toAfter.get(id);
    return { who: ref0(id), before: fate0(id), after: a !== undefined ? fate1(a) : null };
  };

  const focusSet = new Set(focus.filter((id) => id >= 0 && id < P0.length));
  const focusList = [...focusSet].map(change0);

  // 别的国家:from 年时在世或之后才立的,看结局变了多少(存亡翻了 > 亡国年份差得多 > 最后的州数差得多)
  const scored: { c: FateChange; score: number }[] = [];
  for (const p of P0) {
    if (focusSet.has(p.id) || (p.ended !== undefined && p.ended <= from)) continue;
    const a = toAfter.get(p.id);
    const e0 = p.ended;
    const e1 = a !== undefined ? P1[a].ended : undefined;
    let score = 0;
    if (a === undefined || (e0 === undefined) !== (e1 === undefined)) score = 1000;
    else if (e0 !== undefined && e1 !== undefined && Math.abs(e0 - e1) >= 50) score = 100 + Math.abs(e0 - e1) / 10;
    else if (e0 === undefined) {
      const d = Math.abs(size0(p.id, before.endYear) - size1(a, after.endYear));
      if (d >= 3) score = d;
    }
    if (score > 0) scored.push({ c: { who: ref0(p.id), before: null, after: null }, score: score + size0(p.id, Math.max(from, Math.floor(p.founded))) / 100 });
  }
  // 只在试推演里有的(from 年以后新立的)
  for (const p of P1) {
    if (toBefore.has(p.id) || p.founded < from) continue;
    const s = size1(p.id, p.ended === undefined ? after.endYear : Math.max(Math.floor(p.founded), Math.floor(p.ended) - 1));
    if (s >= 3) scored.push({ c: { who: ref1(p.id), before: null, after: fate1(p.id) }, score: 500 + s });
  }
  scored.sort((x, y) => y.score - x.score || x.c.who.name.localeCompare(y.c.who.name));
  const others = scored.slice(0, OTHERS_MAX).map(({ c }) => (c.who.id >= 0 ? change0(c.who.id) : c));

  // 大事
  const ev0 = notableEvents(before, from);
  const ev1 = notableEvents(after, from);
  const k0 = new Set(ev0.map(eventKey));
  const k1 = new Set(ev1.map(eventKey));
  const added = ev1.filter((e) => !k0.has(eventKey(e)));
  const removed = ev0.filter((e) => !k1.has(eventKey(e)));

  return {
    from,
    endYear: Math.floor(after.endYear),
    focus: focusList,
    others,
    alive: [aliveAtEnd(before), aliveAtEnd(after)],
    added: added.slice(0, EVENTS_MAX),
    removed: removed.slice(0, EVENTS_MAX),
    addedCount: added.length,
    removedCount: removed.length,
  };
}

// ---------------------------------------------------------------------------
// 写成文字

/** 国家的叫法(给 AI 看):"P5 大澜王朝";只在试推演里有的:"某某(试推演里新出现的国家)" */
const refText = (r: PolityRef) => (r.id >= 0 ? `P${r.id} ${r.name}` : `${r.name}(试推演里新出现的国家)`);

/** 结局(给 AI 看):"到第 3000 年仍在,5 州""第 2873 年被 P5 大澜王朝所灭(亡国前 4 州)" */
export function fateText(f: Fate | null, endYear: number): string {
  if (!f) return '没有这个国家';
  if (f.end === undefined) return `到第 ${endYear} 年仍在,${f.size} 州`;
  const how = f.way === 'merge' && f.by ? `并入 ${refText(f.by)}` : f.way === 'fall' && f.by ? `被 ${refText(f.by)} 所灭` : '瓦解';
  return `第 ${f.end} 年${how}(亡国前 ${f.size} 州)`;
}

/** 整份对照(交回 AI 的试推演结果) */
export function trialText(d: TrialDiff): string {
  const out: string[] = [];
  const line = (c: FateChange) => `- ${refText(c.who)}:现在 ${fateText(c.before, d.endYear)} → 试推演 ${fateText(c.after, d.endYear)}`;
  if (d.focus.length) out.push('关注的国家:', ...d.focus.map(line));
  if (d.others.length) out.push('其他变化最大的国家:', ...d.others.map(line));
  out.push(`到第 ${d.endYear} 年在世的国家:现在 ${d.alive[0]} 个 → 试推演 ${d.alive[1]} 个`);
  const ev = (e: TrialEvent) => `- 第 ${e.year} 年 ${e.text}`;
  if (d.addedCount) out.push(`第 ${d.from} 年以后试推演里多出来的大事(共 ${d.addedCount} 条${d.addedCount > d.added.length ? `,列前 ${d.added.length} 条` : ''}):`, ...d.added.map(ev));
  if (d.removedCount) out.push(`不再发生的大事(共 ${d.removedCount} 条${d.removedCount > d.removed.length ? `,列前 ${d.removed.length} 条` : ''}):`, ...d.removed.map(ev));
  if (!d.addedCount && !d.removedCount) out.push(`第 ${d.from} 年以后的大事没有变化。`);
  return out.join('\n');
}
