/**
 * 国家卡片「钱粮」一行和钱粮页(FiscalPage.tsx)要的数:从推演记下的账本(gen/civ/fiscalBook.ts)取那一年的一行,换成页面上写的样子。
 * 账本单位是千石,页面上写万石(取整)。纯计算,不碰 DOM。
 */
import type { Civ, Year } from '../gen/civ/types';
import { FISCAL_CONSTS } from '../gen/civ/control';
import { fillOf, fiscalAt, fiscalMood, fiscalSeries, foesAt } from '../gen/civ/fiscalBook';

/** 四档的说法 */
export const MOOD_NAMES = ['充裕', '尚可', '拮据', '国用不足'] as const;

/** 千石 → 万石(取整) */
export function wan(v: number): number {
  return Math.round(v / 10);
}

const DIGITS = '〇一二三四五六七八九';
/** 几成:0.66 → "六成六",0.7 → "七成",不到一成 → "不到一成",满 → "全数" */
export function chengText(x: number): string {
  const k = Math.round(x * 100);
  if (k >= 100) return '全数';
  if (k < 10) return '不到一成';
  const a = Math.floor(k / 10);
  const b = k % 10;
  return `${DIGITS[a]}成${b ? DIGITS[b] : ''}`;
}

export interface FiscalView {
  /** 账本里这一行是哪一年记的 */
  rowYear: Year;
  /** 三样收入(千石) */
  land: number;
  craft: number;
  trade: number;
  owed: number;
  got: number;
  /** 各地截留 = 应缴 − 实收 */
  kept: number;
  /** 截留按管辖四档(直辖、代管、自治、割据) */
  keptBy: [number, number, number, number];
  tribIn: number;
  tribOut: number;
  /** 养官、军费 */
  office: number;
  army: number;
  spent: number;
  income: number;
  /** 每年结余(负 = 亏) */
  net: number;
  treasury: number;
  /** 国库攒到几成(0–1) */
  fill: number;
  /** 0 充裕、1 尚可、2 拮据、3 国用不足 */
  mood: number;
  /** 在打几场仗 */
  wars: number;
  /** 那一年在和哪几国打 */
  foes: number[];
}

/** 国家 p 第 year 年的账(没有账本 = null) */
export function fiscalView(civ: Civ, p: number, year: Year): FiscalView | null {
  const row = fiscalAt(civ, p, year);
  if (!row) return null;
  const v = row.values;
  const office = FISCAL_CONSTS.OFFICE * v.应缴;
  const income = v.实收 + v.收贡;
  const fill = fillOf(v.国库, v.应缴);
  return {
    rowYear: row.year,
    land: v.田赋,
    craft: v.工商,
    trade: v.市税,
    owed: v.应缴,
    got: v.实收,
    kept: Math.max(0, v.应缴 - v.实收),
    keptBy: [v.截留直辖, v.截留代管, v.截留自治, v.截留割据],
    tribIn: v.收贡,
    tribOut: v.纳贡,
    office,
    army: Math.max(0, v.岁出 - office - v.纳贡),
    spent: v.岁出,
    income,
    net: income - v.岁出,
    treasury: v.国库,
    fill,
    mood: fiscalMood(fill, v.窘迫),
    wars: v.战事,
    foes: foesAt(civ, p, year),
  };
}

/** 历年国库攒到几成(给小柱、曲线) */
export function fiscalHistory(civ: Civ, p: number): { year: Year; fill: number; mood: number }[] {
  return fiscalSeries(civ, p);
}

/** 这国记过国用不足的年份 */
export function fiscalAlarms(civ: Civ, p: number): Year[] {
  return civ.annals.filter((e) => e.kind === 'fiscal' && e.a === p).map((e) => e.year);
}
