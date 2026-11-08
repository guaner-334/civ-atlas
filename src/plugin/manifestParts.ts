/**
 * 推演插件、地图插件清单各段共用的小检查:一项一项查,写错了抛 Error(读插件文件时算坏了)。纯计算。
 */

/** 这一版网站不认得的一样东西:什么(影响口、命令、口子……)、叫什么 */
export interface ManifestNeed {
  what: string;
  name: string;
}

/** 新建世界时拨的一个滑条:插件里读 civAtlas.params.<名字> */
export interface ManifestParam {
  /** 滑条的名字 */
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}

export type Obj = Record<string, unknown>;

/** 一个插件最多几个滑条、滑条名字最长几个字 */
export const PARAMS_MAX = 8;
export const PARAM_LABEL_MAX = 12;

export const TABLE_ID_MAX = 64;
export const KEY = /^[a-z][a-z0-9.]{0,63}$/;
const PARAM_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// eslint-disable-next-line no-control-regex
const BAD_TEXT = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

export const fail = (message: string): never => {
  throw new Error(message);
};
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function obj(v: unknown, at: string): Obj {
  return isObj(v) ? v : fail(`${at} 不是对象`);
}
export function list(v: unknown, at: string, max: number): unknown[] {
  if (!Array.isArray(v)) return fail(`${at} 不是列表`);
  return v.length > max ? fail(`${at} 最多 ${max} 项`) : v;
}
export function num(v: unknown, at: string): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(`${at} 要是数`);
}
export function str(v: unknown, at: string, max = TABLE_ID_MAX): string {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : fail(`${at} 要写 1 到 ${max} 个字`);
}
export function line(v: unknown, at: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) return fail(`${at} 不能空着`);
  if (v.length > max) fail(`${at} 太长`);
  return BAD_TEXT.test(v) ? fail(`${at} 里有不许用的字符`) : v;
}
/** 一串名字:不重复、合 KEY 的写法 */
export function names(v: unknown, at: string, max: number): string[] {
  const out = list(v, at, max).map((x, i) => (typeof x === 'string' && KEY.test(x) ? x : fail(`${at}[${i}] 不合规矩`)));
  const dup = out.find((x, i) => out.indexOf(x) !== i);
  return dup === undefined ? out : fail(`${at} 里 ${dup} 写了两遍`);
}

/** 滑条:at = 报错时的位置,如「清单的 sim.params」 */
export function checkParams(raw: unknown, at: string): void {
  const p = obj(raw, at);
  const keys = Object.keys(p);
  if (keys.length > PARAMS_MAX) fail(`${at} 最多 ${PARAMS_MAX} 个`);
  for (const k of keys) {
    if (!PARAM_KEY.test(k)) fail(`${at} 里的 ${k.slice(0, 40)} 只能用字母、数字和下划线,不以数字开头,最长 32 个字`);
    const here = `${at}.${k}`;
    const q = obj(p[k], here);
    line(q.label, `${here}.label`, PARAM_LABEL_MAX);
    const min = num(q.min, `${here}.min`);
    const max = num(q.max, `${here}.max`);
    const def = num(q.default, `${here}.default`);
    if (!(min < max)) fail(`${here}.min 要小于 max`);
    if (def < min || def > max) fail(`${here}.default 要在 min 和 max 之间`);
    if (q.step !== undefined) {
      const step = num(q.step, `${here}.step`);
      if (!(step > 0 && step <= max - min)) fail(`${here}.step 要大于 0、不超过 max − min`);
    }
  }
}
