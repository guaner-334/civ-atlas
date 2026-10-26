/**
 * 政局的数表(gen/civ/stateTables.ts):管得到几成、离国都多远、乡村人口(连同搬家)、钱粮(连同议事改的征收之法、分封、军制、官制)、动荡(连同压到 0 以上之前的值)、国力,
 * 数表算出来的和照公式直接算的一样(两种跑法都是)。
 * 用一串连着的州(邻边的类型轮着来;每州 TPR 个地块,也连成一串)、随机填的输入,不用生成世界。
 */
import { describe, expect, it } from 'vitest';
import { TableEngine, type Backend } from '../src/gen/civ/tables';
import { stateCards } from '../src/gen/civ/stateTables';
import { NEVER } from '../src/gen/civ/devTables';
import { CONTROL_CONSTS as C, FISCAL_CONSTS as F } from '../src/gen/civ/control';
import { UNREST_CONSTS as U } from '../src/gen/civ/unrest';
import { POP_CONSTS as H } from '../src/gen/civ/population';
import { COUNCIL_CONSTS as K } from '../src/gen/civ/councilRules';
import { fpow, keyed } from '../src/gen/civ/rand';

const R = 40;
const NP = 5;
/** 每州几个地块(地块 t 在州 floor(t / TPR),t 和 t ± 1 相邻) */
const TPR = 3;
const NT = R * TPR;

/** r 和 r + 1 之间那条邻边的类型(平地、河、山、海峡、远洋航线轮着来) */
const kindOf = (r: number) => r % 5;

/** 州排成一串(r 和 r ± 1 相邻) */
function chain() {
  const adjStart = new Int32Array(R + 1);
  const adj: number[] = [];
  const kind: number[] = [];
  for (let r = 0; r < R; r++) {
    adjStart[r] = adj.length;
    if (r > 0) adj.push(r - 1), kind.push(kindOf(r - 1));
    if (r + 1 < R) adj.push(r + 1), kind.push(kindOf(r));
  }
  adjStart[R] = adj.length;
  const of = Int32Array.from({ length: NT }, (_, t) => Math.floor(t / TPR));
  const cellStart = Int32Array.from({ length: R + 1 }, (_, r) => r * TPR);
  const cells = Int32Array.from({ length: NT }, (_, t) => t);
  return { count: R, adjStart, adj: Int32Array.from(adj), adjKind: Uint8Array.from(kind), seat: Int32Array.from({ length: R }, (_, r) => r * 7), of, cellStart, cells };
}

/** 地块排成一串 */
function tileChain() {
  const adjStart = new Int32Array(NT + 1);
  const adj: number[] = [];
  for (let t = 0; t < NT; t++) {
    adjStart[t] = adj.length;
    if (t > 0) adj.push(t - 1);
    if (t + 1 < NT) adj.push(t + 1);
  }
  adjStart[NT] = adj.length;
  return { count: NT, adjStart, adj: Int32Array.from(adj) };
}

/** 各地块分到一州上限的几成(一州加起来是 1)、地经不经得住种 */
const SHARE = Array.from({ length: NT }, (_, t) => {
  const r = Math.floor(t / TPR);
  const w = (i: number) => 0.2 + keyed(777, r, i, 0);
  let sum = 0;
  for (let i = 0; i < TPR; i++) sum += w(i);
  return w(t % TPR) / sum;
});
const FRAGILE = Array.from({ length: NT }, (_, t) => keyed(778, t, 0, 0));

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
    city: u(r, 9) < 0.5 ? 80 * u(r, 10) : 0,
    prod: 6 * u(r, 11),
    move: 6 * u(r, 12),
    port: u(r, 13) < 0.3 ? 1 : 0,
    river: u(r, 14) < 0.3 ? 1 : 0,
    // 乡村人口上限(州 5–9 一直没人住)、长得多快、兵灾几件
    ruralCap: r >= 5 && r < 10 ? 0 : 50 + 250 * u(r, 15),
    ruralRate: 0.002 + 0.03 * u(r, 16),
    strife: u(r, 17) < 0.3 ? Math.floor(3 * u(r, 18)) : 0,
    // 饥荒水旱几件
    blight: u(r, 20) < 0.2 ? 1 : 0,
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
    // 军力系数、方针给的国力倍数
    mil: 1 + 2 * u(100 + p, 15),
    scale: u(100 + p, 16) < 0.3 ? 0.5 + u(100 + p, 17) : 1,
    // 议事定下的:直征多收的几成、直征的开销、分封了边地没有、改制的余波
    lift: u(100 + p, 18) < 0.4 ? 0.4 * u(100 + p, 19) : 0,
    cost: u(100 + p, 18) < 0.4 ? 0.07 * u(100 + p, 20) : 0,
    fief: u(100 + p, 21) < 0.4 ? 1 : 0,
    shock: u(100 + p, 22) < 0.3 ? 0.15 * u(100 + p, 23) : 0,
    // 军制(禁军多出兵的几成和开销、边镇)、官制(铨选多管的几档行政能力和开销;自辟是负的)
    armyLift: u(100 + p, 24) < 0.3 ? 0.2 * u(100 + p, 25) : 0,
    armyCost: u(100 + p, 24) < 0.3 ? 0.05 * u(100 + p, 25) : 0,
    border: u(100 + p, 24) > 0.8 ? 1 : 0,
    officeLift: u(100 + p, 26) < 0.4 ? 2 * u(100 + p, 27) - 1 : 0,
    officeCost: u(100 + p, 26) < 0.4 ? 0.04 * (2 * u(100 + p, 27) - 1) : 0,
  }));
  return { reg, pol };
}

/** 接着上一步的:三样收入(几年算一次)、国库;开垦了几成、兵祸(按州)、地力、乡村人口(按地块;每 POP_EVERY 年算一次) */
interface Ledger {
  income: number[][];
  treasury: number[];
  farm: number[];
  strife: number[];
  soil: number[];
  rural: number[];
  /** 乡村人口上一次算是哪一步;一共搬了多少 */
  popAt: number;
  moved: number;
}

/** 各州的和 */
function perRegion(v: number[]): number[] {
  return Array.from({ length: R }, (_, r) => {
    let s = 0;
    for (let i = 0; i < TPR; i++) s += v[r * TPR + i];
    return s;
  });
}

/** 乡村人口照 stateTables.ts 文件头的公式算一步(按地块;搬家照引擎的写法:一块搬出去的总量不超过它有的);返回一共搬了多少 */
function ruralStep(x: ReturnType<typeof inputs>, dt: number, led: Ledger): number {
  const farm = x.reg.map((g, r) => {
    if (g.ruralCap <= 0) return 0;
    const f = led.farm[r];
    return Math.min(1, Math.max(0, f <= 0 ? 1 / (1 + H.GROWTH_A) : f + dt * g.ruralRate * f * (1 - f)));
  });
  const strife = x.reg.map((g, r) => Math.min(1, Math.max(0, Math.min(1, led.strife[r] * (dt > 0 ? fpow(H.FADE, H.POP_EVERY) : 1) + H.HIT * g.strife))));
  const reg = (t: number) => x.reg[Math.floor(t / TPR)];
  const R0 = (t: number) => Math.floor(t / TPR);
  const soil = led.soil.map((d, t) => {
    const g = reg(t);
    if (g.ruralCap * SHARE[t] <= 0) return 1;
    const v = Math.max(H.LAND_FLOOR, Math.min(1, d + dt * (H.LAND_REST * (1 - d) - H.WEAR * farm[R0(t)] * FRAGILE[t] - H.SCORCH * strife[R0(t)]) - H.BLIGHT * g.blight));
    return Math.min(1, Math.max(0, v));
  });
  const P = led.rural;
  const total = perRegion(P);
  const due = soil.map((d, t) => reg(t).ruralCap * SHARE[t] * farm[R0(t)] * d);
  const next = due.map((v0, t) => {
    const v = v0 <= 0 ? 0 : total[R0(t)] <= 0 ? v0 : P[t] + (dt * (v0 - P[t])) / H.RECOVER;
    return Math.min(1e9, Math.max(0, v));
  });
  const nbs = due.map((_v, t) => [t - 1, t + 1].filter((q) => q >= 0 && q < NT && reg(q).ruralCap > 0).length);
  // 每块往左、往右各搬多少
  const out = due.map(() => [0, 0]);
  if (dt > 0) {
    due.forEach((_v, t) => {
      const g = reg(t);
      let sum = 0;
      [t - 1, t + 1].forEach((q, side) => {
        if (q < 0 || q >= NT) return;
        const n = reg(q);
        const crowd = P[t] / Math.max(g.ruralCap * SHARE[t] * farm[R0(t)] * soil[t], 1e-9);
        const there = P[q] / Math.max(n.ruralCap * SHARE[q] * farm[R0(q)] * soil[q], 1e-9);
        const road = n.ruralCap <= 0 ? 0 : n.p === g.p ? 1 : H.ABROAD;
        const v = road * P[t] * (H.MIG * Math.max(0, crowd - there) + (H.FLEE * Math.max(0, strife[R0(t)] - strife[R0(q)])) / Math.max(1, nbs[t]));
        out[t][side] = v > 0 ? v * dt : 0;
        sum += out[t][side];
      });
      const have = Math.max(0, Math.min(P[t], next[t]));
      if (sum > have) for (const side of [0, 1]) out[t][side] *= have / sum;
    });
  }
  const moved = next.map((v, t) => {
    let d = 0;
    if (t > 0) d += out[t - 1][1] - out[t][0];
    if (t + 1 < NT) d += out[t + 1][0] - out[t][1];
    return Math.min(1e9, Math.max(0, d !== 0 ? v + d : v));
  });
  led.farm = farm;
  led.strife = strife;
  led.soil = soil;
  led.rural = moved;
  // 搬家前后总人口不变
  const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
  expect(sum(moved)).toBeCloseTo(sum(next), 6);
  return sum(out.map((o) => o[0] + o[1]));
}

/** 一州的地力(按各块能养多少人加权) */
function regionSoil(x: ReturnType<typeof inputs>, soil: number[]): number[] {
  return x.reg.map((g, r) => {
    if (g.ruralCap <= 0) return 1;
    let s = 0;
    for (let i = 0; i < TPR; i++) s += SHARE[r * TPR + i] * soil[r * TPR + i];
    return s;
  });
}

/** 照公式直接算(原来事件层现算的写法;钱粮照 stateTables.ts 文件头的公式) */
function reference(x: ReturnType<typeof inputs>, k: number, led: Ledger) {
  const scale = (p: number) => 1 + C.ADMIN_GAIN * Math.max(0, x.pol[p].admin);
  // 管得到几成里的行政能力再加铨选多管的几档(离国都远近不加)
  const reach = (p: number) => 1 + C.ADMIN_GAIN * Math.max(0, x.pol[p].admin + x.pol[p].officeLift);
  const ctl = x.reg.map((g) => {
    if (g.p < 0) return 0;
    if (g.seat) return 1;
    const xx = g.dist >= NEVER ? 4 : g.dist / (C.REACH * reach(g.p));
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
  if (k % H.POP_EVERY === 0) {
    led.moved += ruralStep(x, k === 0 ? 0 : k - led.popAt, led);
    led.popAt = k;
  }
  const ruralR = perRegion(led.rural);
  const soilR = regionSoil(x, led.soil);
  if (k % F.FISCAL_EVERY === 0) {
    led.income = x.reg.map((g, r) =>
      g.p < 0
        ? [0, 0, 0]
        : [
            ruralR[r] * soilR[r] * F.LAND * (1 + F.LAND_PROD * g.prod),
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
      rev += sum * (g.lord ? 0 : q.fief && ctl[r] < K.FIEF_C ? K.FIEF_REMIT : F.REMIT_0 + (1 - F.REMIT_0) * Math.min(1, ctl[r] + q.lift));
    });
    const inc = rev + q.got;
    const out = owed * (F.OFFICE + q.officeCost + q.cost + q.armyCost + F.ARMY * q.wars * (q.border ? K.BORDER_ARMY : 1)) + q.paid;
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
    let u = q.crisis + U.FAR_W * (q.fief ? K.FIEF_FAR : 1) * Math.max(0, sumFar / N - U.FAR_0) + (U.FOREIGN_W * foreign) / N;
    if (q.age < U.NEW_YEARS) u -= U.NEW_W;
    else u += U.AGE_W * Math.min(1, Math.max(0, (q.age - U.AGE_0) / U.AGE_SPAN));
    if (q.famine) u += U.FAMINE_W * Math.min(1, q.famine / Math.max(U.FAMINE_FULL_MIN, U.FAMINE_FULL * N));
    if (q.plague) u += U.PLAGUE_W * Math.min(1, q.plague / Math.max(U.FAMINE_FULL_MIN, U.PLAGUE_FULL * N));
    u += U.REVOLT_W * q.quell + F.FISCAL_W * broke[p] + q.shock;
    return u;
  });
  const unrest = base.map((u, p) => Math.max(0, u) + Math.min(C.LORD_U_MAX, C.LORD_U * x.pol[p].lords));
  // 国力:城的人口 × 出兵的几成(割据的州 0;收了兵权的加兵升;设了边镇的边地全出),至少 1,再乘军力系数、国力倍数
  const power = x.pol.map((q, p) => {
    let sum = 0;
    x.reg.forEach((g, r) => {
      if (g.p === p) sum += g.city * (g.lord ? 0 : q.border && ctl[r] < K.BORDER_C ? 1 : Math.min(1, ctl[r] + C.LEVY_0 + q.armyLift));
    });
    return Math.max(1, sum) * q.mil * q.scale;
  });
  return { ctl, power, far, base, unrest, broke, treasury: led.treasury.slice(), rural: led.rural.slice(), ruralR, farm: led.farm.slice(), soil: led.soil.slice(), soilR };
}

describe('政局的数表', () => {
  for (const backend of ['js', 'closure'] as Backend[]) {
    it(`管得到几成、离国都多远、乡村人口、钱粮、动荡、国力和照公式直接算的一样(${backend})`, () => {
      const eng = new TableEngine({ seed: 1, cards: stateCards(C, U, F, H, K), units: { region: chain(), tile: tileChain() }, owner: '国', backend });
      eng.setPolities(NP);
      let negative = 0;
      let broke = 0;
      let rich = 0;
      const zero = () => new Array(R).fill(0);
      const led: Ledger = { income: [], treasury: new Array(NP).fill(0), farm: zero(), strife: zero(), soil: new Array(NT).fill(1), rural: new Array(NT).fill(0), popAt: 0, moved: 0 };
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
        set('乡容', (r) => x.reg[r].ruralCap);
        set('乡速', (r) => x.reg[r].ruralRate);
        set('新祸', (r) => x.reg[r].strife);
        set('新荒', (r) => x.reg[r].blight);
        set('份', (t) => SHARE[t]);
        set('脆', (t) => FRAGILE[t]);
        set('军力', (p) => x.pol[p].mil);
        set('国力倍数', (p) => x.pol[p].scale);
        set('征升', (p) => x.pol[p].lift);
        set('征费', (p) => x.pol[p].cost);
        set('分封', (p) => x.pol[p].fief);
        set('改制', (p) => x.pol[p].shock);
        set('兵升', (p) => x.pol[p].armyLift);
        set('兵费', (p) => x.pol[p].armyCost);
        set('边镇', (p) => x.pol[p].border);
        set('官升', (p) => x.pol[p].officeLift);
        set('官费', (p) => x.pol[p].officeCost);
        // 城的人口每年填(国力要;三样收入只在算它们的年份读)
        set('城民', (r) => x.reg[r].city);
        set('有人邻块', (t) => [t - 1, t + 1].filter((q) => q >= 0 && q < NT && x.reg[Math.floor(q / TPR)].ruralCap > 0).length);
        if (k % F.FISCAL_EVERY === 0) {
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
          rural: [...eng.get('乡民')],
          ruralR: [...eng.get('乡口')],
          farm: [...eng.get('垦')],
          soil: [...eng.get('地力')],
          soilR: [...eng.get('州地力')],
          power: [...eng.get('国力')],
        };
        if (want.base.some((u) => u < 0)) negative++;
        if (want.broke.some((b) => b > 0)) broke++;
        if (want.treasury.some((t) => t > 0)) rich++;
        for (const key of ['ctl', 'far', 'base', 'unrest', 'broke', 'treasury', 'farm', 'soil', 'soilR', 'power'] as const) {
          want[key].forEach((v, i) => expect(got[key][i], `第 ${k} 组 ${key} ${i}`).toBeCloseTo(v, 12));
        }
        want.rural.forEach((v, i) => expect(Math.abs(got.rural[i] - v), `第 ${k} 组 乡民 ${i}`).toBeLessThan(1e-9 * (1 + Math.abs(v))));
        want.ruralR.forEach((v, i) => expect(Math.abs(got.ruralR[i] - v), `第 ${k} 组 乡口 ${i}`).toBeLessThan(1e-9 * (1 + Math.abs(v))));
        // 管得到几成、离国都多远逐位一样(算的先后一样)
        want.ctl.forEach((v, i) => expect(got.ctl[i], `第 ${k} 组 管辖 ${i}`).toBe(v));
        want.far.forEach((v, i) => expect(got.far[i], `第 ${k} 组 边远 ${i}`).toBe(v));
      }
      expect(negative).toBeGreaterThan(0);
      // 搬过家
      expect(led.moved).toBeGreaterThan(1);
      // 有国用不足的,也有攒下钱的
      expect(broke).toBeGreaterThan(0);
      expect(rich).toBeGreaterThan(0);
    });
  }
});
