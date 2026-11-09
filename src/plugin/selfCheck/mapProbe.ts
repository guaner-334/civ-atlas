/** 自检页「地图插件」一组真去量的那一半:示例插件「柯本气候」长一张图,量它多花多久、长出来的打成散列和电脑上的比 */
import { MapClock, timedMapPlugins, type MapStage } from '../../gen/mapHooks';
import { packValue } from '../../gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../../gen/world';
import { loadMapFile, type MapBoxer } from '../../mapPluginRun';
import { mapPluginKey, type MapPluginFile } from '../pluginWorld';
import { MAP_PROBE_SEED, MAP_PROBE_SUM, type MapProbeRaw } from './verdict';

class Spent extends MapClock {
  ms = 0;
  spend(id: string, stage: MapStage, ms: number): void {
    this.ms += ms;
    super.spend(id, stage, ms);
  }
}

/** 地图的散列:海拔、海陆湖、气温、降水、群落、插件的图层(SHA-256 的前 16 位) */
export async function mapSum(w: World): Promise<string> {
  const x = packValue({ elevation: w.elevation, water: w.water, temperature: w.temperature, precipitation: w.precipitation, biome: w.biome, layers: (w.mapLayers ?? []).map((l) => [l.by, l.id, l.values]) });
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', x));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mapProbe(file: MapPluginFile & { bytes: Uint8Array }, box: MapBoxer, now: () => number = () => performance.now()): Promise<MapProbeRaw> {
  const loaded = await loadMapFile(file, mapPluginKey(file), box);
  try {
    const params = { ...DEFAULT_PARAMS, seed: MAP_PROBE_SEED };
    const clock = new Spent(now);
    const t0 = now();
    const world = generateWorld(params, undefined, undefined, undefined, undefined, timedMapPlugins([loaded.plugin], clock));
    const genMs = now() - t0;
    const sum = await mapSum(world);
    return { ms: Math.round(clock.ms * 10) / 10, genMs: Math.round(genMs), cells: params.cells, sum, same: sum === MAP_PROBE_SUM };
  } finally {
    loaded.plugin.dispose();
  }
}
