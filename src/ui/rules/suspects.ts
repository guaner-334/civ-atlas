/**
 * 一套规则推不下去时,说可能是哪几项太极端:改过的项里,滑条上离官方最远、到了最边上的那几项。纯计算,不碰 DOM。
 *
 * 推演出错时不知道是哪一项引起的(几项放在一起才出事的也有),只能挑最可疑的说"可能是":
 *   1. 到了滑条最边上的(×4、不发生、0 年、永不……)先挑
 *   2. 再比离官方走了多远:往那一头已经走了几成(官方在 ×1、拉到 ×4 = 十成;拉到 ×2 = 那一头的五成)
 *   3. 再比走了几格;都一样的照项表的先后
 * 区间(两个把手)按走得最远的那个把手算。
 */
import { TUNING_ITEMS, cleanTuning, type TuningItem, type TuningValue } from '../../gen/civ/tuning';
import { tuningBrief } from '../../gen/civ/tuningText';
import { officialSlots, slotsOf, thumbsOf } from './sliderMath';

/** 一项走了多远:[到了最边上 1 / 没有 0, 往那一头走了几成, 走了几格] */
function reachOf(x: TuningItem, v: TuningValue): [number, number, number] {
  const slots = slotsOf(x);
  const last = slots.length - 1;
  const now = thumbsOf(x, v, slots);
  const off = officialSlots(x, slots);
  let best: [number, number, number] = [0, 0, 0];
  now.forEach((i, k) => {
    const o = off[k] ?? off[0];
    const d = Math.abs(i - o);
    if (!d) return;
    const room = i > o ? last - o : o;
    const r: [number, number, number] = [i === 0 || i === last ? 1 : 0, room ? d / room : 1, d];
    if (r[0] > best[0] || (r[0] === best[0] && (r[1] > best[1] || (r[1] === best[1] && r[2] > best[2])))) best = r;
  });
  return best;
}

export interface Suspect {
  /** 规则项编号 */
  id: string;
  /** 这一项改成了什么(和摘要里一样:"战争 ×4""议和后 0 年不再开战") */
  text: string;
}

/** 一套规则(改过的项)里最可疑的几项(最多 max 项;一项都没改 = 空) */
export function suspectItems(values: unknown, max = 2): Suspect[] {
  const v = cleanTuning(values).values;
  const list = TUNING_ITEMS.flatMap((x, order) => {
    if (!(x.id in v)) return [];
    const r = reachOf(x, v[x.id]);
    return r[2] ? [{ x, r, order }] : [];
  });
  list.sort((a, b) => b.r[0] - a.r[0] || b.r[1] - a.r[1] || b.r[2] - a.r[2] || a.order - b.order);
  return list.slice(0, Math.max(0, max)).map(({ x }) => ({ id: x.id, text: tuningBrief(x, v[x.id]) }));
}
