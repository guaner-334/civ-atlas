/**
 * 政局的数表(gen/civ/stateTables.ts):管得到几成、离国都多远、钱粮、动荡(连同压到 0 以上之前的值),
 * 数表算出来的和照公式直接算的一样(两种跑法都是)。
 * 用一串连着的州、随机填的输入,不用生成世界。
 */
import { describe, expect, it } from 'vitest';
import { TableEngine, type Backend } from '../src/gen/civ/tables';
import { stateCards } from '../src/gen/civ/stateTables';
import { NEVER } from '../src/gen/civ/devTables';
import { CONTROL_CONSTS as C, FISCAL_CONSTS as F } from '../src/gen/civ/control';
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
    lord: u(r, 7) < 0.15 ? 1 : 0,
    rural: 300 * u(r, 8),
    city: u(r, 9) < 0.5 ? 80 * u(r, 10) : 0,
    prod: 6 * u(r, 11),
    move: 6 * u(r, 12),
    port: u(r, 13) < 0.3 ? 1 : 0,
    river: u(r, 14) < 0.3 ? 1 : 0,
  }));
  const pol = Array.from({ length: NP }, (_, p) => ({
    admin: 9 * u(100 + p, 1) - 1,
    // 国 3 隔一组压低一点:动荡压到 0 以上之前是负的
    crisis: p === 3 && k % 2 === 0 ? -1 : 2 * u(100 + p, 2),
    age: 500 * u(100 + p, 3),
    famine: u(100 + p, 4) < 0.5 ? Math.floor(6 * u(100 + p, 5)) : 0,
    plague: u(100 + p, 6) < 0.5 ? Math.floor(6 * u(100 + p, 7)) : 0,
    quell: u(100 + p, 8) < 0.3 ? 1 : 0,
    lords: Math.floor(4 * u(100 + p, 9)),
    size: own.filter((x) => x === p).length,
    // 打仗多的国家入不敷出,国库会空
    wars: Math.floor(4 * u(100 + p, 10)),
    paid: u(100 + p, 11) < 0.3 ? 5 * u(100 + p, 12) : 0,
    got: u(100 + p, 13) < 0.3 ? 5 * u(100 + p, 14) : 0,
  }));
  return { reg, pol };
}

/** 钱粮里接着上一步的:三样收入(几年算一次)、国库 */
interface Ledger {
  income: number[][];
  treasury: number[];
}

/** 照公式直接算(原来事件层现算的写法;钱粮照 stateTables.ts 文件头的公式) */
function reference(x: ReturnType<typeof inputs>, k: number, led: Ledger) {
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
  if (k % F.FISCAL_EVERY === 0) {
    led.income = x.reg.map((g) =>
      g.p < 0
        ? [0, 0, 0]
        : [
            g.rural * F.LAND * (1 + F.LAND_PROD * g.prod),
            g.city * F.CRAFT * (1 + F.CRAFT_PROD * g.prod),
            g.city * F.TRADE * (1 + F.TRADE_MOVE * g.move) * (1 + F.PORT_W * g.port + F.RIVER_W * g.river),
          ],
    );
  }
  const dt = k === 0 ? 0 : 1;
  const broke = x.pol.map((q, p) => {
    let owed = 0;
    let rev = 0;
    x.reg.forEach((g, r) => {
      if (g.p !== p) return;
      const sum = led.income[r][0] + led.income[r][1] + led.income[r][2];
      owed += sum;
      rev += sum * (g.lord ? 0 : F.REMIT_0 + (1 - F.REMIT_0) * ctl[r]);
    });
    const inc = rev + q.got;
    const out = owed * (F.OFFICE + F.ARMY * q.wars) + q.paid;
    const t = Math.max(0, Math.min(F.RESERVE * owed, led.treasury[p] + dt * (inc - out)));
    led.treasury[p] = t;
    if (t > 0 || out <= 0 || q.age < F.GRACE) return 0;
    return Math.min(1, (F.GAIN * Math.max(0, out - inc)) / out);
  });
  const base = x.pol.map((q, p) => {
    const N = q.size;
    if (!(N > 0)) return 0;
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
    u += U.REVOLT_W * q.quell + F.FISCAL_W * broke[p];
    return u;
  });
  const unrest = base.map((u, p) => Math.max(0, u) + Math.min(C.LORD_U_MAX, C.LORD_U * x.pol[p].lords));
  return { ctl, far, base, unrest, broke, treasury: led.treasury.slice() };
}

describe('政局的数表', () => {
  for (const backend of ['js', 'closure'] as Backend[]) {
    it(`管得到几成、离国都多远、钱粮、动荡和照公式直接算的一样(${backend})`, () => {
      const eng = new TableEngine({ seed: 1, cards: stateCards(C, U, F), units: { region: chain() }, owner: '国', backend });
      eng.setPolities(NP);
      let negative = 0;
      let broke = 0;
      let rich = 0;
      const led: Ledger = { income: [], treasury: new Array(NP).fill(0) };
      for (let k = 0; k < 12; k++) {
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
        set('割据州', (r) => x.reg[r].lord);
        set('战事', (p) => x.pol[p].wars);
        set('纳贡', (p) => x.pol[p].paid);
        set('收贡', (p) => x.pol[p].got);
        if (k % F.FISCAL_EVERY === 0) {
          set('乡民', (r) => x.reg[r].rural);
          set('城民', (r) => x.reg[r].city);
          set('生产', (r) => x.reg[r].prod);
          set('运输', (r) => x.reg[r].move);
          set('港口', (r) => x.reg[r].port);
          set('大河', (r) => x.reg[r].river);
        }
        if (k === 0) eng.start(0);
        eng.step(k);
        const want = reference(x, k, led);
        const got = {
          ctl: [...eng.get('管辖')],
          far: [...eng.get('边远')],
          base: [...eng.get('动荡底')],
          unrest: [...eng.get('动荡')],
          broke: [...eng.get('窘迫')],
          treasury: [...eng.get('国库')],
        };
        if (want.base.some((u) => u < 0)) negative++;
        if (want.broke.some((b) => b > 0)) broke++;
        if (want.treasury.some((t) => t > 0)) rich++;
        for (const key of ['ctl', 'far', 'base', 'unrest', 'broke', 'treasury'] as const) {
          want[key].forEach((v, i) => expect(got[key][i], `第 ${k} 组 ${key} ${i}`).toBeCloseTo(v, 12));
        }
        // 管得到几成、离国都多远逐位一样(算的先后一样)
        want.ctl.forEach((v, i) => expect(got.ctl[i], `第 ${k} 组 管辖 ${i}`).toBe(v));
        want.far.forEach((v, i) => expect(got.far[i], `第 ${k} 组 边远 ${i}`).toBe(v));
      }
      expect(negative).toBeGreaterThan(0);
      // 有国用不足的,也有攒下钱的
      expect(broke).toBeGreaterThan(0);
      expect(rich).toBeGreaterThan(0);
    });
  }
});
