/**
 * 各国的账本(钱粮,control.ts 每年算的那本账抄一份下来给界面看;不影响推演)。
 *
 * 推演里的账每年算一次,全抄太大;这里只记:
 *   - 每 BOOK_EVERY 年,在世的各国各一行;
 *   - 年里国库好坏换了一档(fiscalMood)、在打的仗多了少了,那一年那一国也记一行。
 * 所以看某一年时取这一国那一年以前最近的一行:档位、打几场仗是准的,收入、国库是那一行的(最多差 BOOK_EVERY 年)。
 * 行按记的先后(年份不减)排;接着推时从存档里的账本接着记,和一口气推下来的一样。
 *
 * 单位是推演里的"千石"(只比大小)。列见 BOOK_COLS。
 */
import type { Civ, FiscalBook, Year } from './types';

/** 每几年各国记一行 */
export const BOOK_EVERY = 20;

/** 一行里的列(截留按那一州中央管得到几成分四档:直辖、代管、自治、割据) */
export const BOOK_COLS = ['田赋', '工商', '市税', '应缴', '实收', '收贡', '纳贡', '战事', '岁出', '国库', '窘迫', '截留直辖', '截留代管', '截留自治', '截留割据'] as const;
export type BookCol = (typeof BOOK_COLS)[number];
export const BOOK_WIDTH = BOOK_COLS.length;
const COL = Object.fromEntries(BOOK_COLS.map((c, i) => [c, i])) as Record<BookCol, number>;

/**
 * 国库好坏的四档:0 充裕(攒到 MOOD_FULL 以上)、1 尚可(MOOD_OK 以上)、2 拮据(还有一点,或空了但还收支相抵)、3 国用不足(窘迫 > 0)。
 * fill = 国库攒到几成(满 = 攒够了几年的应缴,见 control.ts 的 RESERVE)
 */
export const MOOD_FULL = 0.8;
export const MOOD_OK = 0.4;
export function fiscalMood(fill: number, broke: number): number {
  if (broke > 0) return 3;
  return fill >= MOOD_FULL ? 0 : fill >= MOOD_OK ? 1 : 2;
}

/** 推演时记账(DevModel 上挂一个;接着推时从存档的账本接着记) */
export class BookWriter {
  years: number[] = [];
  polities: number[] = [];
  data: number[] = [];
  /** 每国上一行的档位 × 1000 + 打几场仗(没记过 = 没有) */
  private last = new Map<number, number>();

  constructor(from?: FiscalBook) {
    if (!from) return;
    for (let i = 0; i < from.size; i++) {
      this.years.push(from.year[i]);
      this.polities.push(from.polity[i]);
      for (let c = 0; c < BOOK_WIDTH; c++) this.data.push(from.data[i * BOOK_WIDTH + c]);
    }
    for (let i = 0; i < this.years.length; i++) this.last.set(this.polities[i], this.key(i));
  }

  private key(i: number): number {
    const d = this.data;
    const o = i * BOOK_WIDTH;
    return fiscalMood(fillOf(d[o + COL.国库], d[o + COL.应缴]), d[o + COL.窘迫]) * 1000 + d[o + COL.战事];
  }

  /** 第 t 年以后(含)记的去掉(接着推的那一刻可能重算同一年) */
  trim(t: Year): void {
    let n = this.years.length;
    if (!n || this.years[n - 1] < t) return;
    while (n && this.years[n - 1] >= t) n--;
    this.years.length = n;
    this.polities.length = n;
    this.data.length = n * BOOK_WIDTH;
    this.last.clear();
    for (let i = 0; i < n; i++) this.last.set(this.polities[i], this.key(i));
  }

  /** 第 t 年国家 p 的账(row 按 BOOK_COLS 的先后);该记才记 */
  offer(t: Year, p: number, row: ArrayLike<number>): void {
    // 档位按存下来的精度(Float32)比,接着推时从存档重建的和这里一样
    const f = (c: number) => Math.fround(row[c]);
    const k = fiscalMood(fillOf(f(COL.国库), f(COL.应缴)), f(COL.窘迫)) * 1000 + f(COL.战事);
    if (t % BOOK_EVERY !== 0 && this.last.get(p) === k) return;
    this.last.set(p, k);
    this.years.push(t);
    this.polities.push(p);
    for (let c = 0; c < BOOK_WIDTH; c++) this.data.push(f(c));
  }

  /** 亡了的国家不再比档位(复国是新的编号) */
  forget(p: number): void {
    this.last.delete(p);
  }

  book(): FiscalBook | undefined {
    if (!this.years.length) return undefined;
    return { size: this.years.length, year: Int32Array.from(this.years), polity: Int32Array.from(this.polities), data: Float32Array.from(this.data) };
  }
}

/** 国库攒到几成(0–1;应缴是 0 的算满) */
export function fillOf(treasury: number, owed: number): number {
  const full = BOOK_RESERVE * owed;
  return full > 0 ? Math.min(1, Math.max(0, treasury / full)) : 1;
}
/** 国库最多攒几年的应缴(和 control.ts 的 RESERVE 一样;那边改了这里跟着改,单测核对) */
export const BOOK_RESERVE = 1.5;

/** 账本里的一行 */
export interface BookRow {
  /** 记这一行的年份 */
  year: Year;
  values: Record<BookCol, number>;
}

function rowAt(b: FiscalBook, i: number): BookRow {
  const values = {} as Record<BookCol, number>;
  for (let c = 0; c < BOOK_WIDTH; c++) values[BOOK_COLS[c]] = b.data[i * BOOK_WIDTH + c];
  return { year: b.year[i], values };
}

/** 账本里第一行年份大于 year 的位置 */
function after(b: FiscalBook, year: Year): number {
  let lo = 0;
  let hi = b.size;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b.year[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 国家 p 第 year 年的账:那一年以前(含)最近的一行;没有(旧版本的历史、那年还没立国、早亡了)= null */
export function fiscalAt(civ: Pick<Civ, 'development'>, p: number, year: Year): BookRow | null {
  const b = civ.development?.fiscal;
  if (!b) return null;
  const end = after(b, year);
  for (let i = end - 1; i >= 0 && b.year[i] > year - 2 * BOOK_EVERY; i--) if (b.polity[i] === p) return rowAt(b, i);
  return null;
}

/** 国家 p 历年的国库攒到几成和档位(每 BOOK_EVERY 年一个;给小柱、曲线用) */
export function fiscalSeries(civ: Pick<Civ, 'development'>, p: number): { year: Year; fill: number; mood: number }[] {
  const b = civ.development?.fiscal;
  const out: { year: Year; fill: number; mood: number }[] = [];
  if (!b) return out;
  for (let i = 0; i < b.size; i++) {
    if (b.polity[i] !== p || b.year[i] % BOOK_EVERY) continue;
    const o = i * BOOK_WIDTH;
    const fill = fillOf(b.data[o + COL.国库], b.data[o + COL.应缴]);
    out.push({ year: b.year[i], fill, mood: fiscalMood(fill, b.data[o + COL.窘迫]) });
  }
  return out;
}
