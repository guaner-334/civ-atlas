/**
 * 政局的数表(gen/civ/stateTables.ts):管得到几成、离国都多远、动荡,数表算出来的和照公式直接算的一样(两种跑法都是)。
 * 用一串连着的州、随机填的输入,不用生成世界。
 */
import { describe, expect, it } from 'vitest';
import { TableEngine, type Backend } from '../src/gen/civ/tables';
import { stateCards } from '../src/gen/civ/stateTables';
import { NEVER } from '../src/gen/civ/devTables';
import { CONTROL_CONSTS as C } from '../src/gen/civ/control';
import { UNREST_CONSTS as U } from '../src/gen/civ/unrest';
import { keyed } from '../src/gen/civ/rand';

const R = 40;
const NP = 5;

/** 州排成一串(r 和 r ± 1 相邻) */
function chain() {
  const adjStart = new Int32Array(R + 1);
  const adj: number[] = [];
  for (let r = 0; r < R; r++) {
    adjStart[r] = adj.length;
    if (r > 0) adj.push(r - 1);
    if (r + 1 < R) adj.push(r + 1);
  }
  adjStart[R] = adj.length;
  return { count: R, adjStart, adj: Int32Array.from(adj), adjKind: new Uint8Array(adj.length), seat: Int32Array.from({ length: R }, (_, r) => r * 7) };
}

/** 随机的输入(第 k 组):国 4 没有州,州 0、1 没有国家 */
function inputs(k: number) {
  const u = (i: number, j: number) => keyed(12345, k, i, j);
  const own = Array.from({ length: R }, (_, r) => (r < 2 ? -1 : r % 4));
  const capR = [2, 3, 4, 5, -1];
  const reg = own.map((p, r) => ({
    p,
    dist: u(r, 1) < 0.1 ? NEVER : 30 * u(r, 2),
    seat: p >= 0 && capR[p] === r ? 1 : 0,
    foreign: u(r, 3) < 0.3 ? 1 : 0,
    recent: u(r, 4) < 0.4 ? 200 * u(r, 5) : NEVER,
    big: u(r, 6) < 0.2 ? 1 : 0,
  }));
  const pol = Array.from({ length: NP }, (_, p) => ({
    admin: 9 * u(100 + p, 1) - 1,
    crisis: 2 * u(100 + p, 2),
    age: 500 * u(100 + p, 3),
    famine: u(100 + p, 4) < 0.5 ? Math.floor(6 * u(100 + p, 5)) : 0,
    plague: u(100 + p, 6) < 0.5 ? Math.floor(6 * u(100 + p, 7)) : 0,
    quell: u(100 + p, 8) < 0.3 ? 1 : 0,
    lords: Math.floor(4 * u(100 + p, 9)),
    size: own.filter((x) => x === p).length,
  }));
  return { reg, pol };
}

/** 照公式直接算(原来事件层现算的写法) */
function reference(x: ReturnType<typeof inputs>) {
  const scale = (p: number) => 1 + C.ADMIN_GAIN * Math.max(0, x.pol[p].admin);
  const ctl = x.reg.map((g) => {
    if (g.p < 0) return 0;
    if (g.seat) return 1;
    const xx = g.dist >= NEVER ? 4 : g.dist / (C.REACH * scale(g.p));
    let c = 1 / (1 + xx * xx);
    if (g.foreign) c *= C.FOREIGN;
    if (g.recent < C.RECENT) c *= 1 - C.RECENT_CUT * (1 - g.recent / C.RECENT);
    if (g.big) c *= C.BIG_CITY;
    return c;
  });
  const far = x.reg.map((g) => {
    if (g.p < 0) return 0;
    if (g.dist >= NEVER) return C.REMOTE_MAX;
    return Math.min(C.REMOTE_MAX, g.dist / (C.FAR_REACH * (scale(g.p) / (1 + C.ADMIN_GAIN * C.ADMIN_REF))));
  });
  const unrest = x.pol.map((q, p) => {
    const lords = Math.min(C.LORD_U_MAX, C.LORD_U * q.lords);
    const N = q.size;
    if (!(N > 0)) return lords;
    let sumFar = 0;
    let foreign = 0;
    x.reg.forEach((g, r) => {
      if (g.p !== p) return;
      sumFar += far[r];
      foreign += g.foreign;
    });
    let u = q.crisis + U.FAR_W * Math.max(0, sumFar / N - U.FAR_0) + (U.FOREIGN_W * foreign) / N;
    if (q.age < U.NEW_YEARS) u -= U.NEW_W;
    else u += U.AGE_W * Math.min(1, Math.max(0, (q.age - U.AGE_0) / U.AGE_SPAN));
    if (q.famine) u += U.FAMINE_W * Math.min(1, q.famine / Math.max(U.FAMINE_FULL_MIN, U.FAMINE_FULL * N));
    if (q.plague) u += U.PLAGUE_W * Math.min(1, q.plague / Math.max(U.FAMINE_FULL_MIN, U.PLAGUE_FULL * N));
    u += U.REVOLT_W * q.quell;
    return Math.max(0, u) + lords;
  });
  return { ctl, far, unrest };
}

describe('政局的数表', () => {
  for (const backend of ['js', 'closure'] as Backend[]) {
    it(`管得到几成、离国都多远、动荡和照公式直接算的一样(${backend})`, () => {
      const eng = new TableEngine({ seed: 1, cards: stateCards(C, U), units: { region: chain() }, owner: '国', backend });
      eng.setPolities(NP);
      for (let k = 0; k < 6; k++) {
        const x = inputs(k);
        const set = (id: string, f: (i: number) => number) => {
          const a = eng.input(id);
          for (let i = 0; i < a.length; i++) a[i] = f(i);
        };
        set('国', (r) => x.reg[r].p);
        set('路程', (r) => x.reg[r].dist);
        set('是国都', (r) => x.reg[r].seat);
        set('异族', (r) => x.reg[r].foreign);
        set('新征', (r) => x.reg[r].recent);
        set('大城', (r) => x.reg[r].big);
        set('国都行政', (p) => x.pol[p].admin);
        set('危机', (p) => x.pol[p].crisis);
        set('当朝', (p) => x.pol[p].age);
        set('饥荒', (p) => x.pol[p].famine);
        set('疫病', (p) => x.pol[p].plague);
        set('平叛', (p) => x.pol[p].quell);
        set('割据', (p) => x.pol[p].lords);
        set('州数', (p) => x.pol[p].size);
        if (k === 0) eng.start(0);
        eng.step(k);
        const want = reference(x);
        const got = { ctl: [...eng.get('管辖')], far: [...eng.get('边远')], unrest: [...eng.get('动荡')] };
        for (const key of ['ctl', 'far', 'unrest'] as const) {
          want[key].forEach((v, i) => expect(got[key][i], `第 ${k} 组 ${key} ${i}`).toBeCloseTo(v, 12));
        }
        // 管得到几成、离国都多远逐位一样(算的先后一样)
        want.ctl.forEach((v, i) => expect(got.ctl[i], `第 ${k} 组 管辖 ${i}`).toBe(v));
        want.far.forEach((v, i) => expect(got.far[i], `第 ${k} 组 边远 ${i}`).toBe(v));
      }
    });
  }
});
