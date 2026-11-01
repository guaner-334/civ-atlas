import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  BIOME_SIM_NUMBERS,
  BIOME_TAGS,
  Biome,
  type BiomeInfo,
  biomeColumn,
  biomeHas,
  biomeMask,
  biomeTagged,
  classifyBiome,
  compileBiomeRules,
} from '../src/gen/biomes';
import { TERRAIN_GROUPS } from '../src/gen/civ/frontier';
import { NAME_STYLES } from '../src/gen/names';

/** 出现条件写成表之前的判法(一串 if),留作对照:照表判的结果必须和它逐个一样 */
function legacyClassify(t: number, p: number, water: number, ice = 0): Biome {
  if (water === 1) return ice >= 0.5 ? Biome.SeaIce : Biome.Ocean;
  if (water === 2) return t < -6 ? Biome.Ice : Biome.Lake;
  if (t < -9) return Biome.Ice;
  if (t < -2) return p < 150 ? Biome.ColdDesert : Biome.Tundra;
  if (t < 5) return p < 280 ? Biome.ColdDesert : Biome.Taiga;
  if (t < 18) {
    if (p < 250) return Biome.TemperateDesert;
    if (p < 600) return Biome.Steppe;
    if (p < 2300) return Biome.TemperateForest;
    return Biome.TemperateRainforest;
  }
  if (p < 320) return Biome.HotDesert;
  if (p < 950) return Biome.Savanna;
  if (p < 1800) return Biome.TropicalDryForest;
  return Biome.Rainforest;
}

/** 网格 + 每个门槛本身和紧挨着的两边 + 极端值 */
function samples(from: number, to: number, step: number, cuts: number[]): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  for (const c of cuts) out.push(c, c - 1e-9, c + 1e-9, Math.fround(c - 1e-4), Math.fround(c + 1e-4));
  out.push(-1e9, 1e9, -Infinity, Infinity, NaN, -0);
  return out;
}

describe('生物群落表', () => {
  it('编号和位置一一对应,每种都有名字和两种颜色', () => {
    const ids = Object.values(Biome).filter((v): v is Biome => typeof v === 'number');
    expect(BIOMES.length).toBe(ids.length);
    BIOMES.forEach((b, i) => {
      expect(b.id).toBe(i);
      expect(b.name.length).toBeGreaterThan(0);
      for (const c of [...b.real, ...b.paint]) expect(c >= 0 && c <= 255 && Number.isInteger(c)).toBe(true);
    });
  });

  it('卫星色阶都是七档颜色', () => {
    for (const b of BIOMES) if (b.satRamp) expect(b.satRamp.every((c) => /^#[0-9a-f]{6}$/.test(c)) && b.satRamp.length === 7).toBe(true);
  });

  it('照表判和原来的一串 if 逐个一样(温度 −40…40、降水 0…4000、陆地 / 海洋 / 湖泊、海冰 0 / 0.5 / 1)', () => {
    const ts = samples(-40, 40, 0.5, [-9, -6, -2, 5, 18]);
    const ps = samples(0, 4000, 10, [150, 250, 280, 320, 600, 950, 1800, 2300]);
    const waters = [0, 1, 2, 3];
    const ices = [0, 0.5, 1, 0.5 - 1e-9, NaN];
    let n = 0;
    let bad = 0;
    let firstBad = '';
    for (const water of waters)
      for (const ice of ices)
        for (const t of ts)
          for (const p of ps) {
            n++;
            const want = legacyClassify(t, p, water, ice);
            const got = classifyBiome(t, p, water, ice);
            if (got !== want) {
              if (!bad) firstBad = `t=${t} p=${p} water=${water} ice=${ice}:应为 ${BIOMES[want].name},得到 ${BIOMES[got]?.name}`;
              bad++;
            }
          }
    expect(firstBad).toBe('');
    expect(bad).toBe(0);
    expect(n).toBeGreaterThan(1_000_000);
    // 不传 ice 时按 0 算
    expect(classifyBiome(-20, 100, 1)).toBe(Biome.Ocean);
  });

  it('湿地不按温度、降水判(另算,见 wetland.test.ts);图例只不列海洋', () => {
    expect(BIOMES[Biome.Wetland].when).toEqual([]);
    expect(BIOMES.filter((b) => b.legend).map((b) => b.id)).toEqual(BIOMES.map((b) => b.id).filter((id) => id !== Biome.Ocean));
  });

  it('出现条件有重叠、有空缺、范围写反了都在编表时报错', () => {
    const swap = (id: Biome, when: BiomeInfo['when']): BiomeInfo[] => BIOMES.map((b) => (b.id === id ? { ...b, when } : b));
    expect(() => compileBiomeRules(BIOMES)).not.toThrow();
    // 草原往下多占一段,和温带荒漠重叠
    expect(() => compileBiomeRules(swap(Biome.Steppe, [{ on: 'land', t: { from: 5, below: 18 }, p: { from: 200, below: 600 } }]))).toThrow(/温带荒漠、草原/);
    // 湖泊不要了,湖上 −6°C 以上谁都不是
    expect(() => compileBiomeRules(swap(Biome.Lake, []))).toThrow(/没有群落/);
    expect(() => compileBiomeRules(swap(Biome.Lake, [{ on: 'lake', t: { from: 5, below: -6 } }]))).toThrow(/范围是空的/);
    // 编号和位置对不上
    expect(() => compileBiomeRules([BIOMES[1], BIOMES[0], ...BIOMES.slice(2)])).toThrow(/编号/);
  });

  it('推演用的字段每种地貌都填了、类型对', () => {
    const groups = new Set<string>(TERRAIN_GROUPS.map((g) => g.key));
    const styles = new Set(NAME_STYLES.map((s) => s.id));
    for (const b of BIOMES) {
      for (const k of BIOME_SIM_NUMBERS) {
        const v: unknown = b[k];
        expect(typeof v === 'number' && Number.isFinite(v) && v >= 0, `${b.name}的 ${k} 是 ${String(v)}`).toBe(true);
      }
      expect(Array.isArray(b.tags), `${b.name}的 tags`).toBe(true);
      for (const t of b.tags) expect(BIOME_TAGS, `${b.name}的标签`).toContain(t);
      expect(new Set(b.tags).size, `${b.name}的标签有重复`).toBe(b.tags.length);
      if (b.desert !== undefined) expect(['hot', 'temperate', 'cold']).toContain(b.desert);
      if (b.frontier !== undefined) expect(groups.has(b.frontier) && (b.frontier as string) !== 'mountain', `${b.name}的拓荒分组 ${b.frontier}`).toBe(true);
      expect(Array.isArray(b.nameStyles), `${b.name}的 nameStyles`).toBe(true);
      for (const s of b.nameStyles) expect(styles.has(s), `${b.name}的语感 ${s}`).toBe(true);
    }
    // 拓荒的每一组(除了不按群落的高山)都至少有一种群落
    for (const g of TERRAIN_GROUPS) expect(g.biomes.length > 0, g.key).toBe(g.key !== 'mountain');
  });

  it('推演查的表按编号排、类型照给的', () => {
    const hab = biomeColumn('habitability');
    expect(hab).toBeInstanceOf(Float64Array);
    expect([...hab]).toEqual(BIOMES.map((b) => b.habitability));
    const road = biomeColumn('roadCost', Float32Array);
    expect(road).toBeInstanceOf(Float32Array);
    expect(road[Biome.Rainforest]).toBe(Math.fround(BIOMES[Biome.Rainforest].roadCost));
    const cold = biomeTagged('cold');
    expect(cold).toBeInstanceOf(Uint8Array);
    expect([...cold]).toEqual(BIOMES.map((b) => (b.tags.includes('cold') ? 1 : 0)));
    expect([...biomeTagged('forest', 'wetland')]).toEqual(BIOMES.map((b) => (b.tags.includes('forest') || b.tags.includes('wetland') ? 1 : 0)));
    expect([...biomeMask((b) => b.desert !== undefined)].reduce((a, x) => a + x, 0)).toBe(3);
    expect(biomeHas(Biome.Tundra, 'cold')).toBe(true);
    expect(biomeHas(Biome.Steppe, 'cold')).toBe(false);
    expect(biomeHas(-1, 'cold')).toBe(false);
    expect(biomeHas(BIOMES.length, 'cold')).toBe(false);
  });
});
