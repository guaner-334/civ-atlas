/**
 * 旋钮:推演里"调参"的那些数(开战的赔率、冷却几年、各种倍数……)登记成一张张表,每个子系统的文件里一张(或几张)。
 * 表里是名字和默认值(说明写在每一项上面的注释里);推演照 values 里的数算。
 * 现在每张表在载入时就取出各项当常量用,值就是默认值;以后要按世界换一套数时,改的是"从哪里取",表本身不用动。
 */

/** 一项旋钮的值:一个数,或几个数(区间、按档的倍数……) */
export type KnobValue = number | readonly number[];

/** 一张旋钮表 */
export interface Knobs<T extends Record<string, KnobValue>> {
  /** 表的名字(子系统的文件名;一个文件里有几段调参的,第二段起带 #2、#3……) */
  readonly id: string;
  /** 各项的值 */
  readonly values: Readonly<T>;
  /** 各项的名字(照登记的先后) */
  readonly names: readonly (keyof T & string)[];
}

/** 登记一张旋钮表 */
export function defineKnobs<T extends Record<string, KnobValue>>(id: string, values: T): Knobs<T> {
  return { id, values, names: Object.keys(values) as (keyof T & string)[] };
}
