/**
 * 再推 N 年(gen/civ/extend.ts;gen/civ/index.ts 的 startContinue / continueCiv):在推完的世界上接着往后推,前面的历史一点不变。
 * - 推到 3000 年再推 500 年,和一次推到 3500 年逐字段相等;分两次再推(+300、+200)也一样(seed 7 / 2024)
 * - 分成很多段推(每段之间停下来)和一口气推一样;进度只往前走;叫停了 = 没推,传进去的历史不改
 * - 推好的历史打包读回(原件)以后接着推一样;推演年数不是整千年的存档、分享链接、配方指纹都原样;整千年的和以前一样
 * - 带着地名风格、拓荒、起源、干预(有一条在再推的那段里才生效)、文明种子、改过地形的世界也一样
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World, type WorldParams } from '../src/gen/world';
import { continueCiv, generateCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { extendCiv } from '../src/gen/civ/extend';
import { polityAlive } from '../src/gen/civ/growth';
import { packValue, recipeOfSave, recipeText, unpackValue } from '../src/gen/snapshot';
import { polityKey, type Intervention, type TerrainOp, type WorldEdits } from '../src/gen/edits';
import { decodeShare, encodeShare, makeSave, parseSave, saveText } from '../src/gen/savefile';

const worlds = new Map<string, World>();
const worldOf = (params: WorldParams, terrain?: TerrainOp[]) => {
  const key = JSON.stringify([params, terrain ?? null]);
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld(params, undefined, terrain)));
  return w;
};
const SEEDS = [7, 2024];

/** 两份历史逐字段一样(键也一样) */
function sameCiv(a: Civ, b: Civ, label: string) {
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
}

describe('再推 N 年', () => {
  it('seed 7 / 2024:推到 3000 再推 500,和一次推到 3500 逐字段相等;+300 +200 也一样;传进去的历史不改', async () => {
    for (const seed of SEEDS) {
      const w = worldOf({ ...DEFAULT_PARAMS, seed });
      const whole = generateCiv(w, { endYear: 3500 });
      const base = generateCiv(w);
      const before = structuredClone(base);
      const once = await extendCiv(w, base, { endYear: 3500 });
      sameCiv(once!, whole, `seed ${seed} +500`);
      const mid = await extendCiv(w, base, { endYear: 3300 });
      expect(mid!.endYear).toBe(3300);
      const twice = await extendCiv(w, mid, { endYear: 3500 });
      sameCiv(twice!, whole, `seed ${seed} +300 +200`);
      expect(base, `seed ${seed} 传进去的历史`).toEqual(before);
    }
  }, 300_000);

  it('分成很多段推、每段之间停下来:和一口气推一样,进度只往前走、最后是 1;叫停 = null', async () => {
    const w = worldOf({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
    const base = generateCiv(w);
    const whole = continueCiv(w, base, { endYear: 3250 });
    // 假的表:每看一次过去一整段,于是每段只推一步(10 年)
    let t = 0;
    const now = () => (t += 1000);
    const seen: [number, number][] = [];
    let pauses = 0;
    const civ = await extendCiv(w, base, { endYear: 3250 }, { now, progress: (y, p) => seen.push([y, p]), pause: async () => void pauses++ });
    sameCiv(civ!, whole, '分段');
    expect(pauses).toBe(25);
    expect(seen[0]).toEqual([3000, 0]);
    expect(seen[seen.length - 1]).toEqual([3250, 1]);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
      expect(seen[i][1]).toBeGreaterThan(seen[i - 1][1]);
    }
    // 停在第三段以后
    let n = 0;
    const stopped = await extendCiv(w, base, { endYear: 3250 }, { now, pause: async () => void n++, stop: () => n >= 3 });
    expect(stopped).toBeNull();
    expect(await extendCiv(w, base, { endYear: 3250 }, { stop: () => true })).toBeNull();
    // startContinue 自己分段推:段落停在哪儿都一样
    const run = startContinue(w, base, { endYear: 3250 })!;
    for (const y of [3001, 3017.5, 3100, 3100, 3199, 3260]) run.advance(y);
    expect(run.year).toBe(3250);
    sameCiv(run.finish(), whole, 'startContinue');
    expect(() => run.finish()).toThrow();
  }, 300_000);

  it('推好的历史打包读回(原件)以后接着推一样;没有推好的历史、接不上的,照常从第 0 年推', async () => {
    const w = worldOf({ ...DEFAULT_PARAMS, seed: 2024, cells: 12000 });
    const whole = generateCiv(w, { endYear: 3500 });
    const saved = unpackValue(packValue(generateCiv(w))) as Civ;
    sameCiv((await extendCiv(w, saved, { endYear: 3500 }))!, whole, '原件');
    sameCiv((await extendCiv(w, null, { endYear: 3500 }))!, whole, '没有推好的');
    // 推得比要的还远:接不上,从第 0 年推到要的那年
    expect(startContinue(w, whole, { endYear: 3300 })).toBeNull();
    sameCiv((await extendCiv(w, whole, { endYear: 3300 }))!, generateCiv(w, { endYear: 3300 }), '推过头的');
  }, 300_000);

  it('带着地名风格、拓荒、起源、干预、文明种子、改过地形:推到 3000 再推到 3400 和一次推到 3400 一样', async () => {
    const P = { ...DEFAULT_PARAMS, seed: 7, cells: 12000 };
    const plain = generateCiv(worldOf(P));
    const alive = plain.polities.filter((p) => p.founded < 1000 && polityAlive(p, 3000));
    const iv: Intervention[] = [
      { kind: 'protect', a: polityKey(plain, alive[0].id), from: 1500 },
      { kind: 'protect', a: polityKey(plain, alive[alive.length - 1].id), from: 3200 },
    ];
    const cases: { label: string; terrain?: TerrainOp[]; params: Partial<CivParams> }[] = [
      { label: '地名风格 + 拓荒 + 起源 + 干预', params: { names: { xianxia: 6, central: 4 }, frontier: { spread: 2, expand: 2 }, origins: { pts: [976, 342, 544, 448] }, interventions: iv } },
      { label: '文明种子 + 改过地形', terrain: [{ kind: 'volcano', pts: [1024, 512], r: 20, s: 1 }], params: { civSeed: 52817 } },
    ];
    for (const c of cases) {
      const w = worldOf(P, c.terrain);
      const whole = generateCiv(w, { ...c.params, endYear: 3400 });
      const base = generateCiv(w, c.params);
      sameCiv((await extendCiv(w, base, { ...c.params, endYear: 3400 }))!, whole, c.label);
    }
  }, 300_000);
});

describe('推演年数不是整千年', () => {
  const edits = (endYear?: number): WorldEdits => ({ names: {}, interventions: [], terrain: [], ...(endYear === undefined ? {} : { endYear }) });

  it('存档、分享链接原样往返;配方里记着推到哪年', async () => {
    for (const y of [3250, 3500, 12345]) {
      const save = makeSave(DEFAULT_PARAMS, edits(y), 'abc');
      const back = parseSave(saveText(save));
      expect(back.ok && back.save.edits.endYear, `${y}`).toBe(y);
      const shared = await decodeShare(await encodeShare(save));
      expect(shared.ok && shared.save.edits.endYear, `${y} 链接`).toBe(y);
      expect(recipeOfSave(save).endYear).toBe(y);
      expect(recipeText(recipeOfSave(save))).toContain(`"endYear":${y}`);
    }
    expect(recipeText(recipeOfSave(makeSave(DEFAULT_PARAMS, edits(3250), 'abc')))).not.toBe(recipeText(recipeOfSave(makeSave(DEFAULT_PARAMS, edits(3500), 'abc'))));
  });

  it('整千年的旧存档:读出同一个年数,配方指纹的写法和以前一样;3000 年不写', () => {
    const params = { seed: 1 } as WorldParams;
    expect(recipeText({ params, endYear: 12000 })).toBe('{"endYear":12000,"params":{"seed":1}}');
    expect(recipeText({ params, endYear: 3000 })).toBe('{"params":{"seed":1}}');
    for (let y = 3000; y <= 60000; y += 1000) {
      const save = JSON.parse(saveText(makeSave(DEFAULT_PARAMS, edits(), 'abc')));
      save.edits.endYear = y;
      const back = parseSave(JSON.stringify(save));
      expect(back.ok && back.save.edits.endYear, `${y}`).toBe(y === 3000 ? undefined : y);
      expect(back.ok && back.warnings, `${y}`).toEqual([]);
    }
  });
});
