/// <reference lib="webworker" />
/** 开发者模式「试生成」的后台线程:一次试生成开一个,停 = 关掉线程 */
import { rasterize } from '../gen/raster';
import type { World } from '../gen/world';
import { quickjsMapBox } from '../mapPluginRun';
import { renderFantasy } from '../render/fantasy';
import { renderLayer, type LayerId } from '../render/layers';
import { renderRealistic } from '../render/realistic';
import type { SurfaceLook } from '../render/surface';
import { devGen, type DevGenInput, type DevGenResult } from './devGen';

/** 大地图上看的那张照地图现在的画风画 */
export interface DevGenLook {
  style: 'realistic' | 'fantasy' | 'data';
  look?: SurfaceLook;
  layer?: LayerId;
}

export interface DevGenJob {
  input: DevGenInput;
  look: DevGenLook;
}

export type DevGenReply =
  | { type: 'progress'; pct: number }
  | { type: 'done'; result: DevGenResult; thumbs: { official: ArrayBuffer | null; plugin: ArrayBuffer | null }; big: ImageBitmap | null }
  | { type: 'failed'; error: string };

/** 小图:实景,512 × 256 */
const THUMB_SCALE = 0.25;

type Ctx = CanvasRenderingContext2D;

function paint(world: World, scale: number, look: DevGenLook): OffscreenCanvas | null {
  const raster = rasterize(world, scale, false);
  const c = new OffscreenCanvas(raster.w, raster.h);
  const ctx = c.getContext('2d') as unknown as Ctx | null;
  if (!ctx) return null;
  if (look.style === 'realistic') renderRealistic(ctx, world, raster, look.look);
  else if (look.style === 'fantasy') renderFantasy(ctx, world, raster);
  else renderLayer(ctx, world, raster, look.layer ?? 'biomes');
  return c;
}

async function thumb(world: World | null): Promise<ArrayBuffer | null> {
  if (!world) return null;
  try {
    const c = paint(world, THUMB_SCALE, { style: 'realistic' });
    if (!c) return null;
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    c.width = c.height = 0;
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

const post = (r: DevGenReply, transfer: Transferable[] = []) => self.postMessage(r, transfer);

self.onmessage = async (e: MessageEvent<DevGenJob>) => {
  try {
    const run = await devGen(e.data.input, quickjsMapBox, { progress: (pct) => post({ type: 'progress', pct }) });
    // 没有 OffscreenCanvas 的浏览器不画图,数照交
    const can = typeof OffscreenCanvas !== 'undefined';
    const thumbs = can ? { official: await thumb(run.official), plugin: await thumb(run.plugin) } : { official: null, plugin: null };
    let big: ImageBitmap | null = null;
    if (can && run.plugin) {
      try {
        big = paint(run.plugin, 1, e.data.look)?.transferToImageBitmap() ?? null;
      } catch {
        big = null;
      }
    }
    const transfer: Transferable[] = [...(thumbs.official ? [thumbs.official] : []), ...(thumbs.plugin ? [thumbs.plugin] : []), ...(big ? [big] : [])];
    post({ type: 'done', result: run.result, thumbs, big }, transfer);
  } catch (err) {
    post({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
};
