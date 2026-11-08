/** 环形山、柯本、潮汐一起开(滑条都是默认)长出的地图指纹:直接跑的和打成插件包的示例共用一份。PRINT_FINGERPRINT=1 重算 */
import { createHash } from 'node:crypto';
import type { World } from '../../src/gen/world';

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** 长出来的地图的指纹:海拔、海陆湖、群落、气温、降水、径流、插件出的图层 */
export function mapDigest(w: World): string {
  const h = createHash('sha256');
  for (const a of [w.elevation, w.water, w.biome, w.temperature, w.precipitation, w.flux]) h.update(bytes(a));
  for (const l of w.mapLayers ?? []) h.update(`${l.by}/${l.id}`).update(bytes(l.values));
  return h.digest('hex').slice(0, 16);
}

export const MAP_SEEDS = [7, 2024] as const;
export type MapSeed = (typeof MAP_SEEDS)[number];

export const MAP_PINS: Record<MapSeed, string> = {
  7: '5f38d47fb6f094d5',
  2024: 'fed5495d76d3f6e2',
};
