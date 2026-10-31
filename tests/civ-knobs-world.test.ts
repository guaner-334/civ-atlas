/**
 * 每个世界带一套自己的数(CivParams.knobs:只写和官方不一样的项,表 id → 项名 → 值;engine/knobs.ts、civ/knobs.ts):
 * - 改一项,历史跟着变;同一套改动 + 同一种子 = 同一段历史
 * - 同一个线程里先按改过的数推一个世界、再推官方的(或两个世界交替着推),官方的一位不变、改过的也不串
 * - 接着推、逐年推演用的是世界自己带的那套数(和按这套数一口气推完一样)
 * - 改动里认不出的表、项,值不合用的,当没有(不报错);推出来的 Civ 带着清理过的改动,官方的世界不带这一项
 * - 推演之外现算的(讲故事、界面里现算的)从世界带的那套数取
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { cleanKnobs, knobSet, knobsOf } from '../src/gen/civ/knobs';
import { OFFICIAL_KNOBS, type KnobPatch } from '../src/gen/civ/engine/knobs';
import { WARS_KNOBS } from '../src/gen/civ/wars';
import { RULERS_KNOBS } from '../src/gen/civ/rulers';
import { COUNCIL_KNOBS } from '../src/gen/civ/council';
import { playCiv, playTurn } from '../src/gen/civ/play';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { courtEmpty } from '../src/ui/courtInfo';
import { playState } from '../src/gen/edits';
import { upheavalSteps } from '../src/gen/civ/upheaval';

const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);
/** 一个值的指纹(同 determinism.test.ts):类型化数组逐字节,数按 64 位原样,对象按键名排序 */
function print(v: unknown): string {
  const h = createHash('sha1');
  const feed = (x: unknown): void => {
    if (x === null || x === undefined) return void h.update(`~${x}`);
    if (ArrayBuffer.isView(x)) {
      h.update(`<${x.constructor.name}:${x.byteLength}>`);
      return void h.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    }
    if (Array.isArray(x)) {
      h.update(`[${x.length}`);
      x.forEach(feed);
      return void h.update(']');
    }
    if (typeof x === 'object') {
      for (const k of Object.keys(x as object).sort()) {
        h.update(`.${k}`);
        feed((x as Record<string, unknown>)[k]);
      }
      return;
    }
    if (typeof x === 'number') {
      f64[0] = x;
      h.update('n');
      return void h.update(f64b);
    }
    h.update(`${typeof x}:${String(x)}`);
  };
  feed(v);
  return h.digest('hex').slice(0, 16);
}

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
};

/** 战争的赔率加倍 */
const WAR2: KnobPatch = { wars: { WAR_ODDS: WARS_KNOBS.values.WAR_ODDS * 2 } };
const wars = (c: Civ) => c.annals.filter((e) => e.kind === 'war').length;

describe('每个世界带一套自己的数', () => {
  it('改一项(战争的赔率加倍)历史就变,仗打得更多;推出来的 Civ 带着这套改动', () => {
    const w = world(7);
    const a = generateCiv(w);
    const b = generateCiv(w, { knobs: WAR2 });
    expect(print(b)).not.toBe(print(a));
    expect(wars(b)).toBeGreaterThan(wars(a));
    expect(b.knobs).toEqual(WAR2);
    expect('knobs' in a).toBe(false);
  });

  it('同一套改动跑两次一模一样', () => {
    const w = world(2024);
    const patch: KnobPatch = { wars: { WAR_ODDS: 0.6, TRUCE: 12 }, politics: { SPLIT_ODDS: 0.08 }, rulers: { REIGN_MAX: 20 } };
    // 内容一样、对象不同的两份改动
    expect(print(generateCiv(w, { knobs: patch }))).toBe(print(generateCiv(w, { knobs: JSON.parse(JSON.stringify(patch)) })));
  });

  it('同一个线程里先按改过的数推、再推官方的:官方的指纹不变', () => {
    const w = world(7);
    const before = print(generateCiv(w));
    generateCiv(w, { knobs: { wars: { WAR_ODDS: 0.9 }, rulers: { MAX_AGE: 50 }, regions: { SIZE_MIN: 2 } } });
    expect(print(generateCiv(w))).toBe(before);
  });

  it('两个世界交替着推(一个官方、一个改过的,各分几段接着推):各自和单独推的一样', () => {
    const w = world(7);
    const fullA = print(generateCiv(w, { endYear: 1500 }));
    const fullB = print(generateCiv(w, { endYear: 1500, knobs: WAR2 }));
    expect(fullB).not.toBe(fullA);
    const a0 = generateCiv(w, { endYear: 300 });
    const b0 = generateCiv(w, { endYear: 300, knobs: WAR2 });
    const ra = startContinue(w, a0, { endYear: 1500 })!;
    const rb = startContinue(w, b0, { endYear: 1500, knobs: WAR2 })!;
    expect(ra).not.toBeNull();
    expect(rb).not.toBeNull();
    for (let y = 400; y <= 1500; y += 100) {
      ra.advance(y);
      rb.advance(y);
    }
    expect(print(rb.finish())).toBe(fullB);
    expect(print(ra.finish())).toBe(fullA);
  });

  it('接着推用的是世界自己那套数:和按这套数一口气推完一样(不给 knobs = 照世界带着的)', () => {
    const w = world(42);
    const patch: KnobPatch = { wars: { WAR_ODDS: 0.6 }, dynasty: { ODDS: 0.3 } };
    const full = print(generateCiv(w, { endYear: 2000, knobs: patch }));
    const half = generateCiv(w, { endYear: 1000, knobs: patch });
    expect(print(continueCiv(w, half, { endYear: 2000, knobs: patch }))).toBe(full);
    expect(print(continueCiv(w, half, { endYear: 2000 }))).toBe(full);
    // 明着给另一套(这里是官方):接不上,照官方从第 0 年重推
    expect(startContinue(w, half, { endYear: 2000, knobs: {} })).toBeNull();
    expect(print(continueCiv(w, half, { endYear: 2000, knobs: {} }))).toBe(print(generateCiv(w, { endYear: 2000 })));
  });

  it('逐年推演用的是世界自己那套数:一步步推和带着这套数一口气推到同一刻一样', () => {
    const w = world(7);
    const patch: KnobPatch = { wars: { WAR_ODDS: 0.6 } };
    const params = { knobs: patch };
    let play = playState(800, 0, []);
    let civ = playCiv(w, params, play);
    for (let i = 0; i < 3; i++) {
      const s = playTurn(w, civ, params, play, [], 50);
      civ = s.civ;
      play = s.play;
    }
    expect(play.year).toBe(950);
    expect(print(civ)).toBe(print(playCiv(w, params, play)));
    expect(print(civ)).not.toBe(print(playCiv(w, {}, play)));
  });

  it('有地形大事的世界:大事以后接着推的那一段也按这套数(推出来的 Civ 带着它);同一套改动跑两次一样', () => {
    const w = world(7);
    const ups = upheavalSteps(w.params, [], null, [{ year: 1200, ops: [{ kind: 'sink', pts: [1850, 520, 1930, 530, 1903, 469], r: 40, s: 1.1 }] }]);
    const a = generateCiv(w, { upheavals: ups, knobs: WAR2, endYear: 1800 });
    expect(a.upheavals?.length).toBe(1);
    expect(a.knobs).toEqual(WAR2);
    expect(print(generateCiv(w, { upheavals: ups, knobs: WAR2, endYear: 1800 }))).toBe(print(a));
    expect(print(a)).not.toBe(print(generateCiv(w, { upheavals: ups, endYear: 1800 })));
  });

  it('改动里有认不出的表或项、值不合用的:不报错,当没有', () => {
    const w = world(7);
    const odd = {
      nope: { X: 1 },
      wars: { NOPE: 2, WAR_ODDS: 'x', GAP: [1], TRUCE: NaN, HOLD: WARS_KNOBS.values.HOLD },
      rulers: null,
    } as unknown as KnobPatch;
    expect(cleanKnobs(odd)).toBeUndefined();
    expect(knobSet(odd)).toBe(OFFICIAL_KNOBS);
    const c = generateCiv(w, { knobs: odd });
    expect(print(c)).toBe(print(generateCiv(w)));
    expect('knobs' in c).toBe(false);
    // 认得的留下、认不出的去掉
    expect(cleanKnobs({ nope: { X: 1 }, wars: { NOPE: 2, WAR_ODDS: 0.6, GAP: [1, 3] } })).toEqual({ wars: { WAR_ODDS: 0.6, GAP: [1, 3] } });
  });

  it('推演之外现算的从世界带的那套数取:人物的岁数、议事的门槛、编年史', () => {
    const w = world(2024);
    const patch: KnobPatch = { rulers: { MAX_AGE: 45, FOUNDER_AGE: [28, 40], CONSUL_AGE: [30, 40] }, council: { MIN_SIZE: 3, MIN_AGE: 7 } };
    const official = generateCiv(w);
    const c = generateCiv(w, { knobs: patch });
    expect(knobsOf(c).get(RULERS_KNOBS).MAX_AGE).toBe(45);
    expect(knobsOf(official).get(RULERS_KNOBS)).toBe(RULERS_KNOBS.values);
    // 寻常继位的君主:不被打断时在位到 45 岁为止(即位时已过 44 岁的至少在位一年);推演里排在位表、人物里排生卒都照这一套数
    const old = (x: Civ) =>
      (x.people ?? []).filter((p) => p.role === 'ruler' && p.rise === 'heir' && p.until !== undefined && p.until - p.born > Math.max(45, p.from! - p.born + 1) + 1e-6).length;
    expect(old(official)).toBeGreaterThan(0);
    expect(old(c)).toBe(0);
    // 编年史照常写得出
    expect(buildChronicle(c).length).toBeGreaterThan(0);
    // 界面上议事的门槛("国家到 N 个州、立国满 M 年")按世界的数写
    expect(courtEmpty(c)).toContain('3 个州、立国满 7 年');
    expect(courtEmpty(official)).toContain(`${COUNCIL_KNOBS.values.MIN_SIZE} 个州`);
  });
});
