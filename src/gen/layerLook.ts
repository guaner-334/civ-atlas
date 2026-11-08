/**
 * 插件图层的样子:标题、渐变或分类、图例、透明度。工具插件交的地块图层(plugin/check.ts)、推演插件标的图层、世界文件里的图层块都照这一份查。
 * 不合格的交给 fail(limit = 超上限,bad = 写得不对);合格的换成网站自己的一份:字去掉控制字符和改书写方向的字、换行换成空格,颜色换成小写。纯计算
 */

export interface LayerLook {
  title: string;
  /** 渐变:2–16 个颜色,从 min 到 max */
  ramp?: { colors: string[]; min?: number; max?: number };
  /** 分类:1–32 类 */
  classes?: { value: number; color: string; label: string }[];
  legend?: string;
  /** 0–1 */
  opacity?: number;
}

export type LookFail = (kind: 'bad' | 'limit', text: string) => never;

const plain: LookFail = (_, text) => {
  throw new Error(text);
};

const TITLE_MAX = 40;
const RAMP_COLORS_MAX = 16;
const CLASSES_MAX = 32;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x) && !ArrayBuffer.isView(x);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g;
const HEX = /^#[0-9a-fA-F]{6}$/;

function text(v: unknown, at: string, fail: LookFail): string {
  if (typeof v !== 'string') return fail('bad', `${at} 要是字`);
  const s = v.replace(CONTROL, '').replace(/[\r\n]+/g, ' ');
  return s.length > TITLE_MAX ? fail('limit', `${at} 最多 ${TITLE_MAX} 个字`) : s;
}

function num(v: unknown, at: string, fail: LookFail, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail('bad', `${at} 要是数`);
  if (v < min || v > max) return fail('bad', `${at} 要在 ${min} 到 ${max} 之间`);
  return v;
}

function list(v: unknown, at: string, max: number, fail: LookFail): unknown[] {
  if (!Array.isArray(v)) return fail('bad', `${at} 要是数组`);
  return v.length > max ? fail('limit', `${at} 最多 ${max} 项`) : v;
}

const hex = (v: unknown, at: string, fail: LookFail): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fail('bad', `${at} 要写成 #rrggbb`));

/** 查样子(别的键不管),交回网站这边的一份 */
export function checkLayerLook(raw: unknown, fail: LookFail = plain): LayerLook {
  const a = raw === undefined || raw === null ? {} : isRec(raw) ? raw : fail('bad', '参数要是一个对象');
  const out: LayerLook = { title: text(a.title, 'title', fail) };
  layerLookRest(a, out, fail);
  return out;
}

/** 一样东西写成键排好序的 JSON(比两份样子时不看键的先后) */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) => (isRec(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** raw 里的样子(标题、渐变或分类、图例、透明度,连同里面的键)和 look 一模一样,不看键的先后 */
export function sameLayerLook(raw: Rec, look: LayerLook): boolean {
  return (['title', 'ramp', 'classes', 'legend', 'opacity'] as const).every((k) => canon(raw[k]) === canon(look[k]));
}

/** 标题以外的几样,接着写到 out 上(先后:渐变或分类、图例、透明度) */
export function layerLookRest(a: Rec, out: LayerLook, fail: LookFail = plain): void {
  if ((a.ramp === undefined) === (a.classes === undefined)) fail('bad', 'ramp 和 classes 给且只给一个');
  if (a.ramp !== undefined) {
    const r = isRec(a.ramp) ? a.ramp : fail('bad', 'ramp 要是对象');
    const colors = list(r.colors, 'ramp.colors', RAMP_COLORS_MAX, fail).map((c, i) => hex(c, `ramp.colors[${i}]`, fail));
    if (colors.length < 2) fail('bad', 'ramp.colors 至少两个');
    const min = r.min === undefined ? undefined : num(r.min, 'ramp.min', fail);
    const max = r.max === undefined ? undefined : num(r.max, 'ramp.max', fail);
    if (min !== undefined && max !== undefined && !(min < max)) fail('bad', 'ramp.min 要小于 max');
    out.ramp = { colors, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  } else {
    const seen = new Set<number>();
    out.classes = list(a.classes, 'classes', CLASSES_MAX, fail).map((c, i) => {
      if (!isRec(c)) return fail('bad', `classes[${i}] 要是对象`);
      const value = num(c.value, `classes[${i}].value`, fail, -(2 ** 31), 2 ** 31 - 1);
      if (!Number.isInteger(value)) fail('bad', `classes[${i}].value 要是整数`);
      if (seen.has(value)) fail('bad', `classes[${i}].value 重了`);
      seen.add(value);
      return { value, color: hex(c.color, `classes[${i}].color`, fail), label: text(c.label, `classes[${i}].label`, fail) };
    });
    if (!out.classes.length) fail('bad', 'classes 至少一类');
  }
  const legend = a.legend === undefined ? undefined : text(a.legend, 'legend', fail);
  if (legend !== undefined) out.legend = legend;
  const opacity = a.opacity === undefined ? undefined : num(a.opacity, 'opacity', fail, 0, 1);
  if (opacity !== undefined) out.opacity = opacity;
}
