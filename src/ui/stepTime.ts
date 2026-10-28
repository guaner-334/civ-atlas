/**
 * 逐年推演里一刻、一段怎么写(纯计算,单测直接测):停在年中写到月("第 1549 年菊月"),年初只写年;
 * 起了名字的月写名字,只写年的世界(months = 0)照旧只写年。时刻是带小数的年份(见 stepwisePlan.ts 文件头)。
 */
import { YEAR_TICKS } from '../gen/edits';
import { eraText, monthLabel, yearFull, yearMonthAt, yearMonthFull, type Era } from '../gen/era';

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
const atYear = (y: number) => Math.abs(y - Math.round(y)) < 1e-6;

/**
 * 这一段 [from, to)(to = 停下的那一刻,不含)怎么写:一个月里的 "第 1552 年杏月";正好一整年 "第 1552 年";
 * 整年的 "第 2650–2675 年"(和以前一样);别的两头写到月 "第 1549 年菊月–1574 年菊月"
 */
export function spanText(from: number, to: number, months: number, era?: Era | null, names?: readonly string[] | null): string {
  if (oneMonth(from, to, months)) return yearMonthFull((from + to) / 2, months, era, names);
  if (atYear(from) && atYear(to)) {
    const a = Math.round(from);
    const b = Math.round(to);
    return b - a === 1 ? yearFull(a, era) : eraText(`第 ${a}–${b} 年`, era);
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
