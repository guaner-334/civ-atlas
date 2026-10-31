import { describe, expect, it } from 'vitest';
import { BIOMES, Biome, type BiomeInfo, classifyBiome, compileBiomeRules } from '../src/gen/biomes';

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

  it('湿地没有出现条件,判不出来;图例不列海洋和湿地', () => {
    expect(BIOMES[Biome.Wetland].when).toEqual([]);
    expect(BIOMES.filter((b) => b.legend).map((b) => b.id)).toEqual(
      BIOMES.map((b) => b.id).filter((id) => id !== Biome.Ocean && id !== Biome.Wetland),
    );
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
});
