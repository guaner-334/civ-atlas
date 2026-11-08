/**
 * 地图插件清单的 map 段:在生成的哪几步出手(stages)、交几张图层(layers)、新建世界时拨的滑条(params)。
 * 写错了抛 Error(读插件文件时算坏了)。纯计算,不带生成器,读插件文件时只有地图插件才 import() 它。
 */
import { checkLayerLook } from '../gen/layerLook';
import { PARAMS_MAX, checkParams, fail, has, isObj, list, names, obj, str, type ManifestNeed, type ManifestParam, type Obj } from './manifestParts';

export type MapParam = ManifestParam;

/** 一张图层的登记:编号 + 画法(标题、渐变或分类、图例、透明度,和工具插件的图层同一套) */
export interface MapLayerSpec {
  id: string;
  title: string;
  ramp?: { colors: string[]; min?: number; max?: number };
  classes?: { value: number; color: string; label: string }[];
  legend?: string;
  opacity?: number;
}

export interface MapManifest {
  /** 在生成的哪几步出手 */
  stages: string[];
  /** 交几张图层(要有 layers 这一步) */
  layers?: MapLayerSpec[];
  params?: Record<string, MapParam>;
}

/** 这一版网站有的几步,和各自要的能力(不看版本) */
export const MAP_STAGE_CAPS: Readonly<Record<string, string>> = {
  height: 'gen.height',
  climate: 'gen.climate',
  layers: 'gen.layers',
};

/** 一个插件最多交几张图层、滑条 */
export const MAP_LAYERS_MAX = 4;
export const MAP_PARAMS_MAX = PARAMS_MAX;

const LAYER_ID = /^[a-z][a-z0-9_]{0,31}$/;
const STAGES_MAX = 8;

const capName = (cap: string) => cap.split('@')[0];

function checkLayers(raw: unknown): void {
  const ids = new Set<string>();
  list(raw, '清单的 map.layers', MAP_LAYERS_MAX).forEach((x, i) => {
    const at = `清单的 map.layers[${i}]`;
    const spec = obj(x, at);
    const id = str(spec.id, `${at}.id`, 32);
    if (!LAYER_ID.test(id)) fail(`${at}.id 只能用小写字母、数字和下划线,以字母开头`);
    if (ids.has(id)) fail(`${at}:图层 ${id} 写了两次`);
    ids.add(id);
    try {
      checkLayerLook(spec);
    } catch (e) {
      fail(`${at}:${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

/**
 * 查地图插件的清单(role 是 map 的):map 段每一项、和 requires 对不对得上。写错了抛 Error;
 * 返回这一版网站不认得的头一样(生成的步骤),都认得 = null
 */
export function checkMapManifest(m: { map?: unknown; requires: readonly string[] }): ManifestNeed | null {
  const s = obj(m.map, '清单的 map');
  let need: ManifestNeed | null = null;

  const stages = names(s.stages, '清单的 map.stages', STAGES_MAX);
  if (!stages.length) fail('清单的 map.stages 不能空着');
  const known = stages.filter((k) => has(MAP_STAGE_CAPS, k));
  for (const k of stages) if (!has(MAP_STAGE_CAPS, k)) need ??= { what: '生成的一步', name: k };

  const layers = s.layers === undefined ? undefined : (checkLayers(s.layers), s.layers as unknown[]);
  if (layers?.length && !stages.includes('layers')) fail('清单的 map.layers 要在 map.stages 里写上 layers');
  if (stages.includes('layers') && !layers?.length) fail('清单的 map.stages 写了 layers,要在 map.layers 里登记交哪几张图层');
  if (s.params !== undefined) checkParams(s.params, '清单的 map.params');

  const wanted = new Set(m.requires.map(capName));
  for (const k of known) if (!wanted.has(MAP_STAGE_CAPS[k])) fail(`清单的 map.stages 写了 ${k},要在 requires 里写上 ${MAP_STAGE_CAPS[k]}@1`);
  return need;
}

/** requires 里要了、map.stages 里没写那一步的能力(多要的) */
export function mapCapsUnused(m: { map?: Pick<MapManifest, 'stages'>; requires: readonly string[] }): string[] {
  const stages = new Set((isObj(m.map) && Array.isArray(m.map.stages) ? (m.map as Obj).stages : []) as unknown[]);
  const used = new Set([...stages].flatMap((k) => (typeof k === 'string' && has(MAP_STAGE_CAPS, k) ? [MAP_STAGE_CAPS[k]] : [])));
  return m.requires.filter((c) => Object.values(MAP_STAGE_CAPS).includes(capName(c)) && !used.has(capName(c)));
}
