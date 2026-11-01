import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { rasterize } from '../src/gen/raster';
import { Biome, LAND_ICE_BELOW } from '../src/gen/biomes';
import { WETLAND_CUT, wetlandSuitability } from '../src/gen/wetland';
import { BIOME_HABITABILITY } from '../src/gen/civ/habitat';

const worlds = new Map<number, World>();
const worldOf = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};

/** 不是冰原的陆地块里湿地占几成 */
function share(w: World): number {
  let land = 0;
  let wet = 0;
  for (let i = 0; i < w.mesh.n; i++) {
    if (w.water[i] !== 0 || w.biome[i] === Biome.Ice) continue;
    land++;
    if (w.biome[i] === Biome.Wetland) wet++;
  }
  return wet / land;
}

describe('湿地', () => {
  it('默认精细度下约占陆地 5%(两个种子都在 3%–8% 之间);同种子结果相同', () => {
    for (const seed of [7, 2024]) {
      const s = share(worldOf(seed));
      expect(s, `种子 ${seed}`).toBeGreaterThan(0.03);
      expect(s, `种子 ${seed}`).toBeLessThan(0.08);
    }
    const w = worldOf(7);
    expect(Array.from(wetlandSuitability(w))).toEqual(Array.from(wetlandSuitability(w)));
  });

  it('只长在陆地上、冰原上没有;湿地块就是适宜度过门槛的陆地块', () => {
    const w = worldOf(7);
    const suit = wetlandSuitability(w);
    let bad = '';
    for (let i = 0; i < w.mesh.n && !bad; i++) {
      if (!(suit[i] >= 0 && suit[i] <= 1)) bad = `地块 ${i} 适宜度 ${suit[i]}`;
      else if ((w.water[i] !== 0 || w.temperature[i] < LAND_ICE_BELOW) && suit[i] !== 0) bad = `地块 ${i} 是水面或冰原,适宜度 ${suit[i]}`;
      else if ((w.biome[i] === Biome.Wetland) !== (w.water[i] === 0 && suit[i] >= WETLAND_CUT)) bad = `地块 ${i} 群落 ${w.biome[i]}、适宜度 ${suit[i]}`;
    }
    expect(bad).toBe('');
  });

  it('长在低平的地方:湿地块的海拔、和邻居的高差都比陆地平均低得多', () => {
    const w = worldOf(2024);
    const { adjStart, adj } = w.mesh;
    let nw = 0;
    let nl = 0;
    let ew = 0;
    let el = 0;
    let rw = 0;
    let rl = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      if (w.water[i] !== 0 || w.biome[i] === Biome.Ice) continue;
      let mad = 0;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) mad += Math.abs(w.elevation[i] - Math.max(0, w.elevation[adj[k]]));
      mad /= adjStart[i + 1] - adjStart[i];
      el += w.elevation[i];
      rl += mad;
      nl++;
      if (w.biome[i] === Biome.Wetland) {
        ew += w.elevation[i];
        rw += mad;
        nw++;
      }
    }
    expect(ew / nw).toBeLessThan(0.5 * (el / nl));
    expect(rw / nw).toBeLessThan(0.5 * (rl / nl));
  });

  it('像素一层和地块一层对得上:湿地块里的像素大多是湿地,离湿地远的像素不是', () => {
    const w = worldOf(7);
    const r = rasterize(w, 1, false);
    const suit = wetlandSuitability(w);
    const cut = Math.ceil(WETLAND_CUT * 255);
    let inWet = 0;
    let inWetPx = 0;
    let far = 0;
    let farPx = 0;
    let bad = 0;
    for (let k = 0; k < r.w * r.h; k++) {
      if (r.water[k] !== 0) {
        if (r.wet[k] !== 0 || r.biome[k] === Biome.Wetland) bad++;
        continue;
      }
      const c = r.cell[k];
      if (w.biome[c] === Biome.Wetland) {
        inWet++;
        if (r.biome[k] === Biome.Wetland) inWetPx++;
      } else if (suit[c] < 0.25) {
        far++;
        if (r.biome[k] === Biome.Wetland) farPx++;
      }
      // 像素的群落是湿地 ⇔ 像素的适宜度到门槛
      if ((r.biome[k] === Biome.Wetland) !== r.wet[k] >= cut) bad++;
    }
    expect(bad).toBe(0);
    expect(inWetPx / inWet).toBeGreaterThan(0.6);
    expect(farPx / far).toBeLessThan(0.002);
  });

  it('换精细度湿地的多少差不多(粗、细网格都还有湿地,不翻倍也不消失)', () => {
    for (const cells of [12000, 100000]) {
      const s = share(generateWorld({ ...DEFAULT_PARAMS, seed: 2024, cells }));
      expect(s, `${cells} 地块`).toBeGreaterThan(0.02);
      expect(s, `${cells} 地块`).toBeLessThan(0.1);
    }
  });

  it('推演里湿地难住但不是荒地:宜居比良田低、比针叶林高', () => {
    expect(BIOME_HABITABILITY[Biome.Wetland]).toBeLessThan(BIOME_HABITABILITY[Biome.TropicalDryForest]);
    expect(BIOME_HABITABILITY[Biome.Wetland]).toBeGreaterThan(BIOME_HABITABILITY[Biome.Taiga]);
  });
});
