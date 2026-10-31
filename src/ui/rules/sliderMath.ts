/**
 * 调规则的滑条:一项规则项(gen/civ/tuning.ts)在滑条上分哪几格、每格是什么值、官方在哪一格、刻度和两头的字。纯计算,不碰 DOM。
 *
 * - 倍数档:×¼ ×½ ×¾ ×1 ×1.5 ×2 ×3 ×4 各一格,能关的最左多一格 0(不发生);官方 = ×1 那一格
 * - 数值:从最小到最大按步长一格一格(和读进来时清理吸到的档一样,值一模一样);能关的最左多一格「关」,有「永不」的最右多一格
 * - 区间:同上一格一格,两个把手各停在一格上(前一个不在后一个右边)
 *
 * 格在滑条上平均摆开:第 i 格在 i / (格数 − 1) 处(0 = 最左,1 = 最右)。
 * 刻度:格不多(≤ TICK_ALL 格)的每格一个点,多的只画七个平均的点(看个大概,不和格一一对上)。
 */
import { fmt, multSteps, type NumItem, type RangeItem, type TuningItem, type TuningValue } from '../../gen/civ/tuning';

/** 滑条上的一格 */
export type Slot = number | 'never' | 'off';

/** 格数不超过这么多的每格画一个刻度点 */
const TICK_ALL = 13;

/** 步长的小数位数(和 tuning.ts 清理时吸到档上一样舍入) */
const decimals = (x: number) => {
  const s = String(x);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

/** 数值、区间从最小到最大按步长的各格(和 tuning.ts 的 snap 算出来的一样) */
function numSlots(x: NumItem | RangeItem): number[] {
  const d = Math.max(decimals(x.step), decimals(x.min));
  const n = Math.round((x.max - x.min) / x.step);
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push(Math.min(x.max, Number((x.min + k * x.step).toFixed(d))));
  return out;
}

/** 一项滑条上的各格(从左到右) */
export function slotsOf(x: TuningItem): Slot[] {
  if (x.kind === 'mult') return [...multSteps(x)];
  const nums: Slot[] = numSlots(x);
  if (x.kind === 'num' && x.offable) nums.unshift('off');
  if (x.kind === 'num' && x.never) nums.push('never');
  return nums;
}

/** 值落在哪一格(对不上的取最近的一格;永不 / 关没有那一格的取最右 / 最左) */
export function slotIndex(slots: readonly Slot[], v: Slot): number {
  const i = slots.indexOf(v);
  if (i >= 0) return i;
  if (v === 'never') return slots.length - 1;
  if (v === 'off') return 0;
  let best = 0;
  let gap = Infinity;
  slots.forEach((s, k) => {
    if (typeof s !== 'number') return;
    const g = Math.abs(s - v);
    if (g < gap) {
      gap = g;
      best = k;
    }
  });
  return best;
}

/** 第 i 格在滑条上的位置(0–1) */
export const slotFrac = (slots: readonly Slot[], i: number): number => (slots.length > 1 ? i / (slots.length - 1) : 0);

/** 滑条上的一个位置(0–1)离哪一格最近 */
export const nearestSlot = (slots: readonly Slot[], frac: number): number => Math.round(Math.min(1, Math.max(0, frac)) * (slots.length - 1));

/** 一项现在的值(没改 = 官方)在哪几格:倍数、数值一个把手,区间两个 */
export function thumbsOf(x: TuningItem, v: TuningValue, slots: readonly Slot[] = slotsOf(x)): number[] {
  if (x.kind === 'range') {
    const [a, b] = Array.isArray(v) ? v : x.official;
    return [slotIndex(slots, a), slotIndex(slots, b)];
  }
  return [slotIndex(slots, v as Slot)];
}

/** 官方值在哪几格(区间两格) */
export function officialSlots(x: TuningItem, slots: readonly Slot[] = slotsOf(x)): number[] {
  if (x.kind === 'mult') return [slotIndex(slots, 1)];
  if (x.kind === 'range') return [slotIndex(slots, x.official[0]), slotIndex(slots, x.official[1])];
  return [slotIndex(slots, x.official)];
}

/** 把手停在这几格时的值(区间的两格先后对调好) */
export function valueAt(x: TuningItem, idx: readonly number[], slots: readonly Slot[] = slotsOf(x)): TuningValue {
  if (x.kind === 'range') {
    const [i, j] = idx[0] <= idx[1] ? [idx[0], idx[1]] : [idx[1], idx[0]];
    return [slots[i] as number, slots[j] as number];
  }
  return slots[idx[0]];
}

/** 刻度点的位置(0–1) */
export function ticksOf(slots: readonly Slot[]): number[] {
  if (slots.length <= TICK_ALL) return slots.map((_, i) => slotFrac(slots, i));
  return [0, 1, 2, 3, 4, 5, 6].map((i) => i / 6);
}

/** 两头写的数(滑条下面左右两个小字):几成换成 0–10,百分比带 %,温度带 ° */
function edgeNum(x: NumItem | RangeItem, v: number): string {
  if (x.unit === '成') return fmt(v * 10);
  if (x.unit === '%') return `${fmt(v * 100)}%`;
  if (x.unit === '°C') return `${fmt(v)}°`;
  return fmt(v);
}

/** 滑条下面最左、最右写什么 */
export function edgeLabels(x: TuningItem): [string, string] {
  if (x.kind === 'mult') return [x.off ? '不发生' : '×¼', '×4'];
  const left = x.kind === 'num' && x.offable ? '关' : edgeNum(x, x.min);
  const right = x.kind === 'num' && x.never ? '永不' : edgeNum(x, x.max);
  return [left, right];
}

/** 「官方」两个字写在哪(0–1):官方那一格;区间写在两格中间 */
export function officialLabelAt(x: TuningItem, slots: readonly Slot[] = slotsOf(x)): number {
  const o = officialSlots(x, slots);
  return o.length > 1 ? (slotFrac(slots, o[0]) + slotFrac(slots, o[1])) / 2 : slotFrac(slots, o[0]);
}

/**
 * 涂主色的那一段(0–1 的两头;不涂 = null):倍数、数值从官方那一格涂到现在的位置(没改不涂);
 * 区间涂两个把手中间(没改的也涂,用浅灰,见 RuleRows.tsx)
 */
export function fillSpan(x: TuningItem, thumbs: readonly number[], slots: readonly Slot[] = slotsOf(x)): [number, number] | null {
  if (x.kind === 'range') {
    const a = slotFrac(slots, Math.min(thumbs[0], thumbs[1]));
    const b = slotFrac(slots, Math.max(thumbs[0], thumbs[1]));
    return [a, b];
  }
  const o = slotFrac(slots, officialSlots(x, slots)[0]);
  const p = slotFrac(slots, thumbs[0]);
  return o === p ? null : [Math.min(o, p), Math.max(o, p)];
}

/** 区间挪哪个把手:离点的位置近的那个;两个叠在一起时往左挪左边那个、往右挪右边那个 */
export function pickThumb(thumbs: readonly number[], at: number): number {
  if (thumbs.length < 2) return 0;
  const [a, b] = thumbs;
  if (a === b) return at < a ? 0 : 1;
  return Math.abs(at - a) <= Math.abs(at - b) ? 0 : 1;
}

/** 键盘挪一格:把手 k 往左(−1)往右(+1)挪一格,区间的两个把手不交叉;返回新的各格 */
export function stepThumb(thumbs: readonly number[], k: number, dir: number, count: number): number[] {
  const next = thumbs.slice();
  let i = Math.min(count - 1, Math.max(0, next[k] + dir));
  if (next.length > 1) i = k === 0 ? Math.min(i, next[1]) : Math.max(i, next[0]);
  next[k] = i;
  return next;
}
