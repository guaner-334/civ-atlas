/**
 * 插件自己的数据:设置(store.local,不在世界里)和存进世界的数据(store.world)。
 * 检查在这里;存到哪由调用的地方给(PluginDataStore),没给就先放在内存里。
 */
import type { World } from '../gen/world';
import { argsOf, bad, int, isRec, over } from './check';
import { approxBytes } from './protocol';
import type { StoredData } from './types';

export const STORE_LOCAL_MAX = 64 * 1024;
export const STORE_WORLD_MAX = 1024 * 1024;
const DEPTH_MAX = 32;
const SCHEMA_MAX = 1e9;

/** 一个插件一份;get 取不到 = null,set(null) = 删掉。可以是异步的 */
export interface PluginDataStore {
  get(pluginId: string): StoredData | null | Promise<StoredData | null>;
  set(pluginId: string, data: StoredData | null): void | Promise<void>;
}

/** 只存在内存里的一份(关了网页就没了) */
export function memoryStore(): PluginDataStore {
  const m = new Map<string, StoredData>();
  return {
    get: (pid) => m.get(pid) ?? null,
    set: (pid, d) => void (d ? m.set(pid, d) : m.delete(pid)),
  };
}

const sharedLocal = memoryStore();
const worldStores = new WeakMap<World, PluginDataStore>();
/** 没给存到哪时用的:设置所有世界共用一份,世界的数据跟着这个打开的世界 */
export const defaultLocalStore = (): PluginDataStore => sharedLocal;
export function defaultWorldStore(world: World): PluginDataStore {
  let s = worldStores.get(world);
  if (!s) worldStores.set(world, (s = memoryStore()));
  return s;
}

const NUMERIC = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];

/** 查值能不能存:只认数据,不认函数、Map、日期这类;不许 __proto__ 这类键、不许绕成圈。查过的对象不再查(同一个对象可以被引用很多次) */
function checkValue(v: unknown, depth: number, up: Set<object>, done: Set<object>, at: string): void {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) bad(`${at} 不能是 NaN 或无穷大`);
    return;
  }
  if (typeof v !== 'object') return bad(`${at} 不能存(${typeof v})`);
  if (depth > DEPTH_MAX) over(`最多套 ${DEPTH_MAX} 层`);
  if (ArrayBuffer.isView(v)) {
    if (!NUMERIC.some((T) => v instanceof T)) bad(`${at} 这种数组不能存`);
    return;
  }
  if (up.has(v)) return bad(`${at} 绕成圈了`);
  if (done.has(v)) return;
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return bad(`${at} 只能是普通对象`);
  up.add(v);
  if (Array.isArray(v)) {
    // 传过来的数组可以带着别的键,存的时候不一定留得住
    if (Object.keys(v).length !== v.length) bad(`${at} 是数组,不能有空位或别的键`);
    for (let i = 0; i < v.length; i++) checkValue(v[i], depth + 1, up, done, `${at}[${i}]`);
  } else
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') bad(`${at} 里有不许用的键 ${k}`);
      checkValue((v as Record<string, unknown>)[k], depth + 1, up, done, `${at}.${k}`);
    }
  up.delete(v);
  done.add(v);
}

/** 插件交来的 { schema, value };max 字节(估的) */
export function checkStored(raw: unknown, max: number): StoredData {
  const a = argsOf(raw);
  const schema = int(a.schema, 'schema', 1, SCHEMA_MAX);
  if (!('value' in a) || a.value === undefined) bad('要给 value');
  if (approxBytes(a.value, max) > max) over(`最多 ${Math.round(max / 1024)} KB`);
  checkValue(a.value, 1, new Set(), new Set(), 'value');
  return { schema, value: a.value };
}

/** 存着的那份交回去之前再看一眼(存到哪是外面给的,读回来的不一定还是这个样子) */
export function storedOut(d: unknown): StoredData | null {
  if (!isRec(d) || !Number.isInteger(d.schema) || !('value' in d)) return null;
  return { schema: d.schema as number, value: d.value };
}
