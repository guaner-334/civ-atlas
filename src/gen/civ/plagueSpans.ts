/**
 * 瘟疫(plague.ts)的整理:按史事 plague 和城镇表里 cause = plague 的折损,把每一场瘟疫染了哪些城、哪一年染上的理出来。
 * 编年史、地图上的疫区、统计都用它;只读 Civ,不碰推演引擎(界面里用不会把推演代码带进来)。
 */
import type { Civ, Year } from './types';

/** 一场瘟疫 */
export interface PlagueSpan {
  /** 第几场(史事 plague 的 war 列) */
  id: number;
  great: boolean;
  /** 起疫、最后一年染上的时刻 */
  start: Year;
  end: Year;
  /** 这一场的史事下标(按先后) */
  annals: number[];
  /** 染疫的城:州、哪一刻染上、死几成(按先后;部落地带的也在里面) */
  hits: { region: number; settlement: number; year: Year; loss: number }[];
}

const spanCache = new WeakMap<Civ, PlagueSpan[]>();

/** 这个世界里所有的瘟疫(按先后);只看史事和城镇表 */
export function plagueSpans(civ: Civ): PlagueSpan[] {
  const hit = spanCache.get(civ);
  if (hit) return hit;
  const A = civ.annals;
  const byId = new Map<number, PlagueSpan>();
  const out: PlagueSpan[] = [];
  A.forEach((e, i) => {
    if (e.kind !== 'plague') return;
    let s = byId.get(e.war);
    if (!s) {
      byId.set(e.war, (s = { id: e.war, great: e.cause === 'great', start: e.year, end: e.year, annals: [], hits: [] }));
      out.push(s);
    }
    s.annals.push(i);
  });
  // 城镇表里的折损按起疫的时刻分到各场(同一时刻只有一场在传:下一场起疫以前的都是上一场的)
  const all: { region: number; settlement: number; year: Year; loss: number }[] = [];
  for (const s of civ.settlements) for (const x of s.sacks ?? []) if (x.cause === 'plague') all.push({ region: s.region, settlement: s.id, year: x.year, loss: x.loss });
  all.sort((a, b) => a.year - b.year || a.region - b.region);
  let j = 0;
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    const until = i + 1 < out.length ? out[i + 1].start : Infinity;
    while (j < all.length && all[j].year < s.start) j++;
    while (j < all.length && all[j].year < until) {
      s.hits.push(all[j]);
      s.end = Math.max(s.end, all[j].year);
      j++;
    }
  }
  spanCache.set(civ, out);
  return out;
}

export interface PlagueStats {
  /** 几场;其中大瘟疫几场 */
  plagues: number;
  great: number;
  /** 每场染疫的州数(按先后) */
  sizes: number[];
  /** 每场传了几年 */
  years: number[];
}

export function plagueStats(civ: Civ): PlagueStats {
  const sp = plagueSpans(civ);
  return {
    plagues: sp.length,
    great: sp.filter((s) => s.great).length,
    sizes: sp.map((s) => s.hits.length),
    years: sp.map((s) => Math.round(s.end - s.start) + 1),
  };
}
