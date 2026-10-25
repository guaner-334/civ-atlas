/**
 * 乡村人口:每州一个数(千人),在政局的数表里每 POP_EVERY 年算一步(年初;规则见 stateTables.ts;control.ts 建引擎时把这里挂上)。
 * 人会搬家:往不挤的邻州去、逃兵灾;死伤、逃散以后几十年长回来。城自己的人口仍照 S 形曲线现算(growth.ts 的 populationAt)。
 *
 * **三张表**:
 *   垦(开垦了几成,0–1):这州建了第一座城起从 1 / (1 + GROWTH_A) 按 S 形曲线长,速度 = 那座城的增长速度(和原来的乡村人口一样慢,
 *     要一两千年才长满);"上限 × 垦"是太平年景这州该有多少人。上限 = 州的面积 × 宜居 × 随生产能力变的倍数(development.ts 的 ruralTargets)。
 *   兵祸(0–1):上一步的 × FADE^年数 + HIT × 上一步以来本州的兵灾件数(战役、攻占、洗劫、毁城、饥荒),最多 1。
 *   乡口(乡村人口):每年往"该有的"靠拢 1 / RECOVER(多出来的慢慢退回去),再往邻州搬:
 *     人往不挤的地方去:自己比邻州挤(人口 ÷ 该有的)多少,每年搬 MIG × 那么多成;逃兵灾:兵祸比邻州重多少,每年再搬 FLEE × 那么多成。
 *     跨国打 ABROAD 折,翻山 MOUNTAIN_W、过海峡 STRAIT_W,远洋航线不走,没人住过的州不去。
 *
 * **事件写回**(每一步算之前,上一步以来的):洗劫、饥荒、地震时乡村折损城里那一成的 RURAL_WAR,瘟疫 RURAL_PLAGUE(growth.ts),
 *   毁城当作折损全部;按城表(Settlement.sacks、ended)和史事(battle、conquer)一件件看,只看这一刻以前的,接着推时按存的那一年接上。
 *
 * **快照**:每 RURAL_SNAP 年存一份进 Civ.development.rural(界面上州、国家的人口按前后两份线性插值,growth.ts 的 ruralPopulationAt)。
 * 随机数:不用。纯计算,不碰 DOM。
 */
import type { Year } from './types';
import type { CivSim } from './sim';
import type { PolityModel } from './polities';
import { RURAL_SNAP, ruralTargets, type DevModel } from './development';
import { GROWTH_A, RURAL_PLAGUE, RURAL_WAR, SACK_RECOVER } from './growth';
import type { TableEngine } from './tables';
import type { PopRuleConsts } from './stateTables';

// ---- 调参(以 20 个种子的统计为准,见 scripts/control-stats.ts) ----
/** 几年算一步(搬家要算每条邻边,每年算太慢;钱粮每 10 年读一次、快照每 10 年一份,都对得齐) */
const POP_EVERY = 5;
/** 往"该有的"靠拢:每年缺口(或多出来的)的 1 / RECOVER(和城被洗劫后长回来一样快) */
const RECOVER = SACK_RECOVER;
/** 人往不挤的地方去:挤的差每年搬几成 */
const MIG = 0.01;
/** 逃兵灾:兵祸的差每年搬几成(分给有人住的邻州) */
const FLEE = 0.05;
/** 兵祸:每件兵灾加几成;每年留几成 */
const HIT = 0.5;
const FADE = 0.7;
/** 跨国、翻山、过海峡打的折 */
const ABROAD = 0.3;
const MOUNTAIN_W = 0.5;
const STRAIT_W = 0.3;

/** 乡村人口的常数(见 stateTables.ts) */
export const POP_CONSTS: PopRuleConsts = { GROWTH_A, POP_EVERY, RECOVER, MIG, FLEE, HIT, FADE, ABROAD, MOUNTAIN_W, STRAIT_W };

/** 存档要存的表(接着推时填回) */
export const POP_TABLES = ['垦', '兵祸', '乡口'] as const;

export interface PopLayer {
  /** 第 t 年要算乡村人口的话:填输入(乡村人口上限、长得多快、上一步以来的兵灾),把上一步以来的折损写回乡口(引擎 start 之后、step 之前) */
  prepare(t: Year): void;
  /** 引擎算完第 t 年:算了乡村人口、又在整 RURAL_SNAP 年上的,存一份快照 */
  done(t: Year): void;
}

/**
 * 挂到政局的数表上。resumed:接着推时存档里政局的数表算到的年份(从头推 = null):
 * 乡村人口最后一步(不晚于它的整 POP_EVERY 年)以前的折损、兵灾算过了(一步只看那一刻以前的),之后的接着看
 */
export function popLayer(sim: CivSim, pm: PolityModel, dev: DevModel, eng: TableEngine, resumed: Year | null): PopLayer {
  const R = dev.R;
  const from = resumed === null ? null : Math.floor(resumed / POP_EVERY) * POP_EVERY;
  /** 各城看到第几次折损、毁城看过没有;史事看到第几条 */
  let seen = new Int32Array(0);
  let ended = new Uint8Array(0);
  let annal = 0;
  const grow = (n: number) => {
    if (seen.length >= n) return;
    const a = new Int32Array(Math.max(n, 2 * seen.length));
    a.set(seen);
    seen = a;
    const b = new Uint8Array(a.length);
    b.set(ended);
    ended = b;
  };
  if (from !== null) {
    const S = pm.settlements;
    grow(S.length);
    for (let i = 0; i < S.length; i++) {
      const sk = S[i].sacks;
      let k = 0;
      if (sk) while (k < sk.length && sk[k].year < from) k++;
      seen[i] = k;
      const e = S[i].ended;
      ended[i] = e !== undefined && e < from ? 1 : 0;
    }
    while (annal < sim.annalCount && sim.annal(annal).year < from) annal++;
  }
  let last = from ?? -Infinity;
  dev.ruralNow = () => ({ year: last, data: eng.get('乡口') });

  const { adjStart, adj } = pm.terrain.regions;
  const prepare = (t: Year): void => {
    if (t % POP_EVERY) return;
    const cap = eng.input('乡容');
    ruralTargets(dev, t, cap, eng.input('乡速'));
    // 逃兵灾分给有人住过的邻州
    const nbs = eng.input('有人邻州');
    for (let r = 0; r < R; r++) {
      let n = 0;
      for (let e = adjStart[r]; e < adjStart[r + 1]; e++) if (cap[adj[e]] > 0) n++;
      nbs[r] = n;
    }
    const hit = eng.input('新祸').fill(0);
    const S = pm.settlements;
    grow(S.length);
    const cut = (r: number, f: number) => eng.write('乡口', r, 0, eng.value('乡口', r) * (1 - f));
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const r = s.region;
      const sk = s.sacks;
      if (sk && seen[i] < sk.length) {
        for (; seen[i] < sk.length && sk[seen[i]].year < t; seen[i]++) {
          const k = sk[seen[i]];
          if (r >= R) continue;
          cut(r, (k.cause === 'plague' ? RURAL_PLAGUE : RURAL_WAR) * k.loss);
          // 瘟疫、地震不算兵灾(不逃)
          if (k.cause !== 'plague' && k.cause !== 'quake') hit[r]++;
        }
      }
      if (!ended[i] && s.ended !== undefined && s.ended < t) {
        ended[i] = 1;
        if (r >= R) continue;
        cut(r, RURAL_WAR);
        hit[r]++;
      }
    }
    for (; annal < sim.annalCount; annal++) {
      const a = sim.annal(annal);
      if (!(a.year < t)) break;
      if ((a.kind === 'battle' || a.kind === 'conquer') && a.region >= 0 && a.region < R) hit[a.region]++;
    }
  };

  const done = (t: Year): void => {
    if (t % POP_EVERY) return;
    last = t;
    if (t % RURAL_SNAP) return;
    const ys = dev.ruralYears;
    // 同一年的、更晚的先去掉(接着推时最后一份可能和这一份同年)
    while (ys.length && ys[ys.length - 1] >= t) {
      ys.pop();
      dev.rural.pop();
    }
    ys.push(t);
    dev.rural.push(Float32Array.from(eng.get('乡口')));
  };
  return { prepare, done };
}
