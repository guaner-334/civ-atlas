/**
 * 故事模式写到月(ui/stepTime.ts):
 * - 时间轴大字、两头、"停着"、"在看"什么时候写到月:一步短于一年的一直写(年初写那一年的第一个月);一步一年以上只在停在年中时写
 * - 生效时间 "第 1549 年菊月初" / "第 2676 年年初";停一下卡片里每件事的时间 "1549 桂月";重新演绎时几个时刻合起来怎么写
 * - 年份框点开时的小字"已经演绎到第 1549 年菊月"
 * - 只写年的世界照旧只写年;没起名的月写数字
 */
import { describe, expect, it } from 'vitest';
import { ADVANCE_DEFAULT, YEAR_TICKS, type Advance } from '../src/gen/edits';
import { eventShort, momentAt, momentFull, momentShort, momentStart, momentTail, momentsText, monthly, spanNote, spanText } from '../src/ui/stepTime';

const N12 = ['端月', '杏月', '桃月', '槐月', '蒲月', '荷月', '兰月', '桂月', '菊月', '阳月', '葭月', '冰月'];
const at = (y: number, k = 0) => y + k / YEAR_TICKS;
const adv = (a: Partial<Advance> = {}): Advance => ({ ...ADVANCE_DEFAULT, ...a });
/** 第 1549 年菊月初 */
const JU = at(1549, 171);

describe('写到月', () => {
  it('一步短于一年才"一直写到月":一个月、一季、半年、几格是;一年、五年、几年不是', () => {
    expect(monthly(adv({ step: 1, unit: 'month' }), 12)).toBe(true);
    expect(monthly(adv({ step: 64, unit: 'tick' }), 12)).toBe(true);
    expect(monthly(adv({ step: 255, unit: 'tick' }), 12)).toBe(true);
    expect(monthly(adv({ step: 11, unit: 'month' }), 12)).toBe(true);
    expect(monthly(adv({ step: 12, unit: 'month' }), 12)).toBe(false);
    expect(monthly(adv({ step: 256, unit: 'tick' }), 12)).toBe(false);
    expect(monthly(adv(), 12)).toBe(false);
    expect(monthly(adv({ step: 5 }), 12)).toBe(false);
  });

  it('时间轴大字:停在年中写到月;年初的,一步短于一年写那一年第一个月,一步一年以上只写年(和以前一样)', () => {
    expect(momentTail(JU, 12, N12, false)).toBe('菊月');
    expect(momentTail(JU, 12, N12, true)).toBe('菊月');
    expect(momentTail(1550, 12, N12, true)).toBe('端月');
    expect(momentTail(1550, 12, N12, false)).toBe('');
    expect(momentTail(JU, 12, null, false)).toBe(' 9 月');
    expect(momentTail(JU, 0, N12, true)).toBe('');
    // 一年 24 个月
    expect(momentTail(at(1552, 11), 24, null, true)).toBe(' 2 月');
    expect(momentFull(JU, 12, null, N12, false)).toBe('第 1549 年菊月');
    expect(momentFull(2676, 12, null, N12, false)).toBe('第 2676 年');
    expect(momentFull(JU, 12, { name: '公元', epoch: 2500 }, N12, false)).toBe('公元前 951 年菊月');
    expect(momentAt(at(1574, 171), 12, null, N12, false)).toBe('1574 年菊月');
  });

  it('时间轴两头:年初的照旧只写年,年中的写到月', () => {
    expect(momentShort(1550, 12, null, N12, false)).toBe('1550');
    expect(momentShort(JU, 12, null, N12, false)).toBe('1549 年菊月');
    expect(momentShort(at(1552, 22), 12, null, N12, true)).toBe('1552 年杏月');
    expect(momentShort(JU, 0, null, N12, true)).toBe('1549');
  });

  it('年份框点开时的小字:"已经演绎到"写法同时间轴大字(年中写到月,年初只写年,一步短于一年年初也写月);推演模式照旧', () => {
    expect(spanNote(JU, 12, null, N12, true, false)).toBe('已经演绎到第 1549 年菊月');
    expect(spanNote(JU, 12, null, null, true, false)).toBe('已经演绎到第 1549 年 9 月');
    expect(spanNote(1550, 12, null, N12, true, false)).toBe('已经演绎到第 1550 年');
    expect(spanNote(1550, 12, null, N12, true, true)).toBe('已经演绎到第 1550 年端月');
    expect(spanNote(JU, 0, null, N12, true, true)).toBe('已经演绎到第 1549 年');
    expect(spanNote(JU, 12, { name: '公元', epoch: 2500 }, N12, true, false)).toBe('已经演绎到公元前 951 年菊月');
    // 推演模式(不是逐年推演):从第 0 年推到哪一刻,年初的不受 always 影响
    expect(spanNote(JU, 12, null, N12, false, true)).toBe('这个世界从第 0 年推到第 1549 年菊月');
    expect(spanNote(3000, 12, null, N12, false, true)).toBe('这个世界从第 0 年推到第 3000 年');
  });

  it('生效时间:"第 2676 年年初""第 1549 年菊月初";只写年的世界停在年中只写年', () => {
    expect(momentStart(2676, 12, null, N12, false)).toBe('第 2676 年年初');
    expect(momentStart(JU, 12, null, N12, false)).toBe('第 1549 年菊月初');
    expect(momentStart(1550, 12, null, N12, true)).toBe('第 1550 年端月初');
    expect(momentStart(JU, 0, null, N12, true)).toBe('第 1549 年');
    expect(momentStart(1550, 0, null, N12, true)).toBe('第 1550 年年初');
  });

  it('停一下卡片里每件事的时间:一步短于一年 "1549 桂月",没起名 "1549 年 8 月";不然照旧 "1549"', () => {
    expect(eventShort(1549.613, 12, null, N12, true)).toBe('1549 桂月');
    expect(eventShort(1549.613, 12, null, null, true)).toBe('1549 年 8 月');
    expect(eventShort(1549.613, 12, null, N12, false)).toBe('1549');
    expect(eventShort(1549.613, 0, null, N12, true)).toBe('1549');
    // 年初的事(干预、地形大事这类)不写月
    expect(eventShort(1550, 12, null, N12, true)).toBe('1550');
  });

  it('停一下卡片的标题:整年的照旧;年中的两头写到月;一个月的写那个月', () => {
    expect(spanText(2650, 2675, 12, null, N12, false)).toBe('第 2650–2675 年');
    expect(spanText(2650, 2651, 12, null, N12, false)).toBe('第 2650–2651 年');
    expect(spanText(JU, at(1574, 171), 12, null, N12, false)).toBe('第 1549 年菊月–1574 年菊月');
    expect(spanText(at(1552, 22), at(1552, 43), 12, null, N12, false)).toBe('第 1552 年杏月');
  });

  it('重新演绎时"哪几年加的干预":都在年初照旧;有年中的写到月', () => {
    expect(momentsText([1549], 12, null, N12, false)).toBe('第 1549 年');
    expect(momentsText([1552, 1549, 1550], 12, null, N12, false)).toBe('第 1549–1552 年');
    expect(momentsText([JU], 12, null, N12, false)).toBe('第 1549 年菊月');
    expect(momentsText([JU, at(1552, 22)], 12, null, N12, false)).toBe('第 1549 年菊月–1552 年杏月');
    expect(momentsText([JU, JU], 12, null, N12, true)).toBe('第 1549 年菊月');
    expect(momentsText([JU, at(1552, 22)], 0, null, N12, true)).toBe('第 1549–1552 年');
  });
});
