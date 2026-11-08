/**
 * 检查插件交来的东西:调用的参数、面板、图层。纯计算,不碰 DOM。
 * 不合格的一律抛 PluginApiError(网站回给插件),合格的换成网站自己的一份(插件那边再改也影响不到)。
 */
import type { CellLayerSpec, Hex, LayerMarkColor, MarkItem, MarkLayerSpec, MarkStyle, PanelNode, PluginErrorCode, RegionLayerSpec } from './types';
import { layerLookRest, type LookFail } from '../gen/layerLook';

export class PluginApiError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    text: string,
  ) {
    super(text);
    this.name = 'PluginApiError';
  }
}

export const bad = (text: string): never => {
  throw new PluginApiError('bad-args', text);
};
export const over = (text: string): never => {
  throw new PluginApiError('limit', text);
};

export type Rec = Record<string, unknown>;
export const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x) && !ArrayBuffer.isView(x);

/** 参数对象:没给 = 空对象 */
export function argsOf(raw: unknown): Rec {
  if (raw === undefined || raw === null) return {};
  return isRec(raw) ? raw : bad('参数要是一个对象');
}

export function num(v: unknown, at: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${at} 要是数`);
  if (v < min || v > max) return bad(`${at} 要在 ${min} 到 ${max} 之间`);
  return v;
}
export function int(v: unknown, at: string, min: number, max: number): number {
  const n = num(v, at, min, max);
  return Number.isInteger(n) ? n : bad(`${at} 要是整数`);
}
export const optNum = (v: unknown, at: string, min?: number, max?: number) => (v === undefined ? undefined : num(v, at, min, max));
export const optInt = (v: unknown, at: string, min: number, max: number) => (v === undefined ? undefined : int(v, at, min, max));

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g;

/** 一段字:去掉控制字符和改书写方向的字符;multiline = 留着换行。超过 max 个字是超上限 */
export function text(v: unknown, at: string, max: number, multiline = false): string {
  if (typeof v !== 'string') return bad(`${at} 要是字`);
  let s = v.replace(CONTROL, '');
  s = multiline ? s.replace(/\r\n?/g, '\n') : s.replace(/[\r\n]+/g, ' ');
  return s.length > max ? over(`${at} 最多 ${max} 个字`) : s;
}
export const optText = (v: unknown, at: string, max: number) => (v === undefined ? undefined : text(v, at, max));

const HEX = /^#[0-9a-fA-F]{6}$/;
export function hex(v: unknown, at: string): Hex {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : bad(`${at} 要写成 #rrggbb`);
}

/** 面板控件、图层的 id */
const ID = /^[A-Za-z0-9_-]{1,32}$/;
export function id(v: unknown, at: string): string {
  return typeof v === 'string' && ID.test(v) ? v : bad(`${at} 只能有字母、数字、- 和 _,最长 32`);
}

export function list(v: unknown, at: string, max: number): unknown[] {
  if (!Array.isArray(v)) return bad(`${at} 要是数组`);
  return v.length > max ? over(`${at} 最多 ${max} 项`) : v;
}

/** 一串数(数组或 TypedArray) */
export function numbers(v: unknown, at: string, max: number): ArrayLike<number> {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    if (v instanceof BigInt64Array || v instanceof BigUint64Array) return bad(`${at} 不能是 BigInt 数组`);
    const a = v as unknown as ArrayLike<number>;
    return a.length > max ? over(`${at} 最多 ${max} 个`) : a;
  }
  const a = list(v, at, max);
  for (let i = 0; i < a.length; i++) if (typeof a[i] !== 'number') bad(`${at}[${i}] 要是数`);
  return a as number[];
}

/** 一串地块编号 → Int32Array */
export function cellList(v: unknown, at: string, cells: number, max: number): Int32Array {
  const a = numbers(v, at, max);
  const out = new Int32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    if (!Number.isInteger(c) || c < 0 || c >= cells) bad(`${at}[${i}] 不是地块编号`);
    out[i] = c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 面板

export const PANEL_NODES_MAX = 2000;
export const PANEL_TEXT_MAX = 4000;
export const PANEL_ROWS_MAX = 500;
const PANEL_COLUMNS_MAX = 20;
const PANEL_OPTIONS_MAX = 100;
const PANEL_DEPTH_MAX = 4;
/** 表格的格子、列表的项、下拉的选项、图例加起来最多几个(同一份表格可以被引用很多次,要按展开以后数) */
export const PANEL_ITEMS_MAX = 20_000;
/** 一个标签、按钮上的字最多几个 */
const LABEL_MAX = 80;

/** 面板整个查一遍,返回网站这边的一份 */
export function checkPanel(raw: unknown): PanelNode[] {
  let nodes = 0;
  let chars = 0;
  let items = 0;
  const spend = <T,>(arr: T[]): T[] => {
    items += arr.length;
    return items > PANEL_ITEMS_MAX ? over(`面板的表格格子、列表、选项一共最多 ${PANEL_ITEMS_MAX} 个`) : arr;
  };
  const ids = new Set<string>();
  const t = (v: unknown, at: string, max = PANEL_TEXT_MAX, multi = false) => {
    const s = text(v, at, max, multi);
    chars += s.length;
    if (chars > PANEL_TEXT_MAX) over(`面板的字一共最多 ${PANEL_TEXT_MAX} 个`);
    return s;
  };
  const ot = (v: unknown, at: string, max = LABEL_MAX) => (v === undefined ? undefined : t(v, at, max));
  const cid = (v: unknown, at: string) => {
    const s = id(v, at);
    if (ids.has(s)) bad(`${at} 和别的控件重了`);
    ids.add(s);
    return s;
  };
  const walk = (arr: unknown, at: string, depth: number): PanelNode[] => {
    if (depth > PANEL_DEPTH_MAX) over(`面板最多套 ${PANEL_DEPTH_MAX} 层`);
    return list(arr, at, PANEL_NODES_MAX).map((x, i) => {
      const p = `${at}[${i}]`;
      if (++nodes > PANEL_NODES_MAX) over(`面板最多 ${PANEL_NODES_MAX} 个节点`);
      if (!isRec(x)) return bad(`${p} 要是对象`);
      switch (x.type) {
        case 'heading':
          return { type: 'heading', text: t(x.text, `${p}.text`, LABEL_MAX) };
        case 'text':
          return { type: 'text', text: t(x.text, `${p}.text`, PANEL_TEXT_MAX, true) };
        case 'number': {
          const unit = ot(x.unit, `${p}.unit`, 16);
          return { type: 'number', label: t(x.label, `${p}.label`, LABEL_MAX), value: num(x.value, `${p}.value`), ...(unit !== undefined ? { unit } : {}) };
        }
        case 'table': {
          const columns = spend(list(x.columns, `${p}.columns`, PANEL_COLUMNS_MAX)).map((c, k) => t(c, `${p}.columns[${k}]`, LABEL_MAX));
          const rows = spend(list(x.rows, `${p}.rows`, PANEL_ROWS_MAX)).map((r, k) =>
            spend(list(r, `${p}.rows[${k}]`, PANEL_COLUMNS_MAX)).map((c, j) => (typeof c === 'number' ? num(c, `${p}.rows[${k}][${j}]`) : t(c, `${p}.rows[${k}][${j}]`, LABEL_MAX))),
          );
          return { type: 'table', columns, rows };
        }
        case 'list':
          return { type: 'list', items: spend(list(x.items, `${p}.items`, PANEL_ROWS_MAX)).map((c, k) => t(c, `${p}.items[${k}]`, LABEL_MAX)) };
        case 'button':
          return { type: 'button', id: cid(x.id, `${p}.id`), label: t(x.label, `${p}.label`, LABEL_MAX), ...(x.disabled === true ? { disabled: true } : {}) };
        case 'select': {
          const options = spend(list(x.options, `${p}.options`, PANEL_OPTIONS_MAX)).map((o, k) => {
            if (!isRec(o)) return bad(`${p}.options[${k}] 要是对象`);
            return { value: id(o.value, `${p}.options[${k}].value`), label: t(o.label, `${p}.options[${k}].label`, LABEL_MAX) };
          });
          if (!options.length) bad(`${p}.options 至少一项`);
          const value = x.value === undefined ? undefined : id(x.value, `${p}.value`);
          if (value !== undefined && !options.some((o) => o.value === value)) bad(`${p}.value 不在 options 里`);
          return { type: 'select', id: cid(x.id, `${p}.id`), label: t(x.label, `${p}.label`, LABEL_MAX), options, ...(value !== undefined ? { value } : {}) };
        }
        case 'slider': {
          const min = num(x.min, `${p}.min`);
          const max = num(x.max, `${p}.max`);
          if (!(min < max)) bad(`${p}.min 要小于 max`);
          const step = optNum(x.step, `${p}.step`, 0, max - min);
          if (step === 0) bad(`${p}.step 要大于 0`);
          return { type: 'slider', id: cid(x.id, `${p}.id`), label: t(x.label, `${p}.label`, LABEL_MAX), min, max, ...(step !== undefined ? { step } : {}), value: num(x.value, `${p}.value`, min, max) };
        }
        case 'toggle':
          if (typeof x.value !== 'boolean') bad(`${p}.value 要是 true 或 false`);
          return { type: 'toggle', id: cid(x.id, `${p}.id`), label: t(x.label, `${p}.label`, LABEL_MAX), value: x.value as boolean };
        case 'legend':
          return {
            type: 'legend',
            items: spend(list(x.items, `${p}.items`, 32)).map((o, k) => {
              if (!isRec(o)) return bad(`${p}.items[${k}] 要是对象`);
              return { color: hex(o.color, `${p}.items[${k}].color`), label: t(o.label, `${p}.items[${k}].label`, LABEL_MAX) };
            }),
          };
        case 'divider':
          return { type: 'divider' };
        case 'progress': {
          const label = ot(x.label, `${p}.label`);
          return { type: 'progress', value: num(x.value, `${p}.value`, 0, 1), ...(label !== undefined ? { label } : {}) };
        }
        case 'group': {
          const title = ot(x.title, `${p}.title`);
          return { type: 'group', ...(title !== undefined ? { title } : {}), children: walk(x.children, `${p}.children`, depth + 1) };
        }
        default:
          return bad(`${p}.type 不认得:${String(x.type).slice(0, 20)}`);
      }
    });
  };
  return walk(raw, 'nodes', 1);
}

/** 面板上的控件:用的人动了以后,值要合这个控件(网站这边画面板的代码交来的,也照样查) */
export function panelValue(nodes: readonly PanelNode[], cid: string, value: unknown): { id: string; value?: string | number | boolean } | null {
  const find = (arr: readonly PanelNode[]): PanelNode | null => {
    for (const n of arr) {
      if ('id' in n && n.id === cid) return n;
      if (n.type === 'group') {
        const f = find(n.children);
        if (f) return f;
      }
    }
    return null;
  };
  const n = find(nodes);
  if (!n) return null;
  if (n.type === 'button') return n.disabled ? null : { id: cid };
  if (n.type === 'toggle') return typeof value === 'boolean' ? { id: cid, value } : null;
  if (n.type === 'select') return typeof value === 'string' && n.options.some((o) => o.value === value) ? { id: cid, value } : null;
  if (n.type === 'slider') return typeof value === 'number' && value >= n.min && value <= n.max ? { id: cid, value } : null;
  return null;
}

// ---------------------------------------------------------------------------
// 图层

export const LAYERS_MAX = 4;
export const MARK_ITEMS_MAX = 5000;
export const MARK_TEXT_MAX = 40;
/** 一个标注图层里的地块和点一共最多几个 */
export const MARK_POINTS_MAX = 200_000;
const TITLE_MAX = 40;

/** 网站这边的一份地块图层:值换成 Float32Array,不是有限数的换成 NaN */
export interface CellLayer {
  kind: 'cells';
  id: string;
  title: string;
  values: Float32Array;
  ramp?: { colors: Hex[]; min?: number; max?: number };
  classes?: { value: number; color: Hex; label: string }[];
  legend?: string;
  opacity?: number;
}

/** 样子的查法和存进世界的插件图层同一份(gen/layerLook.ts) */
const lookFail: LookFail = (kind, text) => (kind === 'limit' ? over(text) : bad(text));

export function checkCellLayer(raw: unknown, cells: number): CellLayer {
  const a = argsOf(raw) as Partial<Record<keyof CellLayerSpec, unknown>>;
  const out: CellLayer = { kind: 'cells', id: id(a.id, 'id'), title: text(a.title, 'title', TITLE_MAX), values: new Float32Array(cells) };
  const v = numbers(a.values, 'values', cells);
  if (v.length !== cells) bad(`values 要有 ${cells} 个(每个地块一个)`);
  for (let i = 0; i < cells; i++) out.values[i] = Number.isFinite(v[i]) ? v[i] : NaN;
  layerLookRest(a, out, lookFail);
  return out;
}

/** 一个按州按年份的图层的数最多占多少字节:插件一次发给网站的话最多 4 MiB,留出别的字段 */
export const REGION_LAYER_BYTES = 3.5e6;

/** 网站这边的一份按州按年份的图层:years 是整数年,values 是份数 × 州数,不是有限数的换成 NaN */
export interface RegionLayer extends Omit<CellLayer, 'kind'> {
  kind: 'regions';
  years: number[];
}

/** 按州按年份的图层:regions = 历史的州数,end = 历史推到哪年 */
export function checkRegionLayer(raw: unknown, regions: number, end: number): RegionLayer {
  const a = argsOf(raw) as Partial<Record<keyof RegionLayerSpec, unknown>>;
  const out: RegionLayer = { kind: 'regions', id: id(a.id, 'id'), title: text(a.title, 'title', TITLE_MAX), years: [], values: new Float32Array(0) };
  const ys = numbers(a.years, 'years', Math.floor(end) + 1);
  if (!ys.length) bad('years 至少一个');
  for (let k = 0; k < ys.length; k++) {
    const y = ys[k];
    if (!Number.isInteger(y) || y < 0 || y > end || (k > 0 && !(y > ys[k - 1]))) bad(`years[${k}] 不对:要是整数、从小到大、在 0 到 ${Math.floor(end)} 之间`);
    out.years.push(y);
  }
  const want = ys.length * regions;
  if (want * 4 > REGION_LAYER_BYTES) over(`交得太多:${ys.length} 份 × ${regions} 个州 × 4 字节 = ${(want * 4 / 1e6).toFixed(1)} MB,一个图层最多 ${REGION_LAYER_BYTES / 1e6} MB。把间隔调大`);
  const v = numbers(a.values, 'values', want);
  if (v.length !== want) bad(`values 要有 ${want} 个(${ys.length} 份 × ${regions} 个州)`);
  out.values = new Float32Array(want);
  for (let i = 0; i < want; i++) out.values[i] = Number.isFinite(v[i]) ? v[i] : NaN;
  layerLookRest(a, out, lookFail);
  return out;
}

const LAYER_COLORS: readonly LayerMarkColor[] = ['red', 'orange', 'green', 'blue', 'purple', 'teal', 'black', 'white'];

/** 网站这边的一项标注:地块换成 Int32Array,点换成 Float32Array(x 规整到 [0, width)) */
export interface MarkLayerItem {
  kind: MarkItem['kind'];
  cells?: Int32Array;
  points?: Float32Array;
  text?: string;
  style?: MarkStyle;
}
export interface MarkLayer {
  kind: 'marks';
  id: string;
  title: string;
  items: MarkLayerItem[];
}

function checkStyle(raw: unknown, at: string): MarkStyle | undefined {
  if (raw === undefined) return undefined;
  if (!isRec(raw)) return bad(`${at} 要是对象`);
  const s: MarkStyle = {};
  if (raw.color !== undefined) s.color = LAYER_COLORS.includes(raw.color as LayerMarkColor) ? (raw.color as LayerMarkColor) : bad(`${at}.color 只能是 ${LAYER_COLORS.join('、')}`);
  if (raw.line !== undefined) s.line = raw.line === 'solid' || raw.line === 'dashed' ? raw.line : bad(`${at}.line 只能是 solid、dashed`);
  if (raw.size !== undefined) s.size = raw.size === 's' || raw.size === 'm' || raw.size === 'l' ? raw.size : bad(`${at}.size 只能是 s、m、l`);
  return s;
}

export function checkMarkLayer(raw: unknown, world: { cells: number; width: number; height: number }): MarkLayer {
  const a = argsOf(raw) as Partial<Record<keyof MarkLayerSpec, unknown>>;
  const out: MarkLayer = { kind: 'marks', id: id(a.id, 'id'), title: text(a.title, 'title', TITLE_MAX), items: [] };
  let budget = MARK_POINTS_MAX;
  const spend = (n: number) => {
    budget -= n;
    if (budget < 0) over(`一个标注图层的地块和点一共最多 ${MARK_POINTS_MAX} 个`);
  };
  for (const [i, x] of list(a.items, 'items', MARK_ITEMS_MAX).entries()) {
    const p = `items[${i}]`;
    if (!isRec(x)) bad(`${p} 要是对象`);
    const it = x as Rec;
    const kind = it.kind;
    if (kind !== 'point' && kind !== 'label' && kind !== 'line' && kind !== 'area') bad(`${p}.kind 只能是 point、label、line、area`);
    const k = kind as MarkLayerItem['kind'];
    const item: MarkLayerItem = { kind: k };
    if (it.cells !== undefined && it.points !== undefined) bad(`${p} 的 cells 和 points 只给一个`);
    if (it.cells !== undefined) {
      item.cells = cellList(it.cells, `${p}.cells`, world.cells, budget);
      spend(item.cells.length);
    } else if (it.points !== undefined) {
      if (k === 'area') bad(`${p} 圈地块只认 cells`);
      const pts = numbers(it.points, `${p}.points`, 2 * budget);
      if (pts.length % 2) bad(`${p}.points 要成对(x, y)`);
      item.points = new Float32Array(pts.length);
      for (let j = 0; j < pts.length; j += 2) {
        const px = num(pts[j], `${p}.points[${j}]`);
        const py = num(pts[j + 1], `${p}.points[${j + 1}]`, 0, world.height);
        item.points[j] = ((px % world.width) + world.width) % world.width;
        item.points[j + 1] = py;
      }
      spend(pts.length / 2);
    } else bad(`${p} 要给 cells 或 points`);
    const n = item.cells ? item.cells.length : item.points!.length / 2;
    if ((k === 'point' || k === 'label') && n !== 1) bad(`${p} 是一个点,只能给一个位置`);
    if (k === 'line' && n < 2) bad(`${p} 是线,至少两个位置`);
    if (k === 'area' && n < 1) bad(`${p} 至少圈一个地块`);
    const t = optText(it.text, `${p}.text`, MARK_TEXT_MAX);
    if (k === 'label' && !t) bad(`${p} 是文字标注,要有 text`);
    if (t !== undefined) item.text = t;
    const style = checkStyle(it.style, `${p}.style`);
    if (style) item.style = style;
    out.items.push(item);
  }
  return out;
}
