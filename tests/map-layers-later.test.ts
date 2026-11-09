/**
 * 新建时地图先交(mapFirst):地图插件的图层等地图交出去以后再补,存进世界的图层和一口气长的一样。
 * 生成线程(src/worker.ts)在 Node 里跑,self 换成假的
 */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CivPartInbox } from '../src/civParts';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/world';
import { openPluginFile } from '../src/plugin/pluginFile';
import type { MapPluginFile } from '../src/plugin/pluginWorld';
import type { WorkerRequest, WorkerResponse } from '../src/worker';
import { mapTestFile } from './lib/mapPluginFiles';

vi.mock('../src/gen/quickjs/wasm', async () => {
  const node = await import('../scripts/lib/quickjsNode');
  return { quickjsWasm: async () => node.quickjsWasm() };
});

const g = globalThis as unknown as { self?: unknown };

async function device() {
  const got: WorkerResponse[] = [];
  const inbox = new CivPartInbox();
  const self = {
    navigator: { hardwareConcurrency: 1 },
    onmessage: null as ((e: { data: WorkerRequest }) => void) | null,
    postMessage(m: WorkerResponse) {
      if (m.type === 'civPart') return inbox.take(m);
      if ('split' in m && m.split && 'civ' in m && m.civ) inbox.join(m.civ, m.split);
      got.push(m);
    },
  };
  g.self = self;
  vi.resetModules();
  await import('../src/worker');
  const on = self.onmessage!;
  return {
    got,
    send: (req: WorkerRequest) => on({ data: req }),
    async until(id: number, type: WorkerResponse['type']) {
      for (let t = 0; t < 6000; t++) {
        if (got.some((m) => m.id === id && m.type === type)) return;
        const bad = got.find((m) => m.id === id && m.type === 'mapFailed');
        if (bad) throw new Error(`mapFailed:${JSON.stringify(bad)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`等不到 ${type}`);
    },
  };
}

const PARAMS: WorldParams = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
let files: MapPluginFile[];

beforeAll(async () => {
  const b = await mapTestFile('koppen');
  const o = await openPluginFile(b);
  files = [{ id: o.manifest.id, sum: o.sum, bytes: b }];
}, 60_000);

/** 存进世界的那几块里插件的图层(块名 → 字节) */
const layerParts = (offer: { parts: { name: string; data: ArrayBuffer | Uint8Array }[] }) =>
  Object.fromEntries(offer.parts.filter((p) => p.name.startsWith('layer.')).map((p) => [p.name, [...new Uint8Array(p.data as ArrayBuffer)]]));

describe('新建时地图先交,地图插件的图层随后补', () => {
  it('先交的地图里没有图层;交了地图以后才出图层(进度写是哪个插件);存进世界的图层和一口气长的一样', async () => {
    const d = await device();
    d.send({ type: 'generate', id: 1, scale: 0.25, params: PARAMS, endYear: 200, mapPlugins: files, mapFirst: true, keep: true });
    await d.until(1, 'worldParts');
    const kinds = d.got.filter((m) => m.id === 1).map((m) => (m.type === 'progress' ? `progress:${m.stage}` : m.type));
    const map = kinds.indexOf('map');
    expect(map).toBeGreaterThan(0);
    expect(kinds.slice(0, map)).not.toContain('progress:地图插件「柯本气候」：出图层');
    expect(kinds.slice(map)).toContain('progress:地图插件「柯本气候」：出图层');
    const early = d.got.find((m) => m.id === 1 && m.type === 'map') as Extract<WorkerResponse, { type: 'map' }>;
    expect(early.world.mapLayers).toBeUndefined();
    const later = d.got.find((m) => m.id === 1 && m.type === 'worldParts') as Extract<WorkerResponse, { type: 'worldParts' }>;
    expect(later.offer.mapPlugins?.map((p) => p.id)).toEqual(['koppen']);

    const e = await device();
    e.send({ type: 'generate', id: 1, scale: 0.25, params: PARAMS, endYear: 200, mapPlugins: files });
    await e.until(1, 'worldParts');
    const whole = e.got.find((m) => m.id === 1 && m.type === 'worldParts') as Extract<WorkerResponse, { type: 'worldParts' }>;
    const a = layerParts(later.offer);
    expect(Object.keys(a)).toEqual(['layer.koppen.koppen']);
    expect(a).toEqual(layerParts(whole.offer));
  }, 180_000);
});
