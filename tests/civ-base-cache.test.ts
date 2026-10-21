/**
 * 预先算好的宜居度和州(gen/civ/index.ts 的 civBase、CivParams.base):重推时直接用,不再每次重算。
 * - seed 7 / 2024:带着预先算好的推,和从头推逐字段相等(加一条干预、改拓荒和地名风格、编辑地形以后各一次)
 * - 对不上的不用:换了文明种子、每州面积、换了世界(编辑地形以后是另一个世界),照常现算,结果和从头推一样
 * - 传进去的底子不改,推出来的 Civ 里也不是同一份数组(交给主线程 transfer 走以后,留着的这份照样能用)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { civBase, civTransferables, generateCiv, planetTempo, type Civ, type CivBase } from '../src/gen/civ';
import { polityKey, type Intervention, type TerrainOp } from '../src/gen/edits';

const SEEDS = [7, 2024];
const worlds = new Map<string, World>();
function worldOf(seed: number, terrain?: TerrainOp[]): World {
  const key = JSON.stringify([seed, terrain ?? null]);
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld({ ...DEFAULT_PARAMS, seed }, undefined, terrain)));
  return w;
}

/** 两份历史逐字段一样(键也一样) */
function sameCiv(a: Civ, b: Civ, label: string) {
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
}

/** 底子里的全部数组(和数组的内容),比"传进去的不改"用 */
function arraysOf(b: CivBase) {
  return { habitat: structuredClone(b.habitat), regions: structuredClone(b.regions) };
}

/** 一条落在历史中段的干预:保住第一个立起来的国家 */
function oneIntervention(civ: Civ): Intervention[] {
  const p = civ.polities.find((q) => q.ended !== undefined) ?? civ.polities[0];
  return [{ kind: 'protect', a: polityKey(civ, p.id), from: Math.max(1, Math.floor(p.founded) + 50) }];
}

describe('预先算好的宜居度和州', () => {
  it('seed 7 / 2024:加干预、改拓荒和地名风格重推,带着底子推和从头推逐字段相等;底子不改', () => {
    for (const seed of SEEDS) {
      const w = worldOf(seed);
      const base = civBase(w);
      const before = arraysOf(base);
      const plain = generateCiv(w);
      sameCiv(generateCiv(w, { base }), plain, `seed ${seed} 不改参数`);
      const iv = oneIntervention(plain);
      sameCiv(generateCiv(w, { interventions: iv, base }), generateCiv(w, { interventions: iv }), `seed ${seed} 加干预`);
      const setup = { frontier: { spread: 1.25, expand: 0.8 }, names: { xianxia: 6, central: 4 } };
      sameCiv(generateCiv(w, { ...setup, base }), generateCiv(w, setup), `seed ${seed} 改拓荒、地名风格`);
      expect(arraysOf(base), `seed ${seed} 传进去的底子`).toEqual(before);
    }
  }, 300_000);

  it('编辑地形以后:旧世界的底子不用(是另一个世界),新世界的底子推出来和从头推一样', () => {
    const terrain: TerrainOp[] = [{ kind: 'volcano', pts: [1024, 512], r: 20, s: 1 }];
    for (const seed of SEEDS) {
      const old = civBase(worldOf(seed));
      const w = worldOf(seed, terrain);
      // 改过地形的世界扩张节拍按没改过的星球定:先算好,三次都用同一份(只为省时间,和不给结果一样)
      const tempo = planetTempo(w.params) ?? null;
      const plain = generateCiv(w, { tempo });
      sameCiv(generateCiv(w, { tempo, base: old }), plain, `seed ${seed} 旧世界的底子`);
      sameCiv(generateCiv(w, { tempo, base: civBase(w) }), plain, `seed ${seed} 新世界的底子`);
    }
  }, 300_000);

  it('影响划州的参数对不上就不用:换了文明种子、每州面积照常现算', () => {
    const w = worldOf(7);
    const base = civBase(w);
    const civSeed = 52817;
    sameCiv(generateCiv(w, { civSeed, base }), generateCiv(w, { civSeed }), '换了文明种子');
    // 另一个文明种子的底子,用回地图种子推时也不用
    sameCiv(generateCiv(w, { base: civBase(w, { civSeed }) }), generateCiv(w), '底子是另一个文明种子的');
    const regionArea = 1200;
    const wide = generateCiv(w, { regionArea, base });
    expect(wide.regions.count).not.toBe(base.regions.count);
    sameCiv(wide, generateCiv(w, { regionArea }), '换了每州面积');
    // 底子按同样的文明种子、每州面积算的,照样用得上(结果一样)
    sameCiv(generateCiv(w, { civSeed, base: civBase(w, { civSeed }) }), generateCiv(w, { civSeed }), '文明种子的底子');
  }, 300_000);

  it('推出来的 Civ 和底子不共用数组:交出去(transfer)以后底子照样能接着用', () => {
    const w = worldOf(7);
    const base = civBase(w);
    const civ = generateCiv(w, { base });
    const mine = new Set(civTransferables({ habitat: base.habitat, regions: base.regions } as unknown as Civ));
    for (const buf of civTransferables(civ)) expect(mine.has(buf)).toBe(false);
    // 推出来的州带着州名,底子里的州没有
    expect(civ.regions.name?.length).toBe(civ.regions.count);
    expect(base.regions.name).toBeUndefined();
    // 像 worker 那样把结果的数组 transfer 走:底子不受影响,再推一次还一样
    const { port1 } = new MessageChannel();
    port1.postMessage(civ, civTransferables(civ));
    port1.close();
    expect(civ.habitat.suitability.length).toBe(0);
    expect(base.habitat.suitability.length).toBe(w.mesh.n);
    sameCiv(generateCiv(w, { base }), generateCiv(w), '交出去以后再推');
  }, 300_000);
});
