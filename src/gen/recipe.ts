/**
 * 原件的格式(一份原件有哪几块)和配方指纹(生成一份结果用到的全部输入):首页的「我的世界」只要这些。
 * 打包、解开原件的代码在 snapshot.ts,首页用不着,分开放才不会跟着进首页要下载的那一份。
 */
import { cleanCivSeed, cleanPlay, endParamOf, type Intervention, type PlayState, type TerrainOp, type Upheaval } from './edits';
import type { SketchEdit } from './sketch';
import type { NameMix } from './names';
import { cleanFrontier, cleanOrigins, type Frontier, type Origins } from './civ/frontier';
import { cleanCalamity, type Calamity } from './civ/calamity';
import { worldTuning } from './civ/ruleSet';
import type { TuningValues, WorldTuning } from './civ/tuning';
import type { SaveFile } from './savefile';
import type { WorldParams } from './world';


/** 原件格式的版本(各块的结构有不兼容的变化时加一) */
export const SNAPSHOT_FORMAT = 1;

/** 一块原件 */
export interface SnapshotPart {
  /** 哪一块:map / eras / civ(以后可能有别的) */
  name: string;
  /** 压缩前的字节数 */
  bytes: number;
  /** 压缩前字节的 SHA-256(十六进制) */
  sum: string;
  /** 压缩方式:gzip / none */
  zip: 'gzip' | 'none';
  data: ArrayBuffer;
}

/** 一份原件 */
export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  /** 生成它的生成器版本(GENERATOR_VERSION) */
  generator: number;
  /** 配方指纹(recipeKey) */
  recipe: string;
  /** 带没带形成过程的回放快照(现在都不带) */
  formation: boolean;
  parts: SnapshotPart[];
}

// ---------------------------------------------------------------------------
// 配方指纹

/** 生成一份结果用到的全部输入(和 worker.ts 推文明的请求里同名的几项一样) */
export interface Recipe {
  params: WorldParams;
  terrain?: readonly TerrainOp[];
  sketch?: SketchEdit;
  interventions?: readonly Intervention[];
  upheavals?: readonly Upheaval[];
  names?: NameMix;
  /** 推演年数(带小数:年中停下存回的普通世界推到那一年的那一格,edits.ts 的 endParamOf;推到年初的是整数,和加这一项以前的指纹一样) */
  endYear?: number;
  frontier?: Frontier;
  origins?: Origins;
  /** 「天灾」(平常 = 不给,和加这一项以前的指纹一样) */
  calamity?: Calamity;
  /** 规则里改过的规则项(推演只看这一部分;官方 = 不给,和加这一项以前的指纹一样) */
  tuning?: TuningValues;
  /** 规则项按第几版换算(tuning.ts 的 TUNING_CALC;第 1 版、没改规则项 = 不给,和加这一项以前的指纹一样) */
  calc?: number;
  /** 文明种子(没给 = 地图种子;不给时和加这一项以前的指纹一样) */
  civSeed?: number;
  /** 逐年推演的进度(推到哪年 + 命令串;没在逐年推演 = 不给,和加这一项以前的指纹一样) */
  play?: PlayState;
}

/** 配方里规则那两项:改过的规则项、换算版本(第 1 版不写;没有规则项 = 都不写) */
export function recipeTuning(t: WorldTuning | undefined): Pick<Recipe, 'tuning' | 'calc'> {
  return t ? { tuning: t.values, ...(t.calc > 1 ? { calc: t.calc } : {}) } : {};
}

/** 规范成固定的样子:对象的键排好序、去掉 undefined;顶层的空数组、空对象、3000 年(默认的推演年数)当没给 */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canon(x);
    }
    return out;
  }
  return v;
}

/** 配方规范成的字符串(recipeKey 对它算指纹;单测直接比它) */
export function recipeText(r: Recipe): string {
  const top: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length) continue;
    if (k === 'endYear' && v === 3000) continue;
    top[k] = v;
  }
  return JSON.stringify(canon(top));
}

/** 存档里的配方:和 App 推这个(建好的)世界时交给 worker 的那几项取法一样 */
export function recipeOfSave(save: SaveFile): Recipe {
  const e = save.edits;
  return {
    params: save.params,
    terrain: e.terrain,
    sketch: e.sketch,
    interventions: e.interventions,
    upheavals: e.upheavals,
    names: e.nameMix,
    endYear: endParamOf(e),
    frontier: cleanFrontier(e.frontier),
    origins: cleanOrigins(e.origins),
    calamity: cleanCalamity(e.calamity),
    ...recipeTuning(worldTuning(e.rules)),
    civSeed: cleanCivSeed(e.civSeed),
    play: cleanPlay(e.play),
  };
}

/** 配方指纹:规范成的字符串的 SHA-256(十六进制) */
export function recipeKey(r: Recipe): Promise<string> {
  return sha256(new TextEncoder().encode(recipeText(r)));
}



/** SHA-256(十六进制) */
export async function sha256(data: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let s = '';
  for (const b of h) s += b.toString(16).padStart(2, '0');
  return s;
}

/** 原件里叫 name 的那一块;没有 = undefined */
export function partOf(s: Snapshot, name: string): SnapshotPart | undefined {
  return s.parts.find((p) => p.name === name);
}

/** 一份原件压缩后一共多少字节 */
export function snapshotSize(s: Snapshot): number {
  return s.parts.reduce((n, p) => n + p.data.byteLength, 0);
}
