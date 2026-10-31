/**
 * 推出来的历史合不合法(压力测试的「规则项」那一段用;scripts/stress.ts):
 * - 整份 Civ 里的 NaN、±Infinity 只许出现在官方那套数推出来时也会出现的字段(数组下标不算;比如 sailFrom 是 Infinity、
 *   思潮还没传到的是 NaN);这个世界带的那套改动(Civ.knobs,里面可以有 Infinity)不算
 * - 史事:年份有限、按先后,国家 / 民族编号在范围内(哪几种记的是民族见下面)
 * - 国家:立国、亡国年份有限;在世的国都在本国,亡了的一州不剩;历朝的年份有限、按先后
 * - 城:建城年份有限,几个年份的人口有限、不是负数,被毁以后是 0;折损在 0–1 之间
 * - 人物:生卒、在位年份有限,名字、称号里没有 undefined / NaN
 * - 编年史每条都写得出字,没有 undefined / NaN;战事打完不早于开打;信仰的检查点 + 补日志和从头翻日志一样
 * 每处毛病写一句(最多 limit 句),没毛病 = 空数组。
 */
import { buildChronicle } from '../../src/gen/civ/story/chronicle';
import { capitalAt, populationAt } from '../../src/gen/civ/growth';
import { faithAt, faithFromScratch } from '../../src/gen/civ/religion';
import { warSpans } from '../../src/render/civ/warfare';
import type { Civ } from '../../src/gen/civ';

/** 一个字段的"样子":路径里的数组下标都换成 [](同一个字段在哪一项里都算一样) */
const shape = (path: string) => path.replace(/\[\d+\]/g, '[]');

/** 整份 Civ 里 NaN、±Infinity 出现在哪些字段(样子 → 头一处的路径;Civ.knobs 不算)。类型化数组、普通数组、对象都翻一遍;同一个对象只看一次 */
export function oddNumbers(civ: Civ): { nan: Map<string, string>; inf: Map<string, string> } {
  const nan = new Map<string, string>();
  const inf = new Map<string, string>();
  const seen = new Set<object>();
  const note = (v: number, path: string) => {
    if (Number.isNaN(v)) {
      const s = shape(path);
      if (!nan.has(s)) nan.set(s, path);
    } else if (!Number.isFinite(v)) {
      const s = shape(path);
      if (!inf.has(s)) inf.set(s, path);
    }
  };
  const walk = (x: unknown, path: string): void => {
    if (typeof x === 'number') return note(x, path);
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (ArrayBuffer.isView(x)) {
      if (x instanceof Float32Array || x instanceof Float64Array) for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) note(x[i], `${path}[${i}]`);
      return;
    }
    if (x instanceof Map) {
      for (const [k, v] of x) walk(v, `${path}{${typeof k === 'number' ? 0 : String(k)}}`);
      return;
    }
    if (x instanceof Set) return;
    if (Array.isArray(x)) {
      for (let i = 0; i < x.length; i++) walk(x[i], `${path}[${i}]`);
      return;
    }
    for (const k of Object.keys(x)) if (!(x === civ && k === 'knobs')) walk((x as Record<string, unknown>)[k], `${path}.${k}`);
  };
  walk(civ, 'civ');
  return { nan, inf };
}

/**
 * 历史里的毛病(见文件头)。allow = 官方那套数推出来时有 NaN、±Infinity 的字段样子(oddNumbers(官方) 两张表的键);
 * endYear = 应该推到哪一年
 */
export function historyProblems(civ: Civ, endYear: number, allow: { nan: ReadonlySet<string>; inf: ReadonlySet<string> }, limit = 8): string[] {
  const out: string[] = [];
  const bad = (s: string) => {
    if (out.length < limit) out.push(s);
  };
  if (civ.endYear !== endYear) bad(`只推到第 ${civ.endYear} 年(应到 ${endYear})`);
  const odd = oddNumbers(civ);
  for (const [s, p] of odd.nan) if (!allow.nan.has(s)) bad(`NaN:${p}`);
  for (const [s, p] of odd.inf) if (!allow.inf.has(s)) bad(`Infinity:${p}`);
  const P = civ.polities.length;
  const C = civ.cultures.length;
  const R = civ.regions.count;
  const A = civ.annals;
  for (let i = 0; i < A.length; i++) {
    const e = A[i];
    if (!Number.isFinite(e.year) || (i && e.year < A[i - 1].year)) bad(`史事 ${i}(${e.kind})年份 ${e.year}`);
    // 同化与迁徙、民族分化的 a、b 是民族;大迁徙的 a 是民族、b 是国家;别的 a、b 是国家
    const folk = e.kind === 'migrate' || e.kind === 'assimilate' || e.kind === 'vanish' || e.kind === 'diverge';
    const ok = folk ? e.a >= 0 && e.a < C && e.b < C : e.kind === 'trek' ? e.a >= 0 && e.a < C && e.b < P : e.a < P && e.b < P;
    if (!ok) bad(`史事 ${i}(${e.kind})编号 ${e.a}/${e.b}`);
  }
  for (const po of civ.polities) {
    if (!Number.isFinite(po.founded) || !po.name) bad(`国家 ${po.id} 立国 ${po.founded}`);
    if (po.ended === undefined) {
      if (civ.polity[civ.settlements[capitalAt(po, civ.endYear)].region] !== po.id) bad(`国家 ${po.id} 的国都不在本国`);
    } else if (!Number.isFinite(po.ended) || civ.polity.includes(po.id)) bad(`国家 ${po.id} 亡国 ${po.ended} 还有州`);
    const d = po.dynasties ?? [];
    d.forEach((x, i) => {
      if (!Number.isFinite(x.year) || (i && !(x.year > d[i - 1].year))) bad(`国家 ${po.id} 第 ${i} 朝 ${x.year}`);
    });
  }
  for (let q = 0; q < R; q++) if (civ.polity[q] < -1 || civ.polity[q] >= P || civ.culture[q] < -1 || civ.culture[q] >= C) bad(`州 ${q} 归属编号`);
  for (const cu of civ.cultures) if (cu.ended !== undefined && (!Number.isFinite(cu.ended) || civ.culture.includes(cu.id))) bad(`民族 ${cu.id} 消亡 ${cu.ended} 还有州`);
  for (const st of civ.settlements) {
    if (!Number.isFinite(st.founded) || !st.name) bad(`城 ${st.id} 建城 ${st.founded}`);
    for (const k of st.sacks ?? []) if (!Number.isFinite(k.year) || !(k.loss > 0 && k.loss < 1)) bad(`城 ${st.id} 折损 ${k.loss}(${k.cause ?? 'war'})`);
    for (const y of [st.founded, (st.founded + civ.endYear) / 2, st.ended ?? civ.endYear, civ.endYear]) {
      const pop = populationAt(st, y);
      if (!Number.isFinite(pop) || pop < 0 || (st.ended !== undefined && y >= st.ended && pop !== 0)) bad(`城 ${st.id} 第 ${y} 年人口 ${pop}`);
    }
  }
  const words = /undefined|NaN/;
  for (const x of civ.people ?? []) {
    const life = `人物 ${x.id}(${x.role})生卒 ${x.born}/${x.died} 在位 ${x.from}/${x.until}`;
    if (!Number.isFinite(x.born) || [x.died, x.from, x.until].some((y) => y !== undefined && !Number.isFinite(y))) bad(life);
    // 生、即位、下台、卒的先后对得上(没即位就卒、卒了还在位的不行)
    else if ((x.died !== undefined && x.died < x.born) || (x.from !== undefined && (x.from < x.born || (x.died !== undefined && x.died < x.from) || (x.until !== undefined && x.until < x.from))) || (x.until !== undefined && x.died !== undefined && x.died < x.until - 1e-9)) bad(`${life} 先后对不上`);
    if (!x.name || words.test(x.name) || (x.title !== undefined && words.test(x.title))) bad(`人物 ${x.id} 名字 ${x.name}`);
  }
  for (const s of warSpans(civ)) if (!(s.end >= s.start)) bad(`战事 ${s.start}–${s.end}`);
  for (const e of buildChronicle(civ)) if (!e.text || words.test(e.text)) bad(`编年史 ${e.year}:${e.text}`);
  if (civ.religion) {
    const a = faithAt(civ, civ.endYear * 0.55);
    const b = faithFromScratch(civ, civ.endYear * 0.55);
    for (let q = 0; q < R; q++)
      if (a[q] !== b[q]) {
        bad(`信仰第 ${q} 州对不上`);
        break;
      }
  }
  return out;
}
