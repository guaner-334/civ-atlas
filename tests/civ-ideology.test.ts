/**
 * 思潮(gen/civ/ideology.ts,推演里跟着发展度每 20 年算一步,只算不用):
 * - 冒出来的前提:那几样发明世上已经有了、那州的能力到了那一档、那座城够大;发明还没有的说不冒
 * - 传播:同一国快、跨国慢、走航线更慢(在几州的小图上单算数表)
 * - 退潮:合不来了、对头盛了就往下掉;真的世界里也有渐衰的
 * - 查的接口:某年各州、某国某年各说的接受度(按人口加权)、哪年传进本国、世上头一处
 * - 存档读回、接着推和一口气推完一样
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { populationAt, regionPopulationAt } from '../src/gen/civ/growth';
import { CAP_COUNT, INVENTIONS, developmentAt } from '../src/gen/civ/development';
import { ARRIVE, IDEO_SCALE, THOUGHTS, THOUGHT_COUNT, ideologyAt, polityIdeologyAt, polityThoughts, ideoTableCards, thoughtArrival, thoughtOrigin } from '../src/gen/civ/ideology';
import { TableEngine, type Backend } from '../src/gen/civ/engine/tables';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { AdjKind } from '../src/gen/civ/types';

const K = THOUGHT_COUNT;
const T = (name: string) => THOUGHTS.findIndex((t) => t.name === name);

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}

// ---------------------------------------------------------------------------
// 几州的小图:单算数表

interface Mini {
  /** 各州的邻州(双向写一次)和边的类型 */
  edges: [number, number, number][];
  polity: number[];
  /** 五种能力(各州一样) */
  level: number;
  /** 各国的国号、州数 */
  tier?: number;
}

function miniEngine(m: Mini, backend?: Backend): TableEngine {
  const R = m.polity.length;
  const nb: [number, number][][] = Array.from({ length: R }, () => []);
  for (const [a, b, kind] of m.edges) {
    nb[a].push([b, kind]);
    nb[b].push([a, kind]);
  }
  const adjStart = new Int32Array(R + 1);
  for (let r = 0; r < R; r++) adjStart[r + 1] = adjStart[r] + nb[r].length;
  const adj = new Int32Array(adjStart[R]);
  const adjKind = new Uint8Array(adjStart[R]);
  nb.flat().forEach(([j, kind], i) => ((adj[i] = j), (adjKind[i] = kind)));
  const eng = new TableEngine({ seed: 1, cards: ideoTableCards(), units: { region: { count: R, adjStart, adj, adjKind, seat: new Int32Array(R) } }, owner: '国', ...(backend ? { backend } : {}) });
  const P = Math.max(0, ...m.polity) + 1;
  eng.setPolities(P);
  eng.input('民族').fill(0);
  eng.input('国').set(m.polity);
  eng.input('能力').fill(m.level);
  eng.input('城民').fill(50);
  eng.input('人数').fill(100);
  eng.input('粮').fill(2);
  eng.input('国号').fill(m.tier ?? 2);
  eng.input('州数').fill(R);
  eng.start(0);
  return eng;
}

/** 填上各州各说的接受度(州 → 说 → 值),先算一步 dt = 0 的,返回各州第 k 说再算 n 步(每步 20 年)以后的接受度 */
function run(eng: TableEngine, start: Record<number, Record<number, number>>, k: number, n: number): number[] {
  const v = new Float64Array(eng.get('思潮').length);
  for (const [r, row] of Object.entries(start)) for (const [j, x] of Object.entries(row)) v[Number(r) * K + Number(j)] = x;
  eng.set('思潮', v);
  eng.step(0);
  for (let i = 1; i <= n; i++) eng.step(20 * i);
  const out = eng.get('思潮');
  return Array.from({ length: out.length / K }, (_, r) => out[r * K + k]);
}

describe('思潮的数表(几州的小图)', () => {
  it('传播:同一国的邻州学得快,跨国的慢,走航线的更慢;没传进来的说还是 0', () => {
    // 0 是传出去的那州;1 同一国、2 别国(都挨着陆路),3 别国、只有航线连着
    const law = T('律法之说');
    const eng = miniEngine({ edges: [[0, 1, AdjKind.Flat], [0, 2, AdjKind.Flat], [0, 3, AdjKind.SeaRoute]], polity: [0, 0, 1, 1], level: 2.5 });
    const v = run(eng, { 0: { [law]: 0.6 } }, law, 1);
    expect(v[1]).toBeGreaterThan(v[2] * 1.5);
    expect(v[2]).toBeGreaterThan(v[3]);
    expect(v[3]).toBeGreaterThan(0);
    // 一步至多追平最高的邻州
    expect(Math.max(v[1], v[2], v[3])).toBeLessThanOrEqual(0.6 + 1e-12);
    // 别的几说一州都没有:不会凭空冒出来
    const all = eng.get('思潮');
    for (let r = 0; r < 4; r++) for (let j = 0; j < K; j++) if (j !== law) expect(all[r * K + j]).toBe(0);
  });

  it('前提够不够:能力差得远的州传进去也扎不下根', () => {
    // 民权之说要印刷术(信息 3.4):能力 1.5 的州只学到一点、之后往下掉;能力 4 的州长上去
    const k = T('民权之说');
    const low = run(miniEngine({ edges: [[0, 1, AdjKind.Flat]], polity: [0, 0], level: 1.5 }), { 0: { [k]: 0.7 } }, k, 6);
    const high = run(miniEngine({ edges: [[0, 1, AdjKind.Flat]], polity: [0, 0], level: 4 }), { 0: { [k]: 0.7 } }, k, 6);
    expect(high[1]).toBeGreaterThan(0.3);
    expect(low[1]).toBeLessThan(high[1] / 2);
    expect(low[0]).toBeLessThan(0.7);
  });

  it('退潮:不在国里了(天命之说合不来)往下掉;对头(民权之说)盛了往下掉', () => {
    const fate = T('天命之说');
    const rights = T('民权之说');
    // 一州,不在国里:天命之说一步步往下掉
    const lone = miniEngine({ edges: [], polity: [-1], level: 3 });
    const seq: number[] = [];
    lone.set('思潮', Object.assign(new Float64Array(K), { [fate]: 0.8 }));
    lone.step(0);
    for (let i = 1; i <= 5; i++) {
      lone.step(20 * i);
      seq.push(lone.value('思潮', 0, fate));
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThan(seq[i - 1]);
    expect(seq[seq.length - 1]).toBeLessThan(0.6);
    // 在国里:没有对头时守得住,民权之说盛了就衰
    const calm = run(miniEngine({ edges: [], polity: [0], level: 3 }), { 0: { [fate]: 0.6 } }, fate, 5);
    const rival = run(miniEngine({ edges: [], polity: [0], level: 3 }), { 0: { [fate]: 0.6, [rights]: 0.9 } }, fate, 5);
    expect(calm[0]).toBeGreaterThan(0.5);
    expect(rival[0]).toBeLessThan(calm[0] - 0.1);
  });

  it('天命之说到了印刷的时代合不来:信息过了 3 档的州守不住', () => {
    const fate = T('天命之说');
    const keep = run(miniEngine({ edges: [], polity: [0], level: 3 }), { 0: { [fate]: 0.6 } }, fate, 5);
    const late = run(miniEngine({ edges: [], polity: [0], level: 4 }), { 0: { [fate]: 0.6 } }, fate, 5);
    expect(keep[0]).toBeGreaterThan(0.55);
    expect(late[0]).toBeLessThan(keep[0] - 0.15);
  });

  it('后来几说(技艺、民权)传得快:同样隔着国界、前提都够,一步传过去的比律法之说多得多', () => {
    // 0 是传出去的那州,1 是别国的邻州;两说在 0 州一样多
    const m: Mini = { edges: [[0, 1, AdjKind.Flat]], polity: [0, 1], level: 4.5 };
    for (const k of [T('技艺之说'), T('民权之说')]) {
      const law = T('律法之说');
      const slow = run(miniEngine(m), { 0: { [law]: 0.6 } }, law, 1);
      const fast = run(miniEngine(m), { 0: { [k]: 0.6 } }, k, 1);
      expect(fast[1]).toBeGreaterThan(slow[1] * 1.5);
      expect(fast[1]).toBeLessThanOrEqual(0.6 + 1e-12);
    }
  });

  it('技艺、民权:前提差两档以内的州也学得进一点(能隔着还落后的地方传到别处),差得更多的学不进', () => {
    // 民权之说要印刷术(信息 3.4):差 1.4 档还学得进一点,差 2.1 档学不进
    const k = T('民权之说');
    const at = (level: number) => run(miniEngine({ edges: [[0, 1, AdjKind.Flat]], polity: [0, 0], level }), { 0: { [k]: 0.6 } }, k, 1)[1];
    expect(at(2)).toBeGreaterThan(0.05);
    expect(at(2)).toBeLessThan(at(3.4));
    expect(at(1.3)).toBe(0);
  });

  it('拼成函数和拼成闭包(网页不许拼函数时)算出来逐位一样;各国按人口加权', () => {
    const m: Mini = { edges: [[0, 1, AdjKind.Flat], [1, 2, AdjKind.Mountain], [2, 3, AdjKind.Strait], [3, 0, AdjKind.SeaRoute], [1, 3, AdjKind.River]], polity: [0, 0, 1, -1], level: 3.6 };
    const out = (['js', 'closure'] as Backend[]).map((b) => {
      const eng = miniEngine(m, b);
      eng.input('人数').set([300, 100, 50, 10]);
      run(eng, { 0: { 0: 0.5, 1: 0.7, 2: 0.4, 4: 0.6 }, 2: { 3: 0.3 } }, 0, 8);
      return [Array.from(eng.get('思潮')), Array.from(eng.get('国中'))];
    });
    expect(out[1]).toEqual(out[0]);
    // 国中:国 0 = 州 0、1 按人口(+1)加权
    const [v, nat] = out[0];
    for (let k = 0; k < K; k++) expect(nat[k]).toBeCloseTo((301 * v[k] + 101 * v[K + k]) / 402, 12);
  });
});

describe.each([7, 2024])('思潮 · seed %i', (seed) => {
  it('冒出来的前提:发明世上已有、那州能力到了那一档、那座城够大;发明还没有的说不冒', () => {
    const civ = civOf(seed);
    const ideo = civ.ideology!;
    const dev = civ.development!;
    const invented = (name: string) => dev.events.find((e) => e.kind === 'invent' && INVENTIONS[e.invention!].name === name)?.year;
    expect(ideo.events.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ideo.events.map((e) => e.thought)).size).toBe(ideo.events.length);
    for (let k = 0; k < K; k++) {
      const e = thoughtOrigin(ideo, k);
      const firsts = THOUGHTS[k].needs.map(invented);
      if (firsts.some((y) => y === undefined)) {
        expect(e, `${THOUGHTS[k].name} 的发明还没有`).toBeUndefined();
        continue;
      }
      if (!e) continue;
      const label = `${THOUGHTS[k].name} ${e.year}`;
      for (const y of firsts) expect(y!, label).toBeLessThanOrEqual(e.year);
      // 那州的能力:冒出来以后那一份快照里到了那一档(快照存的是整数档位的 1/28,留一点余地)
      const snapYear = Math.ceil(e.year / 100) * 100;
      const lv = developmentAt(dev, snapYear);
      for (const name of THOUGHTS[k].needs) {
        const inv = INVENTIONS.find((x) => x.name === name)!;
        expect(lv[e.region * CAP_COUNT + inv.cap], label).toBeGreaterThanOrEqual(inv.level - 0.1);
      }
      // 那座城:那一步(整 20 年)还在、有镇那么大;那一刻那州的民族、国家
      const s = civ.settlements[e.settlement];
      const step = Math.ceil(e.year / 20) * 20;
      expect(s.region, label).toBe(e.region);
      expect(s.founded, label).toBeLessThanOrEqual(e.year);
      expect(populationAt(s, step), label).toBeGreaterThanOrEqual(8);
      expect(e.culture, label).toBeGreaterThanOrEqual(0);
      // 那州冒出来以后有这一说
      expect(ideologyAt(ideo, snapYear)[e.region * K + k], label).toBeGreaterThan(0);
      // 始倡这一说的那国:冒出来那年就算传进本国;那一步的国中已经算上冒出来的那一州(那州的人口占得够多时看得出来)
      if (e.polity >= 0) {
        expect(thoughtArrival(ideo, e.polity, k), label).toBe(e.year);
        const own = ownersAt(civ, step).polity;
        let w = 0;
        for (let r = 0; r < own.length; r++) if (own[r] === e.polity) w += regionPopulationAt(civ, r, step) + 1;
        if (own[e.region] === e.polity && (0.3 * (regionPopulationAt(civ, e.region, step) + 1)) / w > 3 / IDEO_SCALE) expect(polityIdeologyAt(ideo, e.polity, step)[k], label).toBeGreaterThan(0);
      }
    }
    // 冒出来以前,世上没有一州有这一说
    for (const e of ideo.events) {
      const before = ideo.snapYears.filter((y) => y < e.year);
      for (const y of before) expect(ideologyAt(ideo, y).filter((_, i) => i % K === e.thought).every((x) => x === 0), `${THOUGHTS[e.thought].name} 第 ${y} 年`).toBe(true);
    }
  }, 60_000);

  it('查的接口:各国按人口加权、哪年传进本国、盛行的几说', () => {
    const civ = civOf(seed);
    const ideo = civ.ideology!;
    // 各州:快照那年就是快照
    const y0 = ideo.snapYears[20];
    const at = ideologyAt(ideo, y0);
    ideo.snaps[20].forEach((x, i) => expect(at[i]).toBeCloseTo(x / IDEO_SCALE, 6));
    // 某国某年 ≈ 那年国里各州的接受度按人口加权(推演里按那一刻的人口算,这里按存下来的人口,差一点)
    const Y = 2500;
    const own = ownersAt(civ, Y).polity;
    const lv = ideologyAt(ideo, Y);
    const size = new Map<number, number>();
    for (const p of own) if (p >= 0) size.set(p, (size.get(p) ?? 0) + 1);
    const big = [...size.entries()].filter(([, n]) => n >= 10).map(([p]) => p);
    expect(big.length).toBeGreaterThan(2);
    let checked = 0;
    for (const p of big) {
      const sum = new Array<number>(K).fill(0);
      let w = 0;
      for (let r = 0; r < own.length; r++) {
        if (own[r] !== p) continue;
        const x = regionPopulationAt(civ, r, Y) + 1;
        w += x;
        for (let k = 0; k < K; k++) sum[k] += x * lv[r * K + k];
      }
      const v = polityIdeologyAt(ideo, p, Y);
      for (let k = 0; k < K; k++) expect(Math.abs(v[k] - sum[k] / w), `${civ.polities[p].name} ${THOUGHTS[k].name}`).toBeLessThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
    // 每 20 年一份:整 20 年就是存下的那份,中间线性插值
    const s = ideo.polities.find((x) => x && x.v.length >= 3 * K)!;
    const p = ideo.polities.indexOf(s);
    const v0 = polityIdeologyAt(ideo, p, s.from + 20);
    const v1 = polityIdeologyAt(ideo, p, s.from + 40);
    const mid = polityIdeologyAt(ideo, p, s.from + 30);
    for (let k = 0; k < K; k++) {
      expect(v0[k]).toBeCloseTo(s.v[K + k] / IDEO_SCALE, 6);
      expect(mid[k]).toBeCloseTo((v0[k] + v1[k]) / 2, 6);
    }
    // 传进本国:那一刻以后的那一份到了半成,以前的那一份不到(始倡的那国除外)
    let arrivals = 0;
    civ.polities.forEach((q, p) => {
      for (let k = 0; k < K; k++) {
        const t = thoughtArrival(ideo, p, k);
        if (Number.isNaN(t) || thoughtOrigin(ideo, k)?.polity === p) continue;
        arrivals++;
        expect(t).toBeGreaterThanOrEqual(q.founded);
        const after = Math.ceil(t / 20) * 20;
        expect(polityIdeologyAt(ideo, p, after)[k], `${q.name} ${THOUGHTS[k].name} ${t}`).toBeGreaterThanOrEqual(ARRIVE - 1 / IDEO_SCALE);
        const before = after - 20;
        if (before >= ideo.polities[p]!.from) expect(polityIdeologyAt(ideo, p, before)[k], `${q.name} ${THOUGHTS[k].name} ${t}`).toBeLessThan(ARRIVE + 1 / IDEO_SCALE);
      }
    });
    expect(arrivals).toBeGreaterThan(10);
    // 盛行的几说:到半成的,从高到低
    const alive = civ.polities.filter((q) => q.ended === undefined);
    let listed = 0;
    for (const q of alive) {
      const list = polityThoughts(ideo, q.id, civ.endYear);
      for (let i = 0; i < list.length; i++) {
        expect(list[i].share).toBeGreaterThanOrEqual(ARRIVE - 1e-6);
        if (i) expect(list[i].share).toBeLessThanOrEqual(list[i - 1].share);
      }
      listed += list.length;
    }
    expect(listed).toBeGreaterThan(alive.length);
  }, 60_000);

  it('会退潮:有国家的某一说从盛时往下掉了一截', () => {
    const ideo = civOf(seed).ideology!;
    let fell = 0;
    for (const s of ideo.polities) {
      if (!s) continue;
      for (let k = 0; k < K; k++) {
        let peak = 0;
        let last = 0;
        for (let i = k; i < s.v.length; i += K) (peak = Math.max(peak, s.v[i])), (last = s.v[i]);
        if (peak >= 0.3 * IDEO_SCALE && last <= peak - 0.1 * IDEO_SCALE) fell++;
      }
    }
    expect(fell).toBeGreaterThan(0);
  }, 60_000);
});

describe('思潮接着推', () => {
  it.each([1230, 1237.5])('推到第 %d 年、存档读回、接着推到第 3000 年:和一口气推完一样', (stop) => {
    const w = world(7);
    const whole = civOf(7);
    const saved = unpackValue(packValue(generateCiv(w, { endYear: stop }))) as Civ;
    const cont = continueCiv(w, saved, { endYear: 3000 });
    expect(cont.ideology).toEqual(whole.ideology);
    expect(cont.annals).toEqual(whole.annals);
  }, 120_000);
});
