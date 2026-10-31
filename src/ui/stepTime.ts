/**
 * 逐年推演里一刻、一段怎么写(纯计算,单测直接测):停在年中写到月("第 1549 年菊月"),年初只写年;
 * 起了名字的月写名字,只写年的世界(months = 0)照旧只写年。时刻是带小数的年份(见 stepwisePlan.ts 文件头)。
 */
import { YEAR_TICKS, type Advance } from '../gen/edits';
import { eraText, monthLabel, monthOf, monthTail, yearAt, yearFull, yearMonthAt, yearMonthFull, yearShort, yearShortAt, type Era } from '../gen/era';
import { stepYears } from './stepwisePlan';

/** 一步短于一年(按月、按格走):时间轴大字、卡片、字幕一直写到月;一步一年以上只在停在年中时写 */
export function monthly(advance: Pick<Advance, 'step' | 'unit'>, months: number): boolean {
  return stepYears(advance, months) < 1;
}

/** [from, to) 正好落在一个月里:那是第几月(1 起);跨了月、只写年 = 0 */
export function oneMonth(from: number, to: number, months: number): number {
  if (!(months > 0) || !(to > from)) return 0;
  const a = Math.floor(from * YEAR_TICKS + 1e-6);
  const b = Math.ceil(to * YEAR_TICKS - 1e-6) - 1;
  if (Math.floor(a / YEAR_TICKS) !== Math.floor(b / YEAR_TICKS)) return 0;
  const m = (t: number) => Math.floor(((t - Math.floor(t / YEAR_TICKS) * YEAR_TICKS) * months) / YEAR_TICKS);
  return m(a) === m(b) ? m(a) + 1 : 0;
}

/** 正好在年初 */
export const atYear = (y: number): boolean => Math.abs(y - Math.round(y)) < 1e-6;

/** 年初那一刻按那一年的第一个月算(写到月时"第 1550 年端月") */
const inMonth = (y: number) => (atYear(y) ? Math.round(y) + 1 / (2 * YEAR_TICKS) : y);

/**
 * 一刻接在年份后面的月份:年中的写那一月;正好在年初的,always(一步短于一年)时写那一年的第一个月,不然不写;
 * 只写年的世界(months = 0)不写。"菊月"" 9 月"''
 */
export function momentTail(y: number, months: number, names: readonly string[] | null | undefined, always: boolean): string {
  if (!(months > 0) || (atYear(y) && !always)) return '';
  return monthTail(inMonth(y), months, names);
}

/** 一刻,全写:"第 1549 年菊月""第 2676 年"(见 momentTail) */
export function momentFull(y: number, months: number, era: Era | null | undefined, names: readonly string[] | null | undefined, always: boolean): string {
  return yearFull(y, era) + momentTail(y, months, names, always);
}

/**
 * 年份框点开时提示下面的小字:推演模式 "这个世界从第 0 年推到第 1549 年菊月"(推到年中的写到月,年初只写年);
 * 逐年推演(future)"已经演绎到第 1549 年菊月",写法和时间轴大字一样(always = 一步短于一年,年初也写那一年第一个月)
 */
export function spanNote(end: number, months: number, era: Era | null | undefined, names: readonly string[] | null | undefined, future: boolean, always: boolean): string {
  return future ? `已经演绎到${momentFull(end, months, era, names, always)}` : `这个世界从${yearFull(0, era)}推到${momentFull(end, months, era, names, false)}`;
}

/** 一刻,句子里:"1549 年菊月""2676 年" */
export function momentAt(y: number, months: number, era: Era | null | undefined, names: readonly string[] | null | undefined, always: boolean): string {
  return yearAt(y, era) + momentTail(y, months, names, always);
}

/** 一刻,短写(时间轴两头):年初 "1550",写到月 "1549 年菊月" */
export function momentShort(y: number, months: number, era: Era | null | undefined, names: readonly string[] | null | undefined, always: boolean): string {
  const t = momentTail(y, months, names, always);
  return t ? yearShortAt(y, era) + t : yearShort(y, era);
}

/** 从这一刻起生效:"第 1549 年菊月初""第 2676 年年初";只写年的世界停在年中 "第 1549 年" */
export function momentStart(y: number, months: number, era: Era | null | undefined, names: readonly string[] | null | undefined, always: boolean): string {
  const t = momentTail(y, months, names, always);
  if (t) return `${yearFull(y, era)}${t}初`;
  return atYear(y) ? `${yearFull(y, era)}年初` : yearFull(y, era);
}

/** 一件事的年份,短写(停一下卡片里):"1549";写到月 "1549 桂月";没起名 "1549 年 8 月" */
export function eventShort(y: number, months: number, era: Era | null | undefined, names: readonly string[] | null | undefined, withMonth: boolean): string {
  const m = withMonth && months > 0 ? monthOf(y, months) : 0;
  if (!m) return yearShort(y, era);
  return names?.[m - 1] ? `${yearShort(y, era)} ${names[m - 1]}` : `${yearShortAt(y, era)} ${m} 月`;
}

/**
 * 这一段 [from, to)(to = 停下的那一刻,不含)怎么写:一个月里的 "第 1552 年杏月";正好一整年 "第 1552 年";
 * 整年的 "第 2650–2675 年"(和以前一样;single = false 时正好一整年也这么写);别的两头写到月 "第 1549 年菊月–1574 年菊月"
 */
export function spanText(from: number, to: number, months: number, era?: Era | null, names?: readonly string[] | null, single = true): string {
  if (oneMonth(from, to, months)) return yearMonthFull((from + to) / 2, months, era, names);
  if (atYear(from) && atYear(to)) {
    const a = Math.round(from);
    const b = Math.round(to);
    return b - a === 1 && single ? yearFull(a, era) : eraText(`第 ${a}–${b} 年`, era);
  }
  // 只写年的世界:年中的也只写年
  if (!(months > 0)) {
    const a = Math.floor(from + 1e-9);
    const b = Math.floor(to + 1e-9);
    return a === b ? yearFull(a, era) : eraText(`第 ${a}–${b} 年`, era);
  }
  return `${yearMonthFull(from, months, era, names)}–${yearMonthAt(to, months, era, names)}`;
}

/** 手机上更短:一个月里的只写月名 "杏月""3 月";别的同 spanText */
export function spanShort(from: number, to: number, months: number, era?: Era | null, names?: readonly string[] | null): string {
  const m = oneMonth(from, to, months);
  return m ? monthLabel(m, names) : spanText(from, to, months, era, names);
}

/**
 * 几个时刻合起来怎么写(重新演绎时"哪几年加的干预"):都在年初的照旧 "第 1549 年""第 1549–1552 年";
 * 有年中的写到月 "第 1549 年菊月""第 1549 年菊月–1552 年杏月"
 */
export function momentsText(ats: readonly number[], months: number, era: Era | null | undefined, names: readonly string[] | null | undefined, always: boolean): string {
  const xs = [...new Set(ats)].sort((a, b) => a - b);
  if (!xs.length) return '';
  if (!(months > 0) || (!always && xs.every(atYear))) {
    const ys = [...new Set(xs.map((x) => Math.floor(x + 1e-9)))];
    return ys.length === 1 ? yearFull(ys[0], era) : eraText(`第 ${ys[0]}–${ys[ys.length - 1]} 年`, era);
  }
  const a = momentFull(xs[0], months, era, names, always);
  const b = xs[xs.length - 1];
  return a === momentFull(b, months, era, names, always) ? a : `${a}–${momentAt(b, months, era, names, always)}`;
}
